# Próximos passos — blog, postagens automáticas, X e e-mail de prospecção

**Data:** 2026-09-30 · **Status:** proposta para o Lucas decidir (nada construído ainda)
**Base:** levantamento read-only de `criptosul`, `boringco`, `leadsfrio`, `cursos/_infra` e
`algumacoisa-agentica/infra` (30/09); preço do X em https://docs.x.com/x-api/getting-started/pricing
(consultado em 30/09; a página não tem data).

---

## 0. O que já existe (e onde)

| Peça | Onde | Estado | Reaproveita? |
|---|---|---|---|
| Blog com autor → revisão → publicação, RLS, sanitizador, sumário, RSS | `criptosul` (Next 16 + Supabase; MIT, código do Lucas) | Pronto, testado (`tests/blog.test.ts`) | Modelo de dados, sanitizador, sumário, regras de moderação. **Sem** agendamento, IA ou redes — tirados de propósito (`0029_o_blog.sql:1-37`) |
| Blog com **campanhas, agendamento e post por IA** | `boringco` (Next 14 + Supabase; código do Lucas, sem LICENSE) | Pronto: `0055_blog.sql`, cron `0056_blog_publish_cron.sql`, `publish-due.ts`, `generate-post.ts` + `content-lint.ts` | A lógica de agenda (`lib/campaign-schedule.ts`, com testes) e o gerador + lint de IA |
| Disparo com aquecimento (throttle) | `boringco/src/features/outreach/lib/throttle.ts` | Pronto: 40/dia subindo 40/dia até 400, lotes de 10, 9h–19h BRT | A lógica de ritmo. **Não** o tratamento de LGPD dele (README assume lista comprada) |
| Listas de prospecção | `cursos/_infra/{vcs,geral,assessores}` | Coletadas e com validação de MX por domínio. **Nenhuma com opt-in** | Sim, com os filtros da seção 4 |
| Listmonk | VPS Hostinger `/opt/ash-mail` | No ar, **SMTP desligado, zero contatos** | Sim — é o motor de envio e descadastro |
| Caixa de envio | `ash-correio` (docker-mailserver, `aceleradora.eco.br`, mesma VPS) | No ar. README diz DKIM/PTR pendentes; memória de 28/09 diz feitos (port25: SPF/DKIM/iprev pass). **Conferir** | Sim |
| Postagem no X | — | **Não existe em nenhum projeto** | Construir do zero |
| `leadsfrio` | `F:\AceleradoraECO\leadsfrio` | Projeto vazio (só o template do OS) | Não |

## 1. Blog no ash.app.br

**Recomendado: posts em Markdown dentro do próprio `ash-web`, com agendamento por build.**

- Content collection do Astro (`src/content/blog/{en,pt}/*.md`) com frontmatter: `title`, `summary`,
  `publishAt`, `tags`, `cover`, `lang`, `translationOf`. Mesmo modelo de campos do criptosul
  (`resumo`, `meta_title/description`, `leitura_minutos`), sem banco.
- Post só aparece quando `publishAt <= agora` no momento do build.
- **Disparador:** um GitHub Action com `schedule` (ex.: a cada hora) que rebuilda e publica. Sem
  servidor, sem cron no banco, sem Supabase. Rollback = reverter o commit.
- **Fluxo editorial:** rascunho → pull request → revisão → merge com `publishAt` no futuro. O PR é o
  "revisão/aprovação" do criptosul, com histórico de graça.
- **Rascunho por IA (opcional):** portar `generate-post.ts` + `content-lint.ts` do boringco para um
  script (`scripts/blog/rascunho.mjs`) que abre um PR com o rascunho, usando como contexto a skill
  `writing-ash-marketing-copy` e as fontes do pitch. Nunca publica sozinho: humano aprova o PR.
- RSS (`/blog/rss.xml`) e sitemap incluem os posts — é o que alimenta o X e a newsletter.

**Alternativa descartada por ora:** rodar o módulo de blog do boringco como serviço à parte
(Next + Supabase/D1) com painel e papéis. Só vale se autores não-técnicos precisarem de painel;
hoje custa servidor, banco e manutenção para um blog de 1–2 posts por semana.

**Decisões do Lucas:** cadência (ex.: 1 post/semana), idiomas (EN e PT sempre? só PT?), quem
aprova, se quer o rascunho por IA.

## 2. Disparador de postagens

O "disparador" é o build agendado da seção 1 mais um passo depois dele:

1. Build agendado publica os posts vencidos.
2. Um script compara o RSS antes/depois e, para cada post novo, **enfileira** (não publica):
   o post no X (seção 3) e a nota da newsletter (Listmonk, só para quem assinou).
3. A fila é aprovada por um humano (ou tem aprovação implícita só para textos já revisados no PR).

## 3. X (Twitter)

**Custo real (docs.x.com, 30/09):** pay-per-use, sem plano grátis nem mensalidade —
**US$ 0,015 por post sem link e US$ 0,20 por post com link**; leitura US$ 0,005 por post; teto de
3 milhões de leituras/mês. Exemplo: 2 posts/dia com link ≈ US$ 12/mês; sem link ≈ US$ 0,90/mês.
→ Escrever o fio sem link e pôr o link numa resposta só quando valer a pena; o link é 13× mais caro.

**Desenho:** tabela `x_queue` no D1 que já existe (`texto`, `url?`, `agendar_para` ISO 8601 UTC,
`status` pendente|aprovado|publicado|falhou, `tweet_id`) + um Cloudflare Worker com Cron Trigger que
publica os aprovados via `POST /2/tweets` (OAuth do usuário da conta do Ash). Modo `dry-run` por
padrão, teto de gasto mensal no código, e nada de post gerado por IA indo ao ar sem aprovação.

**Decisões do Lucas:** qual conta (existe @ do Ash?), quem aprova, cadência, orçamento mensal.

## 4. E-mail para as listas de potenciais clientes

**Isto é o que tem mais bloqueio, e eles já estão escritos nos seus próprios documentos**
(`cursos/_infra/vcs/FUNIL-E-ESTRATEGIA.md:136-140`, `assessores/README.md:57,136`,
`ash-mail/README.md:43-53`). Antes do primeiro envio:

1. **Base de opt-out (supressão)** carregada no Listmonk — quem saiu nunca recebe de novo.
2. **Filtrar na origem:** linhas `canal = nao_contatar` (7 na vcs); `tipo: pessoa` com tratamento
   LGPD separado; **excluir as linhas com `fonte = shizune`** da `geral` (os termos do Shizune proíbem
   raspagem e redistribuição — está no `geral/README.md`). A `Family Office.xlsx` segue reprovada.
3. **Base legal:** legítimo interesse documentado (teste de balanceamento) para B2B, rodapé legal com
   identificação do remetente e descadastro em um clique. Rodar a skill `privacy-audit` antes.
4. **Infra:** SMTP ligado no Listmonk; conferir DKIM e PTR (README e memória divergem); hostname
   público só para descadastro e cliques.
5. **Aquecimento:** 10–20 envios/dia por caixa, subindo em 3–4 semanas (≈ 8–14 semanas só para a vcs).
   Ritmo portado do `throttle.ts` do boringco para um timer (systemd) sobre a API do Listmonk.
6. **CVM:** e-mail para investidores/assessores levando ao pitch com valor de rodada é o ponto mais
   sensível — validar com quem entende antes de disparar.
7. 🟡 **Risco de infraestrutura:** as caixas estão na **mesma VPS** que roda o produto. Se a
   Hostinger suspender por reclamação de spam, cai tudo. A regra da memória era "prospecção fria não
   sai da VPS do produto"; hoje ela sairia. Recomendo uma VPS pequena só para envio.

**Ordem de envio (dos seus documentos):** piloto de 100 da `vcs` com `canal = ok` → medir
entregas, respostas e reclamações → ondas. Cada e-mail leva para `/pt/investidor?utm_…` — o que
**depende da coleta de leads estar ligada** (controlador + canal de contato).

## 5. Ordem sugerida

| # | O quê | Depende de | Tamanho |
|---|---|---|---|
| 0 | Decisões do Lucas: contato/controlador (libera coleta), valor da rodada, time, conta do X | — | — |
| 1 | Blog em Markdown + build agendado + RSS | cadência e idiomas | Pequeno |
| 2 | Fila do X + Worker em dry-run → aprovado | 1, conta do X, orçamento | Pequeno |
| 3 | Rascunho de post por IA (porte do boringco) | 1 | Médio |
| 4 | Prospecção por e-mail: filtros, supressão, SMTP, aquecimento, piloto de 100 | 0, privacy-audit, CVM, VPS de envio | Médio, e longo no relógio (aquecimento) |

## 6. O que não fazer

- Não disparar e-mail do domínio `ash.app.br` nem de listas sem os filtros da seção 4.
- Não usar as linhas do Shizune nem a `Family Office.xlsx`.
- Não publicar no X sem aprovação humana, nem sem teto de gasto.
- Não trazer o Supabase do criptosul/boringco para o site estático só para ter um blog.
