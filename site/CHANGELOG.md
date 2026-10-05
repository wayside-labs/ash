# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Datas em AAAA-MM-DD.

## [Não publicado]

### Adicionado
- **ash-studio M0** (`studio/`): painel de admin em Next 16 com Postgres próprio, fila de jobs
  durável (SKIP LOCKED, backoff, lease, fencing), worker com batimento, `/api/health`, auditoria,
  validação de ambiente, JWT do Cloudflare Access com lista de admins, backup com prova de
  restauração e CI. No ar em `studio.ash.app.br`, atrás do Access.
- **ash-studio M1a — motor do blog** (**no ar desde 2026-10-02**, versão `08d9d7a`): tabelas de posts, categorias e
  autores com tradução vinculada PT/EN; máquina de estados (rascunho → revisão → aprovado →
  publicado, mais rejeitado) com auditoria na mesma transação; sanitizador e sumário (com teto de
  300 mil caracteres por corpo, imagem só de `/media/`, link só para destino visível); upload de
  imagem (WebP, sem metadados) e rota `/media`; API pública `GET /api/public/posts` com cache por
  impressão digital, ETag e 304; publicação agendada no ciclo do worker; job de rebuild do site
  (dez tentativas, junta rajadas, recoloca na fila o que se perdeu; desligado sem
  `GITHUB_DISPATCH_TOKEN`); `/api/health` vermelho com job morto ou erro no ciclo, e
  `?probe=live` para o compose e o deploy.
- **ash-studio M1b — painel do blog** (**no ar desde 2026-10-02**, ainda sem a conferência do
  Lucas no navegador): navegação, início com contagens,
  lista de posts com as abas Posts, Revisão e Agendados, novo post e tradução, categorias e
  autores (com foto), editor visual (TipTap 3) com blocos especiais, diálogos de link e de imagem,
  painel lateral (categoria, autor, tags, capa, destaque, SEO), salvar explícito com aviso de
  alterações não salvas, prévia. Toda gravação e toda mudança de estado conferem a versão do post
  (`if_updated_at`); ação "desagendar"; auditoria de escrita; upload exige post ou autor existente.
- **M1c, lote 1 — dados e lógica do blog no site** (`src/lib/blog-*.ts`): tipos e validador do
  payload do studio, fonte em três modos (`BLOG_SOURCE=api|fixture|off`), paginação, tags,
  relacionados, caminhos por idioma e alternates, corte do corpo nos blocos especiais, download de
  mídia, JSON-LD, RSS, e a fixture `tests/fixtures/blog-payload.json`. **Nenhuma página ainda.**
  Um teste no studio (`studio/tests/site-fixture-contract.test.ts`) quebra se o contrato divergir.
- **M1c, lote 2 — as páginas do blog** (`/blog/` e `/pt/blog/`, **fora do ar**: só existem com
  `BLOG_SOURCE` definido): índice com destaque e paginação de 12, post (capa, sumário, tags,
  compartilhar por links comuns, autor, relacionados, estilo de impressão), categoria, tag, autor
  e feed RSS por idioma; `hreflang` só quando a tradução existe; JSON-LD `BlogPosting` e
  `BreadcrumbList`; `og:image` da capa em JPEG 1200×630; imagens copiadas para `dist/blog-media/`
  no build (o site no ar não consulta o studio); capa desenhada com os tokens quando o post não
  tem imagem; blocos especiais (`mapa`, `cta:pitch`, `cta:contato`; `cta:newsletter` não desenha
  nada até o M3). Tags e páginas 2+ ficam `noindex` e fora do sitemap. Um idioma sem posts tem só
  um índice vazio, `noindex`, sem feed e sem link no menu.
- **M1c, lote 3 — busca e workflow:** busca nos posts com o Pagefind 1.5.2, um índice por idioma,
  só das páginas de post, com caixa de busca própria (`SearchBox.astro`) nos dois índices; nada é
  carregado antes de alguém usar o campo, e a interface pronta do Pagefind não é publicada.
  `deploy.yml` passa a aceitar `repository_dispatch` (`studio-publish`) e `workflow_dispatch`, com
  um deploy por vez; a fonte do blog é `fixture` em pull request e, nos outros eventos, `api`
  quando a variável `BLOG_API_URL` existe e `off` quando não existe.
- Link "pular para o conteúdo" em todas as páginas (`Base.astro`) e `id="main"` no `<main>`.
- `sharp` (0.35.5, a versão que o Astro resolve), `pagefind` e `parse5` (8.0.1) como devDependencies.
- **Corpo do post conferido por parser, com lista do que é permitido** (`lib/blog-html.ts`): o
  build lê o `html` de cada post com o `parse5`, aceita só as tags e os atributos que o
  sanitizador do studio emite (um teste lê os dois arquivos do studio e falha se as listas
  divergirem) e escreve a árvore de volta; qualquer coisa fora disso derruba o build com o nome do
  post. Substitui a conferência por expressão regular, que dava para contornar.
- `pnpm run deploy` recusa rodar com `BLOG_SOURCE=fixture` (não publica os posts de exemplo).
- Busca: tenta de novo depois de uma falha de carregamento, e anuncia o número de resultados.

### Corrigido
- **Imagem Docker do studio:** o primeiro deploy do M1 falhou na construção da imagem. Os testes
  que moram em `src/` importam ajudantes de `tests/`, que fica fora da imagem, e o `next build`
  checa os tipos de tudo o que encontra. `studio/.dockerignore` passa a excluir `**/*.test.ts` e
  `**/*.test.tsx`. O CI não pegou porque builda a árvore inteira, fora do Docker.
- **Privacidade:** `/privacy/` e `/pt/privacidade/` anunciavam no `hreflang` endereços que não
  existem (`/pt/privacy/`, `/privacidade/`); agora apontam um para o outro, e o seletor de idioma
  leva à privacidade do outro idioma em vez da home. Os links "Como funciona", "Prova" e "Para
  quem" do cabeçalho dessas páginas apontavam para âncoras que só a home tem; agora levam à home.
- **Botões de agenda e e-mail de contato:** em todo o site (cabeçalho, topo, "para quem",
  fechamento) `PUBLIC_BOOKING_URL` e `PUBLIC_CONTACT_EMAIL` passam pelo filtro de `lib/contact.ts`;
  valor vazio, de exemplo ou sem https vira o link para a seção de contato da home, e o e-mail
  some. Antes só o fechamento do `/investidor` e o blog filtravam; um valor de exemplo no `.env`
  saía em cinco botões da home.
- `aria-label` do menu do cabeçalho traduzido nas páginas em português ("Seções").

### Alterado
- Política de privacidade com controlador (Lucas, pessoa física), encarregado e `lgpd@ash.app.br`.
  **No ar desde 2026-10-02.**
- **Design v2 — identidade própria do site** (2026-10-02, no ar): verde `#3dff6e` sobre `#070908`,
  Chakra Petch nos títulos e IBM Plex Sans/Mono no texto (auto-hospedadas), o mascote como logo,
  no topo e no fechamento, brilho só onde `docs/design-system.md` permite. A home segue a
  referência `docs/design/ash-home-reference.html`: topo com o mascote, "veja funcionando" com
  totais e o botão que simula um pagamento, cartões em grade. O console do agent-rails mantém a
  identidade dele; a regra "uma identidade só" saiu do `CLAUDE.md`.
- **Copy do site e do pitch reescrita** (2026-10-02, no ar). Título: "Unleash your agents on
  Solana. Full autonomy, on your terms." / "Solte seus agentes na Solana. Autonomia total, nos
  seus termos.", com "Turn prompts into payments" abrindo o subtítulo. Público: quem constrói
  agentes, times e DAOs que pagam à mão, e mesas de DeFi (mandato ainda não construído). Cada
  afirmação foi conferida contra o agent-rails em `2bbe70d`: sete ferramentas, orçamento por
  sessão de agente, sessão revogada em vez de agente pausado, repetição recusada enquanto o
  recibo existe, "um registro on-chain" no lugar de "prova que qualquer um confere", "sem taxa de
  protocolo hoje". A objeção passa a dizer que o Ash usa o Allowances nativo, com o cofre como
  delegado (ADR-014). O pitch tem três opções no dilema e um slide de mercado só com o que dá
  para medir. A skill `writing-ash-marketing-copy` traz a lista do que o código não deixa dizer.
- `public/og.png` e `scripts/og.mjs` na identidade nova, com o título atual e o mascote.
- `studio/src/app/globals.css` com a paleta nova (as fontes do painel ainda são as antigas).

### Adicionado (design v2)
- Página `404` (`src/pages/404.astro`): antes, um endereço errado respondia com a home.

### Removido
- O comando de demonstração (home e slide 9 do pitch) e os links para o GitHub: o repositório do
  protocolo é privado e o script não roda no `main` atual. As contagens "286 testes" e "8 checks",
  as previsões de mercado para 2030 e os números de receita de terceiros.
- `src/components/CeilingScene.astro`, sem uso desde que o mapa do dinheiro assumiu o topo. A
  lógica (`lib/ceiling-scene.ts`) continua: é a cena da boas-vindas do `/investidor`.

### Documentação
- Sessão de 02/10 (`docs/sessions/2026-10-02-design-v2-copy-e-studio-no-ar.md`): linha do tempo,
  decisões do Lucas, a tabela "antes × agora" da copy com a origem de cada troca, e o passo a
  passo de publicar o site à mão, publicar o painel e conferi-lo no navegador. `ROADMAP` §0
  reescrito como "por onde começar"; `DEPLOY` e `studio/README` com o que o primeiro deploy do M1
  ensinou.
- M1c fechado nos documentos: `CODEMAP` (rotas, componentes e integração do blog), `DEPLOY` (o
  workflow por evento e a seção "Ligar o blog"), `ROADMAP`, `README` e a seção "Desvios na
  implementação" do plano do M1c, com as decisões 6 (tags não derrubam o build) e 7
  (`cta:newsletter` não desenha nada) revistas.
- Planos do M1 (`docs/plans/2026-10-01-ash-studio-m1{a,b,c}-plano.md`, os dois primeiros com a
  seção "Desvios na implementação"), sessão de 01/10 em `docs/sessions/`, `CODEMAP` e `ROADMAP`
  atualizados para o M1; `DEPLOY` corrigido (o deploy automático está desligado).
- Desenho e planos do ash-studio (`docs/plans/2026-09-30-ash-studio-*`), `studio/README.md` e o
  runbook `studio/deploy/cloudflare.md`.
- `docs/CODEMAP.md` (mapa do código e dos fluxos), `docs/ROADMAP.md` (próximos passos e
  pendências), `docs/sessions/` (registro das sessões de 29 e 30/09); README, CLAUDE.md e
  design system atualizados.

## [0.4.0] — 2026-09-30

Os painéis de workflow que o Lucas desenhou no Claude Design viram parte do site e do pitch, e o
pitch ganha a estrutura completa de startup.

### Adicionado
- **Mapa do dinheiro no topo do site** (`components/showcase/FlowMap.astro`), portado do painel
  v1: cofre → agentes → recebedores, com um ponto correndo cada pagamento (verde liquidado,
  vermelho negado), agente pausado em âmbar tracejado, contadores e registro ao vivo. Simulação
  pura e testada em `lib/flow-model.ts` (a ordem das checagens segue a do programa). Geometria fixa
  em vez de medir o DOM — o painel original caía ao trocar de fluxo. Texto em container units,
  então o mesmo componente serve no site e num slide; no celular vira pilha de cartões.
  Substitui a animação do teto, a pedido do Lucas.
- **Seção "Veja funcionando"** com os três cartões do painel v2 (`AgentCards.astro`): pagou,
  negado, pausado. Cada painel aparece uma vez no site.
- **Pitch v2, 18 telas em 3:00:** dor (×2), solução, mapa rodando, pilares 01–03, cartões,
  concorrência em 2×2, diferenciais, por que agora, mercado, modelo, onde estamos, time, pedido,
  obrigado. Números só com fonte (pesquisa em `agenttokenfy/.aios/research/2026-09-30-mercado-e-
  concorrentes-pitch.md`, que parte do que o Ronaldo documentou).
- **Fechamento do `/investidor`:** passar da última tela mostra "Obrigado pela leitura, <nome>",
  "Quer conversar com a gente?" e os canais (agenda, WhatsApp, e-mail) que tiverem valor real
  (`lib/contact.ts` recusa vazio e exemplo). Escolher um canal marca o lead como interessado
  (`/api/interest`, migração `0002_interest.sql`).

### Corrigido
- **Número do x402 no site:** "75 milhões de transações, 24 milhões de dólares em 30 dias" era o
  contador da página do x402 (possivelmente parado desde março), não Chainalysis. Agora cita a
  TRM Labs (09/09/2026): ~199 milhões de transações e US$ 52,7 milhões até meados de 2026, a
  maioria testes e robôs.
- Com a coleta de leads desligada (503), o visitante ficava preso no popup com "tente de novo";
  agora segue para a boas-vindas e o pitch sem gravar nada.

## [0.3.0] — 2026-09-30

Reposicionamento no ganho e o funil de investidores.

### Alterado
- **Título novo:** "Give your agents a budget. Never the keys." / "Dê ao seu agente um orçamento.
  Nunca a chave do cofre." O anterior ("você decide quanto ele pode perder") vendia perda; o Lucas
  rejeitou. Categoria "spend authority"; espinha em três pilares numerados (agentes que pagam,
  regras que se sustentam, prova que qualquer um confere). Risco vira motivo, não promessa.
- `.env.example` sem valores de exemplo (dele veio o link quebrado de 29/09).

### Adicionado
- **`/pitch` e `/pt/pitch`:** deck oficial (teclado, clique, toque, `#n`, autoplay de 3:00 com
  `P`, notas com `N`), `noindex` e fora do sitemap.
- **`/investor` e `/pt/investidor`:** popup (nome, cargo, tipo, e-mail, consentimento) →
  boas-vindas pelo nome com a cena do teto "cofre de <nome>" → **o mesmo deck**, desenhado pelo
  mesmo componente a partir do mesmo conteúdo (o e2e confere as telas idênticas).
- **API de lead** (`functions/api/lead.ts` → `lib/lead-handler.ts`): Turnstile, upsert no D1
  `ash-leads` (sem IP), repasse ao Listmonk com double opt-in e reenvio de pendentes. **Coleta
  desligada de propósito** (sem `TURNSTILE_SECRET`) até existirem controlador e canal de contato.
- Política de privacidade EN/PT com a seção do formulário; o popup aponta para o pitch aberto
  (consentimento livre).
- Skill `.claude/skills/writing-ash-marketing-copy` (tom, públicos, Sexy Canvas confirmado, regra
  do enquadramento no ganho).

## [0.2.1] — 2026-09-29

### Alterado
- Copy reescrita com a skill de marketing; seção "Por que agora"; linha das ADRs na prova.

### Corrigido
- Deploy saiu com `cal.com/exemplo/20min` em todos os botões (o build lê o `.env`); republicado
  com as variáveis vazias. Armadilha anotada em `docs/DEPLOY.md`; `pnpm deploy` → `pnpm run deploy`.

## [0.2.0] — 2026-09-29

Uma identidade só com o console, em vez de duas. O Lucas pediu para o marketing parar de ter uma
paleta própria e passar a usar o mesmo sistema do console (`packages/dashboard` no repo
`wayside-labs/agent-rails`, agora em `console.ash.app.br`).

### Alterado
- **Paleta reescrita a partir de `packages/dashboard/src/app/globals.css`**, valor por valor, não
  reinventada: fundo `#08080A`, cartão `#0F0F12`, elevado `#17171B`; mint `#14F195` como marca e
  "bom" (liquidado, botão primário); periwinkle `#7C8CFF` como `--accent` — a mesma variável que o
  console chama de "ceiling", e é exatamente o que a linha de teto da cena desenha; âmbar para
  aviso, vermelho reservado para crítico. Site escuro só, sem alternância clara — o console também
  não tem uma.
- **Tipografia:** Geist/Geist Mono → **Inter + JetBrains Mono**, os mesmos pacotes do console.
- **Forma:** cantos de 4 px → escala de 6–16 px do console; cartões ganham o "friso de luz"
  (`box-shadow: inset 0 1px 0 0 rgba(255,255,255,.04)`) no lugar de sombra, igual ao
  `.surface-raised`/`.surface-card` de lá. Nova utilidade `.num` (mono + zero cortado +
  tabular-nums), copiada do mesmo arquivo, para números de dinheiro e limites.
- **Papéis do cartão corporativo remapeados** com a própria semântica do console: dono = periwinkle
  (ele é quem define o teto), guardião = âmbar (só pausa, não é perigo), agente = mint (pagar
  dentro da política é o caso "bom"). Fechamento deixou de inverter a cor da seção — a página
  inteira já é escura agora — e virou uma superfície elevada com o botão mint de sempre.
- Ícone do favicon e a imagem Open Graph refeitos na paleta nova.

### Corrigido
- A cena do teto tinha uma sobreposição de texto que passou despercebida na direção clara: a
  legenda de um pagamento liquidado ficava em cima do nome da caixa de destino, e um código de
  recusa longo (`EXCEEDS_PER_TX_MAX`, `DESTINATION_NOT_ALLOWED`) podia invadir a mesma caixa em
  telas estreitas. Corrigido: a legenda some quando o marcador chega (o quadrado colorido já é o
  sinal), e um código que não cabe encolhe e depois corta com reticências.

## [0.1.1] — 2026-09-29

### Publicado
- **`ash.app.br` e `www.ash.app.br` estão no ar**, apontando para este site via Cloudflare Pages.
  O `A` antigo (cPanel, 85.155.127.7) e o `CNAME www` antigo foram removidos; em seu lugar, dois
  `CNAME` proxied para `ash-web.pages.dev`, adicionados como custom domains do projeto Pages
  `ash-web`. Confirmado depois: `console.ash.app.br` e `console-api.ash.app.br` (túnel do
  Ronaldo) e todo o e-mail (MX, SPF, autodiscover, Lync, SRV) intocados.
- `PUBLIC_BOOKING_URL` e `PUBLIC_CONTACT_EMAIL` seguem vazias — os botões de agenda ainda não
  levam a lugar nenhum, de propósito, até existirem os valores reais.

### Removido
- O placeholder que rodava na VPS compartilhada (`agent-rails-vps`, containers `ash-web` e
  `ash-cloudflared` em `/opt/ash`, atrás do túnel `ash`) foi desligado (`docker compose down`,
  sem apagar nada em disco). Os arquivos foram copiados para `docs/legacy-vps-placeholder/`
  antes de desligar, para não perder o trabalho. O DNS nunca havia chegado a apontar para ele.
- Backup do estado do DNS antes da mudança: `agenttokenfy/.aios/secrets/ash-dns-backup-2026-09-29-pre-pages.json`.

## [0.1.0] — 2026-09-29

Primeira versão completa do site, pronta para o primeiro deploy na Cloudflare Pages.

### Adicionado
- Bootstrap em Astro 7 com TypeScript strict; plano de implementação em `docs/plans/`.
- Identidade "Aço": tokens claro/escuro, Geist e Geist Mono hospedadas no próprio site.
- Copy de marketing em inglês (`/`) e português (`/pt/`), tipada, com teste de paridade e um
  teste que proíbe preço e a palavra "non-custodial".
- Cena do teto no hero: canvas 2D dirigido por um modelo puro e testado que segue a ordem de
  verificação do programa (pausa, destino, duplicata, teto por pagamento, janela). Arrastável,
  acessível por teclado, estática com `prefers-reduced-motion`.
- Rolagem suave (Lenis), reveals e contadores (GSAP ScrollTrigger), desligados com reduced motion.
- Seções: dor, papéis, prova, públicos, objeção, fechamento invertido, rodapé; páginas de
  privacidade nos dois idiomas; sitemap, robots, canonical, hreflang e imagem Open Graph.
- Smoke em Playwright (overflow em 375/768/1440, console, troca de idioma, cena, reduced
  motion, metadados) servido por `scripts/serve-dist.mjs`.
- Workflow de deploy para a Cloudflare Pages e runbook em `docs/DEPLOY.md`.

### Decisões
- Repositório próprio, sem nada do `wayside-labs/agent-rails`; deploy na Cloudflare Pages, fora
  da VPS compartilhada.
- Conversão v1 é a conversa de 20 minutos (`PUBLIC_BOOKING_URL`); formulário fica para a fase 2,
  depois da revisão de privacidade.
- `node-linker=hoisted` no pnpm: o linker padrão falha no Windows dentro de `@astrojs/check`.
- `@napi-rs/wasm-runtime` como devDependency, instalado com `--force`: sem ele o `astro check`
  sai com 0 sem checar nada (`docs/DEPLOY.md`).

### Publicado
- 2026-09-29: primeiro deploy em `https://ash-web.pages.dev` com `PUBLIC_BOOKING_URL` e
  `PUBLIC_CONTACT_EMAIL` vazias, até existirem o link da agenda e o e-mail. O domínio
  `ash.app.br` ainda aponta para a hospedagem antiga.
