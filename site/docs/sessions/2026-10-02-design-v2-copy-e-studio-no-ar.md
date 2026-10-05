# 2026-10-02 — design v2, copy nova e o painel do blog no ar

Tudo desta sessão está no branch `feat/design-v2` (worktree `ash-web-design`), que inclui o
`feat/ash-studio` (M1a, M1b, M1c). **A produção foi publicada à mão desse branch; o `main` está
atrás.** O que mudou no código está no `CHANGELOG.md`; o que falta, no `docs/ROADMAP.md` §0.

## Linha do tempo

| Quando | O que | Commit |
|---|---|---|
| madrugada | Design v2, lotes 1 e 2: identidade própria, mascote, home na estrutura da referência | `dabfdc9` |
| ~03h | Copy, camada 1: correções de fato no site e no pitch | `d2396b5`, `0f14eb2` |
| ~03h30 | **Produção:** layout novo + camada 1 + política de privacidade nova | `0f14eb2` |
| ~03h45 | Copy, camada 2 (primeira versão), só na prévia | `efbd6fb` |
| ~04h15 | Título e público escolhidos pelo Lucas | `3191a43` |
| ~04h25 | **Produção:** copy nova | `3191a43` |
| ~04h50 | Lote 3: imagem de compartilhamento, 404, slide 9, paleta do painel, docs. **Produção** | `bd4729a` |
| manhã | **Studio M1 no ar** (primeiro deploy do blog no painel), depois de corrigir a imagem Docker | `08d9d7a` |

## Decisões do Lucas

- `docs/design/ash-home-reference.html` (Claude Design) é o system design do site. O console do
  agent-rails não muda; o site tem identidade própria. O mascote foi gerado por ele.
- A copy foi revista em duas camadas, **sem esperar a fusão com o relatório do Ronaldo**: primeiro
  as correções de fato, depois o reposicionamento.
- A política de privacidade nova (controlador = Lucas, `lgpd@ash.app.br`) pode ir ao ar.
- **O título "Give your agents a budget. Never the keys." foi aposentado.** Ele recusou três
  alternativas e uma quarta ("Your agents pay on their own. Only who you approve, only up to your
  limit.") e escolheu: **"Unleash your agents on Solana. Full autonomy, on your terms."**, com
  **"Turn prompts into payments"** como frase de apoio. O motivo, do texto que ele trouxe: um
  título que abre com liberdade e puxa o freio na frase seguinte soa como coleira; a segurança
  fica implícita no desenho e é dita no mecanismo, abaixo.
- Público, em ordem: quem constrói agentes; times e DAOs que pagam à mão; mesas de DeFi (mandato
  ainda não construído). Financeiro e compliance de empresa ficam de fora por ora.

## O que a copy afirma, e de onde vem

Cada afirmação de produto foi conferida contra o agent-rails em `2bbe70d` (a pesquisa está em
`agenttokenfy/.aios/research/2026-10-01-sintese-coordenacao.md`, fora deste repositório).

| Antes | Agora | Por quê |
|---|---|---|
| seis ferramentas | sete; a sétima só pede a um humano | `mcp-tools.ts` |
| "um cofre, quatro agentes, um orçamento" | "um orçamento para cada" | limites vivem na sessão do agente, não no cofre |
| agente pausado pelo guardião | sessão revogada pelo operador | a pausa é do cofre inteiro |
| "nunca paga duas vezes" | recusado enquanto o recibo existe (pelo menos uma hora) | o recibo pode ser fechado |
| "prova que qualquer um confere" | "um registro on-chain" | falta indexer e um verificador público |
| "protocolo aberto", link do GitHub, comando de demo | "licença Apache-2.0"; sem link, sem comando | o repositório é privado |
| "taxa zero, nunca um pedágio" | "sem taxa de protocolo hoje" | não prometer "nunca" |
| "a camada acima do x402" | "ainda não se conecta ao x402" | não há integração |
| swap no Jupiter recusado | pagamento recusado por passar do limite | o programa paga destinos, não opera ativos |
| 286 testes, 8 checks, mercado de 2030, receita do Ramp | fora | sem fonte conferida ou mercado de terceiros |
| "por que não o Allowances nativo?" como concorrente | "a gente usa"; o cofre é o delegado | ADR-014 e o teste `session_key_cannot_pull_via_the_native_program_directly` |

Números externos lidos no **texto bruto** das páginas em 02/10: TRM Labs (52,7 milhões desde maio
de 2025; 25,62 milhões filtrados; 0,6% a 7,5%), CCN/Yahoo (queda de 93% no ano, dados da Helios),
Linux Foundation (40 organizações desde abril).

Do texto que o Lucas trouxe, **ficou de fora** por não ter apoio no código: swaps no Jupiter,
cofre da Kamino, limite de slippage, "cryptographically guaranteed", Eliza e LangChain (só há MCP e
Vercel AI SDK).

## Passo a passo que vale repetir

### Publicar o site à mão (enquanto o `main` está atrás)

No worktree do branch que está em produção, com o repositório limpo:

```bash
set -a; . <arquivo com CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN>; set +a
export PUBLIC_TURNSTILE_SITEKEY=<a sitekey> PUBLIC_BOOKING_URL= PUBLIC_CONTACT_EMAIL= PUBLIC_WHATSAPP= BLOG_SOURCE=off
node scripts/check-deploy.mjs && pnpm build      # conferir a linha "Result (N files): 0 errors"
pnpm exec wrangler pages deploy dist --project-name ash-web --branch <nome>
```

- `--branch feat/design-v2` (ou qualquer nome que não seja `main`) gera **prévia** em
  `https://<nome>.ash-web.pages.dev`. `--branch main` publica em `ash.app.br`.
- Sempre a prévia primeiro, olhar, e só então a produção.
- Um `dist/` feito com `BLOG_SOURCE=fixture` (o dos testes) **não pode** ser publicado; por isso
  o build é refeito antes de cada deploy.
- Logo depois do deploy, o endereço pode responder por alguns segundos com a versão anterior.
- Depois de mudar o título do topo: `node scripts/og.mjs` refaz a imagem de compartilhamento.

### Publicar o painel (studio)

Da raiz do worktree, com `studio/` sem mudanças pendentes: `bash studio/deploy/deploy.sh`. Ele
envia o `studio/` do último commit, constrói a imagem no servidor e só então troca os contêineres
— se a construção falha, o painel que está no ar continua de pé.

O script chama `docker build -q`, que **esconde a mensagem de erro**. Para ver:

```bash
ssh agent-rails-vps 'cd /opt/ash-studio && sudo docker build --progress=plain -t ash-studio:debug src 2>&1 | tail -70'
```

O que aconteceu no primeiro deploy do M1: os testes que moram em `src/` importam ajudantes de
`tests/`, e `tests/` fica fora da imagem; o `next build` checa os tipos de tudo que está na imagem
e parou. Correção: `**/*.test.ts(x)` no `studio/.dockerignore`. Para reproduzir um erro desses
sem o servidor: copiar `studio/` para um disco NTFS, tirar o que o `.dockerignore` tira, e rodar
`pnpm build`.

Depois do deploy, conferir de fora: `https://pub.ash.app.br/api/public/posts` responde 200 com
JSON; `https://studio.ash.app.br` responde 302 (o login da Cloudflare).

### Conferir o painel no navegador (Lucas, pendente)

1. Criar um autor (com foto) e uma categoria.
2. Criar um post, escrever, salvar e levá-lo de rascunho até publicado.
3. Enviar uma imagem no corpo e uma capa; ver se aparecem (inclusive um arquivo perto de 5 MB e
   um acima).
4. Abrir a prévia do post.
5. Abrir o mesmo post em duas abas, salvar numa e depois na outra: a segunda deve avisar.
6. Sair do editor com texto não salvo: deve avisar.
7. Com o console do navegador aberto, abrir o editor: nenhum erro em vermelho.
8. Uma vez no Firefox ou Safari, e uma vez no celular.

## Porquês que não estão em outro lugar

- **A produção à frente do `main`** é consequência de duas decisões: o site novo precisava ir ao
  ar, e o PR #1 só é mergeado com o Lucas. Resolve-se no merge.
- **O comando de demo ficou no slide 9 do pitch por cerca de uma hora e vinte** depois de sair da
  home: estava fixo em `Deck.astro`, não nos arquivos de texto. Texto que afirma algo do produto
  deve morar em `content/`, não em componente.
- **Três testes de navegador diferentes falharam uma vez cada na suíte completa e passaram
  sozinhos** (`blog-search`, duas vezes; `blog-safety`, uma). O `blog-modes.spec.ts` faz builds em
  paralelo com os outros; é o suspeito, não investigado.
- **O CI do studio não constrói a imagem Docker**: roda `pnpm build` com a árvore inteira, e por
  isso não viu o erro do primeiro deploy.
- **A cobertura de 99,2%** continua no site como o número que o agent-rails declara; não foi
  medida por nós.
- **As fontes do painel** continuam as antigas: trocá-las pede pacotes novos e um build que a
  máquina de desenvolvimento (disco FAT32) não roda.

## Por onde começar na próxima sessão

Está no `docs/ROADMAP.md` §0, em ordem. Em uma linha: o Lucas confere o painel e publica o
primeiro post; com ele publicado, gerar uma prévia do site com o blog ligado; depois o merge do
PR #1 e as três configurações que fazem o blog publicar sozinho.
