const videoPath = /\.(mp4|mkv|webm|mov|m4v|avi)$/i;
const pageSize = 4 * 1024 * 1024;
const maxResults = 100;
const catalogHost = "filmesmp4.biz";

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function allowedUrl(value, hosts, base) {
  let url;
  try {
    url = new URL(value, base);
  } catch {
    throw new RequestError("Informe uma URL HTTPS válida.");
  }
  if (
    url.protocol !== "https:" || url.port || url.username || url.password ||
    (hosts.size ? !hosts.has(url.hostname) : !isPublicHostname(url.hostname))
  ) {
    throw new RequestError("Use um endereço HTTPS público permitido pela configuração.", 403);
  }
  url.hash = "";
  return url;
}

function isPublicHostname(hostname) {
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(hostname) &&
    !/\.(?:localhost|local|internal|lan|onion|test|invalid|example|home\.arpa)$/.test(hostname);
}

function isPublicAddress(address, type) {
  if (type === 28) {
    const [first, second] = address.toLowerCase().split(":");
    return /^[23][a-f0-9]{3}$/.test(first) && !["2002", "3fff"].includes(first) &&
      !(first === "2001" && (!second || second === "db8" || parseInt(second, 16) < 0x200));
  }
  const [first, second, third] = address.split(".").map(Number);
  return first > 0 && first < 224 && ![10, 127].includes(first) &&
    !(first === 100 && second >= 64 && second <= 127) &&
    !(first === 169 && second === 254) &&
    !(first === 172 && second >= 16 && second <= 31) &&
    !(first === 192 && (
      second === 168 || (second === 0 && [0, 2].includes(third)) ||
      (second === 88 && third === 99)
    )) &&
    !(first === 198 && ([18, 19].includes(second) || (second === 51 && third === 100))) &&
    !(first === 203 && second === 0 && third === 113);
}

async function checkPublicDns(hostname, signal) {
  const addresses = await Promise.all(["A", "AAAA"].map(async type => {
    const query = new URL("https://cloudflare-dns.com/dns-query");
    query.search = new URLSearchParams({ name: hostname, type });
    const response = await fetch(query, {
      headers: { Accept: "application/dns-json" },
      redirect: "manual",
      signal,
    });
    if (!response.ok) {
      throw new RequestError("Não foi possível validar o domínio da fonte.", 502);
    }
    const answer = await response.json();
    if (answer.Status !== 0) {
      throw new RequestError("O domínio da fonte não pôde ser resolvido.", 422);
    }
    return (answer.Answer ?? []).filter(record => [1, 28].includes(record.type));
  }));
  const records = addresses.flat();
  if (!records.length || records.some(({ data, type }) => !isPublicAddress(data, type))) {
    throw new RequestError("O domínio precisa resolver para endereços públicos.", 403);
  }
}

async function requestSource(url, hosts, accept, signal, origin) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (origin && url.origin !== origin) {
      throw new RequestError("O catálogo redirecionou para outro domínio.", 403);
    }
    if (!hosts.size) await checkPublicDns(url.hostname, signal);
    const response = await fetch(url, {
      headers: { Accept: accept },
      redirect: "manual",
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("Location");
      await response.body?.cancel();
      if (!next || redirects === 5) {
        throw new RequestError("A fonte retornou um redirecionamento inválido.", 502);
      }
      url = allowedUrl(next, hosts, url);
      continue;
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new RequestError(`A fonte respondeu com HTTP ${response.status}.`, 502);
    }
    return { response, url };
  }
}

function contentType(response) {
  return response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
}

function filename(url) {
  const segment = url.pathname.split("/").pop();
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

async function readHtml(url, hosts, origin) {
  const { response, url: base } = await requestSource(
    url, hosts, "text/html, application/xhtml+xml", AbortSignal.timeout(15000), origin,
  );
  if (!["text/html", "application/xhtml+xml"].includes(contentType(response))) {
    await response.body.cancel();
    throw new RequestError("Informe o endereço de uma página HTML.");
  }

  let bytes = 0;
  const limited = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > pageSize) {
        throw new RequestError("A página ultrapassa o limite de 4 MiB.", 413);
      }
      controller.enqueue(chunk);
    },
  }));
  return { base, html: new Response(limited, { headers: response.headers }) };
}

function coverUrl(element, base) {
  const attributes = ["data-src", "data-lazy-src", "data-original", "data-lazy", "data-poster", "data-bg"];
  const candidates = attributes.map(attribute => element.getAttribute(attribute));
  for (const attribute of ["data-srcset", "data-lazy-srcset", "srcset"]) {
    const srcset = element.getAttribute(attribute);
    if (srcset && !srcset.trimStart().startsWith("data:")) {
      candidates.push(...srcset.split(",").map(candidate => candidate.trim().split(/\s+/)[0]));
    }
  }
  candidates.push(
    element.getAttribute("style")?.match(/background(?:-image)?\s*:[^;]*?url\(\s*["']?([^"'()]+)["']?\s*\)/i)?.[1],
    element.getAttribute("src"),
  );
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      return allowedUrl(candidate.trim(), new Set(), base).href;
    } catch {
      // Try the next candidate when a placeholder or a non-public URL is provided.
    }
  }
  return null;
}

async function catalog(url, hosts) {
  if (url.hostname !== catalogHost) {
    throw new RequestError("Informe uma página do catálogo FilmesMP4.", 403);
  }
  const { base, html } = await readHtml(url, hosts, url.origin);
  const titles = new Map();
  let next = null;
  let anchor = null;

  function catalogLink(value) {
    if (!value) return null;
    try {
      const link = allowedUrl(value, hosts, base);
      return link.origin === base.origin ? link : null;
    } catch {
      return null;
    }
  }

  function pagination(element) {
    const rel = element.getAttribute("rel")?.toLowerCase().split(/\s+/) ?? [];
    if (!next && (rel.includes("next") ||
      element.getAttribute("class")?.split(/\s+/).includes("next"))) {
      const link = catalogLink(element.getAttribute("href"));
      if (link && link.href !== base.href) next = link.href;
    }
  }

  function captureCover(element) {
    const link = anchor?.url;
    if (!link || link.href === base.href || (link.pathname === "/" && !link.search) ||
      videoPath.test(link.pathname) || link.href === next) return;
    const image = coverUrl(element, base);
    if (!image && element.tagName !== "img") return;
    const alt = element.getAttribute("alt")?.trim();
    const existing = titles.get(link.href);
    const title = alt || anchor.title ||
      (filename(new URL(link.pathname.replace(/\/$/, "") || "/", link.origin)) || link.search)
        .replace(/[-_]/g, " ");
    titles.set(link.href, {
      url: link.href,
      titulo: alt || existing?.titulo || title,
      capa: existing?.capa || image,
    });
  }

  const parsed = new HTMLRewriter()
    .on("link[rel][href]", { element: pagination })
    .on("a[href]", {
      element(element) {
        pagination(element);
        anchor = {
          url: catalogLink(element.getAttribute("href")),
          title: element.getAttribute("title")?.trim() || element.getAttribute("aria-label")?.trim(),
        };
        captureCover(element);
        element.onEndTag(() => { anchor = null; });
      },
    })
    .on("a[href] img, a[href] picture source, a[href] [style], a[href] [data-bg], a[href] [data-poster]", {
      element: captureCover,
    })
    .transform(html);
  await parsed.body.pipeTo(new WritableStream());
  return Response.json({ titulos: [...titles.values()], proxima: next }, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function search(url, hosts, origin) {
  const { base, html } = await readHtml(url, hosts, origin);
  const videos = new Map();
  function collect(element, attribute) {
    const address = element.getAttribute(attribute)?.trim();
    if (!address || videos.size >= maxResults) return;
    let link;
    try {
      link = allowedUrl(address, hosts, base);
    } catch {
      return;
    }
    const name = filename(link);
    if (videoPath.test(name)) videos.set(link.href, { url: link.href, name });
  }

  const parsed = new HTMLRewriter()
    .on("a[href]", { element: element => collect(element, "href") })
    .on("video[src], source[src]", { element: element => collect(element, "src") })
    .transform(html);
  await parsed.body.pipeTo(new WritableStream());
  return Response.json({ videos: [...videos.values()], downloadDireto: !hosts.size }, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function download(url, hosts) {
  if (!videoPath.test(filename(url))) {
    throw new RequestError("Informe um link direto de vídeo.");
  }
  const { response } = await requestSource(url, hosts, "video/*, application/octet-stream");
  const type = contentType(response);
  if (!(type?.startsWith("video/") || ["application/octet-stream", "application/mp4"].includes(type))) {
    await response.body.cancel();
    throw new RequestError("A fonte não retornou um arquivo de vídeo.", 502);
  }
  const name = filename(url).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const extension = name.lastIndexOf(".");
  const attachment = name.slice(0, extension).slice(0, 100) + name.slice(extension);
  return new Response(response.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${attachment}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env) {
    const endpoint = new URL(request.url);
    if (!["/api/busca", "/api/baixar", "/api/catalogo"].includes(endpoint.pathname)) {
      return new Response("Página não encontrada.", { status: 404 });
    }
    if (request.method !== "GET") {
      return new Response(null, { status: 405, headers: { Allow: "GET" } });
    }

    try {
      const hosts = new Set((env.DOMINIOS_PERMITIDOS ?? "").toLowerCase().split(",").map(
        host => host.trim(),
      ).filter(Boolean));
      if (!hosts.size && endpoint.pathname === "/api/baixar") {
        throw new RequestError("No modo aberto o vídeo é acessado no site de origem.", 403);
      }
      const value = endpoint.searchParams.get("url")?.trim();
      if (!value || value.length > 4096) {
        throw new RequestError("Informe o endereço da página ou do vídeo.");
      }
      const url = allowedUrl(value.includes("://") ? value : `https://${value}`, hosts);
      if (endpoint.pathname === "/api/catalogo") return await catalog(url, hosts);
      if (endpoint.pathname === "/api/baixar") return await download(url, hosts);
      let origin;
      if (endpoint.searchParams.get("catalogo") === "1") {
        if (url.hostname !== catalogHost) {
          throw new RequestError("Informe uma página do catálogo FilmesMP4.", 403);
        }
        origin = url.origin;
      }
      return await search(url, hosts, origin);
    } catch (error) {
      return Response.json({
        erro: error instanceof RequestError ? error.message : "Não foi possível consultar a fonte.",
      }, {
        status: error instanceof RequestError ? error.status : 502,
        headers: { "Cache-Control": "no-store" },
      });
    }
  },
};
