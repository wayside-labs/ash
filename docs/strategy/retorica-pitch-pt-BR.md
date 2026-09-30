# Agent Rails — retórica de pitch (pt-BR)

**Para:** quem apresenta, grava vídeo, escreve deck ou responde jurado/investidor  
**Não é:** glossário técnico nem tradução literal do inglês de engenharia  
**Regra:** argumento primeiro, slogan depois — e slogan só se soa natural falado em voz alta  
**Par:** leia antes ou junto com [`briefing-negocio.md`](./briefing-negocio.md); índice em [`README.md`](./README.md)

---

## 1. O que não levar para o palco

| Evitar | Por quê | Dizer em vez disso |
|---|---|---|
| *Loosening flows downhill only* / *afrouxar só flui morro abaixo* | Calque de inglês de repositório; em português não evoca hierarquia nem autoridade | **Ninguém aumenta o próprio teto.** O dono fixa o máximo; o operador só pode apertar; o agente não define limite nenhum. |
| *Tetos morro abaixo* | Mesma metáfora quebrada | **Limites só ficam mais restritos conforme desce a cadeia de comando.** |
| Abrir com *nós/nosso* em todo parágrafo | Centra a empresa, não a dor nem a prova | Centrar no **comprador**, no **programa** ou no **terceiro que confere** |
| *On-chain*, *enforcement*, *kill switch* sem tradução | Quebra ritmo e exclui financeiro/jurídico | **Na rede** / **a regra está no programa** / **botão de emergência do agente** (o dono continua podendo sacar) |
| *Prestação de contas* repetido como mantra | Vira jargão vazio | Alternar: **prova**, **extrato que não some em silêncio**, **histórico que um auditor confere sem sua palavra** |

O inglês *loosening flows downhill only* continua válido **entre devs e em ADRs**. No pitch em português, use a coluna da direita.

---

## 2. Estrutura argumentativa (qualquer duração)

1. **Gancho (dor):** dar carteira ao agente = dar o saldo inteiro; cartão virtual não escala para dezenas de agentes nem para cripto entre contas.
2. **Virada (categoria):** o mercado investe em *como* o agente paga; falta *quanto pode perder* — com evidência, não com slide.
3. **Mecanismo (uma imagem):** cartão corporativo com quatro papéis — dono, operador, guardião, agente — e uma regra: **quem está embaixo nunca amplia o que recebeu de cima**.
4. **Prova (credibilidade):** a recusa acontece no programa; um terceiro confere em segundos; comprometido, o agente perde no máximo o que a política da janela permite.
5. **Honestidade (objeção):** um teto nativo gratuito basta para um agente só; governança multi-limite, papéis, allowlist e trilha de não-omissão é o que justifica outro programa.
6. **Fecho:** não é confiar na empresa — é ler o código e rodar o comando da demo.

---

## 3. Frases-canônicas (testadas para fala)

### Categoria (escolha uma e sustente)

- **Todo mundo resolve como o agente paga. Falta quanto ele pode perder — e provar isso para quem não está na sala.**
- **Tesouraria para organização de agentes: o dono deposita, define tetos, e o programa recusa o que sair da política.**

### Hierarquia de limites (invariante 3)

- **Ninguém afrouxa o próprio limite.** Cada papel só repassa um teto menor ou igual — e apertar vale no pagamento seguinte.
- **Limite é presente que só desce:** quem opera o dia a dia não pode subir o teto; quem gasta não pode pedir aumento pela ferramenta do agente.

### Dono vs pause

- **O dono sempre tira o dinheiro sozinho** — inclusive com o agente pausado. Pausa desliga o gasto automático; não prende o cofre.
- **O guardião no pior caso desliga o agente do cliente** — não saca, não muda política, não “despausa” sozinho.

### Garantia vs servidor

- **A garantia não é um painel nosso — é o programa na Solana.** Qualquer um confere com um comando.
- **Você não precisa confiar em nós:** o código será congelado, é aberto, e a prova cabe numa tarde de leitura.

### Concorrência (Allowances / Squads / cartão)

- **Allowances nativo é um teto delegado — ótimo primitivo, governança fina não.** Sessão, vários limites ao mesmo tempo, destino e moeda na lista, papéis separados, histórico encadeado.
- **Squads governa quem assina o multisig; isso governa o que o agente pode gastar com sessão e prazo.** O dono do Rails pode ser o próprio cofre Squads — complemento, não substituto.
- **Cartão resolve lojista com humano no circuito; não prova que nada foi omitido do log nem paga outro agente em sub-centavo.**

### Organograma (novidade para jurado)

- **Um pagamento pode alimentar outro cofre — departamento, mesada, mesa.** A árvore é layout de contas; rode o teste e ela aparece no terminal.

### Fecho de qualquer conversa

> Você não precisa confiar em nós. O programa vai ser congelado, o código é aberto, e a garantia inteira está aí para ler e verificar. Esse é o ponto.

---

## 4. Tom: menos “our product”, mais tribunal

| Fraco (centrado em nós) | Forte (centrado em prova ou comprador) |
|---|---|
| Nós resolvemos quanto o agente pode perder | Falta uma resposta verificável para *quanto* o agente pode perder |
| Nossa garantia é on-chain | A recusa acontece no programa — não no nosso servidor |
| Nosso MCP é seguro | A superfície do agente **não tem ferramenta que aumente limite** — e isso é teste automatizado, não promessa de slide |

Use **“a gente”** só em conversa informal; em deck, vídeo Colosseum e grant, prefira impessoal ou segunda pessoa do comprador (*quando você deposita…*).

---

## 5. Onde cada documento deve estar

| Documento | Papel |
|---|---|
| Este arquivo | Palco, deck, roteiro de vídeo, respostas a objeção |
| [`briefing-negocio.md`](./briefing-negocio.md) | Colega de negócio — já alinhado à retórica acima |
| `crypto-worlds-fair-playbook.md` §3 | Roteiros 30s/60s — manter sincronizado com §3 deste guia |
| `product-strategy.md` §2 | Invariantes para decisão interna — mesma ideia, linguagem pode ser mais seca |
| `ARCHITECTURE.md`, ADRs, `CLAUDE.md` | Inglês técnico — **não** copiar frases de lá para o pitch em português |

---

## 6. Checklist antes de gravar ou submeter

- [ ] A primeira frase é **dor ou categoria**, não feature.
- [ ] Invariante de hierarquia aparece como **ninguém aumenta o próprio teto**, não como metáfora de morro.
- [ ] “Nós” aparece no máximo **uma vez** no bloco de 60 segundos (ideal: zero).
- [ ] Objeção Allowances nativo está na **primeira resposta**, não no rodapé.
- [ ] Demo: organograma ou recusa por limite **antes do minuto 1** no vídeo.
