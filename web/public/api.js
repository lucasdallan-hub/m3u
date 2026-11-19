export async function query(endpoint, parameters, signal) {
  const response = await fetch(`/api/${endpoint}?${new URLSearchParams(parameters)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  const contentType = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    if (response.ok || response.status === 404) {
      throw new Error("A API do Filmes Diretos não está disponível neste endereço. Verifique a publicação como Cloudflare Worker.");
    }
    throw new Error(`O servidor retornou HTTP ${response.status} fora da API do Filmes Diretos.`);
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error("A API devolveu uma resposta JSON inválida.");
  }
  if (!response.ok) throw new Error(data?.erro || `A consulta falhou (HTTP ${response.status}).`);
  return data;
}
