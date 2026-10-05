# infra/ash — ash.app.br na VPS

**Estado em 2026-09-28:** página provisória no ar dentro da VPS, túnel `ash` conectado (4
conexões). **O DNS de `ash.app.br` ainda aponta para o cPanel antigo** — a virada está na §3.

## O que roda

| Onde | O quê |
|---|---|
| VPS | Hostinger KVM 2 do agent-rails (acesso: `docs/runbooks/deploy-vps.md` no repo do Ronaldo) |
| `/opt/ash` | `root:deploy`, modo `2775`; `lucas` e `ronaldo` no grupo `deploy` |
| `ash-web` | `nginx:1.28-alpine` servindo `site/` (somente leitura), com healthcheck |
| `ash-cloudflared` | `cloudflare/cloudflared:2026.9.3`, sobe só depois de `ash-web` saudável |
| `/opt/ash/.env` | `CLOUDFLARE_TUNNEL_TOKEN` — `640 root:deploy`, nunca no git |

Nenhum serviço publica porta. Tudo entra pelo Cloudflare Tunnel, no mesmo padrão dos outros
projetos (boringco, criptosul, livro): um túnel por projeto, token de túnel no `.env`.

O aviso `Cannot determine default origin certificate path` no log do cloudflared é normal
em túnel por token. O sinal de saúde é `Registered tunnel connection` ×4.

## Túnel

- Nome `ash`, gerenciado pela Cloudflare (`config_src: cloudflare`).
- Ingress: `ash.app.br` e `www.ash.app.br` → `http://ash-web:80`; o resto → 404.
- `http://`, não `https://`: o TLS termina na borda da Cloudflare. `localhost` não serve —
  dentro do container do cloudflared, `localhost` é ele mesmo.

## 3. Virada do DNS (pendente)

No painel da Cloudflare → `ash.app.br` → DNS:

1. **Apagar** o `A ash.app.br → 85.155.127.7` (cPanel antigo) e o `CNAME www → ash.app.br`.
2. **Criar** `CNAME ash.app.br → <id-do-túnel>.cfargotunnel.com`, proxy ligado (nuvem laranja).
3. **Criar** `CNAME www → <id-do-túnel>.cfargotunnel.com`, proxy ligado.

Atalho equivalente: Zero Trust → Networks → Tunnels → `ash` → Public Hostname → adicionar
`ash.app.br` e `www.ash.app.br` apontando para `http://ash-web:80` — o painel cria os CNAMEs,
mas recusa enquanto existir o registro antigo com o mesmo nome.

**Não tocar** nos registros da Microsoft 365: `MX`, o `TXT` de SPF, `autodiscover`,
`enterprise*`, `lyncdiscover`, `sip` e os dois `SRV`. A cópia de todos os 16 registros de
antes da virada está fora do repo (`.aios/secrets/ash-dns-backup-2026-09-28.json`, na camada
local do agenttokenfy).

Os `A` de `cpanel`, `cpcalendar`, `ftp`, `webdisk` e `whm` apontam para a hospedagem antiga e
podem ser apagados quando ela for cancelada.

## Atualizar a página

```bash
scp -r infra/ash/site agent-rails-vps:/tmp/ash-site
ssh agent-rails-vps 'sudo cp -r /tmp/ash-site/. /opt/ash/site/ && sudo chmod -R o+rX /opt/ash/site'
```

`site/` precisa de leitura para "outros": o nginx roda como usuário próprio dentro do
container. Em 28/09 um `chmod o-rwx` na pasta inteira deixou o `ash-web` unhealthy por isso.
