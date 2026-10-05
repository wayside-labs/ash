# Runbook — a plataforma própria na VPS

**Escopo:** a *máquina* da ADR-019 — conta, acesso SSH e endurecimento do host. O que roda nela
(dashboard, Supabase self-hosted, túnel, backups, deploys) está em
[`deploy/vps/README.md`](../../deploy/vps/README.md), que é o runbook operacional.

**Estado em 2026-09-30 — em produção desde 2026-09-29**, dividindo a VPS com o stack ash.
[`deploy-vercel.md`](deploy-vercel.md) ficou só como caminho de rollback.

| | |
|---|---|
| Provedor | Hostinger, plano **KVM 2**, cobrado em reais, conta do Lucas |
| Máquina | x86_64, 2 vCPU AMD EPYC 9354P, 7,8 GiB RAM, ~97 GB NVMe, **Ubuntu 22.04**, hostname `ash` |
| Onde | **costa leste dos EUA** — medido da máquina: 14 ms até `us-east-1`, ~120 ms até `sa-east-1` |
| IP | fixo do plano; **o endereço não fica no repositório** — peça a um sócio |

O endereço fica fora do repositório porque o repositório vai ser aberto para os avaliadores do
hackathon, e um IP de servidor publicado é um alvo a mais sem nenhum ganho para quem lê.

A primeira versão deste runbook era para uma VM Always Free da Oracle. Ela foi abandonada — o
porquê está na ADR-019. A conta Oracle e a VM de apoio `ash-02` serão encerradas.

---

## 1. Painel da Hostinger ✅ / ⏳

- ⏳ MFA do dono da conta.
- ⏳ **Segundo administrador (Ronaldo)** pelo compartilhamento de conta do painel, com login e
  MFA próprios. Ninguém compartilha o login do dono.
- O **console de recuperação** do painel não passa pelo SSH: é a volta se o acesso por chave
  se perder. Como o login de `root` por SSH está desligado, o terminal web do painel pode não
  funcionar — conte com o console de recuperação, não com ele.

---

## 2. Acesso SSH ✅

Regra: **uma pessoa, um usuário, uma chave própria.** Nenhuma chave privada é copiada entre
pessoas; no servidor só existem chaves públicas.

| Usuário | Quem | sudo | Estado |
|---|---|---|---|
| `root` | — | — | **login por SSH desligado** |
| `lucas` | Lucas, chave própria (`SHA256:ulEjKtRT…fWok`) | sim, sem senha | ✅ 28/09 |
| `ronaldo` | Ronaldo, chave de `github.com/0xcf02.keys` (`SHA256:uc7Gv1Rz…K7qk`) | sim, sem senha | ✅ 28/09; em uso desde 29/09 |
| `ash` | serviço do dashboard e backups — nunca uma pessoa; sem docker, sem SSH | **não** | ✅ 29/09 (`bootstrap.sh`) |

Os dois usuários pessoais estão no grupo `docker` e não têm senha (`passwd -l`): o login é só
por chave, e `NOPASSWD` no sudo evita criar uma senha só para ele.

Criar um usuário pessoal (feito por quem já tem sudo):

```bash
sudo useradd -m -s /bin/bash fulano
sudo usermod -aG sudo,docker fulano
sudo passwd -l fulano
sudo install -d -m 700 -o fulano -g fulano /home/fulano/.ssh
curl -fsS https://github.com/<usuario-github>.keys | sudo tee /home/fulano/.ssh/authorized_keys >/dev/null
sudo chown fulano:fulano /home/fulano/.ssh/authorized_keys && sudo chmod 600 /home/fulano/.ssh/authorized_keys
echo "fulano ALL=(ALL) NOPASSWD:ALL" | sudo tee -a /etc/sudoers.d/90-ash >/dev/null && sudo visudo -c
```

E acrescentar o nome em `AllowUsers` (§3) — sem isso o sshd recusa a pessoa mesmo com a chave
certa.

No computador de cada um, uma entrada em `~/.ssh/config`:

```
Host agent-rails-vps
    HostName <IP da VPS>
    User <seu usuário>
    IdentityFile ~/.ssh/<sua chave>
    IdentitiesOnly yes
```

`IdentitiesOnly yes` não é enfeite: sem ele o cliente oferece todas as chaves do diretório, o
servidor corta em `MaxAuthTries 3` e o fail2ban (§3) bane o seu próprio IP.

**Agrupe comandos numa conexão só.** A Hostinger corta rajadas de conexões SSH seguidas — já
aconteceu na outra VPS do time. No Windows (Git Bash), não use `ControlMaster`: o OpenSSH de lá
falha no repasse do socket (`mm_send_fd: Broken pipe`). E, se estiver numa VPN, é ela o primeiro
suspeito de um SSH lento ou que não conecta.

---

## 3. Endurecimento ✅

Feito em 28/09, nesta ordem — os usuários pessoais foram criados e **testados** antes de o root
ser desligado; inverter a ordem é como se tranca alguém para fora.

| Item | Como | Por quê |
|---|---|---|
| SSH | `/etc/ssh/sshd_config.d/00-hardening.conf`: `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `AllowUsers lucas ronaldo`, `MaxAuthTries 3`, `X11Forwarding no` | O nome `00-` é o ponto: no sshd **o primeiro valor lido vale**, e a imagem traz `50-cloud-init.conf` e `60-cloudimg-settings.conf`. Validar com `sudo sshd -t` e conferir o efetivo com `sudo sshd -T` antes de `systemctl reload ssh`. Testado de fora: root e senha recusados. |
| Firewall | `ufw`: nega entrada por padrão, libera só `22/tcp` | — |
| fail2ban | `/etc/fail2ban/jail.d/sshd.local`: `backend = systemd`, `journalmatch = _COMM=sshd + _COMM=sshd-session`, 5 falhas em 10 min → 1 h | O filtro padrão procura a unidade `sshd.service`, que no Ubuntu se chama `ssh.service`, e o OpenSSH ≥ 9.8 ainda loga como `sshd-session`: sem o `journalmatch`, o fail2ban fica "ativo" e não vê nada. |
| Swap | `/swapfile` 2 GB, `vm.swappiness=10`, no `fstab` | Folga para picos de build. |
| Atualizações | `apt upgrade` aplicado; `unattended-upgrades` ligado | — |
| Docker | Docker CE + Compose do repositório oficial; `/etc/docker/daemon.json` com `"ip": "127.0.0.1"` e log `json-file` 10 MB × 3 | O Docker abre portas **por fora do `ufw`**: na outra VPS do time, o Kong do Supabase respondia na 8000/8443 para a internet com o `ufw` liberando só a 22. Com `ip` em `127.0.0.1`, `-p 8000:8000` só escuta local — testado. Expor ao mundo passa a exigir escrever o endereço, e o caminho certo é o proxy. |
| Runtime | Node 22 (NodeSource), corepack ligado | Dentro do repositório o corepack usa o pnpm do `packageManager` (10.6.5) — testado. Fora dele, o pnpm global é outra versão; não importa. |

Os scripts usados vivem fora do repositório; esta tabela é a fonte do que foi feito.

---

## 4. O que roda na máquina

Tudo o que o plano original listava aqui (Caddy nas portas 80/443, usuário `deploy`, deploy key,
etapa 2 depois de 12/10) foi substituído pelo que foi combinado com o Lucas e construído no PR #77:

- **Tráfego:** túnel Cloudflare próprio; nenhuma porta aberta e o `ufw` não mudou (o certbot do
  ash usa a 80). Hostnames `console.ash.app.br` e `console-api.ash.app.br` (só `/auth` e `/rest`).
- **Usuário:** `ash`, sem docker, sem sudo, sem SSH. O `deploy` é do ash e está no grupo
  docker; não usamos.
- **Supabase:** self-hosted enxuto na mesma VPS, versões iguais às do hospedado, cutover em
  2026-09-29.
- **Deploy:** bundle git por SSH (`deploy/vps/push-deploy.sh origin/<branch>`), sem chave do GitHub
  no servidor. **Migrations não vão no deploy:** aplicar à mão antes, com backup.
- **Backups:** dump noturno cifrado com `age`, enviado pelo ash-offsite para o livro-vps, com teste
  de restauração semanal.

Passo a passo, layout, rede e procedimentos: [`deploy/vps/README.md`](../../deploy/vps/README.md).
Decisão e porquês: [ADR-019](../adr/ADR-019-self-hosted-platform.md).

---

## 5. Máquina compartilhada com o ash

Site, e-mail e listmonk do ash rodam na mesma VPS, com usuários, caminhos (`/opt/ash*`,
`/var/backups/ash-*`) e units (`ash-*`) próprios — nunca dentro de `/srv/agent-rails`.
**Avisar no chat do time antes de reboot, `apt upgrade`, ou mudança em firewall, sshd ou daemon do
docker; nenhum reboot sem o ok do outro.** Separar em duas máquinas quando a memória apertar ou
antes de o produto guardar algo que um cliente chamaria de produção (ADR-019, *Consequences*).

---

## 6. Segredos

Nenhum segredo no repositório, no chat ou em `argv` (mesmo aviso do `deploy-vercel.md` §1).
No servidor: arquivos de root em `/etc/agent-rails/*.env` (0600/0640). Entre os sócios: um cofre
compartilhado de gerenciador de senhas. Chave de sessão de agente gerada **no servidor**, nunca
colada de fora.
