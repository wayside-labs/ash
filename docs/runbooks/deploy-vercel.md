# Runbook — o dashboard na Vercel

**Escopo:** `packages/dashboard` hospedado na Vercel, com a tenancy do ADR-017 ligada.

**Estado em 2026-09-24 — no ar.**

| | |
|---|---|
| URL de produção | <https://agent-rails-virid.vercel.app> |
| Projeto Vercel | `agent-rails`, escopo `0xcf02s-projects`, plano hobby |
| Região da função | `gru1` (São Paulo) |
| Projeto Supabase | ref `rjevwiebjrclgjaumdds`, org `0xcf02's Org`, região `sa-east-1` |

Os passos abaixo estão escritos para reprodução — recriar o ambiente do zero, ou levantar um segundo. O que já foi feito está marcado.

---

## 0. Leia isto antes de tudo: Supabase não é opcional aqui

Fora da Vercel o dashboard roda em modo JSON e grava em `~/.agent-rails/dashboard.json` (`store-json.ts`). **Esse modo não funciona em serverless.** O filesystem da função é somente-leitura fora de `/tmp`, e `/tmp` é por instância e efêmero. Um deploy sem Supabase sobe, serve as páginas, e perde qualquer escrita.

O gate é `isSupabaseConfigured()`, que só olha as variáveis públicas. Com elas presentes, `store.ts` despacha para o Postgres; sem elas, para o JSON.

---

## 1. Supabase ✅

```bash
npx supabase login                      # precisa de TTY — não funciona pelo agente
npx supabase orgs list
npx supabase projects create agent-rails --org-id <org> --region sa-east-1 --db-password "$PW"
cd packages/dashboard
npx supabase link --project-ref <ref>
SUPABASE_DB_PASSWORD=<senha> npx supabase db push
```

> **Nunca passe segredo em `argv` quando o runner for `npx`.** O `npm notice run` imprime a linha de comando **já expandida pelo shell**, então `--db-password "$(cat arquivo)"` vaza o valor no log. Use variável de ambiente (`SUPABASE_DB_PASSWORD`), que não aparece em `argv`. Isso já custou uma rotação de senha aqui.

A senha do banco vive em `~/.agent-rails/supabase-db-password` (`0600`), fora do repositório. Ela **não** é usada pela aplicação — só por `db push` e conexão direta. O app fala com o Supabase pela API, com as chaves.

Depois, no painel (a CLI não faz nenhum dos dois):

1. Authentication → Providers → **Google**, com client id/secret de um OAuth client do Google Cloud.
2. Authentication → URL Configuration → Redirect URLs: `https://agent-rails-virid.vercel.app/auth/callback`.
3. No **Google Cloud Console**, o *Authorized redirect URI* é o callback do **Supabase**: `https://rjevwiebjrclgjaumdds.supabase.co/auth/v1/callback`. Trocar os dois é o erro mais comum aqui.

---

## 2. Projeto Vercel ✅

Não precisa ligar no GitHub. `vercel deploy` sobe os arquivos do diretório local; a integração com o repositório é opcional e só serve para disparar deploy a cada push.

**Deploy sai da raiz do repositório, não de `packages/dashboard`.** A CLI sobe o diretório onde roda, e o build precisa do workspace inteiro: o pnpm resolve `workspace:*` contra o lockfile da raiz, e o `buildCommand` faz `cd ../..` para chegar lá.

```bash
cd <raiz do repo>
npx vercel link --project agent-rails --yes
```

Duas configurações que o `vercel.json` não consegue declarar e precisam ir por API:

```bash
# Root Directory — sem isso o build não encontra o Next
PATCH /v9/projects/{projectId}?teamId={orgId}   {"rootDirectory": "packages/dashboard"}

# Região da função (ver §4)
PATCH /v9/projects/{projectId}?teamId={orgId}   {"serverlessFunctionRegion": "gru1"}
```

O token da CLI está em `~/.local/share/com.vercel.cli/auth.json`.

### `.vercelignore` é obrigatório

Sem ele o upload tenta levar **12G** — `target/` sozinho é 11G de artefato Rust, e o `.next/` local é mais 453M. Com o arquivo, sobe 8.9M. O que está excluído é o que o build regenera ou nunca lê.

### `vercel.json`

| Campo | Por quê |
|---|---|
| `installCommand` | `cd ../..` pelo lockfile na raiz. **`--ignore-scripts`** porque o `prepare` da raiz roda `lefthook install`, que exige um repositório git — e o build da Vercel não tem `.git`. Sem a flag o install sai com 1. O pnpm já bloqueia script de dependência por padrão, então a flag só derruba esse `prepare`. |
| `buildCommand` | `turbo run build --filter=@agent-rails/dashboard` constrói `contract` → `client` → `sdk` → `dashboard` na ordem. `next build` sozinho falha: as deps `workspace:*` não estão compiladas. |
| `headers` | `X-Frame-Options: DENY` complementa o piso de CSRF do `assertSameOrigin`. Nem a aba Conta nem o Tesouro têm caso legítimo de embed. |

---

## 3. Variáveis, e o ovo-e-galinha do `ALLOWED_ORIGINS` ✅

```bash
printf '%s' "$VALOR" | npx vercel env add NOME production
```

O valor vai por **stdin**, não por `--value` — mesma razão do aviso em §1.

Uma exceção: variáveis `NEXT_PUBLIC_*` são recusadas por stdin sem `--type config --yes`, porque a CLI quer confirmação explícita de que o valor será exposto ao browser.

As quatro:

| Variável | Fonte |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave legada `anon` |
| `SUPABASE_SERVICE_ROLE_KEY` | chave legada `service_role` |
| `ALLOWED_ORIGINS` | a URL de produção (ver abaixo) |
| `ANTHROPIC_API_KEY` | opcional; sem ela o chat cai no modo demo |

`ALLOWED_ORIGINS` tem um problema de ordem. Em produção, `allowedOrigins()` devolve **apenas** o que a variável declara — os localhost de desenvolvimento são deliberadamente descartados quando `NODE_ENV === "production"`. Vazia, `assertSameOrigin` nega tudo com `forbidden: no allowed origin configured`. Só que a URL não existe antes do primeiro deploy:

```bash
npx vercel deploy --prod --yes                  # 1º deploy: escritas dão 403
npx vercel env add ALLOWED_ORIGINS production   # cole o domínio de produção
npx vercel deploy --prod --yes                  # 2º deploy: escritas passam
```

O domínio de produção **não** é a URL que o deploy imprime (aquela é por deploy). Pegue o canônico em `GET /v9/projects/{id}/domains` — aqui deu `agent-rails-virid.vercel.app`.

**Preview deploys:** cada um tem URL própria, que nunca estará em `ALLOWED_ORIGINS`. Previews sempre vão 403 nas escritas. Servem para conferir layout, não fluxo.

---

## 4. A região é configuração de projeto, não de `vercel.json`

No plano hobby, `"regions": ["gru1"]` no `vercel.json` é **ignorado** — o deploy sai com `regions: ['iad1']` sem avisar. Por isso a chave não está mais no arquivo: configuração que não faz nada engana quem lê depois.

O que funciona é `serverlessFunctionRegion` no projeto (§2). Confirme pelo header:

```
x-vercel-id: gru1::gru1::...
             ^edge ^compute
```

Se o segundo campo não for `gru1`, a função não está em São Paulo. Cuidado ao medir logo após um deploy: o alias leva alguns segundos para apontar, e até lá você lê o deploy anterior.

Isso importa porque o banco está em `sa-east-1`: função em `iad1` com banco em São Paulo põe um Atlântico em cada `readState`.

---

## 5. Conferir

```bash
U=https://agent-rails-virid.vercel.app
curl -s -o /dev/null -w "%{http_code}\n" $U                   # 200
curl -s $U/api/state                                          # {"error":"unauthorized"} 401
curl -s -X POST $U/api/chat -H "content-type: application/json" \
     -H "origin: $U" -H "sec-fetch-site: same-origin" -d '{"lixo":true}'   # 422, não 500
```

O terceiro é o que prova mais coisa de uma vez: um 422 ali significa que `getDashboardLocale()` caiu para o locale padrão em vez de estourar com o tenant ilegível (#46), **e** que `ALLOWED_ORIGINS` chegou em runtime — sem ela a resposta seria `forbidden: no allowed origin configured` antes de qualquer validação.

Que as chaves públicas foram inlinadas no bundle:

```bash
curl -s $U/_next/static/chunks/<chunk>.js | grep -q "<ref>" && echo ok
```

Depois, no navegador: aba Conta → Entrar com Google.

- `?error=supabase` → as variáveis públicas não chegaram ao build.
- `?error=auth` → a Redirect URL do Supabase não bate com `/auth/callback`.
- `?error=bootstrap` → autenticou, mas o provisionamento falhou. Quase sempre é a `SUPABASE_SERVICE_ROLE_KEY` ausente ou errada: o bootstrap insere sob service role porque a RLS bloqueia insert de sessão de usuário nessas tabelas de propósito.

---

## 6. Armadilhas conhecidas

**O aviso do turbo sobre env é falso positivo — para estas duas.** O build reclama que `SUPABASE_SERVICE_ROLE_KEY` e `ALLOWED_ORIGINS` estão no projeto mas ausentes de `turbo.json`, e que "WILL NOT be available". Elas são lidas em **runtime**, não em build, e a Vercel injeta variáveis de runtime na função independentemente do turbo — o teste do 422 em §5 prova que chegam. Declará-las em `turbo.json` as colocaria no hash de cache do build sem necessidade. As `NEXT_PUBLIC_*` não aparecem no aviso porque o turbo as repassa automaticamente para Next.

**`maxDuration = 120` na rota de chat, contra um plano hobby.** O build não reclamou, mas a Vercel também não confirma quando trunca. Ainda **não verificado** com um stream real de mais de 60s. Se o chat cortar no meio, é aqui.

**O provedor `claude-cli` nunca vai estar disponível.** `providers.ts` faz `execFile("claude", ["--version"])` e não há binário numa função Vercel; o probe sempre devolve `null`. Em produção a única via paga é a `ANTHROPIC_API_KEY`.

**O build do dashboard não é cacheado pelo turbo.** `turbo.json` declara `outputs: ["dist/**"]` e o Next escreve em `.next/**`; o próprio turbo avisa (`no output files found for task @agent-rails/dashboard#build`). Consertável com um override por pacote; ainda não feito.

**Segredos ficam no state.** `readState()` devolve chaves de API cruas; `maskState()` é o que as esconde nas respostas. A rota de export de runner-config é a única autorizada a emitir env inteiras. Qualquer campo novo exposto ao cliente precisa passar por `maskState`.

---

## 7. Rollback

```bash
npx vercel rollback           # volta para o deploy de produção anterior
npx vercel ls                 # histórico, para escolher um alvo específico
```

Rollback não desfaz migration do Supabase. Se o problema for de schema, o caminho é um SQL de reversão — não existe `down` nesta migration.
