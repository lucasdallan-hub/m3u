export function isPlaylistUrl(address) {
  try {
    const url = new URL(address);
    if (/\.m3u8?$/i.test(url.pathname)) return true;
    return /\/get\.php$/i.test(url.pathname) && (
      /^m3u/i.test(url.searchParams.get("type") ?? "") ||
      url.searchParams.has("username") || url.searchParams.has("password")
    );
  } catch {
    return false;
  }
}

export async function preparePlaylistDownload(address, link) {
  let response;
  try {
    response = await fetch("/api/playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: address }),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new Error("Não foi possível conectar ao serviço de playlists.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(typeof data?.erro === "string" ? data.erro : `Não foi possível baixar a playlist (HTTP ${response.status}).`);
  }
  const filename = response.headers.get("Content-Disposition")
    ?.match(/(?:^|;)\s*filename="?([a-z0-9_.-]{1,120}\.m3u8?)"?(?:\s*;|\s*$)/i)?.[1];
  if (!filename) throw new Error("O servidor não retornou um arquivo M3U ou M3U8 para baixar.");
  const blob = await response.blob().catch(() => {
    throw new Error("O download da playlist foi interrompido. Tente novamente.");
  });
  if (!blob.size) throw new Error("O arquivo de playlist está vazio.");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  return filename;
}

export function releasePlaylistDownload(link) {
  const address = link?.getAttribute("href");
  if (!address?.startsWith("blob:")) return;
  URL.revokeObjectURL(address);
  link.removeAttribute("href");
  link.removeAttribute("download");
}
