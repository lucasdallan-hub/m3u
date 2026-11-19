const videoPath = /\.(mp4|mkv|webm|mov|m4v|avi)$/i;
const pageSize = 4 * 1024 * 1024;
const maxResults = 100;
const catalogHost = "filmesmp4.biz";
const catalogFreshMs = 2 * 60 * 1000;
const catalogRetentionSeconds = 24 * 60 * 60;
const redirects = new Set([301, 302, 303, 307, 308]);
const transientStatuses = new Set([429, 502, 503, 504]);
const publicHosts = new Set();

class RequestError extends Error {
  constructor(message, status = 400, retryAfter = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function allowedUrl(value, hosts, base, { keepHash = false } = {}) {
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
  if (!keepHash) url.hash = "";
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
    const response = await fetchSource(query, {
      headers: { Accept: "application/dns-json" },
      redirect: "manual",
      signal,
    }, "o serviço de DNS");
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 503) {
        throw new RequestError(
          "O serviço de DNS está temporariamente indisponível (HTTP 503).",
          503,
          response.headers.get("Retry-After"),
        );
      }
      const status = upstreamStatus(response.status);
      throw new RequestError(
        `O serviço de DNS respondeu com HTTP ${response.status}.`,
        status,
        response.headers.get("Retry-After"),
      );
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

function upstreamStatus(status) {
  return (status >= 400 && status < 500) || transientStatuses.has(status) ? status : 502;
}

async function fetchSource(url, options, service) {
  try {
    return await fetch(url, options);
  } catch {
    if (options.signal?.aborted) {
      throw new RequestError(`O tempo para consultar ${service} se esgotou.`, 504);
    }
    throw new RequestError(`Não foi possível conectar a ${service}.`, 502);
  }
}

function sameCatalogHost(url, origin) {
  const domain = hostname => hostname.replace(/^www\./, "");
  return domain(url.hostname) === domain(new URL(origin).hostname);
}

async function requestSource(url, hosts, accept, signal, origin) {
  for (let hops = 0; hops <= 5; hops++) {
    if (origin && !sameCatalogHost(url, origin)) {
      throw new RequestError("O catálogo redirecionou para outro domínio.", 403);
    }
    if (!hosts.size) await checkPublicDns(url.hostname, signal);
    const response = await fetchSource(url, {
      headers: { Accept: accept },
      redirect: "manual",
      signal,
    }, "o site de origem");
    if (redirects.has(response.status)) {
      const next = response.headers.get("Location");
      await response.body?.cancel();
      if (!next || hops === 5) {
        throw new RequestError("A fonte retornou um redirecionamento inválido.", 502);
      }
      url = allowedUrl(next, hosts, url);
      continue;
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      if (response.status === 503) {
        throw new RequestError(
          "O site de origem está temporariamente indisponível (HTTP 503).",
          503,
          response.headers.get("Retry-After"),
        );
      }
      throw new RequestError(
        `A fonte respondeu com HTTP ${response.status}.`,
        upstreamStatus(response.status),
        response.headers.get("Retry-After"),
      );
    }
    return { response, url };
  }
}

function contentType(response) {
  return response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
}

function htmlUrl(value) {
  // HTMLRewriter may return the escaped separator. Leave percent-encoded values intact.
  return value?.trim().replace(/&(?:amp|#0*38|#x0*26);/gi, "&");
}

function filename(url) {
  const segment = url.pathname.split("/").pop();
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function boundedHtml(response, limit = pageSize) {
  let bytes = 0;
  const limited = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > limit) {
        throw new RequestError("A página ultrapassa o limite de leitura.", 413);
      }
      controller.enqueue(chunk);
    },
  }));
  return new Response(limited, { headers: response.headers });
}

function isHtml(response) {
  return ["text/html", "application/xhtml+xml"].includes(contentType(response));
}

async function readHtml(url, hosts, origin) {
  const { response, url: base } = await requestSource(
    url, hosts, "text/html, application/xhtml+xml", AbortSignal.timeout(15000), origin,
  );
  if (!isHtml(response)) {
    await response.body.cancel();
    throw new RequestError("Informe o endereço de uma página HTML.");
  }
  return { base, html: boundedHtml(response) };
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
      return allowedUrl(htmlUrl(candidate), new Set(), base).href;
    } catch {
      // Try the next candidate when a placeholder or a non-public URL is provided.
    }
  }
  return null;
}

async function catalog(url, hosts) {
  const { base, html } = await readHtml(url, hosts, url.origin);
  const titles = new Map();
  const videos = new Map();
  let next = null;
  let anchor = null;

  function catalogLink(value) {
    if (!value) return null;
    try {
      const link = allowedUrl(htmlUrl(value), hosts, base);
      return sameCatalogHost(link, base.origin) ? link : null;
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
      videoPath.test(filename(link)) || link.href === next) return;
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

  const rewriter = new HTMLRewriter()
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
    });
  readVideoLinks(rewriter, videos, base, hosts);
  const parsed = rewriter.transform(html);
  await parsed.body.pipeTo(new WritableStream());
  const result = { titulos: [...titles.values()], proxima: next };
  if (!result.titulos.length && videos.size) {
    result.videos = [...videos.values()];
    result.downloadDireto = !hosts.size;
  }
  return result;
}

async function serveCatalog(endpoint, url, hosts, context) {
  // Canonicalize the key so equivalent requests reuse the same catalog snapshot.
  const cacheUrl = new URL(endpoint.pathname, endpoint.origin);
  cacheUrl.searchParams.set("url", url.href);
  const cacheKey = new Request(cacheUrl);
  const headers = { "Cache-Control": "no-store" };
  let snapshot;
  let savedAt;
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      savedAt = Number(cached.headers.get("X-Catalog-Saved-At"));
      const age = Date.now() - savedAt;
      if (age >= 0 && age < catalogRetentionSeconds * 1000) {
        const data = await cached.json();
        if (Array.isArray(data?.titulos) && data.titulos.length) snapshot = data;
      }
    }
  } catch {
    // A cache failure is recoverable by reading the source.
  }

  if (snapshot && Date.now() - savedAt < catalogFreshMs) {
    return Response.json(snapshot, { headers });
  }

  let data;
  try {
    data = await catalog(url, hosts);
  } catch (error) {
    if (snapshot && error instanceof RequestError && transientStatuses.has(error.status)) {
      return Response.json({ ...snapshot, desatualizado: true }, { headers });
    }
    throw error;
  }

  if (data.titulos.length) {
    const cached = Response.json(data, {
      headers: {
        "Cache-Control": `public, max-age=${catalogRetentionSeconds}`,
        "X-Catalog-Saved-At": String(Date.now()),
      },
    });
    context.waitUntil(caches.default.put(cacheKey, cached).catch(() => {}));
  }
  return Response.json(data, { headers });
}

const mirrorButton = /^(?:baixar\s+(?:(?:em|no|na|por|pelo|pela)\s+)?|download\s+)?(mega|daily|freedl|usersd)$/i;
const downloadHeading = /^(?:baixar|downloads?)\s+.+$/i;

function buttonText(value) {
  return value.replace(/&nbsp;|&#160;|&#xA0;/gi, " ").replace(/\s+/g, " ").trim();
}

function canOpenMirror(url, hosts) {
  return hosts.has(url.hostname) ||
    (url.hostname === catalogHost && /^\/dl\/?$/.test(url.pathname));
}

function addMirrorReaders(rewriter, base, groups, hosts) {
  const headings = new Set();
  const unlabeledGroup = "Opções de download";
  let currentGroup = unlabeledGroup;
  let button = null;

  function headingTitle(text) {
    const title = buttonText(text);
    if (!downloadHeading.test(title) || mirrorButton.test(title)) return null;
    return title;
  }

  rewriter
    .on('h1, h2, h3, h4, h5, h6, p, strong, b, legend, span, div[class*="download"]', {
      element(element) {
        if (button) return;
        const heading = { text: "", hasButton: false };
        headings.add(heading);
        element.onEndTag(() => {
          headings.delete(heading);
          if (!heading.hasButton) currentGroup = headingTitle(heading.text) || currentGroup;
        });
      },
    })
    .on("a[href], a[data-href], a[data-url], button[data-href], button[data-url]", {
      element(element) {
        let group = currentGroup;
        for (const heading of headings) {
          if (!heading.hasButton) group = headingTitle(heading.text) || group;
          heading.hasButton = true;
        }
        currentGroup = group;

        let link;
        for (const attribute of ["href", "data-href", "data-url"]) {
          const address = htmlUrl(element.getAttribute(attribute));
          if (!address || address.startsWith("#")) continue;
          try {
            const candidate = allowedUrl(address, publicHosts, base, { keepHash: true });
            if (candidate.href === base.href) continue;
            link = candidate;
            break;
          } catch {
            // Try the next static link attribute.
          }
        }
        if (!link) return;

        const capture = {
          text: "",
          labels: [element.getAttribute("aria-label"), element.getAttribute("title")],
        };
        button = capture;
        element.onEndTag(() => {
          button = null;
          const name = [capture.text, ...capture.labels]
            .map(label => mirrorButton.exec(buttonText(label ?? ""))?.[1])
            .find(Boolean)?.toUpperCase();
          if (!name) return;
          if (!groups.has(group)) groups.set(group, new Map());
          const entry = { nome: name, url: link.href };
          if (canOpenMirror(link, hosts)) entry.atalho = true;
          groups.get(group).set(link.href, entry);
        });
      },
    })
    .on("a img, button img", {
      element(element) {
        if (button) button.labels.push(element.getAttribute("alt"));
      },
    })
    .onDocument({
      text(text) {
        if (button && button.text.length < 160) button.text += text.text.slice(0, 160);
        for (const heading of headings) {
          if (!heading.hasButton && heading.text.length < 160) {
            heading.text += text.text.slice(0, 160);
          }
        }
      },
    });
}

function readVideoLinks(rewriter, videos, base, hosts) {
  function collect(element, attribute) {
    const address = htmlUrl(element.getAttribute(attribute));
    if (!address || videos.size >= maxResults) return;
    let link;
    try {
      link = allowedUrl(address, hosts, base);
    } catch {
      return;
    }
    const name = filename(link);
    const namedDownload = element.getAttribute("download")?.trim();
    if (videoPath.test(name)) {
      videos.set(link.href, { url: link.href, name });
    } else if (!hosts.size && namedDownload && videoPath.test(namedDownload)) {
      videos.set(link.href, { url: link.href, name: namedDownload });
    }
  }

  rewriter
    .on("a[href]", { element: element => collect(element, "href") })
    .on("video[src], source[src]", { element: element => collect(element, "src") });
}

async function search(url, hosts, origin) {
  const { base, html } = await readHtml(url, hosts, origin);
  const videos = new Map();
  const rewriter = new HTMLRewriter();
  readVideoLinks(rewriter, videos, base, hosts);
  const groups = new Map();
  if (origin) addMirrorReaders(rewriter, base, groups, hosts);
  const parsed = rewriter.transform(html);
  await parsed.body.pipeTo(new WritableStream());
  const opcoes = [...groups].map(([titulo, links]) => ({ titulo, links: [...links.values()] }));
  return Response.json({ videos: [...videos.values()], downloadDireto: !hosts.size, ...(origin ? { opcoes } : {}) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

function isVideoResponse(response) {
  const type = contentType(response);
  return type?.startsWith("video/") || ["application/octet-stream", "application/mp4"].includes(type);
}

async function publishedFile(page, provider, signal) {
  const response = await fetch(page, { redirect: "manual", cache: "no-store", signal });
  if (response.status !== 200 || !response.body || !isHtml(response) ||
    response.headers.has("Set-Cookie")) {
    await response.body?.cancel();
    return null;
  }
  const files = new Map();
  const parsed = new HTMLRewriter().on("a[download][href]", {
    element(element) {
      const address = htmlUrl(element.getAttribute("href"));
      if (!address) return;
      try {
        const file = allowedUrl(address, publicHosts, page, { keepHash: true });
        if (provider(file) && videoPath.test(filename(file))) files.set(file.href, file);
      } catch {
        // Ignore unsupported destinations.
      }
    },
  }).transform(boundedHtml(response, 512 * 1024));
  await parsed.body.pipeTo(new WritableStream());
  return files.size === 1 ? files.values().next().value : null;
}

async function resolveMirror(url, hosts) {
  const signal = AbortSignal.timeout(6000);
  const visited = new Set();
  const provider = candidate => candidate.origin === url.origin || hosts.has(candidate.hostname);
  let current = url;

  // Inspect public redirects and explicit file links without forwarding browser credentials.
  for (let hops = 0; hops < 5 && current && !visited.has(current.href); hops++) {
    visited.add(current.href);
    const response = await fetch(current, {
      method: "HEAD", redirect: "manual", cache: "no-store", signal,
    });
    if (response.headers.has("Set-Cookie")) return null;
    const location = response.headers.get("Location");
    if (redirects.has(response.status) && location) {
      const next = allowedUrl(location, publicHosts, current, { keepHash: true });
      if (!provider(next)) return null;
      if (!location.includes("#")) next.hash = current.hash;
      current = next;
      continue;
    }
    if (response.status !== 200) return null;
    const type = contentType(response);
    const attachment = response.headers.get("Content-Disposition")
      ?.match(/;\s*filename\*?\s*=\s*(?:"([^"]+)"|([^;]+))/i);
    const name = attachment?.[1] ?? attachment?.[2]?.trim() ?? "";
    if (type?.startsWith("video/") || type === "application/mp4" ||
      (type === "application/octet-stream" &&
        (videoPath.test(filename(current)) || videoPath.test(name)))) {
      return current;
    }
    if (!isHtml(response) || current.search || current.hash || current.hostname === catalogHost) {
      return null;
    }
    current = await publishedFile(current, provider, signal);
  }
  return null;
}

async function openMirror(url, hosts) {
  if (!canOpenMirror(url, hosts)) {
    throw new RequestError("Este provedor não está habilitado para consulta de arquivos.", 403);
  }
  let file;
  try {
    file = await resolveMirror(url, hosts);
  } catch {
    // Let the original provider handle network failures, redirects and sessions.
  }
  return new Response(null, {
    status: 302,
    headers: { Location: (file ?? url).href, "Cache-Control": "no-store" },
  });
}

async function download(url, hosts) {
  if (!videoPath.test(filename(url))) {
    throw new RequestError("Informe um link direto de vídeo.");
  }
  const { response } = await requestSource(url, hosts, "video/*, application/octet-stream");
  if (!isVideoResponse(response)) {
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
  async fetch(request, env, context) {
    const endpoint = new URL(request.url);
    if (!["/api/busca", "/api/baixar", "/api/catalogo", "/api/abrir"].includes(endpoint.pathname)) {
      return Response.json({ erro: "Rota não encontrada." }, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
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
      if (endpoint.pathname === "/api/abrir") {
        const url = allowedUrl(value, publicHosts, undefined, { keepHash: true });
        return await openMirror(url, hosts);
      }
      const url = allowedUrl(value.includes("://") ? value : `https://${value}`, hosts);
      if (endpoint.pathname === "/api/catalogo") return await serveCatalog(endpoint, url, hosts, context);
      if (endpoint.pathname === "/api/baixar") return await download(url, hosts);
      const origin = endpoint.searchParams.get("catalogo") === "1" ? url.origin : undefined;
      return await search(url, hosts, origin);
    } catch (error) {
      const failure = error instanceof RequestError
        ? error
        : new RequestError("Não foi possível consultar a fonte.", 502);
      const headers = new Headers({ "Cache-Control": "no-store" });
      if (failure.retryAfter) headers.set("Retry-After", failure.retryAfter);
      return Response.json({ erro: failure.message }, { status: failure.status, headers });
    }
  },
};
