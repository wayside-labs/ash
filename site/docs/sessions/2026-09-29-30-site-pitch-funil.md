# Sessão 29–30/09/2026 — do site no ar ao pitch v2 com funil

Participantes: Lucas (decisões) e Claude (execução). Versões: 0.1.0 → 0.4.0. Detalhe de cada
mudança no `CHANGELOG.md`; mapa do código em `docs/CODEMAP.md`; o que falta em `docs/ROADMAP.md`.

## Linha do tempo

| Quando | O quê | Por quê |
|---|---|---|
| 29/09 tarde | Site em Astro no repo `ash-web`, Cloudflare Pages | Repo próprio, sem nada do agent-rails; fora da VPS compartilhada |
| 29/09 noite | `ash.app.br` migrado do cPanel para a Pages | DNS conferido pela API antes de mexer; console do Ronaldo e e-mail intactos |
| 29/09 noite | Paleta = a do console | "Uma identidade só" — regra em `docs/design-system.md` |
| 29/09 noite | Skill de copy com Sexy Canvas (só gatilhos confirmados) | Fontes públicas se contradizem; nada inventado |
| 29/09 noite | **Deploy com link de exemplo em todos os botões** | O build lê o `.env`; o `.env.example` tinha `cal.com/exemplo`. Corrigido e documentado |
| 30/09 | **Reposicionamento no ganho** | "Quem vai nos contratar para poder perder?" — título "orçamento, nunca a chave" + três pilares |
| 30/09 | `/pitch` e `/investidor` com deck único | O investidor tem que ser sempre cópia do pitch: garantido por construção + e2e |
| 30/09 | API de lead (D1 + Turnstile + Listmonk) com **coleta desligada** | Privacidade: sem controlador e canal de exclusão não se coleta |
| 30/09 | **Popup travava o visitante** com a coleta desligada | Erro de UX nosso; a trava de coleta não pode travar a pessoa. Corrigido + teste de regressão |
| 30/09 | Fechamento do investidor ("obrigado pelo nome", "quer conversar?") | Pedido do Lucas: CTA depois da última tela |
| 30/09 | Painéis do Claude Design no site (topo + "veja funcionando") e no pitch | Pedido do Lucas; cada painel aparece uma vez |
| 30/09 | **Número do x402 corrigido no site** | 75M/US$ 24M era o contador da página do x402 (possivelmente parado); TRM Labs é a fonte sólida |
| 30/09 | Pitch v2 de 18 telas | Estrutura pedida: dor, solução, concorrentes, diferenciais, mercado, modelo, time, pedido, obrigado |
| 30/09 | Plano de blog, X e prospecção | Documentado, nada construído |

## Decisões que valem daqui para frente

- **Copy vende o "sim", não a perda.** Risco é motivo, não promessa. Regra na skill
  `writing-ash-marketing-copy`.
- **Número só com fonte, e a fonte é a original.** A pesquisa de 30/09 derrubou dois números que
  circulavam nos nossos documentos (x402 e "Visa ~US$ 7 bi"). Antes de pôr número em slide, checar
  quem mediu e o que mediu.
- **O pitch mora num arquivo só** (`content/pitch.*.ts`); `/pitch` e `/investidor` desenham o
  mesmo componente.
- **Nenhum valor de exemplo em `.env.example`**, e `lib/contact.ts` recusa valores com "exemplo".
- **Deploy manual sempre com as variáveis explícitas** (ver `docs/DEPLOY.md`).
- **Coleta de lead fica desligada** até existir controlador e canal de contato.

## O que deu errado e o que ficou de lição

1. Publiquei sem conferir o que o build ia ler do `.env` → link quebrado no ar por algumas horas.
   Lição: ler o que vai para o HTML antes de publicar; valor de exemplo nunca em arquivo copiável.
2. Tratei o 503 da coleta desligada como erro de rede → o Lucas ficou preso no popup. Lição:
   testar o caminho "desligado de propósito" como caminho feliz.
3. Usei um número de mercado herdado sem conferir a fonte original → estava no ar. Lição: todo
   número de slide passa por verificação antes, não depois.

## Onde está o resto

- Pesquisas: `agenttokenfy/.aios/research/2026-09-30-mercado-e-concorrentes-pitch.md` e
  `…/2026-09-30-privacy-investidor.md` (locais, não versionadas).
- Registro interno detalhado: `agenttokenfy/.aios/session-log/2026-09-29-correio-backups-alertas-e-site-colosseum.md`.
- Referência visual: `agenttokenfy/docs/product/Agent Rails Workflow Panel (standalone).html` e v2
  (do Lucas, não versionados no repo do Ronaldo).
