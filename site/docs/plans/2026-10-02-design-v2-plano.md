# Design v2 — a identidade nova do site: plano

> **Para agentes:** SUB-SKILL: superpowers:subagent-driven-development. Trabalho de **porte visual**:
> a referência é `docs/design/ash-home-reference.html` (o fonte que o Lucas desenhou no Claude
> Design, com estilos em linha). Traz-se o **visual e a estrutura**; o **texto do site não muda**.
> Cada lote termina com capturas de tela olhadas de verdade e os testes verdes.

**Objetivo:** o site inteiro (home, pitch, funil do investidor, privacidade, blog) e depois o
painel do studio passam a usar a identidade do `Ash Home`: verde novo com brilho, Chakra Petch e
IBM Plex, mascote robô, clima de terminal.

**Decisões do Lucas (02/10/2026):**
- Layout novo **de forma geral**, no site todo.
- **A copy fica como está.** A copy nova vem depois do BP. O texto dentro da referência é a copy
  antiga e não é fonte de texto.
- **O console do Ronaldo não muda por enquanto.** O site passa a ter identidade própria; a regra
  "uma identidade só com o console" fica suspensa do lado do site.
- **O mascote foi gerado pelo Lucas no ChatGPT.** Registrar a origem no design system.

**Branch:** `feat/design-v2`, saído de `feat/ash-studio`, numa área de trabalho própria
(`F:\AceleradoraECO\ash-web-design`). Nada vai ao ar sem o Lucas ver.

## Decisões travadas

1. **Os nomes dos tokens ficam; os valores mudam.** O site inteiro lê `src/styles/tokens.css`,
   então trocar os valores re-veste blog, pitch e privacidade sem tocar em cada componente.

   | Token | Antes | Agora | Uso |
   |---|---|---|---|
   | `--bg` | `#08080A` | `#070908` | fundo |
   | `--bg-alt` (novo) | — | `#090c0a` | seção alternada |
   | `--surface` | `#0F0F12` | `#0b0f0c` | cartão |
   | `--elevated` | `#17171B` | `#131a15` | chip, campo |
   | `--sunken` (novo) | — | `#050706` | bloco de código |
   | `--ink` | `#F4F4F5` | `#e6ebe7` | título, texto forte |
   | `--body` (novo) | — | `#b9c3bd` | parágrafo de destaque |
   | `--muted` | `#A1A1AA` | `#a8b3ac` | parágrafo |
   | `--faint` | `#7A7A85` | `#8a958e` | rótulo, legenda |
   | `--line` | `#27272E` | `#18201b` | divisor de seção |
   | `--line-strong` | `#3A3A44` | `#2a3a2f` | borda de cartão e de botão secundário |
   | `--settle` | `#14F195` | `#3dff6e` | marca, ação, "bom" |
   | `--settle-hover` (novo) | — | `#7dff9c` | hover do botão primário |
   | `--settle-soft` (novo) | — | `#9dffb5` | texto sobre fundo verde translúcido |
   | `--settle-ink` | `#08080A` | `#04140a` | texto sobre verde |
   | `--settle-line` (novo) | — | `#234a2e` | borda verde discreta |
   | `--accent` | `#7C8CFF` | `#3dff6e` | o periwinkle sai: teto e link passam a verde |
   | `--warning` | `#FAB219` | `#e0b860` | pausa, aviso |
   | `--deny` | `#F0575A` | `#ff6b5e` | negado (texto: `--deny-soft` `#ff8a7e`, novo) |

   Antes de fixar, conferir o contraste de cada par texto/fundo (meta AA; anotar os valores no
   design system) e ajustar um tom se algum texto pequeno ficar abaixo.
2. **Tipografia:** `--display` = Chakra Petch (600 e 700; títulos, números grandes, a palavra ASH),
   `--sans` = IBM Plex Sans (400, 500, 600), `--mono` = IBM Plex Mono (400, 500; rótulos `// …`,
   números, código). Pacotes `@fontsource/*`, só os subconjuntos latinos, **servidos pelo próprio
   site** — nenhuma chamada ao Google Fonts. Inter e JetBrains Mono saem. Escala de títulos da
   referência: `clamp(44px, 6vw, 84px)` no topo, `clamp(32px, 4vw, 48px)` nas seções.
3. **Profundidade:** a regra antiga ("nunca sombra") muda. Brilho verde (`box-shadow`/`text-shadow`
   com o verde em baixa opacidade) **só** no botão primário, na palavra em destaque do título do
   topo, nos números 01/02/03 e nas barras de progresso. Cartões continuam por superfície e borda.
   Fundos de seção podem ter o gradiente radial verde bem fraco da referência.
4. **Raios:** botão 6px, chip 4px, cartão 10–14px (referência). Atualizar `--radius-*`.
5. **Mascote** (`src/assets/mascot/`): três imagens — corpo (topo), close (fechamento), rosto (logo
   e favicon). Geradas em AVIF e WebP nos tamanhos realmente usados (1× e 2×), com `width`/`height`
   declarados, a do topo com prioridade de carregamento e as outras preguiçosas. Meta: as três
   somadas abaixo de ~250 KB no que um visitante baixa (hoje são 2,9 MB em PNG). Texto alternativo
   pelos textos de interface. O espelhamento, a máscara radial e as linhas de varredura da
   referência são CSS. Origem registrada no design system: imagem gerada pelo Lucas no ChatGPT.
6. **Movimento:** piscar (`ashBlink`), anel girando e brilho pulsante respeitam
   `prefers-reduced-motion` — parado é o estado final. Lenis/GSAP continuam só onde já estavam.
7. **Estrutura da home** (EN e PT), na ordem da referência, cada seção com o texto que o site já tem:

   | Seção da referência | Componente hoje | O que muda |
   |---|---|---|
   | Topo com mascote + chip do cofre | `Hero` (com `FlowMap`) | mascote no lugar do mapa; chip "vault / ceiling" |
   | See it run: cartões de agente + "run a payment" | `Showcase`/`AgentCards` | três cartões na grade, barra com totais, botão que simula um pagamento |
   | Why now | `Momentum` | duas colunas, citação com filete |
   | Blank cheque | `Pain` | três cartões em tom de erro + linha final em mono |
   | 01 / 02 / 03 | `Pay`, `Roles`, `Proof` | número grande em verde, duas colunas |
   | Who it's for | `Audiences` | três cartões com botão contornado |
   | Why not native allowances | `Objection` | tabela de duas colunas |
   | Fechamento com mascote | `Closing` | mascote em círculo, anel tracejado, balão |

   O `FlowMap` sai do topo da home e **continua existindo**: é a tela 5 do pitch e o bloco `mapa`
   do blog. Rótulos novos que a referência usa e o site não tem (`ASH · UNIT 01`, `ONLINE`,
   `simulated`, `run a payment`, os `// …` das seções) entram como **texto de interface** em
   `copy.en.ts` e `copy.pt.ts` juntos. Nenhuma frase existente é reescrita, cortada ou movida de
   chave; se a referência e o site divergem no texto, vale o site.
8. **Cabeçalho:** rosto do mascote + "ASH" em Chakra Petch. O da referência quebra em duas linhas
   no celular: aqui não pode — manter a regra atual (menu some abaixo do corte, botão e idioma
   ficam) e o que o M1c acrescentou (link Blog condicional, uma linha em 768 px, pular para o
   conteúdo, filtro do endereço de agenda).
9. **Pitch e funil:** o `Deck` é re-vestido pelos tokens e pela tipografia; as 18 telas têm de
   continuar cabendo (sem transbordar) em 1440×900, 1280×720 e no celular. O e2e que garante que
   `/pitch` e `/investor` mostram as mesmas telas continua valendo.
10. **`og.png`** refeito com a identidade nova (`scripts/og.mjs`), e favicon com o rosto do mascote.
11. **Studio:** `studio/src/app/globals.css` recebe os mesmos valores e as mesmas fontes, por
    último. O console (`wayside-labs/agent-rails`) **não** é tocado.
12. **O que não muda:** rotas, SEO, hreflang, a lógica do blog, os testes de conteúdo
    (`tests/unit/copy.test.ts`), o modo `off` do blog, nenhuma chamada a terceiros.

## Lotes

- **Lote 1 — fundação:** dependências de fonte, `tokens.css`, `base.css`, `Button`, `Section`,
  `Header`, `Footer`, favicon, mascote otimizado, `docs/design-system.md` v2 (substitui o atual,
  com a tabela de tokens, o contraste medido, as regras de brilho, de movimento e do mascote).
  Resultado: o site inteiro já aparece com cores e fontes novas. Capturas **antes e depois** de
  todas as páginas (home, pitch, investidor, privacidade, índice e post do blog; EN e PT; 375 e
  1440) para achar o que a troca quebrou.
- **Lote 2 — a home** na estrutura nova, EN e PT, com a simulação "run a payment".
- **Lote 3 — acabamento:** pitch e funil conferidos tela a tela, blog e privacidade ajustados onde
  a troca de tokens não bastou, `og.png`, studio, documentação (`CODEMAP`, `CHANGELOG`, `ROADMAP`).

## Minas conhecidas

- O `feat/ash-studio` ainda recebe correções da revisão do M1c: este branch vai precisar trazê-las
  (merge) antes de fechar. `Header`, `Base` e `base.css` são os pontos de atrito.
- `pnpm add` neste computador remove `@napi-rs/wasm-runtime` e o `astro check` passa a ser pulado
  em silêncio: depois de instalar fontes, rodar `pnpm install --force --frozen-lockfile` e conferir
  que a linha de resultado do `astro check` aparece no build.
- A referência usa estilos em linha e um motor de template próprio (`sc-for`, `{{ }}`): é desenho,
  não código para copiar. Os valores (cores, tamanhos, espaçamentos) é que se portam, para CSS com
  escopo e tokens.
- Verde `#3dff6e` em área grande cansa: seguir a referência, onde ele é acento, não fundo.
- O texto alternativo e os rótulos novos passam pelo teste de paridade EN/PT.
- A pasta `dist/` e as capturas não entram no git.
