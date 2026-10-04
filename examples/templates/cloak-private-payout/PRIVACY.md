# Texto de privacidade — Privacy Sprint (Cloak + Zcash)

O texto de submissão da trilha: o que fica escondido, de quem, e o que se ganha. Copiado sem
alteração da §13 de [`docs/strategy/privacy-sprint-plano-execucao.md`](../../../docs/strategy/privacy-sprint-plano-execucao.md).
A tradução em inglês está em [`PRIVACY.en.md`](PRIVACY.en.md).

## Texto

<!-- texto:inicio -->
**O que fica escondido.** Hoje, quando um agente de IA paga fornecedores ou contribuidores com dinheiro da empresa, cada pagamento fica público na Solana: quem recebeu, quanto e quando. Com o template *Private payout desk* do Agent Rails, o operador pede no chat "pague 0,02 SOL ao fornecedor A e 0,02 SOL em ZEC ao contribuidor B". O dinheiro entra no pool da Cloak e sai para endereços novos. Quem olha a cadeia vê um depósito e saques de um pool compartilhado, mas não qual virou qual. O swap privado entrega ZEC (mint verificado) a um endereço sem vínculo direto com a carteira que financiou.

**De quem.** De observadores da cadeia: concorrentes e analistas on-chain que hoje mapeiam fornecedores e folha de pagamento a partir de um único endereço. Não esconde valores nem horários nas bordas; com pouco movimento no pool, depósito e saques podem ser casados por valor e horário. Não esconde nada da Cloak: o relay autentica a carteira e recebe a viewing key, que para estas notas reconstrói as chaves delas; por isso os tetos. O ZEC entregue é um token comum até ser blindado numa carteira Zcash. Não prometemos invisibilidade contra um adversário determinado.

**O que se ganha.** (1) Sigilo comercial: fornecedores e valores deixam de ser públicos. (2) Auditoria preservada: a viewing key, derivada da carteira, gera no navegador um CSV que o contador concilia com o `audit export`; ele recebe o CSV, nunca a chave. (3) Controle: o chat só propõe; nada se move sem a aprovação do operador na própria carteira, com teto por execução e endereços completos na tela. O modelo nunca vê chaves nem notas; as chaves vêm da carteira e não ficam guardadas. O agente trabalha em silêncio e o dono continua enxergando tudo.
<!-- texto:fim -->

Reconte as palavras depois de qualquer edição; o limite é 300.

## Contagem

**294 palavras**, conferidas em 2026-10-04 por script. A contagem é a de `wc -w`: sequências de
caracteres separadas por espaço, nos três parágrafos entre os marcadores acima, com os rótulos em
negrito e os marcadores "(1)", "(2)", "(3)" incluídos. Para recontar depois de editar:

```bash
awk '/^<!-- texto:inicio -->$/{f=1;next} /^<!-- texto:fim -->$/{f=0} f' \
  examples/templates/cloak-private-payout/PRIVACY.md | wc -w
```

Se o número passar de 300, a submissão deixa de cumprir a regra da página do desafio. Atualize
esta contagem e o texto em inglês juntos: [`PRIVACY.en.md`](PRIVACY.en.md) tem o próprio limite.
