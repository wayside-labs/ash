# ash-studio — desenho (blog, automação por IA e newsletter)

**Data:** 2026-09-30 · **Status:** aprovado pelo Lucas (30/09) · **Branch:** `feat/ash-studio`
**Substitui:** as seções 1–3 de `2026-09-30-proximos-passos-conteudo-e-prospeccao.md` (blog em
Markdown sem painel). X e prospecção por e-mail continuam fora — fases futuras.
**Base:** levantamento read-only do `boringco` (código, CHANGELOG, session-log, memórias) e do
`criptosul` em 30/09. O boringco é do Lucas (confirmado por ele); o criptosul é MIT dele.

## 1. Objetivo

Trazer para o Ash o sistema de blog do boringco inteiro — editor, campanhas, pautas e posts por
IA, lint, revisão, agenda, publicação e newsletter semanal — num painel de admin próprio, corrigindo
os defeitos que a história do boringco documentou. Critério de pronto de cada fase na seção 6.

## 2. Arquitetura

```
studio.ash.app.br ─(Cloudflare Access)─┐
                                       ├─ túnel ash ─► VPS: ash-studio (Next.js, painel + API)
pub.ash.app.br ─(público, rotas fixas)─┘                ash-studio-worker (fila + agenda)
                                                         ash-studio-db (Postgres 17)
ash.app.br (Astro estático, Pages) ── build lê pub.ash.app.br/api/public/posts
```

- **Onde mora:** pasta `studio/` deste repositório, pacote independente com lockfile próprio. O site
  continua na raiz, com o mesmo build e deploy. Nada do `wayside-labs/agent-rails` entra.
- **Stack:** Next 16 (App Router) + React 19, TipTap 3, Tailwind 4 com os tokens de
  `docs/design-system.md`, Drizzle ORM + driver `postgres`, zod 4, nodemailer, jose (JWT do Access),
  sharp (imagens), vitest.
- **Banco:** Postgres 17 em container próprio (`ash-studio-db`), separado do Supabase do Ronaldo.
  Migrações versionadas pelo Drizzle e aplicadas no deploy — nada de SQL Editor à mão.
- **Dois hostnames, um app.** O middleware decide pelo `Host`: `studio.` exige o JWT do Access
  (`Cf-Access-Jwt-Assertion`, validado contra o JWKS do time) **e** e-mail na lista
  `STUDIO_ADMINS`; `pub.` só serve `/api/public/*`, `/newsletter/*`, `/descadastro` e `/media/*`.
  Qualquer outra rota em `pub.` responde 404.
- **Worker:** o mesmo código, outro processo (`node worker`). A cada minuto: publica o que venceu,
  processa a fila `jobs`, monta e despacha a newsletter. Fila no banco com
  `FOR UPDATE SKIP LOCKED`, `attempts`, `locked_until` e `run_after` — reiniciar não perde nem
  duplica trabalho.
- **Site:** o ash-web ganha `/blog`, `/pt/blog`, post, categoria, tag e autor gerados no build a
  partir da API pública; RSS, sitemap, OG no build, JSON-LD `BlogPosting` + `FAQPage` e busca
  estática com Pagefind. Publicar no studio dispara `repository_dispatch` no GitHub, que rebuilda
  e publica o site. Studio fora do ar não derruba o site nem o blog.
- **Imagens:** disco da VPS (`/opt/ash-studio/uploads`), servidas em `pub.ash.app.br/media/*` com
  cache da Cloudflare; entram no backup cifrado que já existe. WebP ≤ 1600 px, até 5 MB.

## 3. Fases

| Fase | Entrega |
|---|---|
| **M0 — esqueleto** | workspace, app Next, Postgres, Drizzle, auth via Access, `/api/health` (versão, banco, driver de e-mail, último ciclo do worker), auditoria, Docker/Compose, deploy na VPS, túnel, backup |
| **M1 — blog manual** | posts, categorias, tags, autores; editor TipTap com upload; sanitizador do criptosul; estados rascunho → revisão → aprovado → publicado (+ rejeitado); agendar, publicar agora, despublicar; tradução vinculada PT/EN; shortcodes do Ash; API pública; páginas do blog no ash-web + rebuild ao publicar |
| **M2 — automação por IA** | campanhas (tema, contrato de regras, agenda com fuso IANA); pautas com pesquisa na web; geração; lint com até 2 re-tentativas; revisão (aprovar, recusar com comentário, regenerar); próximo horário livre; ação "traduzir"; **registro de uso por chamada e orçamento por campanha**; pacote de fatos do Ash |
| **M3 — newsletter** | inscrição no site (Turnstile) com double opt-in; edição semanal montada sozinha; aprovação humana (auto só se ligada); envio com teto global, janela e rampa; **disjuntor** por taxa de bounce/adiamento; descadastro em um clique com `List-Unsubscribe` + `List-Unsubscribe-Post`; supressão |

## 4. Correções sobre o boringco (o porquê está na história dele)

1. **Fila durável** no lugar do singleton em memória (`generation-queue.ts`): lá, reiniciar
   deixava posts em `gerando` até o cron da hora seguinte.
2. **Todo job de IA é assíncrono.** A geração de pauta era uma server action de 1–2 min contra o
   limite de ~100 s do túnel.
3. **Custo visível e com teto:** tabela `ai_usage` (modelo, tokens de entrada/saída/cache, custo
   estimado, campanha, post). Campanha sem orçamento não gera. Falha de transporte não consome
   tentativa de lint.
4. **Nada de erro engolido.** Toda escrita confere as linhas afetadas; transição de estado é
   condicional (`WHERE status = <esperado>`) e vira erro se não pegar nenhuma linha. Lá,
   `publish-due.ts` ainda contava update vazio como publicado.
5. **Fuso IANA** (`America/Sao_Paulo`) por campanha e na newsletter, em vez de UTC-3 fixo;
   `datetime-local` convertido explicitamente; `DATE` nunca passa por `new Date()`.
6. **Newsletter isolada do e-mail frio.** Remetente `ash.app.br` pelo ash-correio; teto global (não
   por campanha); disjuntor automático; driver `mock` recusado em produção pelo `/api/health` e no
   boot. Prospecção fria, quando vier, sai de outra VPS.
7. **Reserva antes de enviar** (`SKIP LOCKED`); falha transitória com nova tentativa; status
   `sending` de verdade.
8. **O que a tela salva, o código usa** — o `from_name` do boringco era editável e ignorado.
9. **Sem pixel de abertura nem rastreio de clique.** O site do Ash promete "sem analytics".
   "Mais lidos" (dependia de analytics) vira "em destaque", marcado à mão.
10. **Teste de integração do opt-in** (faltou lá) e integração contra Postgres real **no CI**.
11. Os shortcodes de calculadora do salão saem; entram `cta:pitch`, `cta:newsletter`,
    `cta:contato` e `mapa` (o mapa do dinheiro do site).

## 5. Fonte de verdade da IA — sem RAG (decisão)

O boringco decidiu "sem RAG/vetores" (plano de 08/07). Mantemos e melhoramos: um **pacote de fatos
do Ash** (`studio/editorial/fatos.md` + `voz.md`), regenerado por script a partir de fontes
conferidas (pesquisa com fontes, skill `writing-ash-marketing-copy`, pitch) e revisado por PR. Vai
inteiro no prompt com cache. Também entram os últimos 20 posts publicados (links internos e não
repetir assunto) e a pesquisa na web nas pautas. Revisitar RAG só se o pacote passar do que cabe no
contexto.

## 6. Critério de pronto

- **M0:** `https://studio.ash.app.br/api/health` verde atrás do Access; `pub.` responde 404 fora
  das rotas liberadas; worker registra ciclo; backup do banco testado com restauração.
- **M1:** post criado no painel aparece em `ash.app.br/blog` após o rebuild disparado sozinho;
  HTML sanitizado; RSS e sitemap com o post.
- **M2:** uma campanha gera pautas → posts → revisão → publicação agendada sem intervenção além
  das aprovações; custo de cada chamada no `ai_usage`; orçamento estourado para a geração.
- **M3:** inscrição → confirmação → edição montada → aprovada → enviada a uma lista de teste, com
  descadastro em um clique funcionando e supressão respeitada no envio seguinte.

## 7. Depende do Lucas

1. Chave da API da Anthropic com limite de gasto (só no M2).
2. Cloudflare Zero Trust ativo na conta (plano grátis) — ativamos juntos se ainda não estiver.
3. Autorização para um token Cloudflare escopado ao Pages (religa o deploy automático do site).

## 8. Privacidade

A newsletter coleta e-mail (e, por lei, prova do consentimento). Antes do M3: skill
`privacy-audit`, política atualizada (base legal, retenção, descadastro) e nada de IP guardado
além do necessário para o rate limit em memória.
