import { query } from "./api.js";
import { addMediaLinks, magnetUrl, publicHttps, viewerUrl } from "./midia.js";

const parameters = new URLSearchParams(location.search);
const heading = document.querySelector("#nome-titulo");
const status = document.querySelector("#estado-titulo");
const retry = document.querySelector("#tentar-downloads");
const downloads = document.querySelector("#downloads");
const cover = document.querySelector("#capa-titulo");

async function getDownloads(source) {
  const data = await query("busca", { url: source.href, catalogo: "1" });
  if (!Array.isArray(data?.videos) || typeof data.downloadDireto !== "boolean") {
    throw new Error("A API devolveu uma resposta sem opções de download válidas.");
  }
  return data;
}

function mediaAddress(item) {
  return item?.tipo === "magnet" ? magnetUrl(item.url) : publicHttps(item?.url);
}

function showOptions(options, downloadDireto, directLinks, groupedLinks) {
  let count = 0;
  for (const option of options) {
    if (typeof option?.titulo !== "string" || !Array.isArray(option.links)) continue;
    const title = option.titulo.trim();
    if (!title) continue;
    const links = document.createElement("ul");
    for (const item of option.links) {
      const url = mediaAddress(item);
      const name = typeof item?.nome === "string" ? item.nome.trim() : "";
      if (!url || !name || groupedLinks.has(url.href) || (!item.tipo && directLinks.has(url.href))) continue;
      const link = document.createElement("a");
      link.textContent = name;
      if (item.tipo === "magnet") {
        link.href = url.href;
        link.setAttribute("aria-label", `${name} no cliente BitTorrent`);
      } else if (item.tipo === "torrent" && item.atalho === true && !downloadDireto) {
        link.href = `/api/baixar?${new URLSearchParams({ url: url.href })}`;
        link.download = "";
        link.setAttribute("aria-label", `Baixar arquivo .torrent ${name}`);
      } else {
        link.href = viewerUrl(url, { atalho: item.tipo !== "torrent" && item.atalho === true });
      }
      const row = document.createElement("li");
      row.append(link);
      links.append(row);
      groupedLinks.add(url.href);
    }
    if (!links.childElementCount) continue;
    const group = document.createElement("li");
    group.className = "download-grupo";
    const label = document.createElement("h3");
    label.textContent = title;
    group.append(label, links);
    downloads.append(group);
    count += links.childElementCount;
  }
  return count;
}

function showDownloads({ videos, downloadDireto, opcoes }) {
  const directLinks = new Map();
  for (const video of videos) {
    const url = mediaAddress(video);
    if (url && typeof video.name === "string") directLinks.set(url.href, video);
  }
  const groupedLinks = new Set();
  const optionsCount = Array.isArray(opcoes) ? showOptions(opcoes, downloadDireto, directLinks, groupedLinks) : 0;
  const remainingVideos = [];
  for (const [url, video] of directLinks) {
    if (!groupedLinks.has(url)) remainingVideos.push(video);
  }
  const links = addMediaLinks(downloads, remainingVideos, downloadDireto);

  const count = optionsCount + links.length;
  if (!count) {
    status.textContent = "Nenhum link direto para download foi encontrado nesta página.";
  } else if (downloadDireto && !optionsCount && links.every(({ tipo }) => tipo !== "magnet" && tipo !== "torrent")) {
    status.textContent = "Abra um arquivo para baixar ou reproduzir, conforme o site de origem.";
  } else {
    status.textContent = count === 1 ? "1 opção de download" : `${count} opções de download`;
  }
}

const source = publicHttps(parameters.get("url"));
if (!source) {
  status.textContent = "Abra um filme ou série a partir do catálogo para buscar as opções de download.";
} else {
  const catalog = publicHttps(parameters.get("catalogo"));
  if (catalog) {
    const backParameters = new URLSearchParams({ catalogo: catalog.href });
    const titleQuery = parameters.get("buscaTitulo")?.trim();
    if (titleQuery) backParameters.set("buscaTitulo", titleQuery);
    const back = document.querySelector(".detalhe-voltar");
    back.href = `/${titleQuery ? "filmes" : "catalogo"}.html?${backParameters}`;
    if (titleQuery) back.querySelector(".detalhe-voltar-label").textContent = "Voltar à busca de filmes";
  }
  const original = document.querySelector("#origem-titulo");
  const originalLink = original.querySelector("a");
  originalLink.textContent = `Abrir página original em ${source.hostname}`;
  originalLink.href = viewerUrl(source);
  original.hidden = false;

  const title = parameters.get("titulo")?.trim();
  if (title) {
    heading.textContent = title;
    document.title = `${title} | Filmes Diretos`;
  }
  const image = publicHttps(parameters.get("capa"));
  if (image) {
    cover.addEventListener("load", () => { cover.parentElement.hidden = false; }, { once: true });
    cover.src = image.href;
  }
  async function loadDownloads() {
    retry.hidden = true;
    status.textContent = "Procurando opções de download…";
    try {
      showDownloads(await getDownloads(source));
    } catch (error) {
      status.textContent = `Não foi possível buscar as opções de download. ${error.message}`;
      retry.hidden = false;
    }
  }
  retry.addEventListener("click", loadDownloads);
  await loadDownloads();
}
