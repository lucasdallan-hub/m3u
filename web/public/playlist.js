const entryDirective = /^#(?:EXT(?:ALB|ART|BYT|GENRE|GRP|HTTP|IMG|VLCOPT)|KODIPROP)(?=\s|:|$)/i;
const mediaExtension = /\.(?:aac|ac3|avi|flac|m3u8?|m4[av]|mkv|mov|mp[234d]|mpeg|mpg|m2?ts|oga|ogg|ogv|opus|strm|ts|wav|webm|wm[av])$/i;

function normalizedName(name) {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function normalizedCover(cover) {
  const value = cover.trim();
  if (!value) return "";
  try {
    if (value.startsWith("//")) return new URL(`https:${value}`).href.slice("https:".length);
    return new URL(value).href;
  } catch {
    return value;
  }
}

function nameSeparator(body) {
  let quote = "";
  let previous = "";
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (quote) {
      if (character === "\\") {
        index++;
        continue;
      }
      if (character === quote) quote = "";
    } else if (character === ",") {
      return index;
    } else if (previous === "=" && (character === '"' || character === "'")) {
      quote = character;
    }
    if (!/\s/u.test(character)) previous = character;
  }
  return -1;
}

function entryMetadata(body, lineNumber) {
  const separator = nameSeparator(body);
  if (separator === -1) {
    throw new Error(`Metadados #EXTINF inválidos na linha ${lineNumber}. Falta a vírgula antes do nome.`);
  }

  const attributes = new Map();
  const attribute = /(?:^|\s)([a-z_][a-z\d_.:-]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s]+))/gi;
  for (const [, key, doubleQuoted, singleQuoted, unquoted] of body.slice(0, separator).matchAll(attribute)) {
    const field = key.toLowerCase();
    if (!["tvg-name", "tvg-logo", "group-title", "tvg-type"].includes(field)) continue;
    const value = doubleQuoted ?? singleQuoted ?? unquoted;
    attributes.set(field, value.replace(/\\(["'\\])/g, "$1"));
  }

  return {
    name: body.slice(separator + 1).trim() || attributes.get("tvg-name")?.trim() || "",
    cover: normalizedCover(attributes.get("tvg-logo") ?? ""),
    group: attributes.get("group-title")?.trim() ?? "",
    type: attributes.get("tvg-type")?.trim() ?? "",
  };
}

function contentType(metadata, address) {
  const path = address.replace(/^(?:[a-z][a-z\d+.-]*:)?\/\/[^/]+/i, "");
  const section = path.match(/^\/?(live|movie|series)\//i)?.[1].toLowerCase();
  if (section === "live") return "channel";
  if (section) return section;

  const labels = normalizedName(`${metadata?.type ?? ""} ${metadata?.group ?? ""}`)
    .normalize("NFD").replace(/\p{M}/gu, "");
  if (/\b(s\d{1,3}[ ._-]*e\d{1,4}|\d{1,3}x\d{2,4}|episodio\s+\d+)\b/i.test(metadata?.name ?? "") ||
      /\b(series?|seriados?|tv shows?)\b/.test(labels)) return "series";
  if (/\b(filmes?|movies?|cinema)\b/.test(labels)) return "movie";
  if (/\b(canal|canais|channels?|live|ao vivo|tv)\b/.test(labels)) return "channel";
  return "unknown";
}

function isMediaAddress(line) {
  // Some IPTV players append request options after a vertical bar.
  const address = line.split("|", 1)[0].trimEnd();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(address)) {
    try {
      const url = new URL(address);
      return Boolean(url.hostname) || url.protocol === "file:";
    } catch {
      return false;
    }
  }
  const path = address.split(/[?#]/, 1)[0];
  return !/[<>{}]/.test(path) && (mediaExtension.test(path) || /(?:^|[^/\\])[\/\\][^/\\]/.test(path));
}

function parsePlaylist(text, catalogOnly) {
  if (typeof text !== "string" || !text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) {
    throw new Error("O arquivo deve conter uma playlist M3U ou M3U8 de texto.");
  }

  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const lines = text.slice(bom.length).split(/(\r\n|\n|\r)/);
  const output = [bom];
  const identities = new Set();
  const items = [];
  let pending = [];
  let metadata = null;
  let total = 0;
  let removidos = 0;

  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index].trim();
    const raw = lines[index] + (lines[index + 1] ?? "");
    const lineNumber = index / 2 + 1;
    if (/^#EXT-X-/i.test(line)) {
      throw new Error("Este arquivo é uma playlist HLS. Envie uma lista M3U ou M3U8 de canais ou vídeos.");
    }
    if (/^#EXTINF(?=\s|:|$)/i.test(line)) {
      if (metadata) {
        throw new Error(`A entrada #EXTINF anterior à linha ${lineNumber} não tem endereço de mídia.`);
      }
      if (!/^#EXTINF:/i.test(line)) {
        throw new Error(`Metadados #EXTINF inválidos na linha ${lineNumber}.`);
      }
      metadata = entryMetadata(line.slice("#EXTINF:".length), lineNumber);
      if (!catalogOnly) pending.push(raw);
      continue;
    }

    if (!line || line.startsWith("#")) {
      if (catalogOnly) continue;
      if (pending.length || entryDirective.test(line)) {
        pending.push(raw);
      } else {
        output.push(raw);
      }
      continue;
    }
    if (!isMediaAddress(line)) {
      throw new Error(`A linha ${lineNumber} não contém um endereço de mídia válido.`);
    }

    total++;
    const cover = metadata?.cover ?? "";
    if (catalogOnly) {
      const path = line.split(/[|?#]/, 1)[0].trimEnd();
      const filename = path.split(/[\\/]/).filter(Boolean).pop();
      items.push({
        name: metadata?.name || filename || `Item ${total}`,
        cover,
        group: metadata?.group ?? "",
        type: contentType(metadata, path),
      });
      metadata = null;
      continue;
    }
    const name = normalizedName(metadata?.name ?? "");
    const key = JSON.stringify(name && cover ? ["cover", name, cover] : ["address", name, line]);
    if (identities.has(key)) {
      removidos++;
    } else {
      identities.add(key);
      for (const directive of pending) output.push(directive);
      output.push(raw);
    }
    pending = [];
    metadata = null;
  }

  if (metadata) throw new Error("A última entrada #EXTINF não tem endereço de mídia.");
  if (!total) throw new Error("A playlist não contém endereços de mídia.");
  return catalogOnly ? { items } : { texto: output.join("") + pending.join(""), total, removidos };
}

export function importPlaylist(text) {
  return parsePlaylist(text, true);
}

export function cleanPlaylist(text) {
  return parsePlaylist(text, false);
}
