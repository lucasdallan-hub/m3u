const catalogRetryLimitMs = 3000;
const catalogCacheKey = "filmes-diretos:catalogo:v1";
const catalogCacheMaxAgeMs = 24 * 60 * 60 * 1000;
const catalogCacheMaxPages = 16;
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

function saveCatalogPage(url, data) {
  const entries = readCatalogCache();
  const index = entries.findIndex(page => page.url === url);
  // Keep the first pages available after a scan of a large catalog.
  if (index === -1 && entries.length >= catalogCacheMaxPages) return;
  const { proxima } = data;
  const titulos = data.titulos.map(({ titulo, url, capa }) => ({ titulo, url, capa }));
  const entry = { url, data: { titulos, proxima }, savedAt: Date.now() };
  entries[index === -1 ? entries.length : index] = entry;
  try {
    const serialized = JSON.stringify(entries);
    if (serialized.length <= catalogCacheMaxCharacters) localStorage.setItem(catalogCacheKey, serialized);
  } catch {
    // The current response remains usable without local storage.
  }
}

function retryDelay(response) {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value) return 600;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isNaN(delay) ? 600 : Math.max(0, delay);
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

export async function query(endpoint, parameters, signal) {
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
    if (catalogUrl && response.status === 503) {
      const delay = retryDelay(response);
      if (delay <= catalogRetryLimitMs) {
        await response.body?.cancel();
        await waitForRetry(delay, signal);
        response = await fetch(url, options);
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (!catalogUrl || !(error instanceof TypeError)) throw error;
    const saved = cachedCatalogPage(catalogUrl);
    if (saved) return saved;
    throw new Error("Não foi possível conectar ao serviço do catálogo.", { cause: error });
  }

  let unavailableMessage;
  if (catalogUrl && response.status === 503) {
    signal?.throwIfAborted();
    const saved = cachedCatalogPage(catalogUrl);
    if (saved) {
      await response.body?.cancel();
      signal?.throwIfAborted();
      return saved;
    }
    unavailableMessage = "O serviço do catálogo está temporariamente indisponível (HTTP 503).";
  }
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
    throw new Error("A API devolveu uma resposta JSON inválida.");
  }
  if (!response.ok) throw new Error(data?.erro || unavailableMessage || `A consulta falhou (HTTP ${response.status}).`);
  if (catalogUrl) {
    if (!isCatalogPage(data)) throw new Error("A API devolveu uma página de catálogo inválida.");
    if (data.desatualizado !== true && data.titulos.length) saveCatalogPage(catalogUrl, data);
  }
  return data;
}
