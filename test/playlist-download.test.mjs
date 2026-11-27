import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../web/worker.mjs";

const panel = "https://filmes.example.com";
const source = "iptv.example.com";
const playlist = "\uFEFF#EXTM3U\r\n#EXTINF:-1,Canal de teste\r\nhttps://test.example.com/reproducao.ts\r\n";
const encoded = new TextEncoder().encode(playlist);

function download(url, env = {}, headers = {}) {
  return worker.fetch(new Request(`${panel}/api/playlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: panel, ...headers },
    body: JSON.stringify({ url }),
  }), env);
}

function mockSource(t, respond) {
  const upstream = globalThis.fetch;
  globalThis.fetch = (url, init) => respond(new URL(url), init);
  t.after(() => { globalThis.fetch = upstream; });
}

test("baixa a playlist Xtream como anexo preservando todos os bytes e o redirecionamento", async t => {
  const input = `https://${source}/get.php?username=exemplo&password=senha-ficticia&type=m3u_plus`;
  const visited = [];
  mockSource(t, (url, init) => {
    assert.equal(init.redirect, "manual");
    assert.equal(init.cache, "no-store");
    assert.equal(url.hostname, source);
    assert.equal(init.headers.Cookie, undefined);
    visited.push(url.href);
    if (url.pathname === "/get.php") {
      return new Response(null, { status: 302, headers: { Location: "/lista%20teste.m3u" } });
    }
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoded.subarray(0, 2));
        controller.enqueue(encoded.subarray(2, 9));
        controller.enqueue(encoded.subarray(9));
        controller.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/plain" } });
  });

  const response = await download(input, { DOMINIOS_PERMITIDOS: source }, { Cookie: "sessao=privada" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="lista_teste.m3u"');
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), encoded);
  assert.deepEqual(visited, [input, `https://${source}/lista%20teste.m3u`]);
});

test("consulta DNS público em modo aberto e baixa M3U8 com nome próprio", async t => {
  const calls = [];
  mockSource(t, (url, init) => {
    calls.push(url.hostname);
    if (url.hostname === "cloudflare-dns.com") {
      const ipv4 = url.searchParams.get("type") === "A";
      return Response.json({ Status: 0, Answer: ipv4 ? [{ type: 1, data: "93.184.216.34" }] : [] });
    }
    assert.equal(init.headers["Content-Type"], undefined);
    return new Response(playlist);
  });
  const response = await download(`https://${source}/live.m3u8`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="live.m3u8"');
  assert.equal(calls.filter(host => host === "cloudflare-dns.com").length, 2);
  assert.equal(calls.at(-1), source);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), encoded);
});

test("recusa redirecionamento para outro domínio com allowlist e destinos DNS privados", async t => {
  await t.test("redirecionamento", async subtest => {
    mockSource(subtest, url => {
      assert.equal(url.hostname, source);
      return new Response(null, { status: 302, headers: { Location: "https://outro.example.com/playlist.m3u" } });
    });
    const response = await download(`https://${source}/playlist.m3u`, { DOMINIOS_PERMITIDOS: source });
    assert.equal(response.status, 403);
  });
  await t.test("DNS privado", async subtest => {
    mockSource(subtest, url => {
      assert.equal(url.hostname, "cloudflare-dns.com");
      return Response.json({
        Status: 0,
        Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "192.168.10.2" }] : [],
      });
    });
    assert.equal((await download(`https://${source}/private.m3u`)).status, 403);
  });
});

test("distingue erro HTTP, HTML, conteúdo inválido e tamanho acima do limite", async t => {
  const cases = [
    [401, () => new Response(null, { status: 401 }), /HTTP 401/],
    [502, () => new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } }), /página HTML/],
    [502, () => new Response("linha de erro", { headers: { "Content-Type": "audio/x-mpegurl" } }), /playlist M3U válida/],
    [413, () => new Response("resultado grande", { headers: { "Content-Length": String(32 * 1024 * 1024 + 1) } }), /32 MiB/],
  ];
  let result;
  mockSource(t, () => result());
  for (const [status, factory, message] of cases) {
    result = factory;
    const response = await download(`https://${source}/get.php?token=token-ficticio`, { DOMINIOS_PERMITIDOS: source });
    assert.equal(response.status, status);
    const { erro } = await response.json();
    assert.match(erro, message);
    assert.doesNotMatch(erro, /token-ficticio/);
  }
});

test("limita o corpo JSON e exige POST na mesma origem", async () => {
  const method = await worker.fetch(new Request(`${panel}/api/playlist`), {});
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("Allow"), "POST");
  assert.equal((await download(`https://${source}/teste.m3u`, {}, { Origin: "https://outro.example.com" })).status, 403);
  assert.equal((await download(`https://${source}/` + "x".repeat(8200))).status, 413);
});
