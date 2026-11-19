const catalogRetryLimitMs = 3000;

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
  const url = `/api/${endpoint}?${new URLSearchParams(parameters)}`;
  const options = {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  };
  let response = await fetch(url, options);
  const unavailable = endpoint === "catalogo" && response.status === 503;
  if (unavailable) {
    const delay = retryDelay(response);
    if (delay <= catalogRetryLimitMs) {
      await response.body?.cancel();
      await waitForRetry(delay, signal);
      response = await fetch(url, options);
    }
  }

  const unavailableMessage = endpoint === "catalogo" && response.status === 503
    ? "O serviço do catálogo está temporariamente indisponível (HTTP 503)."
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
    throw new Error("A API devolveu uma resposta JSON inválida.");
  }
  if (!response.ok) throw new Error(data?.erro || unavailableMessage || `A consulta falhou (HTTP ${response.status}).`);
  return data;
}
