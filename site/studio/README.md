# ash-studio

Estúdio de blog, IA e newsletter do Ash. Hoje tem o esqueleto (M0: painel de admin em Next 16,
Postgres próprio, fila de jobs durável, worker com batimento e `/api/health`), o motor do blog
(M1a: posts, estados, agendamento, imagens e a API pública que o site lê) e o painel do blog
(M1b: início, listas, novo post, categorias, autores, o editor do post e a prévia). É um pacote
**independente** (lockfile próprio, sem workspace pnpm); o site Astro na raiz do repositório não
muda.

Desenho e planos: `docs/plans/*-ash-studio-*` (o desenho é de 30/09; o plano do M1a, de 01/10, tem
no fim os desvios da implementação). Runbook da Cloudflare: `deploy/cloudflare.md`.

## Rodar local

1. Copie `studio/.env.example` para `studio/.env.local` (ignorado pelo git) e troque os valores:
   `DATABASE_URL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `STUDIO_ADMINS` e `STUDIO_DEV_ADMIN` (e-mail
   do admin local). O exemplo já vem com `NODE_ENV=development`, `STUDIO_HOST=localhost` e
   `PUBLIC_HOST=pub.localhost`. `localhost` só vale em `NODE_ENV=development`; fora disso o `env.ts`
   recusa.
2. `pnpm install` e `pnpm dev` (porta 3100). Abra `http://localhost:3100/`.

O `STUDIO_DEV_ADMIN` só funciona em desenvolvimento: em qualquer outro ambiente o app o ignora.

Variáveis do blog, todas com padrão (nenhuma é obrigatória):

| Variável | Padrão | Para quê |
|---|---|---|
| `UPLOADS_DIR` | `uploads` | Pasta das imagens dos posts. Relativa ao diretório do processo (`/app` na imagem, onde o compose monta o volume). |
| `PUBLISH_TZ` | `America/Sao_Paulo` | Fuso em que o admin pensa ao agendar. Precisa ser um fuso IANA válido. É o fuso de toda data que o painel mostra e do campo de agendamento, seja qual for o fuso do servidor ou do navegador. |
| `GITHUB_DISPATCH_TOKEN` | (vazio) | Token que dispara o rebuild do site. Vazio ou ausente: o rebuild fica desligado e cada job registra `site.rebuild_skipped` na auditoria. Nunca aparece em log, erro ou auditoria. |
| `GITHUB_DISPATCH_REPO` | `lglucas/ash-web` | Repositório (`dono/nome`) que recebe o `repository_dispatch`. |
| `SITE_REBUILD` | (vazio) | Não se preenche à mão: o compose passa `on` ao app quando o token existe (ver abaixo). |

Na VPS só o worker recebe o `GITHUB_DISPATCH_TOKEN`. O `docker-compose.yml` entrega o token vazio
ao app (que fica de frente para a internet e não chama o GitHub) e, no lugar, a bandeira
`SITE_REBUILD`, derivada do mesmo valor do `.env`. É por ela que o `/api/health` sabe dizer
`rebuild: "on"` ou `"off"`.

## Blog (M1a)

Rotas:

| Rota | Host | O que faz |
|---|---|---|
| `POST /api/admin/upload` | só `studio.` | Recebe uma imagem (`multipart/form-data`, campos `file` e `post_id`, os dois obrigatórios) e devolve `{ ok, url, width, height, bytes }`. `post_id` ausente ou que não é uuid dá `400`; de post que não existe, `404`. Para a foto de um autor, `author_id` **no lugar** de `post_id` (os dois juntos dão `400`), com as mesmas regras: uuid de um autor que existe. Só aceita pedido da mesma origem (ver "Regras do código"). |
| `GET /media/...` | `studio.` e `pub.` | Serve as imagens gravadas. Só `.webp`, cache de um ano (`immutable`). |
| `GET /api/public/posts` | `studio.` e `pub.` | Um JSON com todos os posts publicados (pt e en) e as categorias e autores **desses posts**. `cache-control: public, max-age=60, s-maxage=60`, `ETag` forte e `304` para `If-None-Match`. É o que o site lê no build. |

Contrato dos campos da API pública, para quem consome o JSON:

- `html` (do post) é o **único** campo com HTML. Passou pelo sanitizador e pode entrar como
  marcação.
- **Todo o resto é texto puro** e precisa ser escapado por quem consome, conforme o lugar onde
  entra: `title`, `excerpt`, `tags`, `metaTitle`, `metaDescription`, `coverAlt`, nomes e bios de
  categoria e autor, e também `toc[].text` (as entidades já vêm decodificadas, então um título de
  seção que fala de `<script>` chega com esses caracteres).
- Um título pode conter `<`, `&` ou `</script>`. Dentro de um bloco JSON-LD, ou de qualquer
  `<script>` embutido, a sequência `</script>` fecha o elemento: serialize trocando `<` por
  `\u003c`, nunca com `JSON.stringify` puro.
- `coverUrl` e `avatarUrl` são caminhos `/media/...` ou `null`, nunca outra origem.

A API guarda em memória o JSON montado e só o refaz quando muda uma impressão digital barata do
que é público: os posts publicados (id, `updated_at` e `xmin`) e as categorias e autores que eles
usam (a linha inteira). Rascunho não entra: salvar um rascunho não muda a `ETag`, então quem olha
de fora não vê a edição acontecendo. A impressão digital vale por dois segundos, para que uma
enxurrada de pedidos custe uma consulta e não uma por pedido; uma publicação leva até esse tempo
para aparecer aqui. Como o `xmin` muda a cada `UPDATE`, uma correção feita direto no `psql` também
aparece, mesmo sem mexer no `updated_at`.

Imagens: o upload aceita JPG, PNG e WebP de até 5 MB e 50 megapixels. O formato vem dos bytes, não
do tipo que o navegador declara. Toda imagem é girada pelo EXIF, reduzida para até 1600 px de
largura e regravada em WebP, sem metadados (EXIF, GPS, perfil). Fica em
`UPLOADS_DIR/posts/<id do post>/<uuid>.webp`, e o banco guarda só o caminho relativo
`/media/posts/...`, que vale nos dois hosts. Toda imagem é de um post que já existe: o post nasce
antes de o editor abrir, então não há pasta de "post ainda não salvo" nem imagem sem dono para
limpar depois. A foto de um autor passa pelo mesmo caminho e pelas mesmas recusas, com 512 px de
largura no máximo, e fica em `UPLOADS_DIR/autores/<id do autor>/<uuid>.webp`; o autor também tem
de existir antes (por isso a foto é escolhida no "Editar", não no "Novo autor"). Um arquivo
enviado e nunca usado (o admin desistiu antes de salvar) fica no disco sem linha que aponte para
ele; não há limpeza disso ainda. O `sharp` roda só no app: o worker é empacotado pelo esbuild,
que não leva módulo nativo.

Publicação agendada: a cada ciclo, antes da fila, o worker publica os posts aprovados cuja data
venceu. Se esse passo falha, o ciclo continua e o erro aparece no `last_error` do batimento
(`worker_heartbeat`) e no log. Post agendado com o corpo vazio (inclusive o `<p></p>` do editor em
branco) não é publicado: fica aprovado, com a data. A cada ciclo o worker escreve no log quais são
e, no batimento, só quantos (o slug de um post não publicado não vai para o `/api/health`). Isso
deixa o health vermelho até alguém escrever o corpo, reagendar, desagendar ou publicar agora.
Desagendar (`unschedule`) tira a data e deixa o post aprovado; só vale para post aprovado que tem
data.

Edição concorrente: salvar um post exige `if_updated_at`, o `updated_at` da versão que o editor
tinha em mãos. Se a linha mudou desde então (outro admin salvou, ou o post mudou de estado), o save
é recusado inteiro com "Alguém salvou este post depois que você abriu. Recarregue." e nada é
gravado. Criar, salvar e toda mudança de estado devolvem o `updatedAt` novo, que é o token do
próximo save; cada escrita avança esse valor em pelo menos um milissegundo, inclusive a publicação
agendada feita pelo worker (a regra, para um `UPDATE`, mora em `src/blog/updated-at.ts`). Criar um
post não leva `if_updated_at`.

Auditoria de escrita, sempre na mesma transação da escrita (se uma falha, a outra não acontece):
`blog.post_created` e `blog.post_updated` (com o estado do post), `blog.category_saved`,
`blog.category_deleted`, `blog.author_saved` e `blog.author_deleted`, além dos eventos de mudança
de estado (`blog.post_submitted`, `_approved`, `_rejected`, `_reopened`, `_scheduled`,
`_unscheduled`, `_published`, `_unpublished`) e de `blog.image_uploaded`. Todos levam o e-mail de
quem fez.

Listas: `listPosts` devolve os 200 posts mais novos (o limite aceita de 1 a 500), sem o corpo;
`countPostsByStatus` conta por estado numa consulta só, com zero para os estados vazios e sem
depender do limite; `listScheduled` traz os aprovados com data, do mais próximo para o mais
distante. Paginação fica para quando passar de 200.

Rebuild do site: publicar, despublicar, editar um post publicado e mexer em categoria ou autor
**que algum post publicado usa** enfileiram o job `site-rebuild`, com um minuto de atraso para
juntar rajadas. Categoria ou autor que só rascunhos usam ainda não está no site, e não pede build. Com o token, o job
chama `repository_dispatch` (`event_type: studio-publish`) no GitHub; sem o token, só registra que
pulou. Se o GitHub falha, o job tenta dez vezes ao longo de cerca de três horas antes de morrer, e
um disparo que dá certo dá baixa em todos os pedidos que já estavam vencidos na fila (uma fila
acumulada vira um build, não vinte). Rebuild que morreu não fica perdido: a cada ciclo o worker
confere se há um `site-rebuild` morto depois do último disparo (ou pulo) registrado na auditoria e,
se não houver outro esperando, enfileira um novo (`site.rebuild_requeued`). Enquanto o GitHub não
voltar, isso se repete a cada três horas, mais ou menos.

## Painel (M1b)

Interface em português, tema escuro, só com os tokens de `src/app/globals.css`
(`docs/design-system.md`). Todas as telas ficam no host `studio.`, atrás do Access.

| Tela | O que faz |
|---|---|
| `/` | Contagem de posts por estado (cada número leva à lista filtrada), atalhos e o link do `/api/health`. Avisa quando há agendado com o horário vencido. |
| `/blog` | Lista de posts em três abas, pela query string: `?view=posts` (padrão), `?view=revisao`, `?view=agendados`. Na aba de posts, filtros `?lang=pt\|en` e `?status=<estado>`. Valor que a tela não conhece cai no padrão, sem erro. |
| `/blog/novo` | Título, idioma e autor: cria o rascunho e abre o editor (`/blog/<id>`). Com `?traducao_de=<id>`, cria a tradução daquele post, com o idioma fixo no outro; id que não existe dá 404, e post que já tem tradução mostra o link dela em vez do formulário. Sem nenhum autor cadastrado, manda cadastrar um antes. |
| `/blog/categorias`, `/blog/autores` | Lista com contagem de posts (total e publicados), criar e editar em diálogo, apagar com confirmação. A foto do autor é escolhida no "Editar". Autor com posts não pode ser apagado, e o diálogo diz isso em vez de oferecer o botão. |
| `/blog/<id>` | O editor: título, texto, estado e as propriedades do post. Id que não existe ou não é uuid dá 404. |
| `/blog/<id>/previa` | O que está salvo, com sumário, tempo de leitura, capa e os blocos especiais marcados. Não imita o visual do site. |

Fluxo de um post, e onde cada passo acontece:

1. **Novo post** cria o rascunho. Na lista, o rascunho tem "Enviar para revisão".
2. Na aba **Revisão**: "Aprovar" (o servidor recusa post sem texto) ou "Rejeitar", que pede um
   comentário de pelo menos 5 caracteres. Rejeitado, o post mostra o motivo na lista e tem
   "Reabrir", que o devolve a rascunho.
3. Aprovado: "Publicar agora" (pede confirmação), "Agendar" ou, se já tem data, "Reagendar" e
   "Desagendar". A aba **Agendados** mostra os aprovados com data, do mais próximo para o mais
   distante, e marca como atrasado o que passou do horário sem ir ao ar (post sem texto: o worker
   não publica post vazio).
4. Publicado: "Despublicar" (pede confirmação) devolve o post a aprovado.
5. "Criar tradução" aparece em todo post que ainda não tem a versão no outro idioma.

Como as telas se comportam:

- Depois de uma ação que deu certo, a lista é recarregada do servidor (`router.refresh()`). Uma
  ação recusada mostra a mensagem do servidor, como veio, ao lado da linha (ou dentro do diálogo
  que a disparou), e nada é recarregado: as mensagens que pedem para recarregar a página dizem
  isso. Enquanto uma ação roda, os botões daquela linha ficam desabilitados.
- Datas aparecem sempre no `PUBLISH_TZ`, formatadas por `src/blog/lib/format-date.ts`. O campo de
  agendamento conversa com o servidor só por `src/blog/lib/local-time.ts`; um horário que não
  existe no fuso (a hora pulada na entrada do horário de verão) é recusado na tela.
- Categoria e autor são identificados pelo endereço (slug), que não muda depois de criado. Editar
  troca só os nomes (as bios e a foto, no autor). Criar com um endereço que já existe renomeia o
  que existe, e o formulário avisa antes.
- A lista mostra os 200 posts mais recentes do filtro e diz quando há mais. "Criar tradução"
  aparece no post cujo grupo de tradução ainda só tem um idioma, numa consulta sobre a tabela
  inteira.
- Enquanto um pedido está em andamento, o botão que o disparou mostra o giro, os outros daquela
  linha ou daquele diálogo não respondem, e o diálogo não fecha com Esc: a resposta (um erro,
  principalmente) precisa ter onde aparecer. Depois de criar um post, o botão continua morto até
  o editor abrir, para um segundo clique não criar um segundo rascunho (não existe apagar post).

### O editor (`/blog/<id>`)

- **Salvar é explícito**: o botão "Salvar" ou Ctrl+S (Cmd+S no Mac). Não há salvamento
  automático. O salvar manda o documento inteiro e o `if_updated_at` da versão que está na tela;
  a resposta traz o token novo, e toda mudança de estado feita pelo editor também. A página não é
  recarregada por baixo do texto. Sem alteração, nem o botão nem o atalho chamam o servidor (um
  save sempre move o token, grava auditoria e, em post publicado, reconstrói o site). Ctrl+Shift+S
  é do navegador. Uma tag digitada e ainda não fechada com Enter entra no salvar.
- **Texto**: negrito, itálico, riscado, código, títulos de seção (h2) e subtítulos (h3), listas,
  citação, bloco de código, linha divisória, link, imagem e os blocos especiais (shortcodes) do
  catálogo. Não há sublinhado, e nenhum botão existe para algo que o sanitizador descartaria:
  `src/blog/components/editor/extensions.ts` é a configuração única do editor, e
  `tests/editor-roundtrip.test.ts` passa cada comando e um corpus de textos pelo caminho de
  salvar (editor → `{{shortcode}}` → sanitizador) e cobra que nada se perca e que a segunda
  passada não mude nada. A barra de formatação é uma parada só do Tab, e as setas andam entre os
  botões; ela fica presa no alto, embaixo da barra de salvar, enquanto o texto rola.
- **Bloco especial e imagem** entram sempre no nível de cima do texto, depois do bloco em que o
  cursor está (nunca dentro de um item de lista ou de uma citação, onde o servidor recusaria o
  bloco especial), e o cursor fica num parágrafo depois deles, pronto para continuar escrevendo.
- **Link** passa por um diálogo que aplica a mesma regra do sanitizador (`lib/href.ts`): `https://`,
  `http://`, `mailto:`, `#` ou um caminho do próprio site começando com `/`. **Imagem** só entra
  no texto depois de o envio dar certo e de ter texto alternativo; o erro do servidor aparece como
  veio. O envio pode ser cancelado, e é interrompido sozinho depois de um minuto sem resposta.
- **Estado**: a barra lateral mostra o estado e as ações válidas para ele, as mesmas das listas
  (e aprovar e rejeitar, quando em revisão). Com alterações não salvas, a mudança de estado é
  recusada na tela ("salve antes"): o servidor só aprova e publica o texto salvo. O comentário
  da última rejeição continua à vista depois de reabrir o post, até ele ser aprovado.
- **Toda mudança de estado leva o token** (`if_updated_at`), no editor e nas listas: se o post
  foi salvo ou mudou de estado depois que a tela foi desenhada, o servidor recusa com "Alguém
  salvou este post depois que você abriu. Recarregue." Ninguém aprova nem publica um texto que
  mudou por trás da tela. Estado errado continua com a mensagem de estado.
- **Post publicado**: salvar vale na hora, e a tela avisa.
- **Outro admin salvou antes** (`StalePostError`): o salvar é recusado, o texto continua na tela,
  e o aviso oferece copiar o texto (como texto puro e como HTML, para colar no editor da outra
  aba com a formatação), abrir a versão atual em outra aba ou recarregar (que descarta o que
  está na tela). Salvar por cima não é oferecido.
- **Propriedades**: categoria, autor, tags (aparecem já normalizadas pelo mesmo schema que o
  servidor aplica), destaque, resumo, capa com texto alternativo, título e descrição para
  buscadores, com contador em cada campo que tem limite. Endereço (slug) e idioma são só leitura.
  O link para a tradução, ou "Criar tradução", fica ali.

Sair com alterações não salvas, exatamente o que é e o que não é protegido (o App Router não tem
um gancho de "saindo da rota"):

- **Protegido pelo navegador** (`beforeunload`): recarregar, fechar a aba ou a janela, digitar
  outro endereço, seguir um link para outro site. O navegador mostra a pergunta dele.
- **Protegido pelo painel**: clique em qualquer link da página para outra tela do próprio painel,
  inclusive os do menu do topo. Abre "Sair sem salvar?".
- **Não protegido**: os botões de voltar e avançar do navegador dentro do painel (mudam a rota sem
  um evento que a página possa cancelar). Clique com Ctrl, Cmd, Shift ou no botão do meio, e link
  que abre outra aba, não são interceptados porque esta página continua aberta.

Limites conhecidos do editor:

- **Tabela e figura com legenda** não existem no editor (o sanitizador as aceita). Um post que as
  contenha, vindo de fora do painel, abre com um aviso: salvar o texto as transforma em
  parágrafos soltos. Colar uma tabela também avisa.
- **Lista numerada sempre começa em 1**: o `start` de um `<ol>` é descartado pelo sanitizador e
  o editor não o guarda.
- **Voltar e avançar do navegador** não pedem confirmação (ver acima).
- **Imagem enviada e não usada** (o admin fechou o diálogo, ou não salvou) fica no disco sem
  linha que aponte para ela. Não há limpeza disso ainda.
- **Texto colado** perde o que o editor não tem (cores, fontes, sublinhado, imagens de outros
  sites): fica o texto, sem aviso além do da tabela.
- **Bloco especial ou imagem antes do primeiro bloco**: a inserção põe o bloco *depois* do bloco
  em que o cursor está, então com o cursor no primeiro parágrafo ele entra em segundo lugar. Para
  ele ser o primeiro do texto, abra uma linha vazia no começo (Enter com o cursor no início do
  primeiro parágrafo) e insira nela: uma linha vazia é trocada pelo bloco. Quando o texto já
  começa por um bloco ou uma imagem, o lugar antes dele é o cursor de intervalo do editor (uma
  linha horizontal fina).
- **Bloco especial colado junto com outro conteúdo, ou arrastado**, para dentro de um item de
  lista: o bloco sai para o nível de cima (o servidor não o aceita em outro lugar), cortando a
  lista em duas, e pode sobrar um item vazio para apagar. Colar só o bloco não corta nada: ele
  vai para depois da lista, como pela barra.

Onde mora o quê: primitivos de tela em `src/ui/` (botão, campo, diálogo nativo, confirmação, selo
de estado, abas, aviso, menu e `useAction`, que roda uma server action e cuida de pendente, erro e
recarga); componentes do blog em `src/blog/components/` (o editor em `editor/`); a lógica que tem
regra fica em funções puras em `src/blog/lib/` (`post-status`, `list-query`, `list-rows`,
`format-date`, `short-slug`, `field-error`), cada uma com seu teste. O CSS próprio de
`globals.css` fica todo dentro de uma camada (`@layer base`, `@utility`, `@layer components`): no
Tailwind 4 uma regra fora de camada vence as utilitárias, e uma classe como `hover:border-*` ao
lado dela deixaria de valer sem aviso.

## Health

`GET /api/health` responde `200` quando está tudo certo e `503` quando algum item está vermelho; o
corpo sempre diz qual e por quê (`checks`). Além de banco, batimento do worker e e-mail, ficam
vermelhos: um erro no último ciclo do worker (`checks.cycle`) e qualquer job morto nas últimas 24 h
(`checks.jobs`, com a contagem por tipo). O campo `rebuild` mostra `on` ou `off`.

`GET /api/health?probe=live` devolve o mesmo corpo, mas o status só olha o essencial (app
respondendo, banco, batimento, e-mail). É o que o healthcheck do container e o `deploy.sh` usam: um
job que morreu ontem precisa aparecer, mas não pode reiniciar o app nem impedir o túnel de subir.
O `deploy.sh` imprime o health completo no fim e avisa se estiver vermelho.

Job morto não volta sozinho, com uma exceção: o `site-rebuild`, que o worker reenfileira (ver
"Rebuild do site"). Depois de resolver a causa, o vermelho some quando o job passa de 24 h ou quando
a linha é apagada ou reenfileirada à mão.

## Testes

```bash
pnpm typecheck
pnpm test
```

As suítes de banco precisam de um Postgres real. Uma vez: `bash deploy/testdb.sh` (cria o banco
de teste na VPS e grava `.env.test`, ignorado). Depois abra o túnel:
`ssh -N -L 54329:127.0.0.1:54329 agent-rails-vps`. Sem `TEST_DATABASE_URL`, as suítes de banco são
puladas **com aviso alto**. O helper recusa qualquer banco cujo nome não termine em `_test`, porque
cada teste apaga o schema inteiro. O CI roda tudo com `REQUIRE_DB_TESTS=1` e um Postgres 17.11 de
serviço: banco ausente derruba o job em vez de pular.

Testes de componente (`*.test.tsx`, com `@testing-library/react`) pedem o jsdom no próprio
arquivo, com `// @vitest-environment jsdom` na primeira linha; o padrão continua sendo Node, que é
o que as suítes de banco e de bundle precisam. Eles trocam as server actions por dublês
(`vi.mock`) e nunca tocam o banco. O jsdom não tem `showModal()` nem faz layout:
`tests/helpers/dom.ts` põe os substitutos mínimos (abrir e fechar o diálogo, a sequência do Esc
com `pressEscape`, e os retângulos que o editor pede a um `Range`). Foco preso no diálogo e
digitação dentro do editor não são simulados: os testes mudam o texto pelos comandos da barra, e
o resto é do navegador.

`tests/pages.test.tsx` renderiza as páginas de servidor para HTML contra o banco de teste, com os
núcleos de verdade: é o mais perto de abrir a tela que dá para chegar sem o build.

## Build

`pnpm build` gera o servidor (`.next/standalone/server.js`) e empacota o worker e o migrador em
`dist/worker.mjs` e `dist/migrate.mjs`. O `.npmrc` fixa `node-linker=hoisted`: o pnpm no Windows
não consegue ligar o Next no layout isolado, e a imagem precisa instalar igual ao local.

O build precisa de um disco que aceite links (NTFS, ext4): o Turbopack cria um link em
`.next/node_modules` para cada pacote externo (`sharp`, e o `postcss` do `sanitize-html`). Em FAT32
ou exFAT ele falha com "failed to create junction point"; copie a pasta `studio/` para um disco NTFS
e rode o build lá.

## Deploy

Da raiz do repositório: `bash studio/deploy/deploy.sh`. Ele empacota o código com `git archive`,
envia à VPS, faz o `docker build`, garante a pasta `uploads/` com o dono certo (uid 10001, o
usuário da imagem), sobe o compose e confere o `/api/health?probe=live`. A `APP_VERSION` fica
fixada em `/opt/ash-studio/.env`.

A imagem é construída antes de qualquer contêiner ser trocado: se o build falha, o que está no ar
continua de pé. O script chama `docker build -q`, que esconde a mensagem do erro. Para vê-la:

```bash
ssh agent-rails-vps 'cd /opt/ash-studio && sudo docker build --progress=plain -t ash-studio:debug src 2>&1 | tail -70'
```

O `next build` checa os tipos de tudo o que está na imagem, e a imagem não leva `tests/`: um
arquivo de `src/` que importe algo de `tests/` (como os `*.test.ts(x)`, por isso excluídos no
`.dockerignore`) quebra o build só no servidor. O CI não vê isso, porque builda a árvore inteira.

Depois do deploy, de fora: `https://pub.ash.app.br/api/public/posts` responde 200 com JSON e
`https://studio.ash.app.br` responde 302 (o login do Access).

## Na VPS (`/opt/ash-studio`)

- `.env` (segredos do app), `tunnel.env` (token do túnel, root, 0600), `pgdata/`, `uploads/`
  (dono uid 10001).
- Containers: `ash-studio`, `ash-studio-worker`, `ash-studio-db`, `ash-studio-migrate` (uma vez a
  cada subida) e `ash-studio-cloudflared`. O worker tem `stop_grace_period` de 5 min para terminar o
  job em andamento.
- O app e o worker nunca veem o token do túnel.

## Backup

Todo dia às 03:35 UTC. Aos domingos, às 05:00 UTC, um teste de restauração. Logs em
`/var/log/ash-studio-*.log`. A primeira execução passou em 01/10.

Dependências de fora deste repositório: a unit `ash-alerta@` (avisa quando um serviço falha, via
`OnFailure=`) e `algumacoisa-agentica/infra/ash-backup/agent-rails/offsite.sh`, que leva a cópia
para fora da VPS (`ash-offsite`, 04:00 UTC, depois do dump).

Os scripts em `deploy/backup/*.sh` seguem a cada deploy. As units (`*.service`, `*.timer`) são
instaladas à mão, uma vez, e de novo quando mudarem. Na VPS, a partir de `/opt/ash-studio/src`:

```bash
sudo cp deploy/backup/*.service deploy/backup/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ash-studio-backup.timer ash-studio-restauracao.timer
```

## Regras do código

- Toda página, rota e server action **do painel** chama `requireAdmin()`. Só as rotas públicas de
  `hosts.ts` (`PUBLIC_ROUTES`) e o `/api/health` não chamam. O `proxy.ts` é só a primeira porta.
- Nenhuma tela ou rota de admin mora sob um prefixo público (`/api/public/`, `/newsletter/`,
  `/descadastro`, `/media/`): o painel da newsletter fica em `/painel/newsletter`, por exemplo.
- Rota de admin que muda alguma coisa (tudo que não é `GET`/`HEAD`) começa assim, nesta ordem:
  `await requireAdmin()`, depois `const refused = refuseCrossSite(request); if (refused) return
  refused;` (`src/lib/same-origin.ts`). A credencial do admin é um cookie do Access que o navegador
  manda sozinho; sem essa checagem, uma página de outro site conseguiria enviar um formulário em
  nome dele.
- Handler de rota é sempre `export async function GET/POST/...`. `export const POST = ...`,
  re-export e `export default` são recusados pelo teste. Página (`page.tsx`) chama `requireAdmin()`
  na primeira linha, e `generateMetadata` também. **Layout não guarda nada**: ele não roda de novo
  na navegação e também envolve as páginas públicas, então não importa `requireAdmin` nem o banco.
  A mesma regra vale para os outros arquivos que o Next renderiza em volta ou no lugar da página:
  `template`, `default`, `loading`, `error`, `global-error`, `not-found`, `forbidden` e
  `unauthorized`.
- Rota sob prefixo público só exporta `GET` e `HEAD`. Uma rota pública que precise aceitar escrita
  (o descadastro em um clique é um `POST`) entra, por caminho, na lista `PUBLIC_WRITE_ROUTES` do
  teste. Um caminho exato de `hosts.ts` (`/descadastro`) é exato: o que estiver numa pasta abaixo
  dele é rota de admin e segue as regras de admin.
- Server action mora em arquivo que começa com `"use server"`, e todo export dele chama
  `requireAdmin()` na primeira linha (`tests/blog-actions.test.ts`). `"use server"` dentro de uma
  função, em página ou componente, é recusado em todo o `src/`.
- Rota de metadados (`sitemap.ts`, `robots.ts`, `opengraph-image.tsx`, `icon.tsx`...) e a pasta
  `src/pages` são recusadas até ganharem uma regra e uma entrada na lista do teste.
- Quem cobra as regras de rota, página, layout e pontos de entrada é `tests/app-guards.test.ts`.
- O worker não alcança `sharp` nem `sanitize-html` (`tests/worker-bundle.test.ts`).
- Componente cliente não alcança `sanitize-html`, `sharp`, módulo do Node, `src/db`, o ambiente
  (`lib/env.ts`), a guarda (`lib/admin.ts`) nem `next/headers`.
  `tests/client-bundle.test.ts` acha sozinho todo arquivo de `src/` que começa com `"use client"`
  e segue o que ele importa, parando só em arquivo `"use server"` (que o Next troca por uma
  chamada ao servidor). Por isso um componente cliente recebe dados por props, já como texto
  (data em ISO), e importa tipos dos núcleos só com `import type`.
- O `.env.example` tem toda variável que o `env.ts` lê, e só elas (`src/lib/env.test.ts`).
- Escrita confere as linhas afetadas (`expectOne`; na fila, o fencing por tentativa).
- Trabalho demorado vira job. Handlers respeitam `ctx.signal` e tornam seus efeitos externos
  idempotentes pelo `jobId`.
- Sem pixel de rastreio. Bundle público nunca contém segredo nem URL interna.
