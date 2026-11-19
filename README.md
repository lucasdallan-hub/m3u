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

### Varredura do catálogo FilmesMP4

Na interface web, **Varrer catálogo FilmesMP4** lista as capas seguindo a paginação marcada no HTML. Clique em uma capa para abrir uma página do Filmes Diretos que consulta os links daquele filme ou série. Quando houver um arquivo disponível para download pelo Worker, use **Baixar**. No modo aberto, o link leva ao arquivo na origem. **Parar varredura** interrompe a leitura do catálogo e preserva as capas já exibidas.

Quando a página publicar botões MEGA, DAILY, FREEDL ou USERSD no HTML, eles aparecem agrupados pelos títulos das opções de download, como **480P DUBLADO**. Cada botão abre o endereço publicado em uma nova aba.

O catálogo reaproveita por dois minutos as páginas carregadas com sucesso pelo Worker. Se a origem retornar HTTP 503, a última cópia disponível pode ser usada por até 24 horas, com um aviso na interface. Para uma indisponibilidade do próprio Worker, o navegador pode usar as páginas do catálogo carregadas recentemente. Os links de download são consultados ao abrir o título.
