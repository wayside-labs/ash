# 2026-10-05 — O deck de 11 telas vira o /pitch

## O que mudou

`/pitch` e `/pt/pitch` mostravam as 18 telas do `Deck.astro`. Passaram a mostrar o deck de 11
telas que o Ronaldo trouxe como arquivo pronto (`public/pitch-deck/{en,pt}.html`). Está no ar em
`ash.app.br` desde a noite de 05/10.

## Decisões

- **Do Lucas: o deck de 11 telas substitui o de 18 no `/pitch`.** A primeira versão (do Ronaldo)
  abria o deck por cima da página, e só quando o endereço terminava em `#2-pt` ou `#2-en`; sem o
  hash, o `/pitch` seguia mostrando as 18 telas.
- **Do Lucas: sem a trilha de miniaturas** que o deck desenha à esquerda.
- **Minha, para o Lucas e o Ronaldo confirmarem: o funil do investidor não mudou.** `/investor` e
  `/pt/investidor` continuam com as 18 telas. O funil depende do `Deck.astro` (o evento
  `deck:end` abre a tela de agradecimento), e migrá-lo é outro trabalho. Consequência: quem
  recebe o link do funil vê um pitch diferente de quem recebe o `/pitch`.
- **Os links `#2-pt` e `#2-en` continuam valendo**, agora como escolha de idioma.

## Como funciona

`components/pitch/DeckFrame.astro` é a página inteira:

1. **Escolhe o deck.** O `src` do `iframe` sai no HTML com o idioma da página; um script troca
   quando o hash é `#2-pt` ou `#2-en`. O botão "Fechar" virou o link do outro idioma, porque não
   há mais nada por baixo.
2. **Esconde a trilha.** O deck esconde a trilha quando recebe a mensagem
   `{ __omelette_presenting: true }`, que ele só manda a si mesmo em tela cheia. A moldura manda
   essa mensagem sempre que encontra a trilha visível (confere a cada 250 ms), porque o deck
   carrega tarde, troca com o hash e perde o estado ao sair da tela cheia. O arquivo do deck não
   foi alterado. No carregamento a trilha pode aparecer por uma fração de segundo.
3. **Entrega as setas.** O deck só ouve o teclado com o foco dentro do `iframe`. A moldura passa
   o foco e repete a tecla (setas, PageUp/PageDown, Home, End, espaço). Assim as setas funcionam
   sem clicar antes e o link "pular para o conteúdo" continua sendo a primeira parada do Tab.

A tela 6 do deck emoldura `/pitch-deck/flow/{pt,en}/`, que desenha a tela de fluxo do `Deck.astro`
com `only="flow"`.

## O que foi conferido

- `astro check`: 0 erros em 140 arquivos. `pnpm test`: 425 de 425.
- Playwright, `tests/e2e/pitch.spec.ts` mais os testes do pitch em `smoke.spec.ts`: 18 de 18,
  já com a conferência de que a trilha fica escondida. O resto da suíte e2e (blog) não foi rodado.
- Prévia e produção, em navegador automatizado: 11 telas nos dois idiomas, a tela 6 com o fluxo,
  última tela, `#2-pt` e `#2-en`, troca de idioma, 375 px sem estouro horizontal, sem erro no
  console, trilha escondida.
- O resto do site idêntico ao que estava no ar. As páginas de privacidade só diferem pela
  ofuscação de e-mail que a Cloudflare aplica no domínio.

## O que quebrou no caminho

- **O pnpm deixa de fora um pacote que o `astro check` usa.** Com `node-linker=hoisted`, tanto o
  pnpm 10.6.5 quanto o 9.12.0 instalam sem `@napi-rs/wasm-runtime` e `@emnapi/runtime` nesta
  máquina, e o `astro check` avisa da falta mas **não derruba o build**: o `pnpm build` segue e
  gera o site sem checar os tipos. Conferir sempre a linha `Result (N files): 0 errors`. Aqui o
  conserto foi copiar os dois pacotes de uma instalação antiga com o mesmo lockfile. Não sei se
  acontece no Linux do CI.
- **O servidor de teste segura o `dist/`.** Com `scripts/serve-dist.mjs` rodando, o `astro build`
  falha com `EPERM` ao limpar `dist/pitch-deck` no Windows. Encerrar o servidor antes de buildar.
- **A prévia leva alguns segundos para trocar.** Logo depois do deploy, o endereço fixo da prévia
  ainda serviu a versão anterior, e a primeira conferência deu um falso "não funcionou".
- **A Cloudflare tira o `.html`.** `/pitch-deck/pt.html` responde 308 para `/pitch-deck/pt`. O
  `iframe` segue o redirecionamento; quem procura a moldura pelo endereço precisa saber disso.

## Passo a passo: publicar a partir de `site/` no repositório `wayside-labs/ash`

A pasta `site/` fica fora do workspace pnpm da raiz. Tudo roda dentro dela.

```bash
cd site
# 1. Instalar só o site, com o pnpm da época do lockfile (a raiz fixa outra versão).
CI=true COREPACK_ENABLE_STRICT=0 corepack pnpm@9.12.0 install --ignore-workspace --frozen-lockfile

# 2. Variáveis de produção: blog desligado, canais de contato vazios, a site key do Turnstile.
export PUBLIC_TURNSTILE_SITEKEY=<a site key> PUBLIC_BOOKING_URL= PUBLIC_CONTACT_EMAIL= PUBLIC_WHATSAPP= BLOG_SOURCE=off CI=true

# 3. Buildar. Conferir "Result (140 files): 0 errors" e "11 page(s) built".
node scripts/check-deploy.mjs && COREPACK_ENABLE_STRICT=0 corepack pnpm@9.12.0 build

# 4. Prévia primeiro (qualquer nome de branch que não seja main).
set -a; . <arquivo com CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN>; set +a
COREPACK_ENABLE_STRICT=0 corepack pnpm@9.12.0 exec wrangler pages deploy dist --project-name ash-web --branch <nome> --commit-dirty=true

# 5. Olhar a prévia. Só então, o mesmo dist em produção:
COREPACK_ENABLE_STRICT=0 corepack pnpm@9.12.0 exec wrangler pages deploy dist --project-name ash-web --branch main --commit-dirty=true
```

Antes de publicar, vale conferir que as variáveis reproduzem o que está no ar: em 05/10 a home de
produção não tinha `mailto:` nem link de agenda, e o `/investor` carregava a mesma site key.

## Em aberto

- Migrar o funil do investidor para o deck de 11 telas, ou assumir os dois pitches.
- Rodar a suíte e2e inteira (os testes do blog pedem o build com `BLOG_SOURCE=fixture`).
- O deck exibe o selo "Made with Claude Design" no canto inferior direito; vem do arquivo.
- O e2e do site não roda no CI (o workflow roda `pnpm test` e `pnpm build`).
- `content/pitch.{en,pt}.ts` ainda descreve 18 telas que só o funil mostra.
