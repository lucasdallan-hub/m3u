import { findRepeatedMovies } from "./playlist-covers.js";
import { openPlaylistMedia, closePlaylistMedia, playlistMediaUrl } from "./playlist-player.js";
import { preparePlaylistDownload, releasePlaylistDownload } from "./playlist-download.js";

const form = document.querySelector("#playlist-form");
const input = document.querySelector("#playlist-arquivo");
const button = form.querySelector("button");
const download = document.querySelector("#playlist-baixar");
const status = document.querySelector("#playlist-estado");
const importStatus = document.querySelector("#playlist-importacao");
const preview = document.querySelector("#playlist-conteudo");
const count = document.querySelector("#playlist-contagem");
const list = document.querySelector("#playlist-itens");
const more = document.querySelector("#playlist-mais");
const tabs = document.querySelectorAll(".playlist-abas button");
const analyze = document.querySelector("#playlist-analisar");
const cancelAnalysis = document.querySelector("#playlist-cancelar-analise");
const analysisStatus = document.querySelector("#playlist-analise-estado");
const repeats = document.querySelector("#playlist-repetidos");
const moreRepeats = document.querySelector("#playlist-mais-repetidos");
const format = new Intl.NumberFormat("pt-BR");
const typeLabels = { channel: "Canal", movie: "Filme", series: "Série", unknown: "Não identificado" };
const batchSize = 48;
let selection = 0;
let result = null;
let shown = 0;
let filteredItems = [];
let itemsByType = null;
let analysis = null;
let repeatedGroups = [];
let groupsShown = 0;

const remoteForm = document.querySelector("#playlist-download-form");
const remoteInput = document.querySelector("#playlist-url");
const remoteButton = remoteForm.querySelector('button[type="submit"]');
const remoteStatus = document.querySelector("#playlist-download-status");
const remoteDownload = document.querySelector("#playlist-download-link");

remoteForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (remoteButton.disabled) return;
  const address = remoteInput.value.trim();
  if (!address) {
    remoteStatus.textContent = "Informe o endereço da playlist.";
    return;
  }
  releasePlaylistDownload(remoteDownload);
  remoteDownload.hidden = true;
  remoteButton.disabled = true;
  remoteStatus.textContent = "Preparando a playlist para download…";
  try {
    await preparePlaylistDownload(address, remoteDownload);
    if (remoteInput.value.trim() === address) remoteInput.value = "";
    remoteDownload.hidden = false;
    remoteStatus.textContent = "Playlist pronta. Use o botão abaixo se o navegador não iniciar o download.";
    remoteDownload.click();
  } catch (error) {
    remoteStatus.textContent = error.message;
  } finally {
    remoteButton.disabled = false;
  }
});

function showRepeatedGroups() {
  const end = Math.min(groupsShown + 20, repeatedGroups.length);
  const batch = document.createDocumentFragment();
  for (const group of repeatedGroups.slice(groupsShown, end)) {
    const item = document.createElement("li");
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `${group[0].name} · ${format.format(group.length)} entradas`;
    details.append(summary);
    details.addEventListener("toggle", () => {
      if (!details.open || details.children.length > 1) return;
      const entries = document.createElement("ul");
      for (const movie of group) {
        const entry = document.createElement("li");
        entry.textContent = movie.group ? `${movie.name} · ${movie.group}` : movie.name;
        entries.append(entry);
      }
      details.append(entries);
    });
    item.append(details);
    batch.append(item);
  }
  repeats.append(batch);
  groupsShown = end;
  moreRepeats.hidden = end === repeatedGroups.length;
}

function resetAnalysis() {
  analysis?.abort();
  analysis = null;
  analyze.disabled = false;
  cancelAnalysis.hidden = true;
  analysisStatus.textContent = "";
  repeatedGroups = [];
  groupsShown = 0;
  repeats.replaceChildren();
  moreRepeats.hidden = true;
}

moreRepeats.addEventListener("click", showRepeatedGroups);
cancelAnalysis.addEventListener("click", () => analysis?.abort());

analyze.addEventListener("click", async () => {
  if (!itemsByType || analysis) return;
  resetAnalysis();
  const controller = new AbortController();
  analysis = controller;
  analyze.disabled = true;
  cancelAnalysis.hidden = false;
  analysisStatus.textContent = "Preparando a análise…";
  try {
    const { groups, unavailable } = await findRepeatedMovies(itemsByType.movie, controller.signal, (checked, total) => {
      analysisStatus.textContent = `Títulos em comum comparados: ${format.format(checked)} de ${format.format(total)}.`;
    });
    if (analysis !== controller) return;
    controller.signal.throwIfAborted();
    repeatedGroups = groups;
    analysisStatus.textContent = groups.length
      ? `Grupos para revisar: ${format.format(groups.length)}.`
      : "Nenhuma capa coincidente encontrada entre filmes com o mesmo título.";
    if (unavailable) analysisStatus.textContent += ` Entradas sem acesso à imagem da capa: ${format.format(unavailable)}.`;
    showRepeatedGroups();
  } catch {
    if (analysis === controller) {
      analysisStatus.textContent = controller.signal.aborted ? "Análise cancelada." : "Não foi possível analisar as capas.";
    }
  } finally {
    if (analysis === controller) {
      analysis = null;
      analyze.disabled = false;
      cancelAnalysis.hidden = true;
    }
  }
});

function resetDownload() {
  if (!download.hidden) URL.revokeObjectURL(download.href);
  download.removeAttribute("href");
  download.hidden = true;
  status.textContent = "";
}

function processPlaylist(file, clean = false) {
  const worker = new Worker("/playlist-worker.js", { type: "module" });
  return new Promise((resolve, reject) => {
    worker.addEventListener("message", ({ data }) => {
      if (data.erro) reject(new Error(data.erro));
      else resolve(data);
    }, { once: true });
    worker.addEventListener("error", () => {
      reject(new Error("Não foi possível processar o arquivo."));
    }, { once: true });
    worker.postMessage({ file, clean });
  }).finally(() => worker.terminate());
}

function appendItems() {
  const items = filteredItems;
  const end = Math.min(shown + batchSize, items.length);
  const batch = document.createDocumentFragment();

  for (const { name, cover, group, type, address } of items.slice(shown, end)) {
    const card = document.createElement("li");
    const media = playlistMediaUrl(address);
    const artwork = document.createElement(media ? "button" : "div");
    artwork.className = "playlist-capa";
    if (media) {
      artwork.type = "button";
      artwork.setAttribute("aria-label", `Reproduzir ${name}`);
      artwork.addEventListener("click", () => openPlaylistMedia(name, media, type, address));
    }
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
    const category = document.createElement("p");
    category.textContent = group ? `${typeLabels[type]} · ${group}` : typeLabels[type];
    card.append(category);
    batch.append(card);
  }

  list.append(batch);
  shown = end;
  count.textContent = items.length === 0
    ? "Nenhum item deste tipo."
    : items.length === 1
    ? "1 item"
    : `${format.format(shown)} de ${format.format(items.length)} itens`;
  more.hidden = shown === items.length;
}

more.addEventListener("click", appendItems);

function selectType(type) {
  for (const tab of tabs) {
    tab.setAttribute("aria-pressed", String(tab.dataset.type === type));
  }
  filteredItems = type === "all" ? result.items : itemsByType[type];
  shown = 0;
  list.replaceChildren();
  appendItems();
}

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    if (result && tab.getAttribute("aria-pressed") !== "true") selectType(tab.dataset.type);
  });
}

input.addEventListener("change", async () => {
  const currentSelection = ++selection;
  const file = input.files[0];
  closePlaylistMedia();
  resetDownload();
  resetAnalysis();
  button.disabled = true;
  result = null;
  filteredItems = [];
  itemsByType = null;
  shown = 0;
  preview.hidden = true;
  more.hidden = true;
  list.replaceChildren();
  importStatus.textContent = "";
  if (!file) return;

  importStatus.textContent = "Importando a playlist…";
  try {
    const parsed = await processPlaylist(file);
    if (currentSelection !== selection) return;
    result = parsed;
    itemsByType = { channel: [], movie: [], series: [], unknown: [] };
    for (const item of parsed.items) itemsByType[item.type].push(item);
    preview.hidden = false;
    selectType("all");
    button.disabled = false;
    importStatus.textContent = `${format.format(parsed.items.length)} ${parsed.items.length === 1 ? "item importado" : "itens importados"}. Inclui as entradas repetidas.`;
  } catch (error) {
    if (currentSelection === selection) {
      importStatus.textContent = error.message || "Não foi possível importar o arquivo.";
    }
  }
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const file = input.files[0];
  if (!file || !result || button.disabled) return;

  resetDownload();
  const currentSelection = selection;
  button.disabled = true;
  status.textContent = "Removendo duplicados…";
  try {
    const { texto, total, removidos, convertido } = await processPlaylist(file, true);
    if (currentSelection !== selection) return;
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
    if (currentSelection === selection) {
      status.textContent = error.message || "Não foi possível processar o arquivo.";
    }
  } finally {
    if (currentSelection === selection) button.disabled = false;
  }
});
