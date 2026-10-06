# Roadmap — ash-web

O que falta, em ordem, e de quem depende. Atualizado em 2026-10-02 (v0.4.0 + ash-studio M0 no ar,
M1a e M1b no PR #1, **M1c pronto no código**: páginas do blog, busca e workflow; **design v2 e
copy nova no ar**). Histórico no `CHANGELOG.md`; o porquê das decisões em `docs/sessions/`.

> **A produção está à frente do `main`.** `ash.app.br` é publicado à mão a partir do branch
> `feat/design-v2`, que carrega o M1c (PR #1, ainda não mergeado). Publicar a partir do `main`
> antes desse merge devolve o site à versão antiga.
>
> **Desde 2026-10-05 o `/pitch` é o deck de 11 telas** e a publicação saiu da cópia do site em
> `site/` do repositório `wayside-labs/ash`. Publicar a partir de uma árvore sem essa mudança
> devolve o pitch de 18 telas. Passo a passo e armadilhas:
> `docs/sessions/2026-10-05-deck-de-11-telas-no-pitch.md`.

## 0. Por onde começar (estado em 02/10, manhã)

No ar: o site com o design v2 e a copy nova; o painel do blog (studio M1, versão `08d9d7a`), ainda
sem nenhum post. O passo a passo de cada operação está em
`docs/sessions/2026-10-02-design-v2-copy-e-studio-no-ar.md`.

**Em ordem:**

1. **Lucas: conferir o painel no navegador e publicar o primeiro post** (`studio.ash.app.br`; a
   lista de oito itens está na sessão de 02/10). Sem isso nada do blog anda.
2. **Prévia do site com o blog ligado.** Com um post publicado: conferir que ele aparece em
   `https://pub.ash.app.br/api/public/posts`, buildar com `BLOG_SOURCE=api` e
   `BLOG_API_URL=https://pub.ash.app.br/api/public/posts` e publicar como prévia (nunca direto em
   produção). É a primeira vez que o modo `api` roda contra o studio de verdade.
3. **Merge do PR #1** (decisão do Lucas). Leva o blog, o design v2 e a copy para o `main` e acaba
   com a produção à frente do `main`. O branch a mergear é o `feat/design-v2`, que contém o
   `feat/ash-studio`.
4. **Ligar a publicação automática**, na ordem de `docs/DEPLOY.md` § "Ligar o blog": token da
   Cloudflare restrito ao Pages nos secrets do GitHub; variável `BLOG_API_URL`; rodar o workflow à
   mão e conferir; só então `GITHUB_DISPATCH_TOKEN` na VPS.
5. **Duas travas que faltaram hoje** (curtas, sem depender de ninguém): um passo de CI que
   constrói a imagem Docker do studio, e o `deploy.sh` sem o modo silencioso do `docker build`
   (o erro do primeiro deploy do M1 ficou escondido por ele). E investigar os testes de navegador
   que oscilam quando a suíte roda inteira (suspeito: os builds do `blog-modes.spec.ts` em paralelo).
6. **Próximo do studio:** M2 (automação dos posts com IA — o pacote de fatos sai da copy já
   corrigida e da skill `writing-ash-marketing-copy`) e M3 (newsletter).

**Conversas que só o Lucas pode ter** (não bloqueiam os passos 1 a 5):

- Com o Ronaldo: as perguntas sobre o protocolo e a lista do que mudou na copy
  (`agenttokenfy/.aios/research/2026-10-01-sintese-coordenacao.md` §6); o texto da objeção sobre o
  delegado (ADR-014), que já está no ar; se ele e o Bernardo sabem da decisão de 01/10 sobre o
  hackathon.
- Com os sócios: abrir o repositório do protocolo ou não; carteira de plataforma (ADR-024); qual
  modelo de receita vale; rodada e a cautela com a CVM; nomes no slide do time.

**BP interno:** continua esperando o relatório do Ronaldo e a fusão com a pesquisa de 01/10. Falta
decidir onde ele mora (sugestão: `algumacoisa-agentica/docs/business/`).

Feito e fora desta lista: M1c no código (plano e desvios em
`docs/plans/2026-10-01-ash-studio-m1c-plano.md`); design v2, lotes 1 a 3; deploy do studio M1; a
avaliação do `public-apis` (`agenttokenfy/.aios/research/2026-10-01-avaliacao-public-apis.md`).

**Copy do site e do pitch — reescrita e no ar em 02/10**, por decisão do Lucas, sem esperar a
fusão: as correções de fato da pesquisa de 01/10 e o título e o público que ele escolheu. O que
ainda falta na copy:

- a cobertura de 99,2% é o número que o `CLAUDE.md` do agent-rails declara como medido; não foi
  medida por nós (falta `cargo-llvm-cov` nesta máquina) e está no site sem data;
- os números externos do site e do pitch (TRM, "93%" da Helios via CCN, "40 organizações" da
  Linux Foundation) foram lidos no texto bruto das páginas em 02/10;
- o slide de concorrência é leitura de documentação pública; ninguém leu o código da Kyvern, da
  Crossmint nem do Allowances;
- os slides `model`, `ask` e `team` esperam decisões dos sócios;
- mostrar ao Ronaldo o texto da objeção (o cofre como delegado, ADR-014), que já está no ar.

**Design v2 — o que falta:** as fontes do painel (`studio/`), que ainda são Inter e JetBrains
Mono; as capas de exemplo do blog (fixture) com o roxo antigo.

## 1. Esperando decisão do Lucas (destrava o resto)

| # | Decisão | Destrava | Onde entra |
|---|---|---|---|
| 1 | ~~Controlador dos dados + e-mail~~ **Resolvida:** controlador = Lucas, pessoa física; encarregado; `lgpd@ash.app.br`. A política está no repositório, **ainda não publicada** | Ligar a coleta de leads (`TURNSTILE_SECRET`) quando a política for ao ar | `docs/DEPLOY.md` §Funil; `copy.*.ts` → `privacy` |
| 2 | **O pedido:** valor, moeda, instrumento, uso do dinheiro; se aparece nos dois pitches ou só no `/investidor` | Tela 17 do pitch | `pitch.*.ts` → slide `ask` |
| 3 | **Time:** nome, papel, uma linha de credencial (foto/links opcionais) — com o aceite dos três | Tela 16 do pitch | `pitch.*.ts` → slide `team` |
| 4 | **Canais:** link de agenda (Cal.com/Calendly), WhatsApp, e-mail | Botões "Agendar 20 minutos" e o "Quer conversar?" do fechamento | `PUBLIC_BOOKING_URL`, `PUBLIC_WHATSAPP`, `PUBLIC_CONTACT_EMAIL` |
| 5 | **CVM:** ouvir alguém da área antes de enviar o `/investidor` com valor de rodada em massa | Prospecção de investidores | — |
| 6 | Conta @ do Ash no X, cadência e idiomas do blog | Blog e X | `docs/plans/2026-09-30-proximos-passos-conteudo-e-prospeccao.md` |

**Para o blog aparecer em `ash.app.br`** faltam cinco coisas, todas do Lucas, nesta ordem (passo a
passo em `docs/DEPLOY.md`, "Ligar o blog"): (a) deploy do studio na VPS com o M1a/M1b e um post
publicado; (b) merge deste branch na `main` (combinado: só no fim de M0–M3, ou antes se ele
decidir) — o `repository_dispatch` só enxerga o workflow da branch padrão; (c) um token da
Cloudflare escopado ao Pages nos secrets do GitHub (hoje o deploy automático está desligado);
(d) a variável `BLOG_API_URL` no GitHub, que é o que liga o blog (sem ela o build sai sem blog);
(e) por último, `GITHUB_DISPATCH_TOKEN` na VPS — antes de (b)–(d) o GitHub responde 204, nada é
construído e o health do studio fica verde.

**Nunca rodou de verdade:** o workflow novo (só foi conferido que o YAML é válido), o modo `api`
de ponta a ponta contra o studio, e o build no Linux com `sharp` e Pagefind. A primeira execução
depois do merge é o teste.

**Atenção ao mesclar `feat/ash-studio`:** o merge leva à `main` o texto novo da política de
privacidade (commit `eec5bf0`); o próximo deploy do site o coloca no ar.

## 2. Próximos passos de produto (plano completo em `docs/plans/2026-09-30-proximos-passos-conteudo-e-prospeccao.md`)

1. **ash-studio** (`studio/`, plano em `docs/plans/2026-09-30-ash-studio-*`) substitui o plano
   de blog em Markdown: M0 (esqueleto, painel atrás do Access) **pronto e no ar desde 01/10** em `studio.ash.app.br` (CI verde no PR #1,
   rascunho — merge só no fim de M0–M3). **M1, blog manual:** M1a (motor) e M1b (painel) prontos
   no PR #1 e **sem deploy**; M1c (blog no site) pronto no código. Depois **M2 (IA)** e **M3
   (newsletter)** — o M3 é quem dá conteúdo ao bloco `{{cta:newsletter}}`, que hoje não desenha
   nada. Em aberto do M1: o `X-Robots-Tag` de `/media` no studio (o site não consulta `pub.` em
   produção, mas as imagens continuam acessíveis lá).
2. **Disparador:** post novo → fila do X e da newsletter, com aprovação humana.
3. **X (depois do M1):** fila no D1 + Cloudflare Worker com Cron Trigger, `dry-run` por padrão, teto de gasto.
   Custo: US$ 0,015/post sem link, US$ 0,20 com link (docs.x.com, 30/09).
4. **Prospecção por e-mail (depois)** (listas em `cursos/_infra`): supressão, filtros (`nao_contatar`,
   `fonte = shizune` fora, `tipo: pessoa` à parte), base legal, SMTP no Listmonk, aquecimento,
   piloto de 100 da lista `vcs`. Recomendado: VPS só para envio — hoje as caixas estão na VPS do produto.
5. **Pitch mais rico** depois das decisões 2 e 3: tração real (números do agente de referência
   quando existirem, com o rótulo "do próprio time"), e rever a tela de mercado se sair número novo.

## 3. Dívidas técnicas conhecidas

- **Cloudflare:** Access e Zero Trust estão prontos (time `ashhuman`, app "Ash Studio"). O
  "Token da Cloudflare de conta inteira" abaixo continua em aberto.
- **Token da Cloudflare de conta inteira** em `agenttokenfy/.aios/secrets/cloudflare.env`: trocar
  por um escopado a Pages/D1 antes de pôr nos secrets do GitHub (o deploy automático está
  desligado até lá).
- **Listmonk ainda não ligado ao funil:** falta usuário de API, lista double opt-in, hostname de
  túnel com Cloudflare Access e os secrets `LISTMONK_*`/`CF_ACCESS_*`. Sem isso os leads ficam
  `pending` no D1 (é seguro, só não sai e-mail).
- **Retenção de 24 meses** dos leads depende de limpeza manual até existir um script.
- A **boas-vindas do `/investidor`** ainda usa a cena do teto (`lib/ceiling-scene.ts`); pode virar
  o `FlowMap` com o cofre no nome da pessoa, para uma linguagem visual só.
- **Home com ~960 palavras (EN) / ~1.030 (PT)** contando os rótulos da demonstração; a meta era
  700–900 de texto corrido. Rever se a seção de números da prova ainda precisa estar inteira.
- `astro check` depende de `@napi-rs/wasm-runtime` instalado com `--force` (ver `docs/DEPLOY.md`);
  qualquer `pnpm add` o remove de novo e o build passa a não checar tipos, sem avisar.
- **Blog, conhecido e deixado assim:** no modo `off` o build emite dois CSS que nenhuma página usa
  (`_astro/PostCard.*.css`, `PostPage.*.css`), efeito do empacotador; o e2e não roda no CI; em
  `astro dev` as imagens do blog não aparecem (só são copiadas no build).
- ~~`PUBLIC_BOOKING_URL` sem filtro fora do cabeçalho~~ **Resolvido em 02/10:** todo botão de
  agenda e o e-mail impresso passam por `lib/contact.ts`; um teste de build com valores de exemplo
  confere que nenhum chega a página alguma.
- **Sem CSP no site.** Quando tiver: `'wasm-unsafe-eval'` e hashes para a busca (`docs/DEPLOY.md`).
- **Sem link "Blog" no cabeçalho do celular:** abaixo de 760 px o menu some inteiro (já era
  assim); no celular o blog só é alcançado pelo rodapé.

## 4. Fora deste repositório (anotar, não fazer aqui)

- **Painel de workflow v1 (Claude Design):** trocar de aba derruba a página — as arestas do
  fluxo anterior são desenhadas antes de medir (`app.jsx:128`). Avisar o Ronaldo antes de ele
  levar o painel para o console.
- **`agent-rails/docs/strategy/product-strategy.md` §5.4:** "Visa Intelligent Commerce ~US$ 7 bi
  de run-rate" é liquidação em stablecoins da Visa, não de agentes; e a Coinbase usa TEE, não MPC.
  Sugerir a correção ao Ronaldo por PR/conversa — o repo é dele.
