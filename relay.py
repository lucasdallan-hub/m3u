"""Convert configured channels to HLS for the browser player."""
import argparse
import hmac
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ASSETS = Path(__file__).resolve().parent / "web" / "public"
ROUTE = "/api/reproducao/"
SEGMENT = re.compile(r"([0-9a-f]{32})/(index\.m3u8|[0-9]+\.ts)")
PROTOCOLS = {"http", "https", "rtsp", "rtsps", "rtmp", "rtmps", "udp", "rtp", "srt", "mms"}
IDLE_SECONDS = 45
MAX_STREAMS = 3


@dataclass
class Channel:
    id: str
    directory: Path
    process: subprocess.Popen
    touched: float


class Relay(ThreadingHTTPServer):
    def __init__(self, port, sources, directory, token):
        super().__init__(("127.0.0.1", port), Handler)
        self.sources = sources
        self.directory = directory
        self.token = token
        self.channels = {}
        self.lock = threading.Lock()

    def remove(self, address):
        channel = self.channels.pop(address)
        if channel.process.poll() is None:
            channel.process.terminate()
            try:
                channel.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                channel.process.kill()
                channel.process.wait()
        shutil.rmtree(channel.directory)

    def reap(self, stop):
        while not stop.wait(5):
            with self.lock:
                for address, channel in list(self.channels.items()):
                    if time.monotonic() - channel.touched > IDLE_SECONDS:
                        self.remove(address)

    def start_channel(self, address):
        with self.lock:
            channel = self.channels.get(address)
            if channel and channel.process.poll() is not None:
                self.remove(address)
                channel = None
            if channel:
                channel.touched = time.monotonic()
                return channel
            if len(self.channels) >= MAX_STREAMS:
                return None
            channel_id = uuid.uuid4().hex
            directory = self.directory / channel_id
            directory.mkdir()
            command = [
                "ffmpeg", "-nostdin", "-loglevel", "error", "-rw_timeout", "12000000",
                "-protocol_whitelist", "http,https,tcp,tls,udp,rtp,rtmp,rtmps,srt,mmsh,mmst,crypto",
                "-re", "-i", address, "-map", "0:v:0?", "-map", "0:a:0?",
                "-c:v", "libx264", "-preset", "veryfast", "-threads:v", "2",
                "-maxrate", "3M", "-bufsize", "6M",
                "-pix_fmt", "yuv420p", "-vf", "scale=w='min(1280,iw)':h=-2",
                "-force_key_frames", "expr:gte(t,n_forced*2)", "-c:a", "aac",
                "-f", "hls", "-hls_time", "2", "-hls_list_size", "6",
                "-hls_flags", "delete_segments+temp_file",
                "-hls_segment_filename", str(directory / "%d.ts"), str(directory / "index.m3u8"),
            ]
            try:
                process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except OSError:
                directory.rmdir()
                raise
            channel = Channel(channel_id, directory, process, time.monotonic())
            self.channels[address] = channel
            return channel


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args):
        super().__init__(*args, directory=str(ASSETS))

    def respond(self, status, data, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def result(self, status, **fields):
        self.respond(status, json.dumps(fields, ensure_ascii=False).encode())

    def authorized(self):
        token = self.server.token
        supplied = self.headers.get("Authorization", "")
        return not token or hmac.compare_digest(supplied.encode(), f"Bearer {token}".encode())

    def do_POST(self):
        if self.path != ROUTE + "iniciar":
            return self.result(404, erro="Rota desconhecida.")
        if not self.authorized():
            return self.result(401, erro="Servidor de reprodução não autorizado.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if self.headers.get_content_type() != "application/json" or not 0 < length <= 8192:
                raise ValueError
            self.connection.settimeout(5)
            address = json.loads(self.rfile.read(length))["url"]
            if not isinstance(address, str):
                raise ValueError
        except (ValueError, KeyError, TypeError, OSError):
            return self.result(400, erro="Endereço inválido.")
        if address not in self.server.sources:
            return self.result(403, erro="Este canal ainda não foi configurado no servidor de reprodução.")

        try:
            channel = self.server.start_channel(address)
        except OSError:
            return self.result(503, erro="O conversor de vídeo está indisponível.")
        if not channel:
            return self.result(503, erro="O servidor atingiu o limite de canais simultâneos.")
        deadline = time.monotonic() + 18
        while time.monotonic() < deadline:
            if (channel.directory / "index.m3u8").is_file():
                return self.result(200, playlist=f"{ROUTE}{channel.id}/index.m3u8")
            if channel.process.poll() is not None:
                break
            time.sleep(.2)
        return self.result(502, erro="A origem não produziu vídeo reproduzível no tempo esperado.")

    def do_GET(self):
        path = urlsplit(self.path).path
        if not path.startswith(ROUTE):
            return super().do_GET()
        if not self.authorized():
            return self.result(401, erro="Servidor de reprodução não autorizado.")
        match = SEGMENT.fullmatch(path[len(ROUTE):])
        if not match:
            return self.result(404, erro="Recurso desconhecido.")
        channel_id, filename = match.groups()
        with self.server.lock:
            channel = next((entry for entry in self.server.channels.values() if entry.id == channel_id), None)
            try:
                data = (channel.directory / filename).read_bytes() if channel else None
            except FileNotFoundError:
                data = None
            if data is not None:
                channel.touched = time.monotonic()
        if data is None:
            return self.result(404, erro="Segmento indisponível.")
        mime = "application/vnd.apple.mpegurl" if filename == "index.m3u8" else "video/mp2t"
        self.respond(200, data, mime)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, required=True, help="arquivo JSON com URLs autorizadas")
    parser.add_argument("--port", type=int, default=8788)
    args = parser.parse_args()
    try:
        sources = json.loads(args.sources.read_text(encoding="utf-8"))
        if not isinstance(sources, list) or not all(
            isinstance(url, str) and urlsplit(url).scheme in PROTOCOLS and urlsplit(url).hostname
            for url in sources
        ):
            raise ValueError
    except (OSError, ValueError):
        parser.error("informe um arquivo JSON com uma lista de URLs de origem válidas")
    if not shutil.which("ffmpeg"):
        parser.error("FFmpeg é necessário")

    with tempfile.TemporaryDirectory(prefix="m3u-relay-") as directory:
        with Relay(args.port, set(sources), Path(directory), os.environ.get("REPRODUCAO_TOKEN")) as server:
            stop = threading.Event()
            reaper = threading.Thread(target=server.reap, args=(stop,), daemon=True)
            reaper.start()
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                stop.set()
                reaper.join()
                with server.lock:
                    for address in list(server.channels):
                        server.remove(address)


if __name__ == "__main__":
    main()
