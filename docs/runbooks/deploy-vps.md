# Runbook — a plataforma própria na VPS

**Escopo:** o servidor da ADR-019 — dashboard e, na etapa 2, o Supabase self-hosted, numa VPS
paga da Hostinger. Enquanto a etapa 1 não vira, a produção continua em
[`deploy-vercel.md`](deploy-vercel.md).

**Estado em 2026-09-28 — VPS contratada, endurecida e vazia.**

| | |
|---|---|
| Provedor | Hostinger, plano **KVM 2**, cobrado em reais, conta do Lucas |
| Máquina | x86_64, 2 vCPU AMD EPYC 9354P, 7,8 GiB RAM, ~97 GB NVMe, **Ubuntu 22.04**, hostname `agent-rails` |
| Onde | **costa leste dos EUA** — medido da máquina: 14 ms até `us-east-1`, ~120 ms até `sa-east-1` |
| IP | fixo do plano; **o endereço não fica no repositório** — peça a um sócio |

O endereço fica fora do repositório porque o repositório vai ser aberto para os avaliadores do
hackathon, e um IP de servidor publicado é um alvo a mais sem nenhum ganho para quem lê.

A primeira versão deste runbook era para uma VM Always Free da Oracle. Ela foi abandonada — o
porquê está na ADR-019. A conta Oracle e a VM de apoio `agent-rails-02` serão encerradas.

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
| `ronaldo` | Ronaldo, chave de `github.com/0xcf02.keys` (`SHA256:uc7Gv1Rz…K7qk`) | sim, sem senha | ✅ 28/09; ⏳ primeiro login dele |
| `deploy` | serviços e deploys — nunca uma pessoa | **não** | ⏳ criado com a etapa 1 |

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
echo "fulano ALL=(ALL) NOPASSWD:ALL" | sudo tee -a /etc/sudoers.d/90-agent-rails >/dev/null && sudo visudo -c
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

## 4. Abrir HTTP/HTTPS ⏳

Hoje só a 22 está aberta. Para o proxy:

```bash
sudo ufw allow 80,443/tcp
```

Só o Caddy escuta em 80/443. Nenhum container publica porta para fora (§3, Docker).

---

## 5. Etapa 1 — dashboard na VPS ⏳

Pré-requisitos: domínio decidido, ADR-019 aceita.

1. Usuário `deploy`; código em `/srv/agent-rails` com acesso de leitura ao repositório por
   **deploy key somente leitura** gerada no servidor e cadastrada por um admin do repo.
2. `pnpm install --frozen-lockfile` e `turbo run build --filter=@agent-rails/dashboard`, os
   mesmos comandos do `vercel.json`.
3. Variáveis em `/etc/agent-rails/dashboard.env` (`root:root`, `0600`), lidas pelo systemd — as
   mesmas da §3 do `deploy-vercel.md`, com `ALLOWED_ORIGINS` já no domínio novo.
4. Serviço systemd rodando `pnpm --filter @agent-rails/dashboard start` como `deploy`. O script
   já escuta em `127.0.0.1:3000`, então a porta nunca fica exposta.
5. Caddy na frente, TLS automático, repassando o domínio para `127.0.0.1:3000`, com os mesmos
   headers do `vercel.json` (`X-Frame-Options: DENY`).
6. No Supabase: Redirect URL `https://<domínio>/auth/callback`.
7. Conferir com os três `curl` da §5 do `deploy-vercel.md`, trocando `U`. Só então apontar o DNS.

**Latência:** a VPS está nos EUA e o Supabase gerenciado em São Paulo; cada chamada do servidor
ao banco paga ~120 ms de ida e volta. Medir o tempo das páginas autenticadas antes de apontar o
DNS — se ficar ruim, a resposta é a etapa 2 ou mudar a VPS de data center, não otimizar código.

**Rollback:** apontar o DNS de volta. A Vercel continua de pé até a etapa 1 estar estável.

---

## 6. Etapa 2 — Supabase na VPS ⏳

Não agendar antes de verificar:

- memória: com a etapa 1 e os serviços de vendas rodando, sobrarem **3 GB** — o Supabase
  self-hosted usa ~1,3 GB medido na outra VPS do time;
- versão do Auth self-hosted com o provider **Web3/Solana** (o `signInWithWeb3` da ADR-017);
- **backup noturno fora da VPS** (`pg_dump` para um storage externo) funcionando e
  **restaurado uma vez** — sem isso, o gerenciado era mais seguro. O backup do plano da
  Hostinger não substitui este.

Migração: `pg_dump` do projeto gerenciado → `pg_restore` local → providers Google e Web3
reconfigurados → redirect do Google Cloud apontando para o callback do Auth próprio → troca de
`NEXT_PUBLIC_SUPABASE_URL` e das chaves → rebuild (as `NEXT_PUBLIC_*` são inlinadas no build).
O Kong do Compose publica em `127.0.0.1`, e o Caddy repassa o subdomínio da API para ele.

---

## 7. Dividindo a máquina com os serviços de vendas

Site, blog e disparo de e-mail do time rodam na mesma VPS, num projeto Compose próprio e com
usuário de serviço próprio — nunca dentro de `/srv/agent-rails` nem como `deploy`. Separar numa
segunda VPS quando a memória apertar ou antes de o produto guardar algo que um cliente chamaria
de produção (ADR-019, *Consequences*).

---

## 8. Segredos

Nenhum segredo no repositório, no chat ou em `argv` (mesmo aviso do `deploy-vercel.md` §1).
No servidor: arquivos `0600` de root em `/etc/agent-rails/`. Entre os sócios: um cofre
compartilhado de gerenciador de senhas. Chave de sessão de agente gerada **no servidor**, nunca
colada de fora.
