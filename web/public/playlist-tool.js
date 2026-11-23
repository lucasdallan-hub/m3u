const form = document.querySelector("#playlist-form");
const input = document.querySelector("#playlist-arquivo");
const button = form.querySelector("button");
const download = document.querySelector("#playlist-baixar");
const status = document.querySelector("#playlist-estado");
const preview = document.querySelector("#playlist-conteudo");
const count = document.querySelector("#playlist-contagem");
const list = document.querySelector("#playlist-itens");
const more = document.querySelector("#playlist-mais");
const format = new Intl.NumberFormat("pt-BR");
const batchSize = 48;
let selection = 0;
let result = null;
let shown = 0;

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

function appendItems() {
  const { items } = result;
  const end = Math.min(shown + batchSize, items.length);
  const batch = document.createDocumentFragment();

  for (const { name, cover, group } of items.slice(shown, end)) {
    const card = document.createElement("li");
    const artwork = document.createElement("div");
    artwork.className = "playlist-capa";
    const placeholder = document.createElement("span");
    placeholder.textContent = "Sem capa";
    artwork.append(placeholder);
    if (/^(?:https?:\/\/|\/\/)/i.test(cover)) {
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("load", () => { placeholder.hidden = true; }, { once: true });
      image.addEventListener("error", () => image.remove(), { once: true });
      image.src = cover.startsWith("//") ? `https:${cover}` : cover;
      artwork.append(image);
    }
    const title = document.createElement("h3");
    title.textContent = name;
    card.append(artwork, title);
    if (group) {
      const category = document.createElement("p");
      category.textContent = group;
      card.append(category);
    }
    batch.append(card);
  }

  list.append(batch);
  shown = end;
  count.textContent = items.length === 1
    ? "1 item"
    : `${format.format(shown)} de ${format.format(items.length)} itens`;
  more.hidden = shown === items.length;
}

more.addEventListener("click", appendItems);

input.addEventListener("change", async () => {
  const currentSelection = ++selection;
  const file = input.files[0];
  resetDownload();
  button.disabled = true;
  result = null;
  shown = 0;
  preview.hidden = true;
  more.hidden = true;
  list.replaceChildren();
  if (!file) return;

  status.textContent = "Lendo a playlist…";
  try {
    const parsed = await processPlaylist(file);
    if (currentSelection !== selection) return;
    result = parsed;
    preview.hidden = false;
    appendItems();
    button.disabled = false;
    status.textContent = "";
  } catch (error) {
    if (currentSelection === selection) {
      status.textContent = error.message || "Não foi possível processar o arquivo.";
    }
  }
});

form.addEventListener("submit", event => {
  event.preventDefault();
  const file = input.files[0];
  if (!file || !result || button.disabled) return;

  resetDownload();
  try {
    const { texto, total, removidos, convertido } = result;
    const base = file.name.replace(/\.(?:m3u8?)$/i, "") || "playlist";
    const extension = /\.m3u8$/i.test(file.name) ? "m3u8" : "m3u";
    const blob = new Blob([texto], { type: "audio/x-mpegurl;charset=utf-8" });
    download.href = URL.createObjectURL(blob);
    download.download = `${base}-sem-duplicados.${extension}`;
    download.hidden = false;
    const duplicates = removidos === 1 ? "1 duplicado removido" : `${format.format(removidos)} duplicados removidos`;
    status.textContent = `${duplicates}. ${format.format(total - removidos)} de ${format.format(total)} itens mantidos.`;
    if (convertido) status.textContent += " O novo arquivo está em UTF-8.";
  } catch (error) {
    status.textContent = error.message || "Não foi possível processar o arquivo.";
  }
});
