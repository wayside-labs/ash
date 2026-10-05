# Deploy — ash.app.br na Cloudflare Pages

O site é estático (`dist/`). Vai para a Cloudflare Pages, na mesma conta onde a zona `ash.app.br`
já está. Nada roda na VPS compartilhada com o Ronaldo.

## Uma vez (Lucas, no painel e no terminal)

1. **Token da API, escopado.** Cloudflare → My Profile → API Tokens → Create Token → custom com
   `Account · Cloudflare Pages · Edit` e `Zone · DNS · Edit` só para `ash.app.br`. **Não**
   reaproveitar o token de conta inteira do `cursos`.
2. **Projeto Pages.** Já existe (`ash-web`, criado em 29/09 pela API). Se precisar recriar, use a
   API ou o painel, **nunca `wrangler pages project create` dentro do repo**: em 29/09 o wrangler
   4.143 detectou o Astro e, sem perguntar de forma visível, instalou `@astrojs/cloudflare`,
   reescreveu `astro.config.mjs`, `package.json`, `tsconfig.json` e `.gitignore` e criou
   `wrangler.jsonc`, mudando o build para o formato servidor (`dist/client` + `dist/server`), que a
   Pages serve como 404. Se isso acontecer de novo: `git checkout -- .` nesses arquivos, apagar
   `wrangler.jsonc` e `public/.assetsignore`, `pnpm install --frozen-lockfile`.
   ```bash
   curl -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
     "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects" \
     --data '{"name":"ash-web","production_branch":"main"}'
   ```
3. **Variáveis de build** (Pages → ash-web → Settings → Variables, produção e preview):
   `PUBLIC_BOOKING_URL` (link da agenda de 20 min) e `PUBLIC_CONTACT_EMAIL`. São embutidas no
   HTML no build, por isso são `PUBLIC_`. Nenhum segredo entra aqui.
4. **Domínio — feito em 2026-09-29.** `ash.app.br` e `www.ash.app.br` já são custom domains do
   projeto Pages `ash-web`. O que foi necessário, para quem repetir isso num projeto novo: o
   painel/API **não** cria o CNAME sozinho mesmo com a zona na mesma conta — ele fica em
   `pending` com "CNAME record not set" até você criar manualmente um `CNAME <domínio> →
   <projeto>.pages.dev`, proxied, para cada hostname. Antes disso é preciso apagar o registro
   antigo que ocupa o nome (aqui, o `A ash.app.br → 85.155.127.7` do cPanel e o `CNAME www`
   antigo). **Não tocar** em `MX`, `TXT` de SPF, `autodiscover`, `enterprise*`, `lyncdiscover`,
   `sip`, nos dois `SRV` (Microsoft 365) nem em `console.ash.app.br`/`console-api.ash.app.br`
   (túnel do Ronaldo). Backup do estado anterior ao cutover:
   `agenttokenfy/.aios/secrets/ash-dns-backup-2026-09-29-pre-pages.json`.
5. **GitHub Actions.** No repo `lglucas/ash-web` → Settings → Secrets and variables → Actions:
   secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`; variables `PUBLIC_BOOKING_URL` e
   `PUBLIC_CONTACT_EMAIL`.

## O workflow (`.github/workflows/deploy.yml`)

Instala, roda `pnpm test`, faz o build com as variáveis e publica com `wrangler pages deploy`.

| Evento | Fonte do blog (`BLOG_SOURCE`) | Publica? |
|---|---|---|
| `pull_request` | `fixture` (o blog de exemplo do repositório) | nunca |
| `push` na `main` | `api` se a variável `BLOG_API_URL` existir; senão `off` | sim, com o token |
| `repository_dispatch` (`studio-publish`, enviado pelo studio ao publicar) | idem | sim, com o token |
| `workflow_dispatch` (botão "Run workflow") | idem | sim, se rodar a partir da `main` |

- **Sem a variável `BLOG_API_URL` o modo é `off`**: o site sai exatamente como antes do blog. Foi
  de propósito — com `api` fixo, todo push na `main` falharia até a variável existir.
- Com `api`, o studio fora do ar **derruba o build** (melhor não publicar que publicar o blog
  vazio). O site que já está no ar não muda.
- Um deploy por vez: o que está em andamento termina, e só o mais novo fica na fila. Pull request
  tem fila própria e não espera deploy; uma execução manual em outra branch (que não publica)
  também, para não tirar da fila um pedido do studio.
- O `repository_dispatch` só dispara o workflow que está na **branch padrão**.
- Os testes e2e (Playwright) **não rodam no CI**; rodam à mão (`README.md`).

**Hoje a publicação automática está desligada:** o passo de deploy só roda quando o secret
`CLOUDFLARE_API_TOKEN` existe, e ele ainda não foi criado (falta um token restrito ao Pages — ver
`docs/ROADMAP.md`, dívidas). Até lá o push na `main` testa e builda, e o deploy é à mão.

## Ligar o blog

O código está pronto; o blog só aparece em `ash.app.br` depois destes passos, **nesta ordem**:

1. **Studio no ar com o M1** (`bash studio/deploy/deploy.sh`) e pelo menos um post publicado.
   Conferir que `https://pub.ash.app.br/api/public/posts` responde 200 com o post.
2. **Este branch na `main`.** O `repository_dispatch` só enxerga o workflow da branch padrão.
3. **Token da Cloudflare restrito ao Pages** nos secrets do GitHub (`CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`). Sem ele o workflow builda e não publica.
4. **Variável `BLOG_API_URL`** no GitHub (Settings → Secrets and variables → Actions →
   Variables): `https://pub.ash.app.br/api/public/posts`. É ela que liga o modo `api`. Rodar o
   workflow à mão ("Run workflow") e conferir `/blog/` no ar.
5. **Por último, `GITHUB_DISPATCH_TOKEN` na VPS** (o token com que o studio pede o rebuild). Antes
   dos passos 2 a 4 o GitHub responde 204, nada é construído e o health do studio fica verde: o
   token ligado cedo demais esconde que nada acontece.

Para desligar: apagar a variável `BLOG_API_URL` e rodar o workflow. O próximo deploy sai sem blog.

**Risco que não deu para testar: a Cloudflare barrar o runner do GitHub.** O build busca
`pub.ash.app.br` de um IP de datacenter, e a proteção contra robôs da zona pode responder com um
desafio (uma página HTML) em vez do JSON. Sintoma no log do build: `blog api: the body is not
JSON`, ou `blog api: answered 403` (ou 503). Não é o studio fora do ar: abrir a mesma URL no
navegador funciona. O que fazer, do mais restrito ao mais largo: uma regra de WAF que pule o
desafio (Skip) só para `pub.ash.app.br` e os caminhos `/api/public/posts` e `/media/*`; ou liberar
os robôs verificados/o ASN do GitHub nessa regra. As imagens passam pelo mesmo caminho (`/media/`):
se o JSON vier e uma imagem não, o erro é `blog media: <caminho>: answered 403`. Não criar regra de
cache em `/api/public/` (o studio já responde com ETag).

**Para quando o site tiver CSP** (hoje não tem): a busca precisa de `'wasm-unsafe-eval'` em
`script-src` (o Pagefind roda em WebAssembly) e de hash para os dois scripts embutidos na página
do índice — o importador de uma linha (`window.ashImport`) e o módulo da caixa de busca; o
JSON-LD dos posts também é um `<script>` embutido.

**Com posts em um idioma só**, o outro idioma ganha um índice vazio (`noindex`, fora do sitemap),
sem feed e sem link "Blog" no cabeçalho; aparece inteiro quando o primeiro post dele for publicado.

**Build local com o blog de exemplo:**

```bash
BLOG_SOURCE=fixture pnpm build     # 17 posts de exemplo, imagens de tests/fixtures/blog-media
pnpm test:e2e                      # os testes do blog pedem esse build
```

**Esse `dist/` não pode ser publicado**: tem os posts de exemplo, inclusive os de teste de
escape. `pnpm run deploy` refaz o build e **recusa rodar com `BLOG_SOURCE=fixture`** no ambiente
(`scripts/check-deploy.mjs`, o primeiro passo do script); sem `BLOG_SOURCE`, sai sem blog. A
recusa não cobre um `wrangler pages deploy dist` chamado direto: não publique o `dist/` à mão. Para um
deploy à mão **com** o blog de verdade:
`BLOG_SOURCE=api BLOG_API_URL=https://pub.ash.app.br/api/public/posts PUBLIC_… CI=true pnpm run deploy`.

O que o build do blog escreve além das páginas: `dist/blog-media/` (as imagens do studio e um
JPEG 1200×630 de cada capa, para o `og:image`) e `dist/pagefind/` (o índice da busca: 27 arquivos,
cerca de 312 KB com a fixture — o `du` no Windows mostra 1,1 MB porque conta blocos de disco). A
página só pede esses arquivos quando alguém usa a busca; a primeira busca custa 7 pedidos e cerca
de 164 KB sem compressão (medido na revisão de 02/10), e quem não busca não paga nada. Avisos
do build que não o derrubam aparecem com o prefixo `[blog]`: duas grafias de tag na mesma página,
bloco de contato sem canal configurado, bloco de newsletter (não desenha nada até o M3).

## À mão, do PC

```bash
cp .env.example .env   # preencher as duas variáveis (vazias = sem botão de agenda e sem e-mail)
CI=true pnpm run deploy   # build + wrangler pages deploy dist --project-name ash-web
```

`pnpm deploy` sem `run` é um comando nativo do pnpm (só para workspaces) e falha com
`ERR_PNPM_CANNOT_DEPLOY`. O build lê o `.env` local: um valor de exemplo ali (o
`cal.com/exemplo/20min` de 29/09) vai direto para todos os botões do site no ar. Enquanto não
houver agenda real, deixe as variáveis vazias no `.env` ou passe `PUBLIC_BOOKING_URL=
PUBLIC_CONTACT_EMAIL=` na frente do comando. `CI=true` mantém o wrangler não interativo. O token vem de `CLOUDFLARE_API_TOKEN` no ambiente
(em 29/09 foi usado o token de conta guardado fora do repo; trocar por um escopado a Pages assim
que possível). Primeiro deploy: 2026-09-29, `https://ash-web.pages.dev`, com as duas variáveis
vazias de propósito até existirem o link da agenda e o e-mail.

**Prévia antes da produção.** O branch que o `wrangler` recebe decide o destino: qualquer nome que
não seja `main` gera uma prévia em `https://<nome>.ash-web.pages.dev`; `main` publica em
`ash.app.br`. Fora da `main` do git, `pnpm run deploy` gera prévia; para produção, o deploy é em
dois passos, com o branch explícito:

```bash
node scripts/check-deploy.mjs && pnpm build
pnpm exec wrangler pages deploy dist --project-name ash-web --branch feat/design-v2   # prévia
pnpm exec wrangler pages deploy dist --project-name ash-web --branch main             # produção
```

Conferir a linha `Result (N files): 0 errors` do build (sem ela, o `astro check` foi pulado — ver
"pnpm no Windows"). Depois de mudar o título do topo, `node scripts/og.mjs` refaz o `og.png`.

**Desde 2026-10-02 a produção sai do branch `feat/design-v2`, não do `main`**, até o PR #1 ser
mergeado. Um deploy feito a partir do `main` antes disso devolve o site à versão antiga.

## pnpm no Windows: duas manhas

- `.npmrc` tem `node-linker=hoisted` porque o linker padrão falha ao renomear pastas dentro de
  `@astrojs/check` no drive F:.
- `@astrojs/check` precisa de `@napi-rs/wasm-runtime` (via `astro2tsx`), que o pnpm marca como
  opcional pulado e **não instala nem como dependência direta**, nem com reinstalação limpa. Só
  entra com `pnpm add -D @napi-rs/wasm-runtime@1.2.4 --force`. Sem ele, `astro check` imprime um
  erro e sai com código 0, ou seja, o build passa **sem checar tipos**. Se `pnpm exec astro check`
  não mostrar `Result (N files)`, é isso.
- **Qualquer `pnpm add` tira o `@napi-rs/wasm-runtime` de novo** (aconteceu em 02/10 ao adicionar
  `sharp` e `pagefind`: o `astro check` passou a pedir, em modo interativo, para instalar
  `@astrojs/check`, e o `pnpm build` seguia sem checar tipos). Volta com
  `pnpm install --force --frozen-lockfile`, que não mexe no lockfile. No CI (Linux) isso não
  acontece.

## Funil do /investidor (leads)

Spec: `docs/plans/2026-09-30-pitch-investidor.md`. Peças que já existem (30/09):

- D1 `ash-leads` (id no `wrangler.toml`, região ENAM), tabela `leads` da `migrations/0001_leads.sql`.
  Migração nova: `wrangler d1 migrations apply ash-leads --remote`.
- Widget Turnstile `ash-investor` (domínios ash.app.br, www, ash-web.pages.dev). Site key é
  pública e entra no build como `PUBLIC_TURNSTILE_SITEKEY`; a secreta está em
  `agenttokenfy/.aios/secrets/turnstile.env`, fora de qualquer repo.

**A coleta está desligada de propósito.** Sem `TURNSTILE_SECRET` na Pages, `POST /api/lead`
responde 503 e nada é gravado. A análise de privacidade
(`agenttokenfy/.aios/research/2026-09-30-privacy-investidor.md`) só libera a coleta depois de:

1. controlador e canal de contato definidos (entram na política de privacidade);
2. Listmonk ligado com lista double opt-in, ou e-mail de contato publicado.

Para ligar, nessa ordem:

```bash
# Listmonk (VPS): criar usuário de API e lista double opt-in; publicar a API atrás de um
# hostname de túnel com Cloudflare Access (service token). Depois:
wrangler pages secret put LISTMONK_URL --project-name ash-web      # https://<hostname do túnel>
wrangler pages secret put LISTMONK_USER --project-name ash-web
wrangler pages secret put LISTMONK_TOKEN --project-name ash-web
wrangler pages secret put LISTMONK_LIST_ID --project-name ash-web
wrangler pages secret put CF_ACCESS_CLIENT_ID --project-name ash-web
wrangler pages secret put CF_ACCESS_CLIENT_SECRET --project-name ash-web
# Por último, o que abre a porta:
wrangler pages secret put TURNSTILE_SECRET --project-name ash-web
```

Deploy sempre com a site key: `PUBLIC_TURNSTILE_SITEKEY=<site key> PUBLIC_BOOKING_URL=
PUBLIC_CONTACT_EMAIL= CI=true pnpm run deploy`. Sem ela o widget não carrega e todo envio vira
400 (`captcha`).

Pedido de exclusão: apagar o assinante no Listmonk e
`wrangler d1 execute ash-leads --remote --command "DELETE FROM leads WHERE email = 'x@y.z'"`.
Retenção de 24 meses sem contato: limpeza manual por trimestre até existir script.

## Rollback

Pages guarda cada deploy. Pages → ash-web → Deployments → escolher o anterior → "Rollback to
this deployment". Leva segundos e não precisa de build.

## Depois do primeiro deploy

- Abrir `https://ash.app.br/`, `/pt/`, `/privacy/`, `/sitemap-index.xml` e `/og.png`.
- Conferir o cartão de compartilhamento num validador de Open Graph.
- Cancelar a hospedagem cPanel antiga quando o DNS estiver virado há uma semana.
