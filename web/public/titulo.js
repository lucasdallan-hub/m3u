import { query } from "./api.js";

const parameters = new URLSearchParams(location.search);
const heading = document.querySelector("#nome-titulo");
const status = document.querySelector("#estado-titulo");
const downloads = document.querySelector("#downloads");
const cover = document.querySelector("#capa-titulo");

function publicHttps(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
      /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(url.hostname) &&
      !/\.(?:localhost|local|internal|lan|onion|test|invalid|example|home\.arpa)$/.test(url.hostname)) {
      return url;
    }
  } catch {
    // Ignore malformed addresses passed in the URL parameters.
  }
  return null;
}

async function getDownloads(source) {
  const data = await query("busca", { url: source.href, catalogo: "1" });
  if (!Array.isArray(data?.videos) || typeof data.downloadDireto !== "boolean") {
    throw new Error("A API devolveu uma resposta sem opções de download válidas.");
  }
  return data;
}

function showDownloads({ videos, downloadDireto }) {
  for (const video of videos) {
    const url = publicHttps(video?.url);
    if (!url || typeof video.name !== "string") continue;
    const row = document.createElement("li");
    const name = document.createElement("span");
    const link = document.createElement("a");
    name.textContent = video.name;
    if (downloadDireto) {
      link.textContent = "Abrir arquivo";
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else {
      link.textContent = "Baixar";
      link.href = `/api/baixar?${new URLSearchParams({ url: url.href })}`;
      link.download = "";
    }
    link.setAttribute("aria-label", `${link.textContent} ${video.name}`);
    row.append(name, link);
    downloads.append(row);
  }

  const count = downloads.childElementCount;
  if (!count) {
    status.textContent = "Nenhum link direto para download foi encontrado nesta página.";
  } else if (downloadDireto) {
    status.textContent = "Abra um arquivo para baixar ou reproduzir, conforme o site de origem.";
  } else {
    status.textContent = count === 1 ? "1 opção de download" : `${count} opções de download`;
  }
}

const source = publicHttps(parameters.get("url"));
if (!source) {
  status.textContent = "Abra um filme ou série a partir do catálogo para buscar as opções de download.";
} else {
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
