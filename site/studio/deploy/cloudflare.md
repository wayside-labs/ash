# Cloudflare do ash-studio — o que foi feito em 2026-09-30

Registro do que existe hoje. Nenhum valor secreto aparece aqui; os caminhos dizem onde cada um mora.

## Túnel

- Túnel `ash` (gerenciado remotamente). O id está em `agenttokenfy/.aios/secrets/ash-tunnel-id`.
- Foram acrescentadas duas regras de ingress, **antes** do 404 final:
  `studio.ash.app.br` e `pub.ash.app.br` → `http://ash-studio:3000`.
- A configuração anterior ficou salva em
  `agenttokenfy/.aios/secrets/ash-tunnel-config-2026-09-30.json`.
- As regras antigas `ash.app.br`/`www` → `ash-web:80` continuam no túnel, mas estão **mortas**: o
  DNS desses nomes aponta para o Pages desde que o site saiu da VPS.
- A pilha antiga em `/opt/ash` (nginx + connector) está **parada** pelo mesmo motivo. Por isso o
  compose do studio traz o próprio conector, `ash-studio-cloudflared`
  (`cloudflare/cloudflared:2026.9.3`), que lê `/opt/ash-studio/tunnel.env` (`TUNNEL_TOKEN`, dono
  root, modo 0600). O app e o worker nunca veem esse token.

## DNS

CNAME `studio` e CNAME `pub` → `<id-do-túnel>.cfargotunnel.com`, ambos com proxy ligado.

## Access (Zero Trust)

- Time `ashhuman.cloudflareaccess.com`, método de login: código de uso único por e-mail (OTP).
- Aplicação "Ash Studio": domínio `studio.ash.app.br`, tipo `self_hosted`, sessão de 24 h.
- Política "Admins do Ash" (allow): os e-mails do time (a mesma lista fica em `STUDIO_ADMINS` no
  `/opt/ash-studio/.env` e na política do Access).
- A AUD tag fica em `agenttokenfy/.aios/secrets/ash-studio-access-aud` e em
  `/opt/ash-studio/.env` (variável `ACCESS_AUD`).
- O app **também** confere `STUDIO_ADMINS` (a mesma lista de e-mails). Incluir ou remover um admin
  exige mexer nos dois lugares: a política do Access e o `.env` do app.

## Provas (2026-10-01)

- `studio.ash.app.br` sem sessão → 302 para o login do Access.
- `pub.ash.app.br`: `/`, `/api/health`, `/_next/image` e `/descadastro-falso` → 404.
- Cabeçalho `X-Robots-Tag: noindex, nofollow` presente.

## Desfazer

1. Remover as duas regras de ingress (PUT da configuração salva acima).
2. Apagar os dois CNAMEs (`studio`, `pub`).
3. Apagar a aplicação do Access.
4. `docker compose down` em `/opt/ash-studio`.
