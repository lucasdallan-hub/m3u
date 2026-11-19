import { query } from "./api.js";

const form = document.querySelector("#busca");
const input = document.querySelector("#url");
const automatic = document.querySelector("#automatico");
const searchButton = form.querySelector("button");
const scanButton = document.querySelector("#varrer");
const filmsMp4Button = document.querySelector("#usar-filmesmp4");
const stopButton = document.querySelector("#parar");
const status = document.querySelector("#estado");
const results = document.querySelector("#resultados");
const filmsMp4 = "https://filmesmp4.biz/";
let scan;

function setBusy(value) {
  searchButton.disabled = scanButton.disabled = filmsMp4Button.disabled = value;
}

function showVideos(videos, downloadDireto) {
  for (const video of videos) {
    const row = document.createElement("li");
    const name = document.createElement("span");
    const link = document.createElement("a");
    name.textContent = video.name;
    if (downloadDireto) {
      link.textContent = "Abrir vídeo";
      link.href = video.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else {
      link.textContent = "Baixar";
      link.href = `/api/baixar?${new URLSearchParams({ url: video.url })}`;
      link.download = "";
    }
    link.setAttribute("aria-label", `${link.textContent} ${video.name}`);
    row.append(name, link);
    results.append(row);
  }
}

async function searchVideos(address) {
  const autoDownload = automatic.checked;
  results.replaceChildren();
  results.classList.remove("grade-catalogo");
  status.textContent = "Buscando vídeos…";
  setBusy(true);

  try {
    const data = await query("busca", { url: address });
    showVideos(data.videos, data.downloadDireto);

    status.textContent = data.videos.length
      ? `${data.videos.length} vídeo(s) encontrado(s).`
      : "Nenhum link direto de vídeo foi encontrado nesta página.";
    if (autoDownload && data.videos.length === 1) {
      if (data.downloadDireto) {
        status.textContent = "Abra o vídeo encontrado. O site de origem define se ele será baixado ou reproduzido.";
      } else {
        results.querySelector("a").click();
      }
    }
  } catch (error) {
    status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function showTitle(title, catalogUrl) {
  const row = document.createElement("li");
  row.className = "titulo";

  const params = new URLSearchParams({ url: title.url, titulo: title.titulo, catalogo: catalogUrl });
  if (title.capa) params.set("capa", title.capa);
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

async function scanCatalog(address) {
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
  status.textContent = `Buscando capas em ${initial.hostname}…`;
  const pages = new Set();
  const titles = new Set();
  const videos = new Map();
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
    if (titles.size || !videos.size) return false;
    results.classList.remove("grade-catalogo");
    showVideos(videos.values(), downloadDireto);
    return true;
  }
  try {
    while (page && !pages.has(page)) {
      pages.add(page);
      const catalog = await query("catalogo", { url: page }, signal, { paginaInicial: pages.size === 1 });
      usedCache ||= catalog.desatualizado === true;
      for (const title of catalog.titulos) {
        if (titles.has(title.url)) continue;
        titles.add(title.url);
        showTitle(title, initial.href);
      }
      if (catalog.videos?.length) {
        downloadDireto = catalog.downloadDireto !== false;
        for (const video of catalog.videos) videos.set(video.url, video);
      }
      page = catalog.proxima;
      if (page && !pages.has(page)) {
        showCatalogStatus(`${titles.size} título(s) no catálogo. Buscando mais capas…`);
      }
    }
    if (titles.size) {
      showCatalogStatus("Escolha uma capa para ver as opções de download.");
    } else if (showCatalogVideos()) {
      showCatalogStatus(`${videos.size} vídeo(s) direto(s) encontrado(s).`);
    } else {
      showCatalogStatus("Nenhuma capa com link foi encontrada nas páginas do catálogo.");
    }
  } catch (error) {
    const showedVideos = showCatalogVideos();
    if (signal.aborted) {
      const count = showedVideos ? `${videos.size} vídeo(s)` : `${titles.size} capa(s)`;
      showCatalogStatus(`Varredura interrompida. ${count} exibido(s).`);
    } else {
      const partial = titles.size || showedVideos ? " Os resultados encontrados foram mantidos." : "";
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
  if (searchButton.disabled) return;
  const address = input.value.trim();
  if (!address) {
    status.textContent = "Informe o endereço da página.";
  } else if (event.submitter === scanButton) {
    scanCatalog(address);
  } else {
    searchVideos(address);
  }
});

filmsMp4Button.addEventListener("click", () => {
  input.value = filmsMp4;
  form.requestSubmit(scanButton);
});
stopButton.addEventListener("click", () => scan?.abort());

const savedCatalog = new URLSearchParams(location.search).get("catalogo");
if (savedCatalog) {
  input.value = savedCatalog === "1" ? filmsMp4 : savedCatalog;
  form.requestSubmit(scanButton);
}
