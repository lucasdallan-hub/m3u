const retryBudgetMs = 15_000;
const retryDelaysMs = [1_200, 3_500, 7_500];
const rateLimitRetryBudgetMs = 3_000;
const transientStatuses = new Set([429, 502, 503, 504]);
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

function retryDelay(response, minimumDelay) {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value) return minimumDelay;
  if (/^\d+$/.test(value)) return Math.max(minimumDelay, Number(value) * 1000);
  const date = /[a-z]/i.test(value) ? Date.parse(value) : NaN;
  return Number.isNaN(date) ? minimumDelay : Math.max(minimumDelay, date - Date.now());
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

function unavailableMessageFor(response, catalog) {
  if (response.status === 503 && !response.headers.has("X-Filmes-Diretos")) {
    const ray = response.headers.get("CF-Ray");
    const reference = ray ? ` Referência Cloudflare ${ray}.` : "";
    return `A hospedagem devolveu HTTP 503 sem identificar a API do Filmes Diretos.${reference}`;
  }
  const service = catalog ? "do catálogo" : "de busca de downloads";
  return `O serviço ${service} está temporariamente indisponível (HTTP ${response.status}).`;
}

export async function query(endpoint, parameters, signal, { paginaInicial = false } = {}) {
  const search = new URLSearchParams(parameters);
  const url = `/api/${endpoint}?${search}`;
  const catalogUrl = endpoint === "catalogo" ? search.get("url") : null;
  const retryable = Boolean(catalogUrl) || (endpoint === "busca" && search.get("catalogo") === "1");
  const options = {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  };
  let response;
  try {
    signal?.throwIfAborted();
    response = await fetch(url, options);
    let remainingWait = retryBudgetMs;
    for (let attempt = 0; retryable && transientStatuses.has(response.status); attempt++) {
      signal?.throwIfAborted();
      const saved = catalogUrl && cachedCatalogPage(catalogUrl);
      if (saved) {
        await response.body?.cancel();
        signal?.throwIfAborted();
        return saved;
      }
      const rateLimited = response.status === 429;
      const retries = rateLimited ? 1 : retryDelaysMs.length;
      if (attempt >= retries) break;
      const delay = retryDelay(response, rateLimited ? 1_000 : retryDelaysMs[attempt]);
      const budget = rateLimited ? Math.min(rateLimitRetryBudgetMs, remainingWait) : remainingWait;
      if (delay > budget) break;
      await response.body?.cancel();
      const waitingSince = performance.now();
      await waitForRetry(delay, signal);
      remainingWait -= performance.now() - waitingSince;
      response = await fetch(url, options);
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (!retryable || !(error instanceof TypeError)) throw error;
    const saved = catalogUrl && cachedCatalogPage(catalogUrl);
    if (saved) return saved;
    const service = catalogUrl ? "do catálogo" : "de busca de downloads";
    throw new Error(`Não foi possível conectar ao serviço ${service}.`, { cause: error });
  }

  const unavailableMessage = retryable && transientStatuses.has(response.status)
    ? unavailableMessageFor(response, Boolean(catalogUrl))
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
  if (!response.ok) {
    const apiError = typeof data?.erro === "string" ? data.erro.trim() : "";
    throw new Error(apiError || unavailableMessage || `A consulta falhou (HTTP ${response.status}).`);
  }
  if (catalogUrl) {
    if (!isCatalogPage(data)) throw new Error("A API devolveu uma página de catálogo inválida.");
    if (data.desatualizado !== true && data.titulos.length) saveCatalogPage(catalogUrl, data, paginaInicial);
  }
  return data;
}
