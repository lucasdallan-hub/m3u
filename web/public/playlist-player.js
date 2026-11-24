const dialog = document.querySelector("#playlist-player");
const video = document.querySelector("#playlist-video");
const title = document.querySelector("#playlist-player-title");
const status = document.querySelector("#playlist-player-status");
const source = document.querySelector("#playlist-player-link");
let session;
let stream;

export function playlistMediaUrl(address) {
  if (!/^(?:https?:\/\/|\/\/)/i.test(address)) return null;
  try {
    const url = new URL(address.startsWith("//") ? `https:${address}` : address);
    return url.username || url.password ? null : url;
  } catch {
    return null;
  }
}

function releaseMedia() {
  if (!session) return;
  session.abort();
  session = null;
  stream?.destroy();
  stream = null;
  video.pause();
  video.removeAttribute("src");
  video.load();
  source.removeAttribute("href");
}

export function closePlaylistMedia() {
  if (dialog.open) dialog.close();
  releaseMedia();
}

dialog.addEventListener("close", () => {
  if (!dialog.open) releaseMedia();
});

function play(signal) {
  video.play().catch(error => {
    if (!signal.aborted && error.name === "NotAllowedError") {
      status.textContent = "Pressione Reproduzir para iniciar.";
    }
  });
}

async function attachStream(url, format, isLive, signal, onError) {
  try {
    if (format === "ts") {
      await import("https://cdn.jsdelivr.net/npm/mpegts.js@1.8.0/dist/mpegts.js");
      if (signal.aborted) return;
      const { mpegts } = window;
      if (!mpegts.isSupported()) return onError();
      stream = mpegts.createPlayer({ type: "mpegts", url: url.href, isLive });
      stream.on(mpegts.Events.ERROR, onError);
      stream.attachMediaElement(video);
      stream.load();
      play(signal);
      return;
    }

    const { default: Hls } = await import("https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.mjs");
    if (signal.aborted) return;
    if (!Hls.isSupported()) return onError();
    stream = new Hls();
    stream.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) onError();
    });
    stream.once(Hls.Events.MANIFEST_PARSED, () => play(signal));
    stream.loadSource(url.href);
    stream.attachMedia(video);
  } catch {
    onError();
  }
}

export function openPlaylistMedia(name, url, type) {
  releaseMedia();
  session = new AbortController();
  const { signal } = session;
  title.textContent = name;
  source.href = url.href;
  status.textContent = "Carregando mídia…";
  if (!dialog.open) dialog.showModal();

  const isLive = type === "channel";
  const hls = /\.m3u8?$/i.test(url.pathname);
  const ts = /\.tsx?$/i.test(url.pathname);
  let tryHls = isLive && !/\.[a-z\d]+$/i.test(url.pathname);
  function onError() {
    if (signal.aborted) return;
    status.textContent = "Não foi possível reproduzir esta mídia no navegador. Tente abrir o endereço na origem.";
  }
  video.addEventListener("playing", () => { status.textContent = ""; }, { signal });
  video.addEventListener("waiting", () => { status.textContent = "Carregando mídia…"; }, { signal });
  video.addEventListener("error", () => {
    if (tryHls) {
      tryHls = false;
      video.removeAttribute("src");
      video.load();
      attachStream(url, "hls", isLive, signal, onError);
      return;
    }
    onError();
  }, { signal });

  if (ts || (hls && !video.canPlayType("application/vnd.apple.mpegurl"))) {
    attachStream(url, ts ? "ts" : "hls", isLive, signal, onError);
  } else {
    video.src = url.href;
    play(signal);
  }
}
