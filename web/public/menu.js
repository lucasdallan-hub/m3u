const menu = document.querySelector("#menu-lateral");
const pages = [
  { id: "busca", href: "/", label: "Buscar links" },
  { id: "catalogo", href: "/catalogo.html", label: "Varrer catálogo" },
  { id: "playlist", href: "/playlist.html", label: "Limpar M3U" },
];

if (menu) {
  const current = document.body.dataset.menu;
  for (const page of pages) {
    const link = document.createElement("a");
    link.className = "menu-link";
    link.href = page.href;
    link.textContent = page.label;
    if (page.id === current) {
      const currentPath = location.pathname.replace(/\.html$/, "");
      const menuPath = page.href.replace(/\.html$/, "");
      link.classList.add("is-active");
      link.setAttribute("aria-current", currentPath === menuPath ? "page" : "location");
    }
    menu.append(link);
  }
}
