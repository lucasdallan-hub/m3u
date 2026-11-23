import { recentCatalogs } from "./api.js";
import { publicHttps } from "./midia.js";

const list = document.querySelector("#dashboard-lista");
const empty = document.querySelector("#dashboard-vazio");
const number = new Intl.NumberFormat("pt-BR");

for (const entry of recentCatalogs()) {
  const url = entry.url.length <= 4096 ? publicHttps(entry.url) : null;
  if (!url) continue;
  const item = document.createElement("li");
  const link = document.createElement("a");
  const address = document.createElement("strong");
  const count = document.createElement("span");
  link.className = "dashboard-recente";
  link.href = `/catalogo.html?${new URLSearchParams({ catalogo: url.href })}`;
  address.className = "dashboard-endereco";
  address.textContent = url.hostname + (url.pathname === "/" ? "" : url.pathname);
  count.className = "dashboard-contagem";
  count.textContent = `${number.format(entry.total)} ${entry.total === 1 ? "título" : "títulos"} na página salva`;
  link.append(address, count);
  item.append(link);
  list.append(item);
  if (list.childElementCount === 4) break;
}

list.hidden = list.childElementCount === 0;
empty.hidden = !list.hidden;
