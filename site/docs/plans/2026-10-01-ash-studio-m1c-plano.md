# ash-studio M1c — o blog no site: plano

> **Para agentes:** SUB-SKILL: superpowers:subagent-driven-development. Aqui quase nada é porte:
> as páginas do boringco são Next com dados por pedido, e o site é Astro estático. Traz-se a
> **lógica** (relacionados, capa, JSON-LD, RSS) e reescreve-se a apresentação. TDD na lógica pura;
> e2e nas páginas; commits por tarefa.

**Objetivo:** o que está publicado no studio aparece em `ash.app.br/blog` e `/pt/blog`, estático,
com post, categoria, tag, autor, RSS, sitemap, dados estruturados e busca — e o site se reconstrói
sozinho quando o studio publica.

**Onde:** raiz deste repositório (`A` = o site Astro). O studio (`S` = `studio/`) só ganha um
teste de contrato. **Fonte da lógica** (somente leitura): `B` = `F:\AceleradoraECO\boringco\boringco`.
**Base:** M1a e M1b (planos de 01/10, com as seções "Desvios na implementação").
**Regras do site:** `CLAUDE.md` da raiz, `docs/design-system.md`, `docs/CODEMAP.md`,
`.claude/skills/writing-ash-marketing-copy`.

## O contrato que o site consome (do M1a)

`GET <pub>/api/public/posts` → `{ posts, categories, authors }`, os dois idiomas juntos, sem
paginação. Só `html` é HTML (já sanitizado, com `id` em h2/h3 e marcadores `{{nome}}` de
shortcode em nível de bloco); **todo o resto é texto puro e tem de ser escapado**, inclusive
`toc[].text`. `coverUrl` e `avatarUrl` são caminhos `/media/…`. `translationSlug` só existe se a
tradução também está publicada. `publishedAt` é a primeira publicação. 503 = estúdio fora do ar.

## Decisões travadas

1. **Três modos de fonte**, por `BLOG_SOURCE`:
   - `api` — busca `BLOG_API_URL` com `cache: "no-store"`; qualquer resposta que não seja 200 com
     o formato certo **derruba o build** (nunca publicar um blog vazio por engano).
   - `fixture` — lê `tests/fixtures/blog-payload.json`; é o que PR, teste e e2e usam.
   - `off` (padrão quando a variável falta) — nenhuma página de blog é gerada e o link "Blog" não
     aparece. É o que mantém o site de hoje funcionando até o estúdio estar no ar com o M1a.
2. **O formato é validado no build** por um validador escrito à mão (o site não tem zod): campo
   faltando, tipo errado, `coverUrl` fora de `/media/`, idioma desconhecido → erro com o caminho
   do campo. Um teste no studio confere que a fixture do site tem exatamente as chaves do
   `PublicPayload` real — se o contrato mudar de um lado, o outro quebra.
3. **Blog 100% estático, sem pedido a terceiros.** As imagens (`/media/…` no corpo, capa, avatar)
   são baixadas no build para `dist/blog-media/…` e os caminhos reescritos; o site no ar não
   consulta `pub.` Falha ao baixar uma imagem referenciada derruba o build no modo `api`.
4. **Rotas.** EN: `/blog/`, `/blog/page/[n]/`, `/blog/[slug]/`, `/blog/category/[slug]/`,
   `/blog/tag/[tag]/`, `/blog/author/[slug]/`, `/blog/rss.xml`. PT: `/pt/blog/`,
   `/pt/blog/pagina/[n]/`, `/pt/blog/[slug]/`, `/pt/blog/categoria/[slug]/`, `/pt/blog/tag/[tag]/`,
   `/pt/blog/autor/[slug]/`, `/pt/blog/rss.xml`. Nomes reservados (`page`, `category`, `tag`,
   `author`, `rss.xml`, e os equivalentes em pt) não podem colidir com slug de post: o build falha
   dizendo qual post.
5. **Idioma e alternates.** Cada página lista só o seu idioma. `hreflang` do post aponta para a
   tradução **só se `translationSlug` existir**; sem tradução, nenhum alternate (hoje o `Base.astro`
   sempre emite um — anunciaria um 404). Índice, categoria e autor alternam entre si quando o par
   existe nos dois idiomas. O seletor de idioma do cabeçalho segue a mesma regra e, sem par, leva
   ao índice do blog no outro idioma.
6. **Listas:** 12 por página, mais recentes primeiro; "em destaque" (`featured`) no topo do índice;
   relacionados por sobreposição de tags, depois categoria, só do mesmo idioma. Tag vira segmento
   de URL por um slug próprio. **Tag nunca derruba o build** (revisto em 02/10): duas grafias que
   dão o mesmo slug viram uma tag só (a página leva a primeira grafia na ordem do payload e lista
   os posts das duas, com um aviso no log do build nomeando-as), e uma tag sem letra latina nem
   dígito ganha um slug estável (`t-` + oito dígitos hexadecimais de um hash dos seus caracteres).
7. **Shortcodes** (o `html` é cortado nos marcadores e cada pedaço entra por `set:html`):
   `cta:pitch` → cartão para `/pitch` (ou `/pt/pitch`); `cta:contato` → canais de `lib/contact.ts`
   (sem canal configurado não desenha nada e o log do build avisa, com o nome do post);
   `mapa` → `showcase/FlowMap.astro`; `cta:newsletter` → **nada** até o M3, com uma nota no log do
   build (revisto em 02/10: dois cartões de contato iguais em sequência é pior que nenhum).
   Marcador desconhecido derruba o build.
8. **SEO:** `og:type=article`, `article:published_time`/`modified_time`, canonical, JSON-LD
   `BlogPosting` + `BreadcrumbList` (serializado escapando `<` como `\u003c`), `<link rel="alternate"
   type="application/rss+xml">`. `og:image`: a capa convertida no build para JPEG 1200×630 se isso
   sair com o que o Astro já traz; senão o `og.png` do site — dizer qual ficou. Páginas de tag e
   as paginadas (`/page/2…`) ficam fora do sitemap e com `noindex,follow`.
9. **Busca:** Pagefind, gerado depois do build, só sobre as páginas de post, interface com os
   tokens do site, carregada sob demanda (sem custo para quem não busca).
10. **Privacidade:** nenhum cookie, nenhum script de terceiro, botões de compartilhar são links
    comuns (mais "copiar link"). A política de privacidade não muda.
11. **Rebuild sozinho:** `deploy.yml` passa a aceitar `repository_dispatch` (`studio-publish`) e
    `workflow_dispatch`, com `concurrency` (um por vez, o mais novo fica na fila). Em `push` para
    `main` e nos dispatches: `BLOG_SOURCE=api`. Em `pull_request`: `fixture`.
12. **Texto de interface** em `content/copy.{en,pt}.ts` sob a chave `blog`, seguindo a skill de
    copy e passando no `tests/unit/copy.test.ts` (paridade EN/PT, sem preço).

## Mapa de arquivos

| Destino | Fonte | O que é |
|---|---|---|
| `src/lib/blog-types.ts` | `S/src/blog/public.ts` (tipos) | tipos do payload, copiados com o comentário do contrato |
| `src/lib/blog-validate.ts` (+teste) | — | decisão 2 |
| `src/lib/blog-source.ts` (+teste) | — | decisão 1; `fetch` injetável |
| `src/lib/blog-model.ts` (+teste) | `B` `listRelatedPosts`, `sidebar-data.ts`, `pagination.tsx`, `cover.ts`, `format-post-date.ts` | por idioma, paginação, tags e slugs, destaques, relacionados, colisões (4, 6), datas por idioma com fuso explícito |
| `src/lib/blog-paths.ts` (+teste) | — | todas as URLs do blog por idioma (4, 5) |
| `src/lib/blog-body.ts` (+teste) | `B` `post-body.tsx` (ordem) | corta o `html` nos marcadores; reescreve `/media/` → `/blog-media/` |
| `src/lib/blog-media.ts` (+teste) | — | decisão 3; lista de imagens, download com `fetch` injetável |
| `src/lib/blog-jsonld.ts` (+teste) | `B/src/features/landing/lib/json-ld.ts` | `BlogPosting`, `BreadcrumbList`, serialização segura |
| `src/lib/blog-rss.ts` (+teste) | `B/.../blog/feed.xml/route.ts` | XML do feed por idioma; escapa também `'` |
| `tests/fixtures/blog-payload.json` | — | posts nos dois idiomas, com e sem tradução, capa, tags, destaque, cada shortcode, texto hostil nos campos de texto puro |
| `S/tests/site-fixture-contract.test.ts` | — | decisão 2 |
| `src/content/copy.{en,pt}.ts`, `copy.ts` | — | chave `blog`; `blogPath` |
| `src/layouts/Base.astro` | — | `ogType`, `ogImage`, artigo, slot de `<head>`, alternate opcional |
| `src/components/Header.astro`, `Footer.astro` | — | link "Blog" (só com a fonte ligada); âncoras da home com prefixo; `langHref` |
| `src/components/blog/*.astro` | `B/.../components/*` (reescritos) | `PostCard`, `PostBody`, `PostToc`, `PostMeta`, `ShareLinks`, `CtaCard`, `Cover`, `Pagination`, `TagList`, `RelatedPosts`, `SearchBox`, `shortcodes/*` |
| `src/pages/blog/**`, `src/pages/pt/blog/**` | as seis páginas de `B` | decisão 4; `getStaticPaths` |
| `astro.config.mjs` | — | filtro do sitemap (8); integração que baixa as imagens e roda o Pagefind |
| `.github/workflows/deploy.yml` | — | decisão 11 |
| `tests/e2e/blog.spec.ts` | — | índice, post, tradução, sem tradução, tag, RSS, JSON-LD, sem pedido externo, sem overflow em 375/768/1440, campo de texto hostil não vira HTML |
| `docs/CODEMAP.md`, `ROADMAP.md`, `DEPLOY.md`, `CHANGELOG.md` | — | o que mudou e como ligar |

## Lotes

- **Lote 1 — dados e lógica:** tipos, validador, fonte, modelo, caminhos, corpo, mídia, JSON-LD,
  RSS, fixture e o teste de contrato no studio. Nenhuma página.
- **Lote 2 — páginas:** copy, `Base`/`Header`/`Footer`, componentes, páginas EN e PT, shortcodes,
  integração de mídia, e2e.
- **Lote 3 — busca, workflow e documentação:** Pagefind, `deploy.yml`, docs.

## O que este plano não liga (depende do Lucas)

O blog só aparece em `ash.app.br` quando: (a) o studio estiver no ar com o M1a/M1b (deploy na
VPS); (b) este branch for mergeado na `main` (combinado: só no fim de M0–M3 — ou antes, se ele
decidir); (c) existir nos secrets do GitHub um token da Cloudflare restrito ao Pages (o deploy
automático hoje está desligado); (d) a VPS tiver o `GITHUB_DISPATCH_TOKEN`. Até lá, tudo roda em
`fixture` no CI e o site de produção segue em `off`.

## Minas conhecidas

- `repository_dispatch` só dispara o workflow que está na **branch padrão**.
- Com `api`, todo deploy do site passa a depender de `pub.` estar no ar — de propósito (melhor
  falhar que publicar blog vazio); o site já publicado não é afetado.
- Não adicionar regra de cache da Cloudflare em `/api/public/`.
- `cta:pitch` aponta um blog indexado para `/pitch`, que é `noindex` de propósito: é link, não
  página a ser encontrada — sem mudança.
- O `Base.astro` e o `Header.astro` servem todas as páginas: as mudanças não podem alterar o que
  home, pitch, investidor e privacidade emitem hoje (os e2e existentes continuam verdes).
- Escapes com barra invertida: escrever com Write/Edit e conferir com `od -c`.

## Desvios na implementação (lotes 1 a 3, até 02/10)

O que ficou diferente do plano acima, e por quê.

**Rotas e arquivos**
- **Índice e feed são rotas com parâmetro**, não `index.astro` e `rss.xml.ts`: uma página sem
  parâmetro é sempre construída, e no modo `off` nada do blog pode existir. O índice e a paginação
  são `[...page].astro` (parâmetro vazio, `page/2`, `pagina/2`); o feed é `[feed].xml.ts`, com o
  único valor `rss`. As URLs são as da decisão 4.
- **Os arquivos de rota só escolhem o idioma.** A marcação está em `components/blog/pages/`
  (`ListPage`, `PostPage`) e o que cada página recebe é montado em `lib/blog-views.ts`.
- **A integração virou três arquivos** em `src/integrations/`: `blog.ts` (os ganchos),
  `blog-media.ts` (imagens e og:image) e `blog-search.ts` (Pagefind).
- **Componente a mais:** `AuthorCard`. **Módulos a mais:** `blog-views`, `blog-pages`, `blog-og`,
  `blog-cover`, `blog-share`, `blog-text`, `blog-search-ui`, `blog-tags` (separado do modelo).

**Idiomas (decisão 5)**
- **Idioma sem nenhum post:** o índice dele existe (o seletor de idioma precisa de um destino),
  mas é `noindex`, fica fora do sitemap, não declara alternate e o índice do idioma que tem posts
  também não declara. Sem posts não há `rss.xml` nem `<link>` de feed, e o link "Blog" some do
  cabeçalho e do rodapé naquele idioma.
- **`altPath={null}` tira também o `x-default`**; nas páginas do blog que têm par, o `x-default`
  aponta para a página em inglês (prop `xDefaultPath`).
- Listas de categoria, tag e autor **não paginam** (o plano só dá rota de paginação ao índice).

**Tags e blocos (decisões 6 e 7)** — texto das decisões já atualizado acima.

**Corpo do post**
- **O corpo é lido por um parser de HTML de verdade** (`parse5` 8.0.1, devDependency fixada — o
  algoritmo do padrão, o mesmo dos navegadores) e conferido nó a nó contra uma **lista do que é
  permitido**, em `lib/blog-html.ts`: só as tags do `ALLOWED_TAGS` do studio, só os atributos que
  o sanitizador dele deixa (`id` só em `h2`/`h3`/`h4`; `href` e `title` em `a`; `src`, `alt`,
  `width`, `height` em `img`; `align` em `th`/`td`), `href` pela regra do `href.ts` do studio,
  `img src` só `/media/…`, nenhum comentário, nenhum elemento de outro tipo (SVG, MathML). Qualquer
  coisa fora disso **derruba o build com o nome do post**; nada é consertado. A primeira versão
  conferia por expressão regular com uma lista do que era proibido, e dava para passar por ela
  (um `>` dentro de um atributo, `<style>`, `<svg>`, `javascript:` no `href`).
- A lista é uma cópia da do studio, e `tests/unit/blog-html.test.ts` lê `studio/src/blog/lib/
  sanitize.ts` e `href.ts` como texto e falha se as duas divergirem (tags, atributos por tag e o
  padrão do `href`). O site não importa código do studio.
- **O que a página recebe é a árvore escrita de volta**, não o texto do studio: imagens e links
  para `/media/` reescritos para `/blog-media/` na árvore, `loading="lazy"` e `decoding="async"`
  nas imagens do corpo (a capa continua carregando na hora), e o corte nos blocos especiais feito
  só em texto no nível de cima. Uma tag aberta e não fechada no fim do corpo some em vez de
  engolir a marcação da página. O build ainda confere que o texto escrito, lido de novo, dá a
  mesma árvore.
- As imagens a baixar saem da mesma árvore (uma imagem com `<` no `alt` é achada; antes não era).
- Cada `toc[].id` tem de ser o `id` de um título na árvore do post, senão o build para com o slug.
- Textos opcionais vazios (`""` ou só espaços) viram `null` no validador: resumo, alt da capa,
  meta título e meta descrição. Post sem resumo usa as primeiras ~155 letras do corpo como
  descrição.

**Capa e og:image (decisão 8)**
- Post sem capa ganha uma **capa desenhada** só com os tokens do site (três barras de orçamento,
  variando pelo slug), nas listas. Na página do post, sem capa não há figura.
- `og:image` é a capa em JPEG 1200×630 ao lado do WebP (`…webp.og.jpg`), feita com o `sharp`.
  O `sharp` é **devDependency fixada** na versão que o Astro resolve (0.35.5), não buscada dentro
  do `node_modules` do Astro. Sem capa, `og.png` — inclusive no `image` do JSON-LD.

**Busca (decisão 9)**
- Um índice do Pagefind por idioma (ele separa pelo `<html lang>`), só das páginas de post
  (`data-pagefind-body` no artigo; sumário, tags, compartilhar, autor e blocos ficam fora).
- A interface pronta do Pagefind (script e folha de estilo) **não é publicada**: a caixa de busca
  é do site (`SearchBox.astro` + `lib/blog-search-ui.ts`). Nada é pedido antes do primeiro toque
  no campo. Só existe na primeira página dos dois índices.
- Se o carregamento falhar, a próxima tecla tenta de novo (com outro endereço, porque o navegador
  guarda a falha de um módulo). A linha de estado anuncia quantos resultados há.

**Workflow (decisão 11)**
- O modo é derivado: `fixture` em pull request; nos outros eventos, `api` se a variável
  `BLOG_API_URL` existir e `off` se não existir (senão todo push na `main` falharia até ela ser
  criada). O deploy roda em `push`, `repository_dispatch` e `workflow_dispatch`, só a partir da
  `main`.
- Pull request tem um grupo de `concurrency` próprio (e cancela a execução anterior do mesmo PR);
  o grupo de deploy é um só, sem cancelar o que está em andamento. Execução manual fora da `main`
  também tem grupo próprio: não publica, e no grupo de deploy tiraria da fila um pedido do studio.
- `pnpm run deploy` recusa rodar com `BLOG_SOURCE=fixture` (`scripts/check-deploy.mjs`).

**Fora do plano, feito por causa dele**
- Link para pular ao conteúdo no `Base.astro` e `id="main"` em todas as páginas; `aria-label` do
  menu traduzido; a privacidade passou a declarar o par certo no `hreflang` e a apontar as âncoras
  para a home; **todo** botão de agenda e o e-mail impresso (cabeçalho, topo, "para quem",
  fechamento) passam pelo filtro de `lib/contact.ts`: valor vazio ou de exemplo não chega a
  nenhuma página.
- Estilo de impressão para o post.
- `BLOG_FIXTURE_PATH`: outro arquivo de payload no modo `fixture`, para o teste do blog de um
  idioma só.
- A fixture foi reescrita como conteúdo neutro sobre o próprio blog (não repete afirmações do
  produto); a estrutura é a mesma.

**Conhecido e deixado assim**
- No modo `off` o build ainda emite dois CSS que nenhuma página usa (`_astro/PostCard.*.css` e
  `PostPage.*.css`): efeito do empacotador, inofensivo.
- O e2e não roda no CI (nunca rodou); o blog é conferido no CI pelos testes unitários e pelo
  build em `fixture` nos pull requests.
