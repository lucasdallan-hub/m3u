import { query } from "./api.js";

const form = document.querySelector("#busca");
const input = document.querySelector("#url");
const automatic = document.querySelector("#automatico");
const button = form.querySelector("button");
const status = document.querySelector("#estado");
const results = document.querySelector("#resultados");

form.addEventListener("submit", async event => {
  event.preventDefault();
  const autoDownload = automatic.checked;
  if (scan || button.disabled) return;
  results.replaceChildren();
  results.classList.remove("grade-catalogo");
  status.textContent = "Buscando vídeos…";
  button.disabled = scanButton.disabled = true;

  try {
    const data = await query("busca", { url: input.value.trim() });

    for (const video of data.videos) {
      const row = document.createElement("li");
      const name = document.createElement("span");
      const link = document.createElement("a");
      name.textContent = video.name;
      if (data.downloadDireto) {
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
    button.disabled = scanButton.disabled = false;
  }
});

const scanButton = document.querySelector("#varrer");
const stopButton = document.querySelector("#parar");
let scan;

function showTitle(title) {
  const row = document.createElement("li");
  row.className = "titulo";

  const params = new URLSearchParams({ url: title.url, titulo: title.titulo });
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

stopButton.addEventListener("click", () => scan?.abort());

scanButton.addEventListener("click", async () => {
  scan = new AbortController();
  const { signal } = scan;
  scanButton.disabled = button.disabled = true;
  stopButton.hidden = false;
  results.replaceChildren();
  results.classList.add("grade-catalogo");
  status.textContent = "Buscando capas no catálogo…";
  const pages = new Set();
  const titles = new Set();
  let page = "https://filmesmp4.biz/";
  try {
    while (page && !pages.has(page)) {
      pages.add(page);
      const catalog = await query("catalogo", { url: page }, signal);
      for (const title of catalog.titulos) {
        if (titles.has(title.url)) continue;
        titles.add(title.url);
        showTitle(title);
      }
      page = catalog.proxima;
      if (page && !pages.has(page)) {
        status.textContent = `${titles.size} título(s) no catálogo. Buscando mais capas…`;
      }
    }
    status.textContent = titles.size
      ? "Escolha uma capa para ver as opções de download."
      : "Nenhuma capa com link foi encontrada nas páginas do catálogo.";
  } catch (error) {
    status.textContent = signal.aborted
      ? `Varredura interrompida. ${titles.size} capa(s) listada(s).`
      : `Falha ao carregar o catálogo. ${error.message}`;
  } finally {
    scanButton.disabled = button.disabled = false;
    stopButton.hidden = true;
    scan = null;
  }
});

if (new URLSearchParams(location.search).get("catalogo") === "1") scanButton.click();
