const form = document.querySelector("#playlist-form");
const input = document.querySelector("#playlist-arquivo");
const button = form.querySelector("button");
const download = document.querySelector("#playlist-baixar");
const status = document.querySelector("#playlist-estado");

function resetDownload() {
  if (!download.hidden) URL.revokeObjectURL(download.href);
  download.removeAttribute("href");
  download.hidden = true;
  status.textContent = "";
}

function processPlaylist(file) {
  const worker = new Worker("/playlist-worker.js", { type: "module" });
  return new Promise((resolve, reject) => {
    worker.addEventListener("message", ({ data }) => {
      if (data.erro) reject(new Error(data.erro));
      else resolve(data);
    }, { once: true });
    worker.addEventListener("error", () => {
      reject(new Error("Não foi possível processar o arquivo."));
    }, { once: true });
    worker.postMessage(file);
  }).finally(() => worker.terminate());
}

input.addEventListener("change", () => {
  resetDownload();
  button.disabled = input.files.length === 0;
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const file = input.files[0];
  if (!file || button.disabled) return;

  resetDownload();
  button.disabled = input.disabled = true;
  status.textContent = "Lendo a playlist…";
  try {
    const { texto, total, removidos, convertido } = await processPlaylist(file);
    const base = file.name.replace(/\.(?:m3u8?)$/i, "") || "playlist";
    const extension = /\.m3u8$/i.test(file.name) ? "m3u8" : "m3u";
    const blob = new Blob([texto], { type: "audio/x-mpegurl;charset=utf-8" });
    download.href = URL.createObjectURL(blob);
    download.download = `${base}-sem-duplicados.${extension}`;
    download.hidden = false;
    const format = new Intl.NumberFormat("pt-BR");
    const duplicates = removidos === 1 ? "1 duplicado removido" : `${format.format(removidos)} duplicados removidos`;
    status.textContent = `${duplicates}. ${format.format(total - removidos)} de ${format.format(total)} itens mantidos.`;
    if (convertido) status.textContent += " O novo arquivo está em UTF-8.";
  } catch (error) {
    status.textContent = error.message || "Não foi possível processar o arquivo.";
  } finally {
    button.disabled = input.disabled = false;
  }
});
