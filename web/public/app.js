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

function showTitle(title, data) {
  const row = document.createElement("li");
  row.className = "titulo";
  const name = document.createElement("strong");
  name.textContent = title.titulo;
  const links = document.createElement("div");
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
  row.append(name, links);
  results.append(row);
}

stopButton.addEventListener("click", () => scan?.abort());

scanButton.addEventListener("click", async () => {
  scan = new AbortController();
  const { signal } = scan;
  scanButton.disabled = button.disabled = true;
  stopButton.hidden = false;
  results.replaceChildren();
  status.textContent = "Buscando capas no catálogo…";
  const pages = new Set();
  const titles = new Set();
  let page = "https://filmesmp4.biz/";
  let checked = 0;
  let found = 0;
  let failures = 0;

  try {
    while (page && !pages.has(page)) {
      pages.add(page);
      const catalog = await query("catalogo", { url: page }, signal);
      const queue = catalog.titulos.filter(title => !titles.has(title.url));
      for (const title of queue) titles.add(title.url);
      const inspect = async () => {
        while (queue.length && !signal.aborted) {
          const title = queue.shift();
          let data;
          try {
            data = await query("busca", { url: title.url, catalogo: "1" }, signal);
          } catch (error) {
            if (signal.aborted) return;
            failures++;
          }
          showTitle(title, data);
          checked++;
          if (data?.videos.length) found++;
          status.textContent = `${checked} título(s) consultado(s), ${found} com links.`;
        }
      };
      await Promise.all([inspect(), inspect()]);
      signal.throwIfAborted();
      page = catalog.proxima;
    }
    status.textContent = checked
      ? `${checked} título(s) consultado(s), ${found} com links e ${failures} com falha.`
      : "Nenhuma capa com link foi encontrada nas páginas do catálogo.";
  } catch (error) {
    status.textContent = signal.aborted
      ? `Varredura interrompida após ${checked} título(s).`
      : `Varredura interrompida após ${checked} título(s). ${error.message}`;
  } finally {
    scanButton.disabled = button.disabled = false;
    stopButton.hidden = true;
    scan = null;
  }
});
