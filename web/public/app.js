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
    const response = await fetch(`/api/busca?${new URLSearchParams({ url: input.value.trim() })}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.erro || "A busca falhou.");

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

async function query(endpoint, parameters, signal) {
  const response = await fetch(`/api/${endpoint}?${new URLSearchParams(parameters)}`, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.erro || "A consulta falhou.");
  return data;
}

function fillTitleLinks(links, data) {
  links.replaceChildren();
  if (!data?.videos.length) {
    links.textContent = data ? "Sem link direto publicado" : "Falha ao consultar";
  } else {
    for (const video of data.videos) {
      const link = document.createElement("a");
      link.textContent = video.name;
      link.href = data.downloadDireto
        ? video.url
        : `/api/baixar?${new URLSearchParams({ url: video.url })}`;
      if (data.downloadDireto) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      } else {
        link.download = "";
      }
      links.append(link);
    }
  }
}

function showTitle(title) {
  const row = document.createElement("li");
  row.className = "titulo";
  const name = document.createElement("strong");
  name.textContent = title.titulo;
  const links = document.createElement("div");
  links.textContent = "Aguardando consulta dos links…";
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

  const details = document.createElement("div");
  details.className = "titulo-detalhes";
  links.className = "titulo-links";
  details.append(name, links);
  row.append(cover, details);
  results.append(row);
  return links;
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
  let checked = 0;
  let found = 0;
  let failures = 0;

  const queue = [];
  let catalogError;
  try {
    while (page && !pages.has(page)) {
      pages.add(page);
      let catalog;
      try {
        catalog = await query("catalogo", { url: page }, signal);
      } catch (error) {
        signal.throwIfAborted();
        catalogError = error.message;
        break;
      }
      for (const title of catalog.titulos) {
        if (titles.has(title.url)) continue;
        titles.add(title.url);
        queue.push({ title, links: showTitle(title) });
      }
      status.textContent = `${titles.size} título(s) no catálogo. Buscando mais capas…`;
      page = catalog.proxima;
    }

    const inspect = async () => {
      while (queue.length && !signal.aborted) {
        const { title, links } = queue.shift();
        let data;
        try {
          data = await query("busca", { url: title.url, catalogo: "1" }, signal);
        } catch {
          if (signal.aborted) return;
          failures++;
        }
        fillTitleLinks(links, data);
        checked++;
        if (data?.videos.length) found++;
        status.textContent = `${checked} de ${titles.size} título(s) consultado(s), ${found} com links.`;
      }
    };
    await Promise.all([inspect(), inspect()]);
    signal.throwIfAborted();
    status.textContent = checked
      ? `${checked} título(s) consultado(s), ${found} com links e ${failures} com falha.`
      : "Nenhuma capa com link foi encontrada nas páginas do catálogo.";
    if (catalogError) status.textContent += ` Falha ao carregar o catálogo. ${catalogError}`;
  } catch (error) {
    status.textContent = signal.aborted
      ? `Varredura interrompida. ${titles.size} capa(s) listada(s), ${checked} título(s) consultado(s).`
      : `Varredura interrompida após ${checked} título(s). ${error.message}`;
  } finally {
    scanButton.disabled = button.disabled = false;
    stopButton.hidden = true;
    scan = null;
  }
});
