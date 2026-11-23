const menu = document.querySelector("#menu-lateral");
const pages = [
  { id: "dashboard", href: "/dashboard.html", label: "Dashboard" },
  { id: "filmes", href: "/filmes.html", label: "Buscar filmes" },
  { id: "busca", href: "/", label: "Buscar links" },
  { id: "catalogo", href: "/catalogo.html", label: "Varrer catálogo" },
  { id: "playlist", href: "/playlist.html", label: "Catálogo M3U" },
];

if (menu) {
  const currentPath = location.pathname.replace(/\.html$/, "");
  const titleSearch = currentPath === "/titulo" && new URLSearchParams(location.search).get("buscaTitulo")?.trim();
  const current = titleSearch ? "filmes" : document.body.dataset.menu;
  for (const page of pages) {
    const link = document.createElement("a");
    link.className = "menu-link";
    link.href = page.href;
    link.textContent = page.label;
    if (page.id === current) {
      const menuPath = page.href.replace(/\.html$/, "");
      link.classList.add("is-active");
      link.setAttribute("aria-current", currentPath === menuPath ? "page" : "location");
    }
    menu.append(link);
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "botao secundario menu-toggle";
  toggle.textContent = "Menu";
  toggle.setAttribute("aria-controls", "menu-gaveta");
  toggle.setAttribute("aria-expanded", "false");
  document.querySelector(".site-header-inner").append(toggle);

  const drawer = document.createElement("dialog");
  drawer.id = "menu-gaveta";
  drawer.className = "menu-gaveta";
  drawer.setAttribute("aria-label", "Menu do Filmes Diretos");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "botao secundario menu-fechar";
  close.textContent = "Fechar menu";
  drawer.append(close);
  menu.after(drawer);

  toggle.addEventListener("click", () => {
    drawer.showModal();
    toggle.setAttribute("aria-expanded", "true");
  });
  close.addEventListener("click", () => drawer.close());
  drawer.addEventListener("close", () => toggle.setAttribute("aria-expanded", "false"));
  drawer.addEventListener("click", event => {
    if (event.target === drawer && event.clientX > drawer.getBoundingClientRect().right) drawer.close();
  });
  menu.addEventListener("click", event => {
    if (event.target.closest("a") && drawer.open) drawer.close();
  });

  const narrow = matchMedia("(max-width: 46rem)");
  function placeMenu() {
    if (narrow.matches) {
      drawer.append(menu);
    } else {
      if (drawer.open) drawer.close();
      drawer.before(menu);
    }
  }
  narrow.addEventListener("change", placeMenu);
  placeMenu();
}
