# Filmes Diretos

Encontra links diretos de vídeo em páginas HTTPS e baixa automaticamente o que estiver nos domínios permitidos. Use com conteúdo de domínio público, próprio ou cujo download tenha sido autorizado.

## Uso

Requer Python 3.10 ou superior. O programa usa apenas a biblioteca padrão.

### Buscar em um site

```bash
python3 filmes.py --site 'https://catalogo.example.org/filmes'
python3 filmes.py --site 'catalogo.example.org/filmes' --intervalo 3600
```

Troque o endereço pela página que deseja verificar. O programa busca os links diretos presentes nessa página e salva os vídeos do mesmo domínio em `downloads/`. Se o catálogo hospedar os vídeos em outro domínio, use a configuração abaixo para permitir esse domínio também.

### Usar um catálogo salvo

```bash
cp fontes.exemplo.json fontes.json
```

Edite `fontes.json`. Troque os endereços de exemplo pelas páginas do seu catálogo e adicione à lista de domínios os nomes exatos do catálogo e dos servidores que hospedam os vídeos. A pasta de downloads é relativa ao arquivo de configuração, e o limite se aplica a cada arquivo.

```bash
python3 filmes.py
python3 filmes.py --intervalo 3600
```

O primeiro comando faz uma varredura. O segundo repete a busca a cada hora enquanto o processo estiver rodando. Use Ctrl+C para encerrar. Uma varredura única retorna código 1 se alguma fonte ou download falhar.

O programa lê links de arquivos MP4, MKV, WebM, MOV, M4V e AVI presentes no HTML. Ele ignora scripts, pop-ups e URLs de domínios fora da lista, inclusive durante redirecionamentos. URLs já baixadas são reaproveitadas nas próximas varreduras. Páginas que carregam os links exclusivamente via JavaScript e fontes que exigem login ou disponibilizam apenas streaming ficam fora desse fluxo.

## Versão web no Cloudflare Workers

A página web permite colar a URL do catálogo, buscar vídeos e baixar os resultados pelo navegador. Ela pode iniciar o download quando a busca encontra um único vídeo e a opção correspondente está marcada. Se o navegador pedir confirmação ou bloquear o início automático, use o botão **Baixar**.

1. Deixe `DOMINIOS_PERMITIDOS` vazio em `wrangler.jsonc` para pesquisar em domínios públicos HTTPS. Para restringir a busca e habilitar downloads pelo Worker, informe os domínios exatos do catálogo e dos servidores de vídeo, separados por vírgula, como `catalogo.example.org,videos.example.org`.
2. Com Node.js e npm disponíveis, execute `npx wrangler dev` na raiz para testar.
3. Quando estiver pronto para publicar na sua conta, execute `npx wrangler login` e `npx wrangler deploy`. Abra o endereço que o Wrangler informar.

O Worker serve a interface e processa a busca. A busca lê os links diretos do HTML da página informada, com limite de 100 resultados, e valida os domínios também nos redirecionamentos. No modo aberto, os resultados levam ao site de origem, que decide se o navegador vai baixar ou reproduzir o vídeo. Com uma lista de domínios configurada, o Worker pode transmitir o arquivo como download, inclusive automaticamente para um único resultado. Cada busca consome cota do Worker.

### Varredura de catálogos

Na interface web, informe uma página pública HTTPS e use **Varrer catálogo** para listar as capas seguindo a paginação marcada no HTML. Para consultar os arquivos diretos de uma única página, use **Buscar links**. Clique em uma capa para consultar os links daquele filme ou série. Quando o domínio do arquivo estiver autorizado para download pelo Worker, use **Baixar**. No modo aberto, o botão leva ao arquivo na origem e o navegador pode oferecer a opção de salvá-lo. **Parar varredura** preserva as capas já exibidas.

Quando a página publicar botões MEGA, DAILY, FREEDL ou USERSD no HTML, eles aparecem agrupados pelos títulos das opções de download, como **480P DUBLADO**. Os botões abrem o visualizador do Filmes Diretos na própria aba. Para links do catálogo em `/dl/` e domínios configurados em `DOMINIOS_PERMITIDOS`, o Worker tenta seguir os redirecionamentos e confirmar o arquivo público. Se o provedor bloquear a exibição dentro do visualizador, use **Abrir na mesma aba** para acessar a página oficial.

O catálogo reaproveita por dois minutos as páginas carregadas com sucesso pelo Worker. Em falhas temporárias, como HTTP 503, a última cópia disponível pode ser usada por até 24 horas, com um aviso na interface. Se o Worker estiver indisponível, o navegador usa as páginas daquele catálogo que carregou recentemente. Na primeira visita, a origem precisa responder para exibir as capas. Os links de download são consultados ao abrir o título.

### Torrents

Na versão web, **Buscar links** também aceita um endereço HTTPS de arquivo `.torrent` ou um link magnet. A busca em páginas reconhece essas opções quando estão publicadas no HTML. Use **Baixar .torrent** nos domínios autorizados pelo Worker ou abra o arquivo na origem no modo aberto. **Abrir no cliente BitTorrent** entrega o magnet ao aplicativo instalado no dispositivo. A transferência entre pares é feita pelo cliente BitTorrent.
