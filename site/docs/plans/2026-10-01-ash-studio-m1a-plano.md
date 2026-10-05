# ash-studio M1a — motor do blog: plano de porte

> **Para agentes:** SUB-SKILL: superpowers:subagent-driven-development. Este é um plano de **porte**:
> a fonte é código existente e testado; cada tarefa diz o que copiar, o que adaptar e o que testar.
> TDD: teste primeiro, ver falhar, implementar. Commits por tarefa.

**Objetivo:** o studio guarda, valida, transiciona, agenda e publica posts; serve imagens e uma API
pública que o site lê no build. Sem telas ainda (M1b) e sem páginas no site (M1c).

**Fontes** (somente leitura): `B` = `F:\AceleradoraECO\boringco\boringco` (código do Lucas),
`C` = `F:\AceleradoraECO\criptosul` (MIT, do Lucas). **Destino:** `S` = `studio/` deste repo.
**Desenho:** `2026-09-30-ash-studio-desenho.md`. **Base:** M0 (fila, worker, auditoria, `expectOne`).

## Decisões travadas (valem para M1a–M1c)

1. **Estados M1:** `rascunho`, `revisao`, `aprovado`, `publicado`, `rejeitado`. Os de IA entram no M2
   por migração. Máquina (escrita, não portada — no boringco post manual não tinha saída do rascunho):
   `submit` rascunho→revisao · `approve` revisao→aprovado (corpo não vazio) · `reject`
   revisao→rejeitado (feedback obrigatório) · `reopen` rejeitado→rascunho · `schedule`
   aprovado→aprovado (`scheduled_for`) · `publish` aprovado→publicado · `unpublish`
   publicado→aprovado **limpando `scheduled_for`** (lá, despublicar um agendado republicava sozinho).
2. **`published_at` é a data da primeira publicação:** `publish` grava `coalesce(published_at, now)`;
   `unpublish` não apaga. Data e URL estáveis.
3. **Idioma:** `lang` (`pt`|`en`) por post; traduções compartilham `translation_group` (uuid);
   únicos `(lang, slug)` e `(translation_group, lang)`.
4. **Autores numa tabela** (`blog_authors`: slug, nome, bio pt/en, avatar), não num array no código;
   o post guarda `author_id`.
5. **Sanitizador e sumário do criptosul** (`sanitizar.ts`, `sumario.ts` + testes), não os do boringco:
   297 linhas de testes de ataque contra 10 casos. Regra nova: **`img src` só `/media/…`** (imagem
   de fora seria pedido a terceiro — contradiz "sem analytics"). Sanitiza ao salvar **e** ao servir.
6. **Imagens:** upload por route handler do painel (`POST /api/admin/upload`, multipart — server
   action tem teto de 1 MB), `sharp` (`rotate` → largura ≤ 1600 → WebP), disco em
   `UPLOADS_DIR/posts/<postId>/<uuid>.webp`, caminho guardado **relativo** (`/media/posts/…`).
   `sharp` só no app, nunca no worker (o bundle do esbuild não leva módulo nativo).
7. **Shortcodes:** catálogo `cta:pitch`, `cta:newsletter`, `cta:contato`, `mapa`; só em nível de
   bloco; sem `print:`. Teste de ida e volta pelo schema real do TipTap entra no M1b.
8. **API pública:** um JSON em `GET /api/public/posts` com todos os publicados (pt e en), corpo
   re-sanitizado e com ids de título, itens do sumário, minutos de leitura, categoria, tags, autor,
   capa, `translationSlug`, `featured`; mais categorias e autores. `cache-control: public, max-age=60`.
9. **Publicação agendada:** passo `publishDue` rodado a cada ciclo do worker (um UPDATE condicional
   com RETURNING, auditoria, e enfileira o rebuild). Não é job de fila.
10. **Rebuild do site:** job `site-rebuild` com `dedupeKey` e atraso de 60 s (junta rajadas); o
    handler chama `repository_dispatch` no GitHub se `GITHUB_DISPATCH_TOKEN` existir; sem token,
    registra na auditoria `site.rebuild_skipped` e conclui. **Desligado até o Lucas liberar os tokens.**
11. **Núcleo separado de action:** `src/blog/*.ts` recebe `db: Db` (testável com `freshDb()`);
    `src/blog/actions/*.ts` (`"use server"`) só faz `requireAdmin()` + `db()` + chama o núcleo. Todo
    export de arquivo `"use server"` chama `requireAdmin()`; leitura pública mora em módulo comum.
12. **Sem** busca por tsvector (Pagefind no site), **sem** "mais lidos" (vira `featured`), **sem**
    cookies de atribuição.

## Mapa de arquivos

| Destino em `S/` | Fonte | Veredito e adaptações |
|---|---|---|
| `src/db/schema.ts` + `drizzle/0002_*.sql` | `B/supabase/migrations/0055`, `0057` | Reescrever: `blogCategories` (slug com o CHECK original, `name_pt`, `name_en`), `blogAuthors`, `blogPosts` (CHECK de slug original; `lang`; `translation_group`; `featured`; `author_id`; `cover_url`/`cover_alt`; `feedback`; `meta_*`; `scheduled_for`; `published_at`; `created_by`/`updated_by`). Índices `(status, published_at desc)`, `category_id`, GIN em `tags`. Sem `search`, `campaign_id`, `keywords`, RLS |
| `src/blog/lib/post-slug.ts` (+teste) | `B/.../lib/post-slug.ts` | Copiar; faixa de acentos como `\u0300-\u036f`; resultado com menos de 2 caracteres vira `post` (o CHECK exige ≥ 2) |
| `src/blog/lib/sanitize.ts` (+teste) | `C/src/features/blog/sanitizar.ts`, `C/tests/sanitizar.test.ts` | Copiar + regra do `img src`; tirar o caso de CSP do teste |
| `src/blog/lib/toc.ts` (+teste) | `C/.../sumario.ts`, `C/tests/sumario.test.ts` | Adaptar o import do slug para `postSlug` |
| `src/blog/lib/shortcodes.ts` (+teste) | `B/.../lib/shortcodes.ts` | Catálogo novo; sem `print:`; `validateShortcodes` também recusa shortcode dentro de `<p>` |
| `src/blog/lib/shortcode-html.ts` (+teste) | `B/.../lib/shortcode-html.ts` | Rótulos novos; `EDITOR_RE` tolera texto dentro do span; caso de teste com rótulo |
| `src/blog/lib/reading-time.ts` (+teste) | `B` | Copiar |
| `src/blog/lib/image-rules.ts` (+teste) | `B/.../lib/image-upload-rules.ts` | Saída sempre `.webp`; o tipo real vem do `sharp`, não do `file.type` |
| `src/blog/lib/local-time.ts` (+teste) | novo | `datetime-local` ↔ ISO num fuso IANA (padrão `America/Sao_Paulo`); `DATE` nunca passa por `new Date()` |
| `src/blog/schemas.ts` (+teste) | `B/.../schemas.ts` | `UpsertPost`, `UpsertCategory`, `UpsertAuthor`, `SetPostStatus`, `RejectPost`; limites originais (título 8–160, resumo ≤ 400, até 12 tags de ≤ 40, meta_title ≤ 70, meta_description ≤ 170, cover_alt ≤ 160, agenda ≤ 12 meses); `cover_url` = caminho `/media/…`; zod 4 (`z.uuid()`, `z.iso.datetime()`) |
| `src/blog/posts.ts` (+ `tests/blog-posts.test.ts`) | `B/.../server/manage-post.ts`, `unique-slug.ts` | `createPost`, `updatePost` (`expectOne`; enfileira rebuild se publicado), `getPost`, `listPosts` (sem corpo), `createTranslation`; slug único por idioma numa consulta + captura de 23505 |
| `src/blog/status.ts` (+ `tests/blog-status.test.ts`) | `B/.../server/set-post-status.ts`, parte manual de `review-post.ts` | Máquina da decisão 1; UPDATE condicional + `logAudit` na mesma transação; `LostTransitionError` quando o estado não é o esperado |
| `src/blog/categories.ts`, `authors.ts` (+ testes) | `B/.../server/categories.ts`, `types.ts` | Contagem agrupada numa consulta; `onConflictDoUpdate` por slug |
| `src/blog/upload.ts` + `src/app/api/admin/upload/route.ts` (+ teste) | `B/.../server/upload-post-image.ts` | Reescrever (decisão 6); auditoria `blog.image_uploaded` |
| `src/app/media/[...path]/route.ts` (+ teste) | novo | Serve `UPLOADS_DIR`; recusa `..`, `%2F`, barra invertida e caminho absoluto depois de decodificar; resolve sob a raiz; `immutable` |
| `src/blog/public.ts` + `src/app/api/public/posts/route.ts` (+ teste) | `B/.../server/public-posts.ts` | Reescrever menor (decisão 8); sempre `status = 'publicado'` |
| `src/blog/publish-due.ts` + `src/worker/cycle.ts` (`ticks`) (+ teste) | `B/.../server/publish-due.ts` | Decisão 9; teste: agendado vence → publicado; despublicado depois não volta |
| `src/blog/rebuild.ts` + `src/worker/handlers.ts` (+ teste com `fetch` injetado) | novo | Decisão 10 |
| `src/lib/env.ts` (+teste) | — | `UPLOADS_DIR` (padrão `uploads`), `PUBLISH_TZ`, `GITHUB_DISPATCH_TOKEN?`, `GITHUB_DISPATCH_REPO` (padrão `lglucas/ash-web`) |

Testes de integração a trazer e reescrever sobre `describeDb`/`freshDb()`:
`B/tests/integration/blog-set-post-status.test.ts`, `blog-cover-rascunho.test.ts`. Casos novos
obrigatórios: caminho inteiro rascunho → publicado; despublicar depois do worker não republica;
update de id inexistente falha; unicidade `(lang, slug)`; transição com estado errado não muda nada.

## Lotes

- **Lote 1 — schema e bibliotecas puras:** dependências (`sanitize-html`, `@types/sanitize-html`,
  `sharp`), schema + migração 0002 (ler o SQL gerado), todos os `lib/*`, `schemas.ts`.
- **Lote 2 — núcleos e actions:** posts, estados, categorias, autores, com os testes de integração.
- **Lote 3 — bordas:** upload, `/media`, API pública, `publishDue` no ciclo, `site-rebuild`, env.
  Depois: deploy, prova de que o `sharp` roda na imagem alpine (upload real), backup cobrindo as
  tabelas novas (o `restore-test.sh` passa a contar `blog_posts`).

## Minas conhecidas

- `Date` em SQL cru com postgres-js: usar o `iso()` + `::timestamptz` de `jobs/queue.ts`.
- Linhas do Drizzle vêm em camelCase e com `Date`; nada de copiar acesso `snake_case` do boringco.
- `sanitize-html` e `sharp` só em Node: nunca em `proxy.ts` nem em componente cliente.
- Marca e domínio do boringco a não trazer: `supersecretaria.online`, "Super Secretária", `/gratis`,
  `/parceira`, `/blog/prints/`, cookies `ea_ref`/`ea_aff`, emoji em texto de interface.
- Nenhuma rota de admin sob prefixo público (`/api/public/`, `/newsletter/`, `/descadastro`, `/media/`).

## Desvios na implementação

O que foi construído diferente do que as decisões acima dizem, e por quê. As decisões ficam como
foram escritas; vale o que está aqui e no `studio/README.md`.

- **Decisão 8 (API pública).** O `cache-control` ganhou `s-maxage=60`. A resposta tem `ETag` forte
  e responde `304` a `If-None-Match`. O JSON é montado uma vez e guardado em memória; só é refeito
  quando muda uma impressão digital barata do que é público (posts publicados: id, `updated_at` e
  `xmin`; categorias e autores usados por eles), e essa impressão vale por 2 s. Sem isso, cada
  pedido a uma URL pública re-sanitizava todos os corpos. As listas de categorias e autores trazem
  só os que algum post publicado usa, não todos: o resto ainda não é público. `coverUrl` e
  `avatarUrl` que não sejam `/media/...` saem como `null`.
- **Decisão 9 (publicação agendada).** Não é um UPDATE só. É um `SELECT ... FOR UPDATE` dos
  vencidos (em ordem de id, com `statement_timeout` de 5 s), o `hasBodyContent` aplicado em código,
  e um UPDATE condicional só dos que têm corpo, tudo na mesma transação. Post vencido com corpo
  vazio (inclusive `<p></p>`) não é publicado: fica aprovado e o worker avisa a cada ciclo.
- **Decisão 10 (rebuild do site).** A chave de dedupe não é fixa: leva o minuto do `run_after`
  (`site-rebuild:<minuto>`), porque com chave fixa uma publicação feita enquanto um rebuild rodava
  não enfileirava nada e nunca era construída. O job tem 10 tentativas (cerca de 3 h de GitHub fora
  do ar) em vez de 3. Um disparo que dá certo dá baixa nos outros pedidos já vencidos (`absorbDue`).
  Um rebuild que morreu é reenfileirado pelo worker (`requeueLostRebuild`). O token do GitHub fica
  só no worker; o app recebe a bandeira `SITE_REBUILD`.
- **Health.** `/api/health` também fica vermelho com erro no último ciclo do worker e com job morto
  nas últimas 24 h, e mostra `rebuild: on/off`. `?probe=live` devolve o mesmo corpo com o status de
  antes (banco, batimento, e-mail); é o que o container e o `deploy.sh` consultam.
- **Corpo do post.** Teto de 300 000 caracteres, medido na entrada e de novo depois de sanitizado
  (`MAX_BODY_HTML_LENGTH`); acima disso o salvamento é recusado, não truncado.
- **Decisão 5 (sanitizador), regra de `href`.** Além da lista de esquemas, o link só fica se for
  `https://`, `http://`, `mailto:`, âncora (`#`) ou caminho a partir da raiz, e sem barra invertida
  nem caractere de controle (`isSafeHref`): o `sanitize-html` sozinho deixava passar um caminho que
  começa por barra e barra invertida, que o navegador lê como endereço de outro host. O link
  recusado perde o `href`, o texto fica.
- **Decisão 4 (autores).** A FK `author_id` é `ON DELETE RESTRICT` (a da categoria é `SET NULL`):
  autor com post não pode ser apagado, e o erro chega ao admin como mensagem.
- **Decisão 6 (imagens).** Além do que está lá: teto de 50 megapixels, recusa de pedido de outra
  origem (`refuseCrossSite`) e corpo limitado a 6 MB no proxy. No M1a o `post_id` era opcional (sem
  ele a imagem ia para `posts/novo/`); o M1b o tornou obrigatório, porque o post passa a nascer
  antes do editor: sem `post_id`, ou com um que não é uuid, a resposta é `400`, e a pasta
  `posts/novo/` não recebe mais nada.
- **Decisão 11 (núcleo e action).** As actions devolvem `{ ok, data }` ou `{ ok: false, error }`
  (`toResult`), porque em produção o Next troca a mensagem de um erro lançado por uma genérica.

Ficou para o M1b, de propósito: ação de tirar o agendamento, auditoria de edições e de categorias
e autores, limpeza das imagens órfãs de `posts/novo/`, e a tela que usa o `PUBLISH_TZ`.

Feito no lote 1 do M1b (motor): a ação `unschedule`; a auditoria de criação e edição de post e de
categorias e autores, na mesma transação da escrita; e o fim da pasta `posts/novo/` (o upload exige
um post que existe, então não nascem mais imagens órfãs; as que o M1a gravou lá continuam sendo
servidas e não são limpas por nada). No mesmo lote entraram a recusa de save sobre versão velha
(`if_updated_at`) e o limite e as contagens das listas. Segue para os lotes de tela: o `PUBLISH_TZ`.
