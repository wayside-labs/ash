import type { LegalDoc } from "./types";

/**
 * Privacy Policy, both languages. Every factual claim here was checked against the code on
 * 2026-10-02 and has to stay true or be edited with it:
 *  - no table or log stores chat text (the migrations have none; `/api/chat` streams and forgets);
 *  - no third-party analytics or advertising script is loaded;
 *  - OpenRouter receives a SHA-256 of the auth id, never the id or the email
 *    (`openrouterPlatformAccess` in server/llm/providers.ts).
 * The OpenRouter data-sharing setting is an account setting we do not control from code:
 * docs/runbooks/openrouter-chat-integration.md §3 says to leave it off, and this policy says so.
 */
export const PRIVACY: Record<"en" | "pt-BR", LegalDoc> = {
  en: {
    title: "Privacy Policy",
    updated: "2 October 2026",
    intro:
      "This policy explains what {entity} (“we”, “us”) collects when you use Agent Rails, why, and who else sees it. It applies together with the Terms of Service.",
    sections: [
      {
        id: "collect",
        heading: "What we collect",
        paragraphs: ["We collect only what the Service needs to work:"],
        items: [
          "Account data: your email address or Google account identifier, or the wallet address you sign in with, and the organisation we create for you.",
          "Workspace data you create: workflows, agents, spending policies, session metadata, integrations and any API keys you choose to store. Stored keys are masked whenever they are shown back to you.",
          "Billing records: deposits (amount, time and the public transaction signature), assistant debits (model, token counts, provider cost and fee), withdrawal requests and the address you ask us to pay.",
          "Technical data: your IP address and country as seen by our network provider, request logs and error logs, and the cookies described below.",
          "Your assistant messages, while a reply is being produced. We do not keep the text of your conversations in our database.",
        ],
      },
      {
        id: "use",
        heading: "How we use it",
        paragraphs: [
          "To provide and secure the Service, to answer you, to bill and keep accounting records for credit, to prevent abuse and fraud, to support you, and to meet legal obligations. We do not sell your data and we do not use it for advertising.",
        ],
      },
      {
        id: "providers",
        heading: "Who processes your assistant messages",
        paragraphs: [
          "When you use the assistant, we send your message, the earlier turns of that conversation and the workspace context needed to answer (for example workflow and agent names, balances and policy summaries) to OpenRouter, which routes the request to a model provider, currently Anthropic. They process these inputs and the model’s outputs under their own terms and privacy policies. We also send OpenRouter a one-way hashed identifier for your account, so that it can isolate abuse; it is not your email or account ID.",
          "We do not enable OpenRouter’s option that lets it use prompts and outputs in return for a discount. Providers may keep requests for a limited time to operate their services and to prevent abuse, as their own policies describe. Do not put into the assistant anything you do not want these companies to process, and never private keys, seed phrases or passwords.",
        ],
      },
      {
        id: "others",
        heading: "Other services we rely on",
        paragraphs: [
          "Our authentication and database software, our hosting and network provider (which sees connection data such as IP address and country) and the email service that delivers sign-in links process data only to run the Service for us.",
          "Blockchain data is public by design. Wallet addresses, deposits and the transactions your agents make are visible on the Solana network to anyone, and we cannot erase them.",
        ],
      },
      {
        id: "cookies",
        heading: "Cookies and local storage",
        paragraphs: [
          "We use only what is needed to sign you in and remember your preferences, such as language and the selected network. We do not load third-party analytics or advertising trackers.",
        ],
      },
      {
        id: "retention",
        heading: "How long we keep it",
        paragraphs: [
          "Account and workspace data stay while your account exists. Billing records are kept as long as we need them for accounting, security and legal reasons, even after you delete the rest. Logs are kept for a limited time.",
        ],
      },
      {
        id: "rights",
        heading: "Your rights",
        paragraphs: [
          "Depending on where you live (for example under Brazil’s LGPD or the EU GDPR), you may ask us to confirm that we process your data, to give you a copy, to correct it, to delete it, to restrict or object to its processing, or to move it, and you may complain to your data protection authority. Write to {email}. We may need to keep some records the law requires, and we cannot alter public blockchain data.",
        ],
      },
      {
        id: "transfers",
        heading: "International transfers",
        paragraphs: [
          "OpenRouter and the model providers operate largely outside your country, including in the United States. By using the assistant you understand that your messages are transferred there to be processed.",
        ],
      },
      {
        id: "children",
        heading: "Children",
        paragraphs: [
          "The Service is not for anyone under 18, and we do not knowingly collect their data.",
        ],
      },
      {
        id: "changes",
        heading: "Changes and contact",
        paragraphs: [
          "We will change the date above when this policy changes and announce material changes in the Service. Questions or requests: {email}.",
        ],
      },
    ],
  },
  "pt-BR": {
    title: "Política de Privacidade",
    updated: "2 de outubro de 2026",
    intro:
      "Esta política explica o que {entity} (“nós”) coleta quando você usa o Agent Rails, por quê e quem mais tem acesso. Ela vale em conjunto com os Termos de Serviço.",
    sections: [
      {
        id: "collect",
        heading: "O que coletamos",
        paragraphs: ["Coletamos só o que o Serviço precisa para funcionar:"],
        items: [
          "Dados da conta: seu e-mail ou identificador da conta Google, ou o endereço da carteira com que você entra, e a organização que criamos para você.",
          "Dados do espaço de trabalho que você cria: fluxos, agentes, políticas de gasto, metadados de sessões, integrações e as chaves de API que você optar por guardar. Chaves guardadas aparecem mascaradas quando mostradas a você.",
          "Registros de cobrança: depósitos (valor, horário e a assinatura pública da transação), débitos do assistente (modelo, contagem de tokens, custo do provedor e taxa), pedidos de retirada e o endereço para o qual você pede o pagamento.",
          "Dados técnicos: seu endereço IP e país conforme vistos pelo nosso provedor de rede, logs de requisições e de erros e os cookies descritos abaixo.",
          "As mensagens ao assistente, enquanto uma resposta é produzida. Não guardamos o texto das suas conversas em nosso banco de dados.",
        ],
      },
      {
        id: "use",
        heading: "Como usamos",
        paragraphs: [
          "Para prestar e proteger o Serviço, responder a você, cobrar e manter os registros contábeis do crédito, prevenir abuso e fraude, dar suporte e cumprir obrigações legais. Não vendemos seus dados e não os usamos para publicidade.",
        ],
      },
      {
        id: "providers",
        heading: "Quem processa as mensagens do assistente",
        paragraphs: [
          "Quando você usa o assistente, enviamos a sua mensagem, os turnos anteriores da conversa e o contexto do espaço de trabalho necessário para responder (por exemplo nomes de fluxos e agentes, saldos e resumos de políticas) à OpenRouter, que encaminha o pedido a um provedor de modelo, hoje a Anthropic. Elas processam esses dados e as respostas do modelo conforme seus próprios termos e políticas de privacidade. Também enviamos à OpenRouter um identificador da sua conta em hash, irreversível, para que ela isole abusos; não é o seu e-mail nem o ID da conta.",
          "Não ativamos a opção da OpenRouter que permite usar prompts e respostas em troca de desconto. Os provedores podem reter requisições por tempo limitado para operar seus serviços e prevenir abuso, como descrevem suas políticas. Não coloque no assistente nada que você não queira que essas empresas processem, e nunca chaves privadas, frases-semente ou senhas.",
        ],
      },
      {
        id: "others",
        heading: "Outros serviços de que dependemos",
        paragraphs: [
          "Nosso software de autenticação e banco de dados, nosso provedor de hospedagem e rede (que vê dados de conexão como IP e país) e o serviço de e-mail que entrega os links de acesso tratam dados apenas para operar o Serviço por nós.",
          "Dados de blockchain são públicos por natureza. Endereços de carteira, depósitos e as transações dos seus agentes ficam visíveis a qualquer pessoa na rede Solana, e não podemos apagá-los.",
        ],
      },
      {
        id: "cookies",
        heading: "Cookies e armazenamento local",
        paragraphs: [
          "Usamos só o necessário para entrar na sua conta e lembrar preferências, como idioma e rede selecionada. Não carregamos rastreadores de análise ou publicidade de terceiros.",
        ],
      },
      {
        id: "retention",
        heading: "Por quanto tempo guardamos",
        paragraphs: [
          "Os dados da conta e do espaço de trabalho ficam enquanto a conta existir. Os registros de cobrança são mantidos pelo tempo necessário para contabilidade, segurança e obrigações legais, mesmo depois de você apagar o resto. Os logs são mantidos por tempo limitado.",
        ],
      },
      {
        id: "rights",
        heading: "Seus direitos",
        paragraphs: [
          "Conforme onde você mora (por exemplo, pela LGPD ou pelo GDPR da UE), você pode pedir confirmação de que tratamos seus dados, cópia, correção, eliminação, restrição ou oposição ao tratamento e portabilidade, e pode reclamar à autoridade de proteção de dados. Escreva para {email}. Podemos precisar manter registros que a lei exige, e não podemos alterar dados públicos de blockchain.",
        ],
      },
      {
        id: "transfers",
        heading: "Transferências internacionais",
        paragraphs: [
          "A OpenRouter e os provedores de modelo operam em boa parte fora do seu país, inclusive nos Estados Unidos. Ao usar o assistente, você entende que as suas mensagens são transferidas para lá para serem processadas.",
        ],
      },
      {
        id: "children",
        heading: "Crianças",
        paragraphs: [
          "O Serviço não é destinado a menores de 18 anos, e não coletamos conscientemente dados deles.",
        ],
      },
      {
        id: "changes",
        heading: "Alterações e contato",
        paragraphs: [
          "Mudaremos a data acima quando esta política mudar e avisaremos no Serviço sobre mudanças relevantes. Dúvidas ou pedidos: {email}.",
        ],
      },
    ],
  },
};
