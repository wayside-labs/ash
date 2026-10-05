# Placeholder antigo (retirado em 2026-09-29)

Antes deste repositório existir, `ash.app.br` tinha uma página provisória de espera rodando na
VPS compartilhada (`agent-rails-vps`, Hostinger), servida por um nginx atrás de um Cloudflare
Tunnel próprio (`ash`), em `/opt/ash`. O DNS nunca chegou a apontar para ela — o apex continuava
no cPanel antigo até o cutover de 2026-09-29.

Estes três arquivos são a cópia exata do que estava lá, guardada para não perder o trabalho:

- `docker-compose.yml` — nginx (`ash-web`) + `cloudflared` (`ash-cloudflared`), sem porta
  publicada, segredo do túnel só em `.env` na VPS.
- `index.html` — a página de espera em si.
- `original-README.md` — o runbook original (`algumacoisa-agentica/infra/ash/README.md`),
  incluindo os passos de virada de DNS que acabaram não sendo usados (o cutover real foi direto
  para a Cloudflare Pages, sem tunnel).

**Substituído por:** este repositório, publicado na Cloudflare Pages. O apex e o `www` agora
apontam por CNAME para `ash-web.pages.dev`. Os containers `ash-web` e `ash-cloudflared` na VPS
foram parados (`docker compose down`) no mesmo cutover, para não ficarem consumindo recursos à
toa numa máquina que o Ronaldo também usa. Nada foi apagado na VPS: `/opt/ash` continua lá,
parado, caso precise voltar.
