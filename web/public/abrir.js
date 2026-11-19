import { providerUrl, publicHttps, requiresSameTab } from "./midia.js";

const parameters = new URLSearchParams(location.search);
const source = publicHttps(parameters.get("url"));
const mode = parameters.get("modo");
const status = document.querySelector("#abrir-status");
const back = document.querySelector(".detalhe-voltar");
let frameLoads = 0;

const internalPages = new Set(["/", "/index", "/index.html", "/titulo", "/titulo.html"]);
if (document.referrer) {
  const previous = new URL(document.referrer);
  if (previous.origin === location.origin && internalPages.has(previous.pathname)) {
    back.href = previous.pathname + previous.search + previous.hash;
    back.addEventListener("click", event => {
      if (history.length <= 1 || frameLoads > 1 ||
        event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      history.back();
    });
  }
}

if (!source || !["video", "pagina"].includes(mode)) {
  status.textContent = "Abra um link a partir do catálogo para ver o conteúdo.";
} else {
  const provider = document.querySelector("#abrir-provedor");
  const fallback = document.querySelector(".abrir-externo");
  provider.textContent = source.hostname;
  provider.parentElement.hidden = false;

  const address = providerUrl(source, mode === "pagina" && parameters.get("atalho") === "1");
  fallback.href = address;
  fallback.hidden = false;

  if (mode === "video") {
    const player = document.querySelector("#abrir-player");
    player.addEventListener("error", () => {
      status.textContent = "O navegador não conseguiu reproduzir este vídeo aqui. Use Abrir na mesma aba para acessar o arquivo.";
    });
    player.src = address;
    player.hidden = false;
    document.querySelector("#abrir-titulo").textContent = "Assistir ao vídeo";
    document.title = "Assistir ao vídeo | Filmes Diretos";
    player.parentElement.hidden = false;
  } else if (requiresSameTab(source)) {
    status.textContent = "Use Abrir na mesma aba para continuar na página do provedor.";
  } else {
    const frame = document.querySelector("#abrir-frame");
    frame.addEventListener("load", () => { frameLoads++; });
    frame.src = address;
    frame.hidden = false;
    frame.parentElement.hidden = false;
    document.querySelector("#abrir-titulo").textContent = "Página do provedor";
    status.textContent = "Se o provedor bloquear a exibição aqui, use Abrir na mesma aba.";
  }
}
