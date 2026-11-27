import { query } from "./api.js";
import { addMediaLinks } from "./midia.js";

const form = document.querySelector("#busca");
const input = document.querySelector("#url");
const automatic = document.querySelector("#automatico");
const searchButton = form.querySelector('button[type="submit"]');
const status = document.querySelector("#estado");
const results = document.querySelector("#resultados");

async function searchVideos(address) {
  const autoDownload = automatic.checked;
  results.replaceChildren();
  status.textContent = "Buscando links…";
  searchButton.disabled = true;

  try {
    const data = await query("busca", { url: address });
    const links = addMediaLinks(results, data.videos, data.downloadDireto);

    status.textContent = links.length
      ? `${links.length} link(s) encontrado(s).`
      : "Nenhum link direto de vídeo ou torrent foi encontrado nesta página.";
    if (autoDownload && links.length === 1) {
      const [{ link, tipo }] = links;
      if (tipo === "magnet") {
        status.textContent = "Selecione o link para abrir o cliente BitTorrent.";
      } else if (data.downloadDireto && tipo === "torrent") {
        status.textContent = "Abra o arquivo .torrent no site de origem e use um cliente BitTorrent.";
      } else if (data.downloadDireto) {
        status.textContent = "Abra o vídeo encontrado. O site de origem define se ele será baixado ou reproduzido.";
      } else {
        link.click();
      }
    }
  } catch (error) {
    status.textContent = error.message;
  } finally {
    searchButton.disabled = false;
  }
}

const savedCatalog = new URLSearchParams(location.search).get("catalogo");
if (savedCatalog !== null) {
  location.replace(`/catalogo.html?${new URLSearchParams({ catalogo: savedCatalog })}`);
} else {
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (searchButton.disabled) return;
    const address = input.value.trim();
    if (address) {
      searchVideos(address);
    } else {
      status.textContent = "Informe o endereço da página.";
    }
  });
}
