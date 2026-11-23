import { query } from "./api.js";
import { addMediaLinks } from "./midia.js";

const form = document.querySelector("#busca");
const input = document.querySelector("#url");
const titleInput = document.querySelector("#titulo-busca");
const scanButton = document.querySelector("#varrer");
const filmsMp4Button = document.querySelector("#usar-filmesmp4");
const stopButton = document.querySelector("#parar");
const status = document.querySelector("#estado");
const results = document.querySelector("#resultados");
const filmsMp4 = "https://filmesmp4.biz/";
let scan;

function setBusy(value) {
  scanButton.disabled = filmsMp4Button.disabled = value;
}

function showTitle(title, catalogUrl, titleQuery) {
  const row = document.createElement("li");
  row.className = "titulo";

  const params = new URLSearchParams({ url: title.url, titulo: title.titulo, catalogo: catalogUrl });
  if (title.capa) params.set("capa", title.capa);
  if (titleQuery) params.set("buscaTitulo", titleQuery);
  const link = document.createElement("a");
  link.className = "titulo-card";
  link.href = `/titulo.html?${params}`;

  const name = document.createElement("strong");
  name.className = "titulo-detalhes";
  name.textContent = title.titulo;
  const cover = document.createElement("div");
  cover.className = "capa";
  cover.setAttribute("aria-hidden", "true");
  cover.textContent = "Sem capa";
  if (title.capa) {
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove(), { once: true });
    image.src = title.capa;
    cover.append(image);
  }

  link.append(cover, name);
  row.append(link);
  results.append(row);
}

function titleWords(value) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

async function scanCatalog(address, titleQuery = "") {
  const terms = titleWords(titleQuery);
  if (titleInput && !terms.length) {
    status.textContent = "Informe o nome do filme ou série.";
    return;
  }
  let initial;
  try {
    initial = new URL(address.includes("://") ? address : `https://${address}`);
    if (initial.protocol !== "https:" || initial.username || initial.password || initial.port) {
      throw new Error();
    }
    initial.hash = "";
  } catch {
    status.textContent = "Informe um endereço HTTPS válido para o catálogo.";
    return;
  }
  scan = new AbortController();
  const { signal } = scan;
  setBusy(true);
  stopButton.hidden = false;
  results.replaceChildren();
  results.classList.add("grade-catalogo");
  status.textContent = titleInput
    ? `Buscando “${titleQuery}” em ${initial.hostname}…`
    : `Buscando capas em ${initial.hostname}…`;
  const pages = new Set();
  const titles = new Set();
  const videos = new Map();
  let shownTitles = 0;
  let downloadDireto = true;
  let page = initial.href;
  let usedCache = false;
  function showCatalogStatus(message) {
    const withOrigin = `${message} Origem ${initial.hostname}.`;
    status.textContent = usedCache
      ? `${withOrigin} A varredura inclui páginas de uma cópia salva.`
      : withOrigin;
  }
  function showCatalogVideos() {
    if (titleInput || titles.size || !videos.size) return 0;
    results.classList.remove("grade-catalogo");
    return addMediaLinks(results, videos.values(), downloadDireto).length;
  }
  try {
    while (page && !pages.has(page)) {
      pages.add(page);
      const catalog = await query("catalogo", { url: page }, signal, { paginaInicial: pages.size === 1 });
      signal.throwIfAborted();
      usedCache ||= catalog.desatualizado === true;
      for (const title of catalog.titulos) {
        if (titles.has(title.url)) continue;
        titles.add(title.url);
        if (terms.length) {
          const words = titleWords(title.titulo);
          if (!terms.every(term => words.some(word => word.includes(term)))) continue;
        }
        showTitle(title, initial.href, titleQuery);
        shownTitles++;
      }
      if (!titleInput && catalog.videos?.length) {
        downloadDireto = catalog.downloadDireto !== false;
        for (const video of catalog.videos) videos.set(video.url, video);
      }
      page = catalog.proxima;
      if (page && !pages.has(page)) {
        showCatalogStatus(titleInput
          ? `${shownTitles} resultado(s) para “${titleQuery}”. Verificando mais páginas…`
          : `${titles.size} título(s) no catálogo. Buscando mais capas…`);
      }
    }
    const mediaCount = showCatalogVideos();
    if (shownTitles) {
      const matches = titleInput ? `${shownTitles} resultado(s) para “${titleQuery}”. ` : "";
      showCatalogStatus(`${matches}Escolha uma capa para ver as opções de download.`);
    } else if (mediaCount) {
      showCatalogStatus(`${mediaCount} link(s) direto(s) encontrado(s).`);
    } else if (titleInput && titles.size) {
      showCatalogStatus(`Nenhum título corresponde a “${titleQuery}”.`);
    } else {
      showCatalogStatus("Nenhuma capa com link foi encontrada nas páginas do catálogo.");
    }
  } catch (error) {
    const mediaCount = showCatalogVideos();
    if (signal.aborted) {
      const count = mediaCount ? `${mediaCount} link(s)` : `${shownTitles} capa(s)`;
      showCatalogStatus(`Varredura interrompida. ${count} exibido(s).`);
    } else {
      const partial = shownTitles || mediaCount ? " Os resultados encontrados foram mantidos." : "";
      showCatalogStatus(`Falha ao carregar o catálogo. ${error.message}${partial}`);
    }
  } finally {
    setBusy(false);
    stopButton.hidden = true;
    scan = null;
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  if (scanButton.disabled) return;
  const address = input.value.trim();
  if (address) {
    scanCatalog(address, titleInput?.value.trim());
  } else {
    status.textContent = "Informe o endereço do catálogo.";
  }
});

filmsMp4Button.addEventListener("click", () => {
  input.value = filmsMp4;
  form.requestSubmit(scanButton);
});
stopButton.addEventListener("click", () => scan?.abort());

const parameters = new URLSearchParams(location.search);
const savedCatalog = parameters.get("catalogo");
if (titleInput) {
  const savedTitle = parameters.get("buscaTitulo")?.trim() ?? "";
  titleInput.value = savedTitle.slice(0, titleInput.maxLength);
}
if (savedCatalog) {
  input.value = savedCatalog === "1" ? filmsMp4 : savedCatalog;
}
if (titleInput ? titleInput.value : savedCatalog) form.requestSubmit(scanButton);
