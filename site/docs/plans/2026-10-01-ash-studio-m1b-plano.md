# ash-studio M1b — painel do blog: plano de porte

> **Para agentes:** SUB-SKILL: superpowers:subagent-driven-development. Plano de **porte**, como o
> M1a: a fonte é código existente; cada linha diz o que copiar, adaptar e testar. TDD onde há
> lógica (núcleos, helpers, round trip do editor); commits por tarefa.

**Objetivo:** um admin cria, edita, revisa, agenda, publica e despublica posts pelo painel, com
editor visual, imagens, categorias, autores, tradução vinculada e prévia. Sem páginas no site (M1c).

**Fontes** (somente leitura): `B` = `F:\AceleradoraECO\boringco\boringco`, `C` =
`F:\AceleradoraECO\criptosul`. **Destino:** `S` = `studio/`. **Base:** M1a
(`2026-10-01-ash-studio-m1a-plano.md`, com a seção "Desvios na implementação").
**Identidade:** `docs/design-system.md` — só os tokens de `S/src/app/globals.css`; tema escuro.

## Contratos do M1a que o painel obedece

- Actions devolvem `{ ok: true, data } | { ok: false, error }`; `error` já vem em português.
- Upsert de post carrega o **documento inteiro**: campo omitido é campo limpo.
- Slug e idioma não mudam depois de criar. Editar post publicado vale na hora (e pede rebuild).
- Corpo é sanitizado ao salvar; `img src` só `/media/…`; link só `https?:`, `mailto:`, `#` ou
  caminho com uma `/` inicial; shortcode só em nível de bloco.
- Toda página e `generateMetadata` começam com `await requireAdmin()`; layout e arquivos em volta
  da página não importam guarda nem banco; nada de `"use server"` inline; rota não-GET de admin
  chama `refuseCrossSite`; nenhuma tela sob prefixo público. `tests/app-guards.test.ts` cobra.

## Decisões travadas

1. **Rotas** (sem `[locale]`, sem next-intl; interface em português):
   `/` (início com atalhos e contagens) · `/blog` (lista; abas por `?view=posts|revisao|agendados`,
   filtros `?lang=` e `?status=`) · `/blog/novo` · `/blog/[id]` (editor) · `/blog/[id]/previa` ·
   `/blog/categorias` · `/blog/autores`.
2. **O post nasce antes do editor.** `/blog/novo` pede só título, idioma e autor, cria o rascunho e
   redireciona para `/blog/[id]`. Consequência: o upload passa a **exigir** `post_id` e a pasta
   `posts/novo/` deixa de existir — não há imagem órfã de post que nunca foi salvo.
3. **Salvar é explícito** (botão e Ctrl+S), sem autosave: cada save de post publicado pede rebuild,
   e autosave tornaria rotineira a corrida de duas gravações. Aviso de alterações não salvas
   (`beforeunload` + confirmação nos links internos do editor).
4. **Edição concorrente:** `updatePost` recebe `if_updated_at` (ISO) e recusa com `StalePostError`
   ("Alguém salvou este post depois que você abriu. Recarregue.") quando não bate. Três admins.
5. **Desagendar** existe: ação `unschedule` (aprovado→aprovado, `scheduled_for = null`, auditoria
   `blog.post_unscheduled`). Fecha o texto do M1a sobre post agendado sem corpo.
6. **Auditoria de escrita:** `blog.post_created`, `blog.post_updated` (com `status` no payload),
   `blog.category_saved|deleted`, `blog.author_saved|deleted`, na mesma transação da escrita.
7. **Editor:** TipTap 3 (`@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`,
   `@tiptap/extension-image`), `immediatelyRender: false`. StarterKit configurado para emitir **só**
   o que `ALLOWED_TAGS` aceita (títulos h2/h3; Link e Underline pelo próprio StarterKit, sem
   `@tiptap/extension-link`). `ShortcodeNode` (`group: "block"`, `atom`) com chip nos tokens.
   **Teste de ida e volta pelo schema real** (jsdom): para um corpus de HTML sanitizado,
   `editor → getHTML → editorHtmlToStored → sanitizePostHtml` é estável na segunda passada e não
   perde shortcode, imagem, link nem título.
8. **Sem `window.prompt`/`confirm`:** link, texto alternativo de imagem, rejeição e confirmações
   usam um `<dialog>` próprio. O campo de link valida com `isSafeHref` — que sai de `sanitize.ts`
   para um módulo puro (`lib/href.ts`), porque `sanitize-html` não pode entrar no bundle do cliente.
9. **Agenda no fuso do projeto:** `datetime-local` ↔ ISO por `lib/local-time.ts` com `PUBLISH_TZ`
   (lido no servidor e passado como prop); a tela mostra o fuso por extenso.
10. **Prévia** em `/blog/[id]/previa`: página de servidor que mostra `withToc(sanitizePostHtml())`
    com sumário, tempo de leitura e os shortcodes como chips. Não imita o tema do site (isso é M1c).
11. **Lista:** `listPosts` ganha `limit` (padrão 200) e a página mostra contagem por estado numa
    consulta agrupada. Paginação de verdade fica para quando passar de 200.
12. **Limite de server action:** `experimental.serverActions.bodySizeLimit: "2mb"` (o corpo vai até
    300 mil caracteres; o padrão é 1 MB).
13. **Componentes pequenos, sem biblioteca de UI.** Primitivos em `src/ui/` (Button, Field, Dialog,
    StatusBadge, Tabs, Toast inline). Sem emoji. Foco visível em `settle`.
14. **Testes de componente** com `@testing-library/react` + jsdom só onde há regra: quais ações
    aparecem em cada estado, o aviso de não salvo, o diálogo de link recusando href inseguro, o
    round trip do editor. O resto é coberto pelos núcleos (já testados com banco).

## Mapa de arquivos

| Destino em `S/` | Fonte | Veredito e adaptações |
|---|---|---|
| `src/blog/status.ts`, `schemas.ts`, `actions/status.ts` (+testes) | — | `unschedule` (decisão 5) |
| `src/blog/posts.ts`, `categories.ts`, `authors.ts` (+testes) | — | auditoria (6); `if_updated_at` + `StalePostError` (4); `listPosts({ limit })` e `countPostsByStatus` (11) |
| `src/blog/upload.ts`, `lib/image-rules.ts`, rota de upload (+testes) | — | `post_id` obrigatório; some `novo` (2) |
| `src/blog/lib/href.ts` (+teste) | `lib/sanitize.ts` | mover `isSafeHref`; `sanitize.ts` reexporta (8) |
| `next.config.ts` | — | decisão 12 |
| `src/ui/*.tsx` | — | primitivos (13) |
| `src/app/layout.tsx`, `src/ui/nav.tsx` | — | navegação Início / Blog / Categorias / Autores; layout continua sem guarda nem banco |
| `src/app/page.tsx` | — | atalhos + contagens por estado + health |
| `src/app/blog/page.tsx` | `B/src/app/[locale]/console/blog/page.tsx` | `requireAdmin()`; abas; sem "campanhas" |
| `src/blog/components/post-list.tsx` | `B/.../console-blog-panel.tsx` | todos os estados do M1 (lá `rascunho` faltava na ordem); coluna e filtro de idioma; ações por estado; "criar tradução" |
| `src/blog/components/review-list.tsx` | `B/.../review-panel.tsx` | só `revisao`; aprovar; rejeitar com feedback (≥ 5) em diálogo |
| `src/blog/components/scheduled-list.tsx` | `B/.../queued-post-row.tsx` | horário no fuso (9); reagendar, desagendar, publicar agora; destaque para agendado vencido sem corpo |
| `src/app/blog/novo/page.tsx` + `components/new-post-form.tsx` | — | decisão 2; também recebe `?traducao_de=<id>` e chama `createTranslation` |
| `src/app/blog/[id]/page.tsx` | — | carrega post, categorias, autores, tradução irmã; 404 se não existe |
| `src/blog/components/editor/post-editor.tsx` | `B/.../editor/post-editor.tsx` | decisões 3, 4, 7; barra de estado com as ações válidas |
| `…/editor/editor-toolbar.tsx` | `B` idem | botões só do que o sanitizador aceita; shortcodes do Ash |
| `…/editor/link-dialog.tsx`, `image-dialog.tsx` | `B/.../image-upload-button.tsx` | decisão 8; upload via `fetch` multipart para `/api/admin/upload` |
| `…/editor/shortcode-node.ts` | `B` idem | decisão 7 |
| `…/editor/extensions.ts` (+ `tests/editor-roundtrip.test.ts`) | — | configuração única do editor, usada pelo componente e pelo teste |
| `src/blog/components/post-settings.tsx` | `B/.../post-settings-panel.tsx` | categoria, autor, tags, resumo, capa (upload) + alt, destaque, SEO (meta título/descrição com contador), link para a tradução |
| `src/app/blog/[id]/previa/page.tsx` | `C` `PreviaSegura` (ideia) | decisão 10 |
| `src/app/blog/categorias/page.tsx`, `autores/page.tsx` + `components/taxonomy-*.tsx` | `B` (parte de `console-blog-panel.tsx`) | lista com contagens; criar/editar pelo slug; apagar com confirmação; erro legível de autor em uso |
| `tests/app-guards.test.ts` | — | sem mudança de regra; as páginas novas têm de passar |
| `README.md` | — | telas, fluxo, atalhos |

Mapa de cores do porte (boringco é claro, Ash é escuro): `bg-white` → `bg-surface`/`.surface-card`;
`border-ink/5|10|15` → `border-line`; `bg-ink text-white` → `bg-settle text-settle-ink`;
`text-accent` (link) → `text-accent`; `bg-accent/5` e `bg-ink/5` → `bg-elevated`; verde → `settle`;
azul → `accent`; vermelho → `deny`; âmbar → `warning`; `rounded-full` (botão) → `rounded-lg`.

## Lotes

- **Lote 1 — motor:** `unschedule`, auditoria de escrita, `if_updated_at`, `post_id` obrigatório no
  upload, `href.ts`, `listPosts.limit`, `countPostsByStatus`, `bodySizeLimit`. Tudo com teste de
  banco; nenhuma tela.
- **Lote 2 — casca, listas e taxonomia:** dependências de teste de componente, `src/ui`, navegação,
  início, `/blog` com as três abas, `/blog/novo`, categorias e autores.
- **Lote 3 — editor:** dependências do TipTap, `extensions.ts` + round trip, editor, barra, diálogos,
  painel lateral, prévia. Depois: deploy, e o Lucas percorre o fluxo inteiro (criar → escrever com
  imagem e bloco especial → enviar → aprovar → agendar → publicar → despublicar → traduzir).

## Minas conhecidas

- `sanitize-html` e `sharp` nunca em componente cliente nem em nada que o cliente importe:
  conferir os imports de `schemas.ts` e `lib/*` usados no cliente.
- Linhas do Drizzle têm `Date`; componente cliente recebe **string ISO** (serializar na página).
- TipTap: comandos tipados vêm de module augmentation (`import type {} from "@tiptap/starter-kit"`);
  o Link pode emitir `target`/`rel`/`class`, que o sanitizador remove — o round trip tem de aceitar.
- `datetime-local` nunca passa por `new Date(string)`; só por `localToIso`/`isoToLocal`.
- O build não roda no drive `F:` (FAT32); conferir no CI.
- Banco de teste é compartilhado: **uma** suíte por vez, com limite ≥ 25 min.
- Escapes com barra invertida: escrever com Write/Edit e conferir com `od -c`.

## Desvios na implementação (lotes 2 e 3)

O que ficou diferente do que está acima, e por quê. O `studio/README.md` descreve o estado atual.

- **Decisão 7, títulos.** O schema do editor aceita h2, h3 **e h4**; a barra só oferece h2 e h3.
  O sanitizador aceita `<h4>`, e sem ele no schema um h4 gravado viraria parágrafo ao editar.
- **Decisão 7, riscado.** O Strike do StarterKit escreve `<s>`, que o sanitizador não tem. Em vez
  de desligar, o editor tem um mark próprio que lê `<s>`, `<del>` e `<strike>` e escreve `<del>`.
  Sublinhado continua fora.
- **Decisão 7, parágrafo final.** O editor mantém um parágrafo vazio depois de um último bloco
  que não é texto (imagem, shortcode, lista). `editorToStored` o tira antes de salvar; um
  documento em branco vai para o servidor como texto vazio.
- **Tabela e figura.** O sanitizador aceita e o editor não tem. Nada no painel as escreve; um
  post que as contenha abre com um aviso de que salvar o texto as desmancha.
- **Decisão 11 e "Criar tradução".** A lista não deduz mais a tradução dos 500 posts mais
  recentes: `listTranslatedGroups` faz uma consulta agrupada, e `getTranslationSibling` e
  `countScheduled` entraram no núcleo de posts pelo mesmo motivo (o lote 1 não os previa).
- **Avatar do autor.** O upload ganhou `author_id` no lugar de `post_id` (nunca os dois): mesma
  rota, mesmas guardas e recusas, pasta `autores/<id>/`, 512 px. O `post_id` continua obrigatório
  para imagem de post. A foto só pode ser escolhida para um autor que já existe.
- **Tags "como o servidor devolveu".** `updatePost` não devolve o documento. As tags passam, na
  tela, pelo mesmo campo do `UpsertPostSchema` que o servidor aplica, e aparecem já normalizadas.
- **Recarga depois de uma ação.** `router.refresh()` no cliente (`useAction`), não `refresh()` do
  `next/cache` dentro da action: o editor usa as mesmas actions e não pode ter a página
  recarregada por baixo do texto.
- **Guarda de alterações não salvas.** `beforeunload` mais a captura de clique em qualquer link
  da página para outra tela do painel (inclusive o menu). Voltar e avançar do navegador dentro do
  painel não são protegidos: o App Router não dá um evento cancelável para isso.
- **`publishDue`** passou a avançar o `updated_at` como as outras escritas (achado da revisão do
  lote 1): a expressão mora em `src/blog/updated-at.ts`.
- **Token nas transições** (fechado na revisão do lote 3). `SetPostStatusSchema` e
  `RejectPostSchema` aceitam `if_updated_at`; com ele, a transição só passa sobre a versão que a
  tela mostrava, e recusa com `StalePostError` quando o post mudou. Estado errado continua sendo
  `LostTransitionError`: a versão só é olhada quando a linha está onde a ação espera. O editor e
  as três listas mandam o token em toda transição; ele é opcional só para quem chama sem tela.
  Antes disso, um editor aberto sobre uma versão velha fazia uma transição, recebia o token novo
  e o salvar seguinte passava por cima do outro admin.
- **Bloco especial só no nível de cima.** O `ShortcodeNode` saiu do grupo `block`; o documento do
  editor é `(block | shortcode)+`. Colado ou arrastado para dentro de uma lista ou citação, o
  próprio schema o tira de lá. Pela barra, bloco e imagem entram depois do bloco de cima em que
  o cursor está (`insertBlock`), com o cursor de texto num parágrafo depois deles: sem isso o
  bloco ficava selecionado e a tecla seguinte o apagava.
- **Salvar sem nada a salvar não existe.** Nem o botão nem o Ctrl+S chamam o servidor sem
  alteração: cada save move o token, grava auditoria e, em post publicado, reconstrói o site.
  Ctrl+Shift+S fica com o navegador, e o riscado não tem atalho.
- **`<ol start>`.** O sanitizador descarta o `start` e o editor não o guarda: lista numerada
  sempre começa em 1. Ficou como limite conhecido, em vez de abrir o atributo dos dois lados.
- **Limites conhecidos:** tabela e figura viram parágrafos (com aviso ao abrir e ao colar);
  voltar e avançar do navegador não são protegidos; imagem enviada e não usada fica no disco.
