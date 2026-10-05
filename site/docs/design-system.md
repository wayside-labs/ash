# System design do Ash — v2 (a identidade própria do site)

**Vale a partir de 2026-10-02.** Substitui a v1 ("uma identidade só com o console").

## O que mudou e por quê

O Lucas desenhou uma home nova no Claude Design ("Ash Home") e decidiu levar aquele visual ao site
inteiro: verde novo com brilho, Chakra Petch e IBM Plex, mascote robô, clima de terminal.

- **O console não muda por enquanto.** O console (`wayside-labs/agent-rails`, pacote
  `packages/dashboard`) continua com a paleta dele. A regra antiga — o site copia os tokens do
  console e ninguém escolhe cor aqui sem olhar lá — está **suspensa do lado do site**. Enquanto
  durar, quem sai do site e abre o console vê duas identidades; isso é sabido e aceito.
- **O texto não mudou.** A troca foi de cor, letra, forma e marca. A copy nova vem depois.
- **Os nomes dos tokens ficaram; os valores mudaram.** É o que re-veste todas as páginas de uma vez.

### A referência

`docs/design/ash-home-reference.html` é o fonte do desenho: estilos em linha e um motor de template
próprio (`sc-for`, `{{ }}`). É **desenho, não código para copiar** — dele saem valores (cor,
tamanho, espaçamento, raio), que viram tokens e CSS com escopo. **O texto que está dentro dele é a
copy antiga e não é fonte de texto**: se a referência e o site divergem numa frase, vale o site
(`src/content/copy.*.ts`).

## Tokens de cor

Em `src/styles/tokens.css`. Só existe tema escuro.

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#070908` | fundo da página |
| `--bg-alt` | `#090c0a` | seção alternada (`.band-alt`) |
| `--surface` | `#0b0f0c` | cartão |
| `--elevated` | `#131a15` | chip, campo de formulário, cartão dentro de cartão |
| `--sunken` | `#050706` | bloco de código, linha de comando |
| `--ink` | `#e6ebe7` | título, texto forte |
| `--body` | `#b9c3bd` | parágrafo de destaque (subtítulo do topo, fechamento) |
| `--muted` | `#a8b3ac` | parágrafo |
| `--faint` | `#8a958e` | rótulo, legenda |
| `--line` | `#18201b` | divisor de seção. **Fraco demais para segurar um cartão.** |
| `--line-strong` | `#2a3a2f` | borda de cartão, de campo e do botão contornado |
| `--settle` | `#3dff6e` | marca, ação e "bom" — um verde só para os três |
| `--settle-hover` | `#7dff9c` | botão primário sob o ponteiro |
| `--settle-soft` | `#9dffb5` | texto sobre fundo verde translúcido; link sob o ponteiro |
| `--settle-ink` | `#04140a` | texto sobre preenchimento verde |
| `--settle-line` | `#234a2e` | borda verde discreta (etiqueta de estado, caixa de destaque) |
| `--accent` | `#3dff6e` | teto/limite. Era periwinkle; agora é o mesmo verde (ver abaixo) |
| `--warning` | `#e0b860` | pausa, aviso — nunca falha |
| `--deny` | `#ff6b5e` | negado: preenchimento, borda, ponto |
| `--deny-soft` | `#ff8a7e` | negado, como **texto** |
| `--code-fg` | `#c9d2cc` | texto de código |
| `--wash` | `rgb(61 255 110 / .07)` | o verde bem fraco dos fundos (`.wash-top`, `.wash-side`) |

### O periwinkle saiu: onde isso custa

Na v1 o periwinkle (`#7C8CFF`) queria dizer "teto, estrutura" e o verde queria dizer "liquidado".
Agora são a mesma cor. O nome `--accent` ficou para o código continuar dizendo "isto é um limite",
mas o olho não distingue mais. Onde duas coisas diferentes ficaram iguais:

- **Barras de limite** (`FlowMap`, `AgentCards`, capa desenhada do blog): o tique do teto e o
  preenchimento do gasto são do mesmo verde. Distingue-se só pela forma (o tique é mais alto que a
  barra). Numa barra quase cheia, o tique some no preenchimento.
- **Cofre do mapa do dinheiro**: o ponto e o valor do "Teto" eram periwinkle; agora têm a cor de um
  pagamento liquidado.
- **Legenda do mapa**: "Pagamento" (linha verde) e "Teto" (tique verde) só diferem na forma.
- **Papéis (seção 02)**: Dono (era periwinkle) e Agente (verde) têm a mesma faixa lateral.
- **Cena do teto** (boas-vindas do `/investidor`): a linha tracejada do limite e os pagamentos
  liquidados são do mesmo verde; o que separa é o tracejado.
- **Pitch**: a linha tracejada da tela "orçamento, nunca a chave" e o filete das telas de número
  continuam fazendo sentido (são marca), mas não dizem mais "teto" por cor.

Se a distinção fizer falta, a saída é dar ao teto uma **forma** própria (tracejado, tique), não
trazer uma segunda cor de volta sem decisão do Lucas.

### Contraste medido (WCAG 2.x, razão de luminância)

Medido em 2026-10-02 para cada par texto/fundo que o site usa. Meta: AA (4,5:1 para texto normal).
**Nenhum tom precisou de ajuste**: todos os tokens de texto passam em todos os fundos.

| Texto | `--bg` | `--bg-alt` | `--surface` | `--elevated` | `--sunken` |
|---|---|---|---|---|---|
| `--ink` | 16,55 | 16,28 | 16,00 | 14,67 | 16,74 |
| `--body` | 11,03 | 10,86 | 10,67 | 9,78 | 11,16 |
| `--muted` | 9,23 | 9,09 | 8,92 | 8,18 | 9,34 |
| `--faint` | 6,44 | 6,34 | 6,22 | 5,71 | 6,51 |
| `--settle` | 14,96 | 14,72 | 14,46 | 13,26 | 15,13 |
| `--settle-soft` | 16,55 | 16,29 | 16,00 | 14,67 | 16,74 |
| `--deny` | 7,15 | 7,03 | 6,91 | 6,34 | 7,23 |
| `--deny-soft` | 8,74 | 8,60 | 8,45 | 7,75 | 8,84 |
| `--warning` | 10,65 | 10,48 | 10,29 | 9,44 | 10,77 |

Outros pares: `--settle-ink` sobre `--settle` **14,17**; sobre `--settle-hover` **15,01**;
`--settle-soft` sobre verde a 7% em cima de `--surface` **14,11**; `--deny-soft` sobre vermelho a
8% em cima de `--surface` **7,76**.

O que **não** passa, e por isso não serve para texto: o `#6f7b73` que a referência usa na etiqueta
"simulated" dá 4,37 sobre `--surface` e 4,01 sobre `--elevated` — o site usa `--faint` no lugar.
`--line-strong` e `--settle-line` são bordas (1,5 a 2,0 contra os fundos): delimitam, não informam
sozinhas. Um campo de formulário é reconhecido também pelo fundo `--elevated` e pelo rótulo.

## Tipografia

Três famílias, pacotes `@fontsource/*`, **servidas pelo próprio site** (nenhuma chamada a Google
Fonts ou a qualquer outro domínio), só o subconjunto `latin` — ele já traz `ã ç é õ` e os demais
acentos do português, conferido em captura de tela. `latin-ext` não é carregado.

| Token | Família | Pesos | Uso |
|---|---|---|---|
| `--display` | Chakra Petch | 600, 700 | `h1`, `h2`, a palavra ASH, números grandes (01/02/03, estatísticas) |
| `--sans` | IBM Plex Sans | 400, 500, 600 | corpo, `h3` e abaixo, botões |
| `--mono` | IBM Plex Mono | 400, 500 | rótulos `// …`, dinheiro, endereços, código |

Escala:

| Token / lugar | Tamanho | Observação |
|---|---|---|
| `--step-5` (`h1`) | `clamp(2.75rem, 6vw, 5.25rem)` (44–84 px) | peso 700, entrelinha 1 |
| `--step-4` (`h2`) | `clamp(2rem, 4vw, 3rem)` (32–48 px) | peso 600, entrelinha 1,08 |
| título de seção numerada (`Section`) | `clamp(30px, 3.6vw, 42px)` | fica na coluna estreita |
| `--step-3` | 1,75 rem | `h2` dentro do corpo de um post |
| `--step-2` | 1,375 rem | título de cartão |
| `--step-1` | 1,125 rem | `h3` |
| corpo | 16 px / 1,6 | parágrafo de destaque 17–19 px |

Chakra Petch é larga: um título que cabia em Inter pode quebrar uma linha a mais. Conferir em 375,
768 e 1440 sempre que um título novo entrar.

### O rótulo mono ("kicker")

A linha pequena acima de um título: mono, 12 px, verde, maiúsculas, espaçamento `.08em`.

- `.kicker-slash` escreve `// ` na frente (o comentário de terminal): `// WHY NOW`. As barras são
  CSS (`::before`, com alternativa vazia para leitor de tela); **o texto do rótulo continua vindo
  da copy, sem as barras**.
- `.kicker-dot` põe o quadradinho verde na frente (topo da home, categoria no blog).

## Forma e profundidade

- **Raios** (`--radius-*`): `sm` 4 px (chip, etiqueta, botão de idioma), `md` 6 px (botão, campo),
  `lg` 10 px e `xl` 14 px (cartão).
- **Cartão é superfície mais borda**, nada além: `--surface` com borda `--line-strong`
  (`.surface-card`). O friso de luz interno da v1 saiu.
- **Brilho** (`box-shadow`/`text-shadow` verde em baixa opacidade) é a única sombra que existe, e
  **só** em quatro lugares:
  1. botão primário (`--glow-button`);
  2. as palavras em destaque do título do topo (`.glow-title`);
  3. os números 01 / 02 / 03 (`.glow-number`);
  4. barras de progresso (`--glow-bar`: barras de limite, barra do deck).

  Nada de brilho em cartão, logo, ícone, borda ou texto corrido. No papel (`@media print`) todo
  brilho some.
- **Seções** são faixas de largura inteira (`.band`) com um filete `--line` em cima; alternam com
  `.band-alt`. As que abrem um assunto podem levar o gradiente radial verde bem fraco
  (`.wash-top`, `.wash-side`). Verde em área grande cansa: ele é acento, nunca fundo.
- **Botões**: primário = preenchimento verde, texto `--settle-ink`, brilho, `--settle-hover` sob o
  ponteiro. Secundário (`variant="ghost"`) = contorno `--line-strong` que fica verde sob o ponteiro.
- **Foco**: contorno de 2 px em `--settle`, afastado 3 px, em tudo que recebe teclado.

## Movimento

- `prefers-reduced-motion: reduce` desliga **toda** animação e transição (`base.css`). O estado
  parado é o estado final: o que pisca fica aceso, o anel não gira, o brilho não pulsa.
- Piscar (`ashBlink`), anel girando (`ashSpin`) e brilho pulsante, quando entrarem com a home nova,
  seguem essa regra sem exceção.
- Lenis e GSAP continuam só onde já estavam (`src/lib/motion.ts`); o deck não usa.

## O mascote

Um robô de tela verde, **gerado pelo Lucas no ChatGPT** (imagem de IA; não há fotógrafo nem
ilustrador a creditar). São três imagens do mesmo personagem:

| Imagem | Onde | Tamanho na tela | Arquivos (1× / 2×) |
|---|---|---|---|
| `face` — rosto | logo no cabeçalho e no topo do pitch; rodapé; capa desenhada do blog; favicon | 34 px (logo), 22 px (rodapé, capa) | `face-34` / `face-68`, `face-22` / `face-44` |
| `body` — corpo inteiro | topo da home (entra no lote da home) | até 480 × 600 | `body-480` / `body-753` |
| `closeup` — close | fechamento da home (entra no lote da home) | até 388 × 388 | `closeup-388` / `closeup-700` |

- **Fontes** em `src/assets/mascot/source/` (WebP qualidade 95, 367 KB somados; os PNG originais,
  2,9 MB, não entram no git). **Derivados** em `src/assets/mascot/`, AVIF e WebP, gerados por
  `node scripts/mascot.mjs` e versionados: o build não processa imagem, o visitante baixa o que
  está no git. O mesmo script gera `public/favicon.ico`, `favicon.png` e `apple-touch-icon.png`.
- O `body` é recortado para o quadro 4:5 do topo (o miolo da imagem 16:9); o 2× é o máximo que o
  original permite (753 px, cerca de 1,6×).
- **Componente**: `src/components/Mascot.astro` — `<picture>` com AVIF e WebP, `width`/`height`
  declarados, `loading` e `fetchpriority` por propriedade. A do topo carrega com prioridade
  (`loading="eager" fetchpriority="high"`); as outras, preguiçosas.
- **Peso para o visitante** (um arquivo de cada imagem): de 36 KB (AVIF, 1×) a 110 KB (WebP, 2×),
  somando as três. Meta do plano: abaixo de 250 KB.
- **Texto alternativo**: onde o nome "Ash" está escrito ao lado (logo, rodapé, capa), `alt=""` —
  a imagem é enfeite e o leitor de tela já lê o nome. No topo e no fechamento o `alt` descreve o
  que se vê e vem dos textos de interface (`copy.en.ts` e `copy.pt.ts`, juntos), por exemplo
  "Ash, o robô mascote, fazendo sinal de positivo".

Pode: espelhar (`scaleX(-1)`), máscara radial, linhas de varredura, recorte circular — tudo CSS
sobre os mesmos arquivos. Não pode: recolorir, distorcer, gerar "outro Ash" numa pose nova sem o
Lucas, usar como fundo de texto, pôr brilho no logo, usar o PNG original numa página.

## Onde isso vive em código

- `src/styles/tokens.css` — cores, brilhos, famílias, escala, raios.
- `src/styles/base.css` — títulos, `.btn`, `.surface-card`, `.kicker-slash`/`.kicker-dot`,
  `.band`/`.band-alt`/`.wash-*`, `.glow-title`/`.glow-number`, `.brand-face`/`.wordmark`, `.num`,
  movimento reduzido, impressão.
- `src/components/Section.astro` — a faixa com título à esquerda; `alt` alterna o fundo; `kicker`
  é o número grande.
- `src/components/Header.astro` · `Footer.astro` · `pitch/Top.astro` — rosto do mascote + "ASH".
  O nome é escrito "Ash" e desenhado em maiúsculas por CSS.
- `src/lib/ceiling-scene.ts` — não tem cor no código; lê os tokens via `getComputedStyle`.
- `src/components/showcase/` — `FlowMap` e `AgentCards`. Semântica: verde = liquidado/ativo/teto;
  âmbar = pausado ou perto do limite; vermelho = negado.

## Pendências conhecidas

- `public/og.png` ainda é o da identidade antiga (refazer com `scripts/og.mjs` no acabamento).
- O painel do studio (`studio/src/app/globals.css`) ainda está na paleta antiga.
- O Design System publicado como Artifact do Claude (`claude.ai/artifact/EU34a5fdwcXYXk1rMQckGx`)
  descreve a v1 e está desatualizado.
