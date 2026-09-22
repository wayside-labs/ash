# Runbook — colocar o dashboard no ar na Vercel

**Escopo:** `packages/dashboard` em hospedagem Vercel, com a tenancy do ADR-017 ligada.
**Estado em 2026-09-22:** nenhum projeto Vercel existe ainda. `gh api repos/:owner/:repo/deployments` devolve `0`, não há webhook de deploy, não há `.vercel/` no repositório. A única menção a Vercel na árvore é o placeholder de `ALLOWED_ORIGINS` no `.env.example`.

---

## 0. Leia isto antes de tudo: Supabase não é opcional aqui

Fora da Vercel o dashboard roda em modo JSON e grava em `~/.agent-rails/dashboard.json` (`store-json.ts`). **Esse modo não funciona em serverless.** O filesystem da função é somente-leitura fora de `/tmp`, e `/tmp` é por instância e efêmero — cada invocação pode cair numa instância diferente. Um deploy sem Supabase configurado sobe, serve as páginas, e perde qualquer escrita.

Ou seja: a ordem é **Supabase primeiro, Vercel depois**. Não há atalho útil.

O gate é `isSupabaseConfigured()`, que só olha as variáveis públicas. Com elas presentes, `store.ts` despacha para o Postgres; sem elas, para o JSON.

---

## 1. Supabase

1. Criar o projeto em <https://supabase.com/dashboard>. A região deve ser a mais próxima da região da função Vercel — cada leitura de state é uma ida ao Postgres, e essa latência entra em toda página.
2. Aplicar `packages/dashboard/supabase/migrations/20260921000000_tenancy.sql`. Pelo SQL Editor do painel, ou `supabase db push` se você linkar a CLI.
3. Ligar o provedor **Google** em Authentication → Providers, com o client id/secret de um OAuth client do Google Cloud.
4. Em Authentication → URL Configuration:
   - **Site URL:** a URL de produção da Vercel (você só vai saber no passo 3 — volte aqui).
   - **Redirect URLs:** `https://<dominio>/auth/callback`. Sem isso o `exchangeCodeForSession` falha e o usuário cai em `/account?error=auth`.
5. No Google Cloud Console, o *Authorized redirect URI* do OAuth client é o **callback do Supabase** (`https://<ref>.supabase.co/auth/v1/callback`), não o da Vercel. Trocar os dois é o erro mais comum aqui.

Anote da aba Settings → API: a URL do projeto, a chave pública (`anon`/`publishable`) e a **service role key**.

---

## 2. Projeto Vercel

Não precisa ligar no GitHub. `vercel deploy` sobe os arquivos do diretório local direto para a Vercel; a integração com o repositório é um recurso separado e opcional, que só serve para disparar deploy a cada push. Dá para operar 100% pela CLI.

A CLI já está autenticada nesta máquina como `0xcf02` (plano **hobby**, escopo pessoal `0xcf02s-projects`). Confirme com `npx vercel whoami`.

```bash
cd packages/dashboard
npx vercel link --yes          # cria/associa o projeto; escreve packages/dashboard/.vercel (gitignorado)
```

O `vercel.json` ao lado deste diretório já declara o que o monorepo exige:

| Campo | Por quê |
|---|---|
| `installCommand` | `cd ../..` porque o lockfile e o workspace pnpm vivem na raiz, não em `packages/dashboard`. |
| `buildCommand` | `turbo run build --filter=@agent-rails/dashboard` constrói `contract` → `client` → `sdk` → `dashboard` na ordem. `next build` sozinho falha: as deps `workspace:*` não estão compiladas. |
| `headers` | `X-Frame-Options: DENY` complementa o piso de CSRF do `assertSameOrigin` — a aba Conta e o Tesouro não têm caso legítimo de embed. |

No painel do projeto, **Root Directory = `packages/dashboard`** e "Include files outside of the Root Directory" ligado. Sem isso o build não enxerga a raiz do workspace.

---

## 3. Variáveis, e o ovo-e-galinha do `ALLOWED_ORIGINS`

```bash
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel env add ANTHROPIC_API_KEY production      # opcional; sem ela o chat cai no modo demo
```

`ALLOWED_ORIGINS` tem um problema de ordem. Em produção, `allowedOrigins()` devolve **apenas** o que a variável declara — os localhost de desenvolvimento são deliberadamente descartados quando `NODE_ENV === "production"`. E se a lista ficar vazia, `assertSameOrigin` nega tudo com `forbidden: no allowed origin configured`: toda rota mutante devolve 403.

Só que a URL de produção você não conhece antes do primeiro deploy. Então:

```bash
npx vercel deploy --prod --yes          # 1º deploy: páginas sobem, escritas dão 403
npx vercel env add ALLOWED_ORIGINS production   # cole https://<url-que-saiu-acima>
npx vercel deploy --prod --yes          # 2º deploy: escritas passam
```

O 403 do primeiro deploy é esperado, não é bug.

**Preview deploys:** cada um ganha uma URL própria (`<projeto>-<hash>.vercel.app`), que nunca vai estar em `ALLOWED_ORIGINS`. Previews sempre vão 403 nas escritas, a menos que você declare a variável também no ambiente `preview` com a URL daquele deploy — o que na prática significa que preview serve para conferir layout, não fluxo.

---

## 4. Conferir

1. Abrir a URL. As páginas renderizam mesmo deslogado.
2. Aba Conta → **Entrar com Google**. Deve voltar para `/account` com o e-mail preenchido.
   - `?error=supabase` → as variáveis públicas não chegaram ao build.
   - `?error=auth` → a Redirect URL do Supabase não bate com `/auth/callback`.
   - `?error=bootstrap` → autenticou, mas o provisionamento falhou. Quase sempre é a `SUPABASE_SERVICE_ROLE_KEY` ausente ou errada: o bootstrap insere sob service role porque a RLS bloqueia insert de sessão de usuário nessas tabelas de propósito.
3. Criar um workflow e recarregar. Se sumiu, o state não está no Postgres — reveja o passo 0.
4. `select * from workflows` no SQL Editor deve mostrar a linha com o `org_id` da sua conta.

---

## 5. Armadilhas conhecidas desta base

**`maxDuration = 120` na rota de chat vs. plano hobby.** `src/app/api/chat/route.ts` declara 120 segundos. O teto do hobby é menor que isso (historicamente 60s). Confira a saída do primeiro build: se a Vercel reclamar ou truncar, baixe o valor na rota ou suba o plano. Não deixe para descobrir com um stream cortado no meio.

**O provedor `claude-cli` nunca vai estar disponível.** `providers.ts` faz `execFile("claude", ["--version"])`. Não existe binário `claude` numa função Vercel, então o probe sempre devolve `null` e o chat cai para `anthropic-api` (se houver chave) ou `demo`. Isso é correto, mas significa que em produção **a única via paga é a `ANTHROPIC_API_KEY`**.

**O build do dashboard não é cacheado pelo turbo.** `turbo.json` declara `outputs: ["dist/**"]` para a task `build`, e o Next escreve em `.next/**`. Toda build roda do zero — e o turbo avisa isso em texto (`no output files found for task @agent-rails/dashboard#build`). Consertável com um override por pacote; ainda não feito.

**Segredos ficam no state.** `readState()` devolve chaves de API cruas; `maskState()` é o que as esconde nas respostas. A rota de export de runner-config é a única autorizada a emitir env inteiras. Qualquer campo novo exposto ao cliente precisa passar por `maskState`.

---

## 6. Rollback

```bash
npx vercel rollback           # volta para o deploy de produção anterior
npx vercel ls                 # histórico, para escolher um alvo específico
```

Rollback não desfaz migration do Supabase. Se o problema for de schema, o caminho é um SQL de reversão — não existe `down` nesta migration.
