import { query } from "./api.js";
import { addMediaLinks, publicHttps } from "./midia.js";

const parameters = new URLSearchParams(location.search);
const heading = document.querySelector("#nome-titulo");
const status = document.querySelector("#estado-titulo");
const downloads = document.querySelector("#downloads");
const cover = document.querySelector("#capa-titulo");

async function getDownloads(source) {
  const data = await query("busca", { url: source.href, catalogo: "1" });
  if (!Array.isArray(data?.videos) || typeof data.downloadDireto !== "boolean") {
    throw new Error("A API devolveu uma resposta sem opções de download válidas.");
  }
  return data;
}

function setNewTabLink(link, href) {
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
}

function showOptions(options) {
  let count = 0;
  for (const option of options) {
    if (typeof option?.titulo !== "string" || !Array.isArray(option.links)) continue;
    const title = option.titulo.trim();
    if (!title) continue;
    const links = document.createElement("ul");
    for (const item of option.links) {
      const url = publicHttps(item?.url);
      const name = typeof item?.nome === "string" ? item.nome.trim() : "";
      if (!url || !name) continue;
      const link = document.createElement("a");
      link.textContent = name;
      const href = item.atalho === true
        ? `/api/abrir?${new URLSearchParams({ url: url.href })}`
        : url.href;
      setNewTabLink(link, href);
      const row = document.createElement("li");
      row.append(link);
      links.append(row);
    }
    if (!links.childElementCount) continue;
    const group = document.createElement("li");
    group.className = "download-grupo";
    const label = document.createElement("h2");
    label.textContent = title;
    group.append(label, links);
    downloads.append(group);
    count += links.childElementCount;
  }
  return count;
}

function showDownloads({ videos, downloadDireto, opcoes }) {
  const optionsCount = Array.isArray(opcoes) ? showOptions(opcoes) : 0;
  const links = addMediaLinks(downloads, videos, downloadDireto);

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
    document.querySelector(".detalhe-voltar").href = `/?${new URLSearchParams({ catalogo: catalog.href })}`;
  }
  const original = document.querySelector("#origem-titulo");
  const originalLink = original.querySelector("a");
  originalLink.textContent = `Abrir página original em ${source.hostname}`;
  setNewTabLink(originalLink, source.href);
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
  try {
    showDownloads(await getDownloads(source));
  } catch (error) {
    status.textContent = `Não foi possível buscar as opções de download. ${error.message}`;
  }
}
