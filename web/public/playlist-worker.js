import { cleanPlaylist, importPlaylist } from "./playlist.js";

self.addEventListener("message", async ({ data: { file, clean } }) => {
  try {
    const bytes = await file.arrayBuffer();
    let texto;
    let convertido = false;
    try {
      texto = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      if (/\.m3u8$/i.test(file.name)) throw new Error("O arquivo M3U8 precisa estar em UTF-8.");
      texto = new TextDecoder("windows-1252").decode(bytes);
      convertido = true;
    }
    const result = clean ? cleanPlaylist(texto) : importPlaylist(texto);
    self.postMessage({ ...result, convertido });
  } catch (error) {
    self.postMessage({ erro: error.message || "Não foi possível ler a playlist." });
  }
});
