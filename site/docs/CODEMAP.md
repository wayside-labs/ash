# Codemap — ash-web

Mapa de onde cada coisa mora e de como os dados fluem. Atualizado em 2026-10-02 (v0.4.0 + M1 do
ash-studio no PR #1; o blog do site está pronto no código — páginas, busca e workflow — e fora do
ar até ser ligado, ver `docs/DEPLOY.md`).
Regras de trabalho em `CLAUDE.md`; deploy em `docs/DEPLOY.md`; próximos passos em `docs/ROADMAP.md`.

## Rotas

| Rota | Página | O que é |
|---|---|---|
| `/` · `/pt/` | `pages/index.astro` · `pages/pt/index.astro` | Home: topo com o mascote, veja funcionando (cartões e botão de simular), por que agora, dor, pilares 01–03, para quem, objeção, fechamento com o mascote |
| `/pitch/` · `/pt/pitch/` | `pages/pitch.astro` · `pages/pt/pitch.astro` | Pitch aberto: o deck de 11 telas de `public/pitch-deck/{en,pt}.html` numa moldura de tela cheia, no idioma da página; `#2-pt` e `#2-en` escolhem o deck (`noindex`, fora do sitemap) |
| `/pitch-deck/flow/pt/` · `/pitch-deck/flow/en/` | `pages/pitch-deck/flow/[lang].astro` | A tela de fluxo do `Deck.astro` sozinha, sem controles: é o que a tela 6 do deck emoldura (`noindex`, fora do sitemap) |
| `/investor/` · `/pt/investidor/` | `pages/investor.astro` · `pages/pt/investidor.astro` | Funil: popup → boas-vindas → **as 18 telas do `Deck.astro`** → fechamento (`noindex`) |
| `/privacy/` · `/pt/privacidade/` | `pages/privacy.astro` · `pages/pt/privacidade.astro` | Política, inclusive do formulário |
| qualquer endereço inexistente | `pages/404.astro` | Uma página para os dois idiomas (`noindex`, fora do sitemap); a Cloudflare Pages serve o `404.html` |
| `POST /api/lead` | `functions/api/lead.ts` | Grava o lead (desligado até existir `TURNSTILE_SECRET`) |
| `POST /api/interest` | `functions/api/interest.ts` | Marca "quero conversar" pelo `ref` do lead |

**Blog** — só existe com `BLOG_SOURCE` definido (`fixture` ou `api`); com ele vazio nenhuma destas
rotas é construída. Os arquivos ficam em `pages/blog/` (EN) e `pages/pt/blog/` (PT) e só escolhem
o idioma; a marcação está em `components/blog/pages/`.

| Rota (EN · PT) | Arquivo | O que é |
|---|---|---|
| `/blog/` · `/pt/blog/` | `[...page].astro` | Índice: busca, destaque no topo, 12 por página |
| `/blog/page/2/` · `/pt/blog/pagina/2/` | `[...page].astro` | Paginação (`noindex`, fora do sitemap) |
| `/blog/<slug>/` · `/pt/blog/<slug>/` | `[slug].astro` | Post |
| `/blog/category/<slug>/` · `/pt/blog/categoria/<slug>/` | `category/[slug].astro` · `categoria/[slug].astro` | Posts da categoria |
| `/blog/tag/<slug>/` · `/pt/blog/tag/<slug>/` | `tag/[tag].astro` | Posts da tag (`noindex`, fora do sitemap) |
| `/blog/author/<slug>/` · `/pt/blog/autor/<slug>/` | `author/[slug].astro` · `autor/[slug].astro` | Autor e seus posts |
| `/blog/rss.xml` · `/pt/blog/rss.xml` | `[feed].xml.ts` | Feed RSS do idioma (não existe em idioma sem posts) |
| `/blog-media/…` | — (escrito pela integração) | Imagens do studio copiadas no build + JPEG da capa para `og:image` |
| `/pagefind/…` | — (escrito pela integração) | Índice da busca, um por idioma, só dos posts |

## Pastas

```
src/
├── content/        TODO o texto do site e do pitch (fonte da verdade da copy)
│   ├── copy.en.ts · copy.pt.ts · copy.ts        site (getCopy, caminhos, tipo Copy)
│   └── pitch.en.ts · pitch.pt.ts · pitch.ts     pitch, popup, boas-vindas, fechamento, cartões
├── components/     seções da home (Hero, Momentum, Pain, Showcase, Pay, Roles, Proof, Audiences,
│   │               Objection, Closing, Header, Footer, Section, Button)
│   ├── showcase/   FlowMap (mapa do dinheiro, painel v1) · AgentCards (cartões, painel v2)
│   ├── pitch/      Deck (desenha as 18 telas do funil e a tela de fluxo) · DeckFrame (moldura do deck de 11 telas no /pitch)
│   │               Top · Gate (popup) · Welcome · Outro · Investor (orquestra o funil)
│   └── blog/       PostCard · Cover (capa enviada ou desenhada com os tokens) · PostMeta · PostBody
│       │           (corpo e tipografia) · PostToc · TagList · RelatedPosts · Pagination · ShareLinks
│       │           · AuthorCard · CtaCard · SearchBox
│       ├── pages/        ListPage (índice, categoria, tag, autor) · PostPage — as duas páginas inteiras
│       └── shortcodes/   Shortcode (escolhe) · PitchCta · ContactCta · MapBlock
├── integrations/   o que o blog pede ao build: blog.ts (ganchos: o que fica fora do sitemap, e
│                   depois das páginas imagens → og:image → busca) · blog-media.ts · blog-search.ts
├── lib/            lógica pura e testada — nada aqui toca DOM, exceto ceiling-scene, motion e blog-search-ui
│   ├── flow-model.ts       simulação do mapa (paused antes de limite; negado não move nada)
│   ├── deck-model.ts       navegação do deck (limites, hash 1-based, linha do tempo do autoplay)
│   ├── lead-schema.ts      validação do lead (navegador e função usam a mesma)
│   ├── lead-handler.ts     Turnstile → upsert no D1 → Listmonk → reenvio de pendentes
│   ├── interest-handler.ts "quero conversar" → interested_at + interest_channel
│   ├── contact.ts          links de agenda/WhatsApp/e-mail; recusa vazio e exemplo
│   ├── visitor.ts          localStorage `ash.visitor` = { name, kind, ref? } — nunca o e-mail
│   ├── ceiling-model.ts · ceiling-scene.ts   cena do teto (só na boas-vindas do /investidor)
│   ├── motion.ts           Lenis + GSAP (desligado nas páginas do pitch)
│   └── blog-*.ts           o blog (M1c):
│       ├── blog-types · blog-validate   contrato do payload do studio; campo errado derruba o build;
│       │                                texto opcional vazio vira null
│       ├── blog-source     BLOG_SOURCE = api | fixture | off (padrão); uma carga por processo
│       ├── blog-model · blog-tags       por idioma, paginação (12), destaque, relacionados; tags:
│       │                                slug, grafias que colidem viram uma tag só, nunca derrubam o build
│       ├── blog-paths      URLs por idioma; alternate só quando o par existe
│       ├── blog-views      o que cada página recebe (rotas, alternates, noindex, feed) e o que derruba o build
│       ├── blog-pages      liga as páginas ao ambiente: getStaticPaths, link "Blog", feed, avisos `[blog]`
│       ├── blog-html       lê o corpo com um parser (parse5) e só aceita as tags e atributos do
│       │                   sanitizador do studio (lista copiada; um teste confere contra o studio)
│       ├── blog-body       sobre a árvore do blog-html: corta nos blocos especiais; /media/ →
│       │                   /blog-media/ em imagens e links; imagens do corpo em lazy; escreve de volta
│       ├── blog-media      lista e baixa as imagens no build (fetch injetável)
│       ├── blog-og · blog-cover · blog-share · blog-text   og:image da capa; capa desenhada; links de
│       │                   compartilhar; texto do corpo para a descrição
│       ├── blog-search-ui  a caixa de busca no navegador (carrega o Pagefind no primeiro uso)
│       └── blog-jsonld · blog-rss       BlogPosting/Breadcrumb com escape seguro; feed por idioma
├── layouts/Base.astro      head, fontes, hreflang/altPath (null = nenhum), noindex, og de artigo,
│                           slot "head", link de pular para o conteúdo, motion
└── styles/                 tokens.css (identidade própria desde o design v2; regras em docs/design-system.md) · base.css
src/assets/mascot/  o mascote em AVIF/WebP, gerado por scripts/mascot.mjs; usado por components/Mascot.astro
functions/api/      adaptadores finos da Cloudflare Pages Functions → lib/*-handler.ts
migrations/         D1 `ash-leads`: 0001_leads.sql · 0002_interest.sql
scripts/            serve-dist.mjs (servidor dos testes) · og.mjs (gera public/og.png a partir do título do topo; rodar depois de mudar o título) · mascot.mjs · check-deploy.mjs
tests/unit/         vitest: paridade EN/PT (site e pitch), modelos, handlers, contato, visitante, blog-*
tests/fixtures/     blog-payload.json (17 posts de exemplo sobre o próprio blog, dois com texto hostil) · blog-media/ (WebP)
tests/e2e/          playwright sobre o dist/: smoke do site (links, âncoras e hreflang existem), deck,
                    funil; blog*.spec.ts pedem o build com BLOG_SOURCE=fixture (páginas, listas, SEO,
                    segurança, busca); blog-modes.spec.ts faz os próprios builds (blog desligado,
                    um idioma só, bloco de contato)
.claude/skills/     writing-ash-marketing-copy (regras de tom e enquadramento)
docs/               DEPLOY · design-system · CODEMAP · ROADMAP · plans/ · sessions/ · legacy-vps-placeholder/
```

## Fluxos

**Dois pitches, desde 2026-10-05.** O `/pitch` é o deck de 11 telas: um arquivo pronto por idioma
em `public/pitch-deck/{en,pt}.html`, que `components/pitch/DeckFrame.astro` emoldura. Mudar esse
pitch = trocar os dois arquivos. A moldura faz três coisas que o arquivo sozinho não faz: escolhe
o deck pelo idioma da página (ou por `#2-pt` / `#2-en`), manda ao deck o sinal de "apresentando"
para ele esconder a trilha de miniaturas, e repassa as setas do teclado para funcionarem sem
clique. A tela 6 do deck emoldura `/pitch-deck/flow/{pt,en}/`, que desenha a tela de fluxo do
`Deck.astro`; é o único ponto em que os dois pitches se tocam.

O `/investor` continua com as 18 telas: `content/pitch.{en,pt}.ts` → `components/pitch/Deck.astro`.
Mudar esse pitch = mudar só o conteúdo. **As duas rotas não mostram mais as mesmas telas**; o e2e
confere cada uma por si (`pitch deck › …` e `investor funnel › carries the site's eighteen slides`).

**Funil do investidor.**
```
Gate (popup) ──validateLead──► POST /api/lead ──► handleLead
   │                                   ├─ sem TURNSTILE_SECRET → 503 → visitante segue sem gravar
   │                                   ├─ Turnstile ok → upsert leads (RETURNING id = ref)
   │                                   └─ Listmonk configurado → double opt-in; falha → pending
   ▼
saveVisitor({name, kind, ref}) → Welcome ("Olá, <nome>", cena "cofre de <nome>")
   ▼
Deck (18 telas) ──passar da última──► evento `deck:end` ──► Outro
   └─ "Sim" → canais reais (contact.ts) → clique → POST /api/interest {ref, channel}
```

**Mapa do dinheiro.** `lib/flow-model.ts` (estado + `step(rand)`) → `showcase/FlowMap.astro`
(geometria fixa 1000×560, pulsos por `requestAnimationFrame`, só roda quando visível via
IntersectionObserver). Usado no topo do site (`variant="hero"`) e na tela 5 do pitch.

## Dados

Tabela `leads` (D1 `ash-leads`, ENAM): `id` (UUID), `created_at` / `updated_at` / `consent_at`
(ISO 8601 UTC), `name`, `role`, `kind` (`investor|founder|other`), `email` (único, minúsculo),
`lang` (`en|pt`), `listmonk_status` (`pending|sent`), `interested_at`, `interest_channel`
(`booking|whatsapp|email`). Sem IP, sem user-agent. Análise de privacidade:
`agenttokenfy/.aios/research/2026-09-30-privacy-investidor.md`.

## Configuração

Build (públicas, entram no HTML): `PUBLIC_BOOKING_URL`, `PUBLIC_CONTACT_EMAIL`, `PUBLIC_WHATSAPP`,
`PUBLIC_TURNSTILE_SITEKEY`. Secrets da Pages (nunca no repo): `TURNSTILE_SECRET` (liga a coleta),
`LISTMONK_URL/USER/TOKEN/LIST_ID`, `CF_ACCESS_CLIENT_ID/SECRET`. Binding `DB` no `wrangler.toml`.

## studio/ (ash-studio: M0 e M1 no ar desde 02/10; o código está no PR #1, fora do `main`)

A imagem Docker leva só o que roda: `studio/.dockerignore` deixa de fora `tests/`, os
`*.test.ts(x)` que moram ao lado do código, `deploy/` e os arquivos de ambiente.

Pacote independente (Next 16 + Postgres + worker); `studio/README.md` tem o como-fazer, as regras
do código e os limites conhecidos.

```
studio/
├── src/proxy.ts          classifica host/rota (admin, public, internal, deny) antes de tudo
├── src/lib/              env (zod, lazy), hosts (PUBLIC_ROUTES), access (JWT do Cloudflare Access),
│                         admin-token, admin (requireAdmin), same-origin (refuseCrossSite), health,
│                         audit, expect-rows
├── src/db/               schema (audit_log, jobs, worker_heartbeat, blog_posts, blog_categories,
│                         blog_authors), client (lazy), migrate
├── src/jobs/queue.ts     fila: enqueue (dedupe parcial), claimNext (SKIP LOCKED), fencing, reap,
│                         absorbDue
├── src/worker/           cycle (laço, batimento, ticks), run-job, handlers (site-rebuild),
│                         main (ticks: publish-due, rebuild-retry)
├── src/blog/             o motor (M1a) e o painel (M1b)
│   ├── lib/              puro e seguro para o navegador: sanitize, href, toc, shortcodes,
│   │                     shortcode-html, body-content, entities, post-slug, reading-time,
│   │                     image-rules, local-time, post-status, list-query, format-date
│   ├── schemas.ts        zod: upsert (documento inteiro), update (com if_updated_at), estados
│   ├── posts · status · categories · authors   núcleos: recebem db; versão do post em toda escrita
│   ├── upload · media    imagem → WebP em UPLOADS_DIR/{posts,autores}/<id>/; leitura segura
│   ├── public            payload público, impressão digital, memo
│   ├── publish-due · rebuild · updated-at      agenda no worker; job de rebuild; regra do updated_at
│   ├── actions/          "use server": requireAdmin + db + núcleo; devolvem {ok,data}|{ok,error}
│   └── components/       listas, diálogos, taxonomia, post-settings, editor/ (TipTap 3)
├── src/ui/               primitivos: Button, Field, Dialog, ConfirmDialog, Tabs, Notice, Nav, useAction
├── src/app/              /, /blog, /blog/novo, /blog/[id], /blog/[id]/previa, /blog/categorias,
│                         /blog/autores, /api/admin/upload, /api/public/posts, /media/[...path],
│                         /api/health
├── tests/                banco (helpers/db.ts recusa bancos que não terminam em _test), componentes
│                         (jsdom), páginas, e estruturais: app-guards, blog-actions, client-bundle,
│                         worker-bundle, site-fixture-contract
├── drizzle/              migrações geradas, versionadas (0002 = tabelas do blog)
└── deploy/               compose, deploy.sh, testdb.sh, backup/, cloudflare.md
```

Hostnames: `studio.ash.app.br` (atrás do Access) e `pub.ash.app.br` (só rotas públicas:
`/api/public/*`, `/media/*`, e as da newsletter no M3).

**Do studio ao site (M1c).**
```
publicar no studio → job site-rebuild → repository_dispatch (studio-publish) no GitHub
   → site-deploy.yml (um por vez) → pnpm build com BLOG_SOURCE=api e BLOG_API_URL
        ├─ loadBlog: GET pub.ash.app.br/api/public/posts → validatePayload (não-200 ou formato errado derruba)
        ├─ páginas: getStaticPaths de lib/blog-pages.ts → ListPage / PostPage
        └─ integração (depois das páginas): imagens → dist/blog-media/ · capas em JPEG · Pagefind → dist/pagefind/
   → wrangler pages deploy
```
O lado do site está completo no código; nada disso rodou em produção. Faltam o merge na `main`, a
variável `BLOG_API_URL` e os tokens (`docs/DEPLOY.md`, "Ligar o blog"). Sem `BLOG_API_URL` o
build sai no modo `off`, igual ao site de antes do blog.
