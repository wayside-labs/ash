# Runbook — login por e-mail, carteira da plataforma e o gate Pro (ADR-024)

O que precisa estar ligado fora do código para o fluxo do ADR-024 funcionar, e como tirar do ar.

```
 visitante ──► middleware (sign-in-gate) ──sem sessão──► /account  (porta de entrada)
                     │                                     │
                     │ com sessão                          ├─ e-mail ─► signInWithOtp ─► e-mail
                     ▼                                     ├─ Google ─► signInWithOAuth
               páginas do dashboard                        └─ carteira (disclosure) ─► signInWithWeb3
                                                                          │
   link do e-mail ─► /auth/confirm (token_hash, qualquer navegador) ─┐     │
   link PKCE/Google ─► /auth/callback (code, mesmo navegador) ───────┤     │ POST /api/auth/bootstrap
                                                                     ▼     ▼
                                               ensureAccountForUser (service role, idempotente)
                                                 account → identity(email|google|wallet) → org
                                                 → membership → profile → settings → seed
                                                 → ensurePlatformWallet ──► PlatformWalletProvider
                                                        (best effort)          └─ stub | <vendor>
                                                                     │
                                                                     ▼
                                    platform_wallets (1 por conta, custody none|provider)
                                                                     │
   GET /api/account/wallet (sessão do usuário, RLS) ◄────────────────┘
     { plan, externalWallets, platformWallet, linkedWallets }
            │
            ├─ free ─► card "Seu saldo" + card Pro bloqueado; header sem botão de carteira
            └─ pro  ─► + ConnectButton (Phantom/Solflare/Backpack)
                          └─ "Vincular" ─► signMessage(linkMessage(accountId, agora))
                                            ─► POST /api/account/wallet/link
                                               verifyLinkProof ─► linked_wallets (service role)
```

## 1. Migration

```bash
cd packages/dashboard
SUPABASE_DB_PASSWORD=<senha> npx supabase db push   # aplica 20261001000000_platform_wallets.sql
```

Cria `account_entitlements`, `platform_wallets`, `linked_wallets` e aceita `provider = 'email'`
em `identities`. Sem ela, o bootstrap de uma conta nova por e-mail falha no insert da identity
(`?error=bootstrap`) e a carteira fica "sendo criada" para sempre.

## 2. Supabase: provedor de e-mail

Authentication → Providers → **Email**: ligado. Não declaramos isso no `config.toml` de
propósito — `config push` aplica tudo o que o arquivo declara e zeraria o que foi configurado no
projeto hospedado (mesmo motivo do bloco do Google). Rode `npx supabase config diff` antes de
qualquer `config push`.

**SMTP.** O SMTP embutido do Supabase tem limite baixo de envios por hora e serve só para teste.
Para qualquer tráfego real, Authentication → SMTP Settings com um provedor próprio.

**Redirect URLs.** `additional_redirect_urls` já tem `/auth/callback` de produção e local; na VPS,
acrescente `https://<domínio público>/auth/callback` no painel (Authentication → URL
Configuration). `site_url` precisa ser a origem pública em que os usuários de fato entram — o
template abaixo monta o link a partir dela.

### Template do magic link (o que faz funcionar no celular)

O template padrão manda um link PKCE, que só funciona no **mesmo** navegador que pediu. No
celular o app de e-mail costuma abrir num navegador embutido e a troca falha com `?error=auth`.
Authentication → Email Templates → **Magic Link** (e **Confirm signup**, que é o que um e-mail
novo recebe):

```html
<h2>Entrar na Agent Rails</h2>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Entrar</a></p>
<p>Se você não pediu este link, ignore este e-mail.</p>
```

`/auth/confirm` só aceita `email`, `magiclink` e `signup`; recuperação de senha e troca de
e-mail não são portas de entrada e voltam para `/account?error=auth`.

## 3. Variáveis de ambiente

| Variável | Onde | Valor |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build + runtime | já existentes (ADR-017) |
| `SUPABASE_SERVICE_ROLE_KEY` | runtime, só servidor | já existente; agora também grava `platform_wallets` e `linked_wallets` |
| `DASHBOARD_PUBLIC_URL` | runtime | origem pública; obrigatória atrás do túnel da VPS |
| `PLATFORM_WALLET_PROVIDER` | runtime | `stub` (padrão, e o único que existe) |
| `DASHBOARD_EXTERNAL_WALLETS` | runtime | `pro` (padrão) ou `everyone` |

Nenhuma delas é segredo novo: o stub não tem credencial. Quando um vendor for escolhido, as
credenciais dele entram aqui como variáveis **só de servidor**, nunca `NEXT_PUBLIC_*`.

**Demo do Colosseum:** o wizard de tesouraria ainda assina com carteira externa. Se o juiz
precisa criar uma tesouraria com uma conta free, `DASHBOARD_EXTERNAL_WALLETS=everyone`.

## 4. Dar Pro a uma conta

Não há checkout ainda. Pelo SQL editor (roda como `postgres`, fora da RLS):

```sql
insert into public.account_entitlements (account_id, plan)
select account_id, 'pro' from public.profiles where email = 'alguem@exemplo.com'
on conflict (account_id) do update set plan = excluded.plan, updated_at = now();
```

Nenhuma sessão de usuário consegue escrever nessa tabela: não há policy de insert/update, de
propósito. Uma coluna `plan` em `accounts` seria autoatualizável pela `accounts_update_self`.

## 5. Conferir

- Aba anônima em `/treasury` → redireciona para `/account?next=%2Ftreasury`.
- E-mail → link abre em outro navegador → cai em `/treasury` logado.
- `/account` mostra "Seu saldo" com o aviso de carteira de prévia (stub) e o card Pro bloqueado;
  o header não mostra "Conectar".
- Com Pro: o header mostra "Conectar"; conectar Phantom → "Vincular à minha conta" → a carteira
  aparece em "Carteiras vinculadas".

## 6. Contas que já existiam

- **Google e carteira:** nada muda no login. No próximo login (ou no botão "Tentar de novo" do
  card) o bootstrap cria a carteira da plataforma. Não há backfill por migration porque uma
  migration não pode chamar um provedor de carteira.
- **Quem usava Phantom numa conta free:** o header deixa de oferecer a conexão e desconecta a
  carteira que estava na store. A tesouraria continua sendo dela on-chain — o gate é de produto,
  não de autoridade. Para voltar a assinar pelo dashboard: Pro, ou `DASHBOARD_EXTERNAL_WALLETS=everyone`.
- **Modo local (JSON, sem Supabase):** nenhuma mudança de comportamento. Sem contas, sem carteira da
  plataforma, sem gate; a página Conta mostra o card da carteira própria e o aviso de Supabase
  não configurado.

## 7. Rollback

`DASHBOARD_EXTERNAL_WALLETS=everyone` desfaz o gate sem deploy de código. As tabelas novas podem
ficar: nada as lê se o código anterior voltar. Remover a migration exigiria reverter o check de
`identities.provider`, o que quebra qualquer identidade `email` já criada — não faça sem antes
migrar essas contas.
