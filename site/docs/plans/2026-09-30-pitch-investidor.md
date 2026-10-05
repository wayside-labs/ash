# /pitch e /investidor — especificação

**Data:** 2026-09-30 · **Status:** aprovado pelo Lucas (revisão posterior com o Ronaldo)

## Objetivo

1. `/pitch` (EN) e `/pt/pitch` (PT): o pitch oficial do Ash, ~12 telas, 3:00, aberto.
2. `/investor` (EN) e `/pt/investidor` (PT): funil de lead. Popup obrigatório → tela de
   boas-vindas personalizada → **as mesmas telas do `/pitch`**.

Regra de sincronia: o `/investidor` nunca é uma cópia mantida à mão. As telas moram num único
arquivo de conteúdo por idioma (`src/content/pitch.{en,pt}.ts`) e um único componente `Deck`
desenha as duas rotas. Atualizar o pitch atualiza o investidor por construção; um teste e2e
confere que as duas rotas mostram as mesmas telas.

## Enquadramento do pitch

Segue a skill `writing-ash-marketing-copy`: vende o "sim" (orçamento, nunca a chave), risco como
motivo, espinha em três pilares. Nada de preço, "non-custodial", promessa de auditoria ou valor
de rodada. Cada número vem do repositório `agent-rails` (fonte anotada no arquivo de conteúdo).

| # | Tela | Linha na tela (EN) |
|---|---|---|
| 1 | Gancho | Would you hand an AI your company card? |
| 2 | Motivo | A wallet in an agent's hands is a blank cheque. |
| 3 | A resposta | Give your agents a budget. Never the keys. |
| 4 | 01 Agentes que pagam | It pays on its own — and cannot promote itself. |
| 5 | 02 Regras que se sustentam | No one loosens their own limit. |
| 6 | 03 Prova | Proof anyone can check. |
| 7 | Demo | Three scenarios, one command, public devnet. |
| 8 | Por que agora | Agents already pay. What they lack is a budget. |
| 9 | Por que nós | A cap is one number. A budget is governance. |
| 10 | O que já existe | Built, tested, running on devnet. |
| 11 | Modelo | Open protocol. Paid operations. |
| 12 | Fases + próximo passo | 0.x today. Renounced at 1.0. Let's talk. |

Lacunas que **não** vão ao ar como TODO: números de tração do agente de referência (tela 10
mostra só o que é conferível: programa em devnet, 286 testes, console, MCP) e nomes/bios do time
(tela 12 cita "três pessoas, no Brasil" até cada um aprovar o próprio nome).

## Deck

- Tela cheia, uma ideia por tela. Seta/espaço/clique/deslizar avançam; `Home`/`End`; o hash
  `#3` abre direto na tela 3.
- Modo apresentação (`P`): autoplay com a duração de cada tela somando 3:00. Notas de fala (`N`).
- Estado puro em `src/lib/deck-model.ts` (próxima, anterior, limites, linha do tempo), com teste
  unitário. `prefers-reduced-motion` troca transições por corte seco.
- Sem Lenis nessas páginas (`Base` ganha `motion={false}`).

## Popup e boas-vindas (`/investidor`)

- Campos: nome, cargo/função, tipo (`investor` | `founder` | `other`), e-mail, consentimento
  (obrigatório, com link para a política). Turnstile invisível da Cloudflare.
- Sem enviar, o deck não aparece (o `/pitch` segue aberto para quem não quer se identificar).
- Boas-vindas: "Olá, Ana." + uma frase por tipo + a cena do teto com o rótulo do cofre trocado
  para o nome dela ("cofre da Ana"); ela arrasta o limite. Botão "Ver o pitch".
- Quem volta: `localStorage` guarda só `{ name, kind }` (nunca o e-mail) → "Olá de novo, Ana",
  sem popup. Leituras/escritas em `try/catch`; sem storage, o popup volta — nada quebra.

## Dados do lead

`POST /api/lead` (Pages Function em `functions/api/lead.ts`, lógica testável em
`src/lib/lead-handler.ts`):

1. Valida com o mesmo esquema do navegador (`src/lib/lead-schema.ts`): nome 1–80, cargo 1–80,
   tipo do enum, e-mail válido ≤ 254, consentimento `true`, idioma `en|pt`.
2. Confere o token do Turnstile (`TURNSTILE_SECRET`); sem token válido → 400.
3. Grava no D1 (`leads`), upsert por e-mail: `id`, `created_at`/`updated_at` (ISO 8601 UTC),
   `name`, `role`, `kind`, `email`, `lang`, `consent_at`, `listmonk_status`
   (`pending|sent`; falha de repasse continua `pending` e é reenviada). **Não guarda IP nem user-agent.**
4. Repassa ao Listmonk (`POST /api/subscribers`, lista double opt-in, status não confirmado,
   atributos `role`, `kind`, `lang`, `source`). Só se `LISTMONK_URL` estiver configurado. O
   Listmonk fica atrás de um hostname de túnel protegido por Cloudflare Access (service token),
   então a API não fica aberta à internet. Falhou → `pending`; cada lead novo tenta reenviar até
   5 pendentes; um script de reenvio manual fica para quando o Listmonk estiver ligado.
5. Resposta `{ ok: true }`. O navegador personaliza com o que a pessoa digitou.

## Privacidade (LGPD)

Política em EN/PT ganha a seção do formulário: que dados, para quê (falar sobre o Ash com quem
pediu), onde (Cloudflare D1; Listmonk na nossa VPS), quem acessa (só o time), retenção (até a
pessoa pedir para sair ou 24 meses sem contato), como sair (link de descadastro em todo e-mail;
pedido de exclusão responde a qualquer e-mail nosso). E-mail de marketing só depois da
confirmação (double opt-in). Análise das nove perguntas em `.aios/` antes de publicar.

## CVM (cautela, não parecer jurídico)

Página pública falando com investidor não pode parecer oferta: sem valores, percentuais,
condições ou prazos de rodada. O pedido é uma conversa. Validar com quem entende antes de
disparar o link em massa.

## SEO

As quatro rotas têm `noindex`, ficam fora do sitemap e fora do menu. São links enviados.

## Verificação

- Unit: paridade EN/PT do pitch; `deck-model`; `lead-schema`; `lead-handler` com D1 e fetch
  falsos (grava, upsert, Turnstile inválido, Listmonk fora → `pending`).
- e2e: `/pitch` navega por teclado; `/investidor` bloqueia sem consentimento, envia (API
  interceptada), mostra "Olá, <nome>", e as telas são idênticas às do `/pitch`; sem overflow no
  celular; `noindex` presente.

## Infra

D1 `ash-leads` + `wrangler.toml` (`pages_build_output_dir = "dist"`, binding `DB`), widget
Turnstile, secrets na Pages (`TURNSTILE_SECRET`, `LISTMONK_*`, `CF_ACCESS_*`). Listmonk: usuário
de API, lista double opt-in, hostname de túnel + Access. Sem `LISTMONK_URL`, o funil funciona só
com o D1.
