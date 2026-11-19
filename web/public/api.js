const catalogRetryLimitMs = 3000;
const catalogTransientStatuses = new Set([429, 502, 503, 504]);
const catalogCacheKey = "filmes-diretos:catalogo:v1";
const catalogCacheMaxAgeMs = 24 * 60 * 60 * 1000;
const catalogCacheMaxPages = 16;
const catalogCacheMaxInitialPages = 6;
const catalogCacheMaxCharacters = 512 * 1024;

function isCatalogPage(data) {
  return Array.isArray(data?.titulos) &&
    (data.proxima === null || typeof data.proxima === "string") &&
    data.titulos.every(title => typeof title?.url === "string" &&
      typeof title.titulo === "string" &&
      (title.capa == null || typeof title.capa === "string"));
}

function readCatalogCache() {
  try {
    const entries = JSON.parse(localStorage.getItem(catalogCacheKey) ?? "[]");
    if (!Array.isArray(entries)) return [];
    const now = Date.now();
    return entries.filter(entry => typeof entry?.url === "string" &&
      Number.isFinite(entry.savedAt) && entry.savedAt <= now &&
      entry.savedAt > now - catalogCacheMaxAgeMs &&
      isCatalogPage(entry.data) && entry.data.titulos.length).slice(0, catalogCacheMaxPages);
  } catch {
    return [];
  }
}

function cachedCatalogPage(url) {
  const entry = readCatalogCache().find(page => page.url === url);
  return entry && { ...entry.data, desatualizado: true };
}

function saveCatalogPage(url, data, paginaInicial) {
  const entries = readCatalogCache();
  const previous = entries.find(page => page.url === url);
  const { proxima } = data;
  const titulos = data.titulos.map(({ titulo, url, capa }) => ({ titulo, url, capa }));
  const entry = {
    url,
    data: { titulos, proxima },
    savedAt: Date.now(),
    paginaInicial: paginaInicial || previous?.paginaInicial === true,
  };
  const recent = [entry, ...entries.filter(page => page.url !== url).sort(
    (left, right) => right.savedAt - left.savedAt,
  )];
  const initialPages = new Set(recent.filter(page => page.paginaInicial === true)
    .slice(0, catalogCacheMaxInitialPages));
  const ordered = [...initialPages, ...recent.filter(page => !initialPages.has(page))];
  try {
    const saved = [];
    let size = 2;
    for (const page of ordered) {
      const serialized = JSON.stringify(page);
      const addedSize = serialized.length + Number(saved.length > 0);
      if (size + addedSize > catalogCacheMaxCharacters) continue;
      saved.push(serialized);
      size += addedSize;
      if (saved.length === catalogCacheMaxPages) break;
    }
    if (saved.length) localStorage.setItem(catalogCacheKey, `[${saved.join(",")}]`);
  } catch {
    // The current response remains usable without local storage.
  }
}

function retryDelay(response) {
  const value = response.headers.get("Retry-After")?.trim();
  const defaultDelay = response.status === 429 ? 1000 : 600;
  if (!value) return defaultDelay;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = /[a-z]/i.test(value) ? Date.parse(value) : NaN;
  return Number.isNaN(date) ? defaultDelay : Math.max(0, date - Date.now());
}

function waitForRetry(delay, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function query(endpoint, parameters, signal, { paginaInicial = false } = {}) {
  const search = new URLSearchParams(parameters);
  const url = `/api/${endpoint}?${search}`;
  const catalogUrl = endpoint === "catalogo" ? search.get("url") : null;
  const options = {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  };
  let response;
  try {
    response = await fetch(url, options);
    for (let attempt = 0; catalogUrl && catalogTransientStatuses.has(response.status); attempt++) {
      signal?.throwIfAborted();
      const saved = cachedCatalogPage(catalogUrl);
      if (saved) {
        await response.body?.cancel();
        signal?.throwIfAborted();
        return saved;
      }
      const delay = retryDelay(response);
      if (attempt === 1 || delay > catalogRetryLimitMs) break;
      await response.body?.cancel();
      await waitForRetry(delay, signal);
      response = await fetch(url, options);
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (!catalogUrl || !(error instanceof TypeError)) throw error;
    const saved = cachedCatalogPage(catalogUrl);
    if (saved) return saved;
    throw new Error("Não foi possível conectar ao serviço do catálogo.", { cause: error });
  }

  const unavailableMessage = catalogUrl && catalogTransientStatuses.has(response.status)
    ? `O serviço do catálogo está temporariamente indisponível (HTTP ${response.status}).`
    : null;
  const contentType = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    if (response.ok || response.status === 404) {
      throw new Error("A API do Filmes Diretos não está disponível neste endereço. Verifique a publicação como Cloudflare Worker.");
    }
    throw new Error(unavailableMessage || `O servidor retornou HTTP ${response.status} fora da API do Filmes Diretos.`);
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(unavailableMessage || "A API devolveu uma resposta JSON inválida.");
  }
  if (!response.ok) throw new Error(data?.erro || unavailableMessage || `A consulta falhou (HTTP ${response.status}).`);
  if (catalogUrl) {
    if (!isCatalogPage(data)) throw new Error("A API devolveu uma página de catálogo inválida.");
    if (data.desatualizado !== true && data.titulos.length) saveCatalogPage(catalogUrl, data, paginaInicial);
  }
  return data;
}
