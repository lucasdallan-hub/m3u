const form = document.querySelector("#busca");
const input = document.querySelector("#url");
const automatic = document.querySelector("#automatico");
const button = form.querySelector("button");
const status = document.querySelector("#estado");
const results = document.querySelector("#resultados");

form.addEventListener("submit", async event => {
  event.preventDefault();
  const autoDownload = automatic.checked;
  results.replaceChildren();
  status.textContent = "Buscando vídeos…";
  button.disabled = true;

  try {
    const response = await fetch(`/api/busca?${new URLSearchParams({ url: input.value.trim() })}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.erro || "A busca falhou.");

    for (const video of data.videos) {
      const row = document.createElement("li");
      const name = document.createElement("span");
      const link = document.createElement("a");
      name.textContent = video.name;
      link.textContent = "Baixar";
      link.href = `/api/baixar?${new URLSearchParams({ url: video.url })}`;
      link.download = "";
      link.setAttribute("aria-label", `Baixar ${video.name}`);
      row.append(name, link);
      results.append(row);
    }

    status.textContent = data.videos.length
      ? `${data.videos.length} vídeo(s) encontrado(s).`
      : "Nenhum link direto de vídeo foi encontrado nesta página.";
    if (autoDownload && data.videos.length === 1) results.querySelector("a").click();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
