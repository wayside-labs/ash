# ash-web — site do Ash (ash.app.br)

Site de marketing, pitch e funil de investidores do Ash: autoridade de gasto para agentes de IA,
imposta on-chain na Solana. Repositório próprio, sem nada do `wayside-labs/agent-rails` dentro.

**No ar:** `ash.app.br` (EN) · `/pt/` · `/pitch/` · `/pt/pitch/` · `/investor/` · `/pt/investidor/`
(Cloudflare Pages). Versão atual: ver `CHANGELOG.md`.

## Rodar

```bash
pnpm install
cp .env.example .env      # deixe vazio o que não for real — o build publica esses valores
pnpm dev                  # http://localhost:4321
pnpm build                # astro check + build estático em dist/ (sem blog: BLOG_SOURCE vazio)
pnpm test                 # vitest: paridade EN/PT, modelos, handlers da API, lógica do blog
BLOG_SOURCE=fixture pnpm build   # o mesmo build, com o blog de exemplo (não publicar esse dist/)
pnpm test:e2e             # playwright sobre o dist/: site, deck, funil, blog, busca
```

O blog (`/blog/`, `/pt/blog/`) vem do ash-studio no build e só existe com `BLOG_SOURCE` definido:
`fixture` para testar, `api` em produção. Os testes e2e do blog pedem o build em `fixture`. Como
ligar em produção: `docs/DEPLOY.md`, seção "Ligar o blog".

Deploy manual e o funil de leads: `docs/DEPLOY.md` (sempre com as variáveis `PUBLIC_*` explícitas).

## Documentação

| Arquivo | Para quê |
|---|---|
| `docs/CODEMAP.md` | Onde cada coisa mora, rotas, fluxos do funil e do pitch, dados |
| `docs/ROADMAP.md` | O que falta, decisões pendentes, dívidas técnicas |
| `CHANGELOG.md` | O que mudou em cada versão |
| `docs/sessions/` | O porquê das decisões, por sessão |
| `docs/design-system.md` | Paleta, tipografia e a regra "uma identidade com o console" |
| `docs/DEPLOY.md` | Deploy, armadilhas (`.env`, pnpm no Windows), funil e exclusão de lead |
| `docs/plans/` | Especificações e planos (site, pitch/investidor, blog/X/prospecção) |
| `.claude/skills/writing-ash-marketing-copy/` | Regras de copy: tom, públicos, enquadramento no ganho |

## Regras rápidas

- Texto muda sempre em `copy.en.ts` + `copy.pt.ts` (site) ou `pitch.en.ts` + `pitch.pt.ts`
  (pitch), juntos; `pnpm test` cobra a paridade e proíbe preço.
- `/pitch` e `/investidor` desenham o mesmo deck: nunca copie uma tela para uma página.
- Número em página ou slide só com fonte original conferida.
- Movimento respeita `prefers-reduced-motion`: o estado de repouso é o final.
- Depois de mudar o título do topo, rode `node scripts/og.mjs` e commite o `public/og.png`.
