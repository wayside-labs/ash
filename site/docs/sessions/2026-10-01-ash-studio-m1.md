# Sessão 01/10/2026 — ash-studio M1: motor, painel e a lógica do blog no site

Participantes: Lucas (decisões) e Claude (execução, com agentes de implementação e de revisão).
Branch `feat/ash-studio`, PR #1 em rascunho. O que mudou está no `CHANGELOG.md`; o mapa em
`docs/CODEMAP.md`; o que falta em `docs/ROADMAP.md`. Planos, com a seção "Desvios na
implementação": `docs/plans/2026-10-01-ash-studio-m1{a,b,c}-plano.md`.

## Linha do tempo

| Quando | O quê | Por quê |
|---|---|---|
| madrugada | **M1a, motor do blog**, em três lotes | A sessão anterior caiu logo depois do plano; retomado dali |
| madrugada | Túnel SSH do banco de teste caiu três vezes | Suíte de 15 min por rodada e instável |
| manhã | Push do M1a no PR #1; CI verde | Prova o build em Linux — no drive `F:` (FAT32) o `next build` não roda |
| tarde | **M1b, painel**, em três lotes | "Vamos fazer o commit e push e, em paralelo, dar início à próxima fase" |
| tarde | Postgres 17 local (`embedded-postgres`) para os testes | Suíte inteira em ~1–2 min; o túnel deixou de ser necessário |
| tarde | Revisão do painel em **navegador de verdade** (Edge headless por CDP) | Nem build nem dev server rodam no `F:`; jsdom não pega foco, Esc, seleção |
| tarde | **M1c, lote 1** (dados e lógica do blog no site) | "Vamos pro M1c" |
| noite | Pesquisa de mercado, perdas e x402 + red teams + síntese | Pedido do Lucas, para site, pitch e um BP interno |
| noite | M1c pausado no lote 1; BP e copy esperam o relatório do Ronaldo | Decisão do Lucas |

## Decisões que valem daqui para frente

**Motor (M1a)**
- Autor com post não pode ser apagado (FK `restrict`); categoria apagada só desvincula.
- Salvar um post manda o **documento inteiro**: campo omitido é campo limpo; texto vazio vira `null`.
- Corpo com teto de 300 mil caracteres, na validação e no sanitizador (entrada e saída).
- Link só `https?:`, `mailto:`, `#` ou caminho com uma `/` inicial; imagem só de `/media/`.
- `published_at` é a primeira publicação e sobrevive a despublicar e republicar.
- A chave de deduplicação do rebuild inclui o minuto, para não mexer no índice da fila do M0, que
  fazia perder uma publicação feita durante um rebuild em execução.
- `/api/health` fica vermelho com job morto em 24 h ou erro no último ciclo; `?probe=live` mantém a
  semântica antiga e é o que o compose e o `deploy.sh` usam.
- O token do GitHub vai só para o worker; o app recebe a flag `SITE_REBUILD`.

**Painel (M1b)**
- O post nasce antes do editor (título, idioma, autor); por isso o upload exige um post existente e
  não há imagem órfã de post nunca salvo.
- Salvar é explícito (botão e Ctrl+S), sem autosave, e só quando há alteração.
- Toda gravação e toda mudança de estado levam a versão que a tela abriu (`if_updated_at`); se
  outra pessoa salvou depois, a ação é recusada. Vale para o editor e para as três listas.
- Uma mudança de estado é recusada enquanto houver alteração não salva.
- Bloco especial só no nível principal do texto.
- Sem `window.prompt`/`confirm`: diálogos próprios, que não fecham com Esc no meio de um pedido.

**Blog no site (M1c)**
- Três modos de fonte (`BLOG_SOURCE`): `api` (falha o build em vez de publicar blog vazio por
  erro), `fixture` (PR, testes) e `off`, o padrão, que não gera página nem link.
- Blog estático, sem pedido a terceiros: as imagens são baixadas no build.
- Um blog vazio mas válido é aceito no modo `api` (studio sem nada publicado).
- Tag sem letra latina derruba o build; datas no fuso de Brasília nos dois idiomas.

## O que as revisões pegaram antes de ir ao ar

- Expressão regular que travaria o painel por até 88 s com entrada maliciosa de 46 KB.
- `href="/\evil.com"` passando pelo sanitizador; data sem horário virando o dia anterior.
- Publicação perdida quando feita durante um rebuild; rebuild morto sem ninguém ver.
- Upload sem checagem de origem; categorias e autores sem post publicado na API pública.
- No painel, em navegador: post criado em dobro; erro que sumia com Esc; bloco e imagem recém
  inseridos sendo substituídos pela tecla seguinte; Ctrl+S gravando sem alteração; cursor escondido
  atrás da barra fixa; `.surface-card` fora de camada no Tailwind 4.

## Não verificado

- **Nada do M1a nem do M1b foi implantado.** O `deploy.sh` e as mudanças do compose nunca rodaram.
- O navegador de teste era um pacote só de cliente, com as actions em stub: hidratação, gravação
  real, upload real pela Cloudflare, Firefox e Safari não foram exercitados.
- Do M1c só existe a lógica; nenhuma página foi desenhada.

## Para o Lucas conferir depois do deploy

1. Console ao abrir `/blog/[id]`: avisos de hidratação em volta do editor.
2. Salvar e mudar de estado de verdade; depois, o conflito com duas abas no mesmo post.
3. Upload real: um arquivo perto de 5 MB, um acima, a imagem voltando de `/media`, a foto de autor.
4. "Sair sem salvar" navegando de fato, e a criação de post levando ao editor.
5. Voltar do navegador com texto não salvo (sem aviso, por limitação do Next).
6. Colar do Google Docs e do Word; arrastar um bloco ou uma imagem.
7. Firefox e Safari uma vez; um celular, com o teclado sob as duas barras fixas.
8. `/blog/[id]/previa`.
9. No primeiro deploy: health respondendo, `GITHUB_DISPATCH_TOKEN` vazio no container `app`.

## Limites conhecidos (também em `studio/README.md`)

Tabela e figura achatadas ao salvar (o editor avisa); lista numerada sempre começa em 1; texto
colado perde cores, fontes e sublinhado; voltar e avançar do navegador não avisam; imagem enviada
e nunca usada fica no disco; bloco especial colado junto com texto dentro de uma lista divide a lista.

## Método que vale repetir

- **Banco de teste local:** `embedded-postgres` (Postgres 17.10) numa pasta temporária, porta
  54330, um banco por agente. Duas suítes no mesmo banco dão falso "relation does not exist".
- **Revisão de interface em navegador:** empacotar os componentes cliente com esbuild (actions e
  `next/*` em stub), servir em loopback e dirigir o Edge headless por CDP, com teclado, mouse e
  clipboard reais.
- **Um agente commitando por vez;** revisores só leem.
- **Conferir em disco** todo arquivo que um agente disser que gravou: um hook desta máquina bloqueia
  a primeira gravação de arquivo novo, e cinco relatórios foram dados como gravados sem existir.

## A pesquisa e a copy

A pesquisa de 01/10 (em `agenttokenfy/.aios/research/2026-10-01-*`, começar pela
`sintese-coordenacao`) concluiu que o volume de pagamentos de agentes medido é pequeno e caiu mais
de 90%, que as perdas reais de agentes somam cerca de US$ 0,5 milhão, e que várias frases do site
e do pitch dizem mais do que o código do protocolo garante. **Nenhuma correção foi aplicada:** por
decisão do Lucas, espera-se o relatório do Ronaldo sobre tom de voz e a fusão das duas fontes.
