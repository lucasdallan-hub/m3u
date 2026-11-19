export function publicHttps(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
      /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(url.hostname) &&
      !/\.(?:localhost|local|internal|lan|onion|test|invalid|example|home\.arpa)$/.test(url.hostname)) {
      return url;
    }
  } catch {
    // Ignore malformed addresses.
  }
  return null;
}

export function magnetUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    const hash = /^(?:urn:btih:(?:[0-9a-f]{40}|[a-z2-7]{32})|urn:btmh:1220[0-9a-f]{64})$/i;
    if (url.protocol === "magnet:" && !url.host && !url.pathname &&
      url.searchParams.getAll("xt").some(value => hash.test(value))) {
      return url;
    }
  } catch {
    // Ignore malformed magnet links.
  }
  return null;
}

export function addMediaLinks(list, videos, downloadDireto) {
  const links = [];
  for (const video of videos) {
    const magnet = video?.tipo === "magnet";
    const url = magnet ? magnetUrl(video.url) : publicHttps(video?.url);
    if (!url || typeof video.name !== "string") continue;

    const row = document.createElement("li");
    const name = document.createElement("span");
    const link = document.createElement("a");
    const torrent = video.tipo === "torrent";
    name.textContent = video.name;
    if (magnet) {
      link.textContent = "Abrir no cliente BitTorrent";
      link.href = url.href;
    } else if (downloadDireto) {
      link.textContent = torrent ? "Abrir arquivo .torrent" : "Abrir vídeo";
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else {
      link.textContent = torrent ? "Baixar .torrent" : "Baixar";
      link.href = `/api/baixar?${new URLSearchParams({ url: url.href })}`;
      link.download = "";
    }
    link.setAttribute("aria-label", `${link.textContent} ${video.name}`);
    row.append(name, link);
    list.append(row);
    links.push({ link, tipo: video.tipo });
  }
  return links;
}
