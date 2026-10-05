# CLAUDE.md — ash-web

Site, pitch e funil de investidores do Ash em Astro 7 estático + Cloudflare Pages Functions + D1.
Mapa em `docs/CODEMAP.md`; o que falta em `docs/ROADMAP.md`; porquê em `docs/sessions/`.

## Regras

- Docs e commits em português; código, nomes e a copy-fonte em inglês (os `*.pt.ts` são tradução).
- Arquivo com mais de ~200 linhas está fazendo duas coisas: dividir.
- Copy do site só muda em `copy.en.ts` e `copy.pt.ts` **juntos**; o pitch só em `pitch.en.ts` e
  `pitch.pt.ts` **juntos**. `pnpm test` cobra a paridade, proíbe preço, "non-custodial" e `TODO`.
- **O pitch mora num arquivo só.** `/pitch` e `/investidor` desenham o mesmo `Deck.astro`; nunca
  copie uma tela para uma página. O e2e confere que as rotas mostram as mesmas telas.
- **Copy vende o "sim", não a perda** (skill `writing-ash-marketing-copy`). Risco é motivo.
- **Número só com fonte original conferida.** Dois números herdados já estavam errados (x402,
  "Visa ~US$ 7 bi"). Pesquisa de referência: `agenttokenfy/.aios/research/2026-09-30-mercado-e-concorrentes-pitch.md`.
- Nada do repositório `wayside-labs/agent-rails` entra aqui, nem como submódulo nem copiado.
- Sem preço do Ash, sem "non-custodial", sem promessa de auditoria. Status devnet visível.
- Demonstrações são marcadas como simulação; valores de exemplo em USDC.
- Segredos só em `.env` (ignorado) ou nos secrets da Pages. **`.env.example` fica vazio** — o build
  publica os `PUBLIC_*` em todos os botões (link quebrado de 29/09).
- Deploy manual: `PUBLIC_BOOKING_URL= PUBLIC_CONTACT_EMAIL= PUBLIC_WHATSAPP= PUBLIC_TURNSTILE_SITEKEY=<site key> CI=true pnpm run deploy`
  (valores reais no lugar dos vazios quando existirem). Nunca `wrangler pages project create` aqui.
- **Coleta de lead desligada** (sem `TURNSTILE_SECRET`) até existirem controlador e canal de
  contato. Dado pessoal novo passa pela skill `privacy-audit` antes.
- Movimento respeita `prefers-reduced-motion`: o estado de repouso é o estado final.
- **Identidade própria do site (design v2, 02/10).** Regra, tokens, contraste medido e uso do
  mascote em `docs/design-system.md`; fonte da verdade: `src/styles/tokens.css`. O console
  (`wayside-labs/agent-rails`) mantém a paleta dele por enquanto — nada daqui é copiado de lá nem
  levado para lá. Cor só por token; brilho só onde o design system permite.

## studio/

Painel de admin (blog, IA, newsletter) em Next 16, pacote **independente** com lockfile próprio e
Postgres próprio. Mapa em `studio/README.md`; runbook da Cloudflare em `studio/deploy/cloudflare.md`.

- Não há workspace pnpm: o `pnpm install` do site e o do `studio/` são separados.
- Toda página, rota e server action **do painel** chama `requireAdmin()`; só as rotas públicas de
  `hosts.ts` (`PUBLIC_ROUTES`) e o `/api/health` não chamam. O `proxy.ts` é só a primeira porta.
- Nenhuma tela ou rota de admin mora sob um prefixo público (`/api/public/`, `/newsletter/`,
  `/descadastro`, `/media/`): o painel da newsletter fica em `/painel/newsletter`, por exemplo.
- Escrita confere as linhas afetadas (`expectOne`; na fila, o fencing por tentativa).
- Trabalho demorado vira job; o handler respeita `ctx.signal` e é idempotente pelo `jobId`.
- Sem pixel nem rastreio; bundle público nunca leva segredo nem URL interna.
- Testes de banco rodam contra Postgres real e só em banco `*_test`; no CI, `REQUIRE_DB_TESTS=1`.
- Dado pessoal novo passa pela skill `privacy-audit` antes.
