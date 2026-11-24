const dialog = document.querySelector("#playlist-player");
const video = document.querySelector("#playlist-video");
const title = document.querySelector("#playlist-player-title");
const status = document.querySelector("#playlist-player-status");
const browserProtocols = new Set(["https:", "http:"]);
const externalProtocols = new Set(["rtsp:", "rtsps:", "rtmp:", "rtmps:", "udp:", "rtp:", "srt:", "mms:"]);
const playbackTimeout = 20000;
let session;
let stopStream;

export function playlistMediaUrl(address) {
  if (!/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(address)) return null;
  try {
    const url = new URL(address.startsWith("//") ? `https:${address}` : address);
    if (!url.hostname || (!browserProtocols.has(url.protocol) && !externalProtocols.has(url.protocol))) return null;
    return url;
  } catch {
    return null;
  }
}

function stopPlayback() {
  stopStream?.();
  stopStream = null;
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function releaseMedia() {
  if (!session) return;
  session.abort();
  session = null;
  stopPlayback();
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
    if (format === "dash") {
      const { MediaPlayer } = await import("https://cdn.jsdelivr.net/npm/dashjs@5.0.3/dist/modern/esm/dash.all.min.js");
      if (signal.aborted) return;
      const player = MediaPlayer().create();
      stopStream = () => player.reset();
      player.on(MediaPlayer.events.ERROR, onError);
      player.on(MediaPlayer.events.STREAM_INITIALIZED, () => play(signal));
      player.initialize(video, url.href, false);
      return;
    }

    if (format === "mpegts" || format === "flv") {
      await import("https://cdn.jsdelivr.net/npm/mpegts.js@1.8.0/dist/mpegts.js");
      if (signal.aborted) return;
      const { mpegts } = window;
      if (!mpegts.isSupported()) return onError();
      const stream = mpegts.createPlayer({ type: format, url: url.href, isLive });
      stopStream = () => stream.destroy();
      stream.on(mpegts.Events.ERROR, onError);
      stream.attachMediaElement(video);
      stream.load();
      play(signal);
      return;
    }

    const { default: Hls } = await import("https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.mjs");
    if (signal.aborted) return;
    if (!Hls.isSupported()) return onError();
    const stream = new Hls();
    stopStream = () => stream.destroy();
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

function streamFormat(url, contentType = "") {
  const path = url.pathname;
  if (/\.m3u8?$/i.test(path) || /mpegurl/i.test(contentType)) return "hls";
  if (/\.mpd$/i.test(path) || /dash\+xml/i.test(contentType)) return "dash";
  if (/\.(?:ts|m2ts|mts)$/i.test(path) || /video\/mp2t/i.test(contentType)) return "mpegts";
  if (/\.flv$/i.test(path) || /video\/x-flv/i.test(contentType)) return "flv";
  return "";
}

async function discoverStream(url, signal) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    if (response.ok) return streamFormat(new URL(response.url), response.headers.get("Content-Type") ?? "");
  } catch {
    // Some streaming origins reject HEAD or do not allow CORS.
  }
  return "";
}

export function openPlaylistMedia(name, url, type, address) {
  releaseMedia();
  session = new AbortController();
  const { signal } = session;
  title.textContent = name;
  const webSource = browserProtocols.has(url.protocol) && !url.username && !url.password;
  const mixedIp = location.protocol === "https:" && url.protocol === "http:" &&
    (/^\d+(?:\.\d+){3}$/.test(url.hostname) || url.hostname.startsWith("["));
  status.textContent = "Carregando mídia…";
  if (!dialog.open) dialog.showModal();

  const isLive = type === "channel";
  const format = streamFormat(url);
  let probeLive = (isLive || url.pathname === "/") && !format && !/\.[a-z\d]+$/i.test(url.pathname);
  let relayAttempted = false;
  let startingRelay = false;
  let timer;
  function stopWithMessage(message) {
    if (signal.aborted) return;
    session.abort();
    stopPlayback();
    status.textContent = message;
  }
  function onError() {
    if (signal.aborted || startingRelay) return;
    if (!relayAttempted) {
      startRelay();
      return;
    }
    stopWithMessage("Não foi possível reproduzir o vídeo recebido do servidor.");
  }
  async function startRelay() {
    relayAttempted = startingRelay = true;
    probeLive = false;
    clearTimeout(timer);
    stopPlayback();
    status.textContent = "Preparando transmissão no servidor…";
    try {
      const response = await fetch("/api/reproducao/iniciar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: address }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(22000)]),
      });
      if (![200, 403, 502, 503].includes(response.status)) {
        return stopWithMessage("O serviço de reprodução HLS ainda não está disponível neste site.");
      }
      const { playlist, erro } = await response.json();
      if (signal.aborted) return;
      if (!response.ok || !/^\/api\/reproducao\/[a-f0-9]{32}\/index\.m3u8$/.test(playlist)) {
        return stopWithMessage(erro || "O servidor não conseguiu converter a transmissão.");
      }
      const converted = new URL(playlist, location.origin);
      startingRelay = false;
      waitForMedia();
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = converted.href;
        play(signal);
      } else {
        attachStream(converted, "hls", isLive, signal, onError);
      }
    } catch {
      stopWithMessage("O serviço de reprodução HLS não respondeu.");
    }
  }
  function waitForMedia() {
    status.textContent = "Carregando mídia…";
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!relayAttempted) startRelay();
      else stopWithMessage("A transmissão demorou para responder.");
    }, playbackTimeout);
  }
  signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  video.addEventListener("playing", () => {
    clearTimeout(timer);
    status.textContent = "";
  }, { signal });
  video.addEventListener("pause", () => clearTimeout(timer), { signal });
  video.addEventListener("waiting", waitForMedia, { signal });
  video.addEventListener("error", async () => {
    if (startingRelay) return;
    if (probeLive) {
      probeLive = false;
      video.removeAttribute("src");
      video.load();
      waitForMedia();
      const detected = await discoverStream(url, signal);
      if (!signal.aborted && !relayAttempted) attachStream(url, detected || "hls", isLive, signal, onError);
      return;
    }
    onError();
  }, { signal });

  if (!webSource || mixedIp) {
    startRelay();
    return;
  }
  waitForMedia();
  if (format && (format !== "hls" || !video.canPlayType("application/vnd.apple.mpegurl"))) {
    attachStream(url, format, isLive, signal, onError);
  } else {
    video.src = url.href;
    play(signal);
  }
}
