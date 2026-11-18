"""Baixa vídeos com links diretos publicados em páginas autorizadas."""

import argparse
import hashlib
import json
import logging
import os
import re
import tempfile
import time
from html.parser import HTMLParser
from pathlib import Path
from http.client import HTTPException
from urllib.parse import unquote, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".m4v", ".avi"}
PAGE_LIMIT = 4 * 1024 * 1024
BLOCK_SIZE = 256 * 1024


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attribute = {"a": "href", "video": "src", "source": "src"}.get(tag)
        if attribute:
            self.urls.extend(value for key, value in attrs if key == attribute and value)


class AuthorizedRedirects(HTTPRedirectHandler):
    def __init__(self, hosts):
        self.hosts = frozenset(host.lower() for host in hosts)

    def validate(self, url):
        parts = urlsplit(url)
        if (
            parts.scheme != "https"
            or parts.hostname not in self.hosts
            or parts.username is not None
            or parts.port not in (None, 443)
        ):
            raise ValueError("URL fora dos domínios HTTPS permitidos")
        return parts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.validate(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Downloader:
    def __init__(self, hosts, destination, max_bytes):
        self.policy = AuthorizedRedirects(hosts)
        self.opener = build_opener(self.policy)
        self.destination = destination
        self.max_bytes = max_bytes

    def open(self, url, accept):
        self.policy.validate(url)
        request = Request(url, headers={"User-Agent": "FilmesDiretos/1.0", "Accept": accept})
        return self.opener.open(request, timeout=30)

    def find_videos(self, page):
        with self.open(page, "text/html") as response:
            if response.headers.get_content_type() not in {"text/html", "application/xhtml+xml"}:
                raise ValueError("a fonte deve ser uma página HTML")
            body = response.read(PAGE_LIMIT + 1)
            if len(body) > PAGE_LIMIT:
                raise ValueError("página acima do limite de 4 MiB")
            links = Links()
            links.feed(body.decode(response.headers.get_content_charset() or "utf-8", errors="replace"))
            base = response.geturl()

        found = {}
        for link in links.urls:
            try:
                url = urljoin(base, link.strip()).split("#", 1)[0]
                parts = self.policy.validate(url)
            except ValueError:
                continue
            name = unquote(parts.path.rsplit("/", 1)[-1])
            if Path(name).suffix.lower() in VIDEO_EXTENSIONS:
                found[url] = name
        return found

    def download(self, url, name):
        stem = re.sub(r"[^\w.-]+", "_", Path(name).stem, flags=re.ASCII).strip("._") or "video"
        suffix = Path(name).suffix.lower()
        key = hashlib.sha256(url.encode()).hexdigest()[:16]
        target = self.destination / f"{stem[:100]}-{key}{suffix}"
        if target.exists():
            return

        temporary = None
        try:
            with self.open(url, "video/*, application/octet-stream") as response:
                content_type = response.headers.get_content_type()
                if not (
                    content_type.startswith("video/")
                    or content_type in {"application/octet-stream", "application/mp4"}
                ):
                    raise ValueError(f"tipo de arquivo inesperado ({content_type})")
                if response.status != 200:
                    raise ValueError(f"resposta incompleta ou inesperada (HTTP {response.status})")
                length = response.headers.get("Content-Length")
                expected = int(length) if length is not None else None
                if expected is not None and not 0 < expected <= self.max_bytes:
                    raise ValueError("tamanho informado fora do limite configurado")
                with tempfile.NamedTemporaryFile(dir=self.destination, suffix=".part", delete=False) as output:
                    temporary = Path(output.name)
                    size = 0
                    while chunk := response.read(BLOCK_SIZE):
                        size += len(chunk)
                        if size > self.max_bytes:
                            raise ValueError("download acima do limite configurado")
                        output.write(chunk)
                    if size == 0 or (expected is not None and size != expected):
                        raise ValueError("download vazio ou incompleto")

            try:
                os.link(temporary, target)
            except FileExistsError:
                return
            logging.info("Baixado: %s (%d bytes)", target.name, size)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def scan(self, pages):
        failed = False
        visited = set()
        for page in dict.fromkeys(pages):
            try:
                videos = self.find_videos(page)
                logging.info("%s: %d link(s) direto(s)", urlsplit(page).hostname, len(videos))
            except (OSError, HTTPException, ValueError, LookupError) as error:
                logging.error("Falha ao ler fonte: %s", error)
                failed = True
                continue
            for url, name in videos.items():
                if url in visited:
                    continue
                visited.add(url)
                try:
                    self.download(url, name)
                except (OSError, HTTPException, ValueError) as error:
                    logging.error("Falha ao baixar %r: %s", name, error)
                    failed = True
        return int(failed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--config", type=Path, help="arquivo de fontes (padrão: fontes.json)")
    source.add_argument("--site", metavar="URL", help="página HTTPS para procurar vídeos diretamente")
    parser.add_argument("--intervalo", type=int, default=0, help="segundos entre varreduras; 0 executa uma vez")
    args = parser.parse_args()
    if args.intervalo < 0:
        parser.error("--intervalo deve ser maior ou igual a zero")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        config_path = args.config or Path("fontes.json")
        if args.site is None:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        else:
            page = args.site.strip()
            if "://" not in page:
                page = f"https://{page}"
            host = urlsplit(page).hostname
            if not host:
                raise ValueError("--site deve indicar um domínio ou uma URL HTTPS")
            config = {"dominios_permitidos": [host], "paginas": [page]}
        hosts = config["dominios_permitidos"]
        pages = config["paginas"]
        for values in (hosts, pages):
            if not isinstance(values, list) or not values or not all(isinstance(value, str) and value for value in values):
                raise ValueError("informe listas não vazias de domínios e páginas")
        max_mib = config.get("limite_mib", 4096)
        if type(max_mib) is not int or max_mib <= 0:
            raise ValueError("limite_mib deve ser um inteiro positivo")
        destination = config_path.parent / config.get("pasta", "downloads")
        downloader = Downloader(hosts, destination, max_mib * 1024 * 1024)
        for page in pages:
            downloader.policy.validate(page)
        destination.mkdir(parents=True, exist_ok=True)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))

    try:
        while True:
            result = downloader.scan(pages)
            if not args.intervalo:
                return result
            time.sleep(args.intervalo)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
