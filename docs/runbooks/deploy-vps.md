# Runbook — a plataforma própria na Oracle Cloud

**Escopo:** o servidor da ADR-019 — dashboard e, na etapa 2, o Supabase self-hosted, numa VM
Always Free da Oracle Cloud. Enquanto a etapa 1 não vira, a produção continua em
[`deploy-vercel.md`](deploy-vercel.md).

**Estado em 2026-09-24 — VM de apoio endurecida; VM principal aguardando capacidade.**

| | |
|---|---|
| Tenancy | conta Oracle Cloud do Lucas, home region **São Paulo** (`sa-saopaulo-1`) — permanente |
| VCN | `vcn-20260924-1730`, sub-rede pública `subnet-20260924-1730` |
| IP | **reservado** (sobrevive à troca de máquina); o endereço não fica no repositório — peça a um sócio |
| VM de apoio ✅ | `agent-rails-02`, `VM.Standard.E2.1.Micro`, x86, 1/8 OCPU, 1 GB, Ubuntu 22.04 |
| VM principal ⏳ | `VM.Standard.A1.Flex`, arm64, 4 OCPU / 24 GB, Ubuntu 24.04 — *out of capacity* em 24/09 |

O endereço fica fora do repositório porque o repositório vai ser aberto para os avaliadores do
hackathon, e um IP de servidor publicado é um alvo a mais sem nenhum ganho para quem lê.

---

## 0. Leia isto antes de tudo: a micro não é o servidor

A micro existe para rodar um processo Node de longa duração — o agente de referência do plano
de execução — e para o time aprender a máquina enquanto a A1 não sai. **Ela não roda o build do
Next nem o Supabase.** Um `next build` do workspace em 1 GB e 1/8 de OCPU troca para swap e não
termina em tempo útil; o Supabase self-hosted sozinho pede mais memória do que ela tem.

A micro é **x86** e a A1 é **arm64**: nada compilado numa roda na outra.

---

## 1. Conseguir a A1 ⏳

O Always Free só existe na home region, e São Paulo tem um único domínio de disponibilidade.
Trocar de região não resolve; insistir resolve.

1. **Compute → Instâncias → Criar instância**, nome `agent-rails-a1`.
2. **Imagem e forma → Editar**: imagem Canonical Ubuntu **24.04**; forma **Ampere →
   `VM.Standard.A1.Flex`**, abrir a setinha ▸ e pôr **4 OCPUs / 24 GB**.
3. **Rede: selecionar a VCN existente** (`vcn-20260924-1730`) e a sub-rede pública. Não criar
   outra: o Always Free tem teto de VCNs, e as regras de firewall valem por sub-rede.
4. Chaves SSH públicas: as mesmas da §3.
5. **Volume de inicialização: 100 GB.** O teto grátis é 200 GB *somando todas as VMs*; a micro
   já ocupa ~100.
6. **Salvar como pilha** (`agent-rails-a1`). Cada tentativa passa a ser *Pilhas →
   agent-rails-a1 → Aplicar*. A falha não cria nem cobra nada.

Madrugada e início da manhã têm mais chance. Se em dois dias não sair: (a) automatizar as
tentativas pela OCI CLI, com um usuário IAM restrito a compute; ou (b) converter a conta para
*Pay As You Go*, que continua gratuita dentro dos limites Always Free e, por relato da
comunidade — não por garantia da Oracle —, destrava a capacidade. (b) só com o alarme da §2
ligado e com acordo dos dois sócios.

Quando a A1 subir, o IP reservado passa para ela: VNIC da micro → *Endereços IP* → editar →
sem IP público; VNIC da A1 → editar → **IP público reservado existente**.

---

## 2. Conta Oracle ⏳

- ⏳ MFA do dono da tenancy.
- ⏳ **Alarme de gasto:** *Billing & Cost Management → Budgets*, US$ 1, alerta em 1% de gasto
  real. É o que torna qualquer engano visível no mesmo dia.
- ⏳ **Segundo administrador (Ronaldo).** Ninguém compartilha o login do dono.
  1. *Identity & Security → Domains → Default domain → Users → Create user*, com o e-mail dele.
  2. *Groups → Administrators → Add user to group*.
  3. Ele recebe o convite, define a senha e configura o próprio MFA.

---

## 3. Acesso SSH ✅ / ⏳

Regra: **uma pessoa, um usuário, uma chave própria.** Nenhuma chave privada é copiada entre
pessoas; no servidor só existem chaves públicas.

| Usuário | Quem | sudo | Estado |
|---|---|---|---|
| `ubuntu` | padrão da imagem; hoje a chave de automação usada pelo assistente do Lucas | sim | ✅ |
| `ronaldo` | Ronaldo, chave publicada em `github.com/0xcf02.keys` | sim | ⏳ aguarda ele confirmar a chave |
| `lucas` | Lucas, chave própria | sim | ⏳ |
| `deploy` | serviços e deploys — nunca uma pessoa | **não** | ⏳ criado com a etapa 1 |

Criar um usuário pessoal (feito por quem já tem sudo):

```bash
sudo adduser --disabled-password --gecos "" ronaldo
sudo usermod -aG sudo ronaldo
echo "ronaldo ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/90-ronaldo >/dev/null
sudo install -d -m 700 -o ronaldo -g ronaldo /home/ronaldo/.ssh
curl -fsS https://github.com/0xcf02.keys | sudo tee /home/ronaldo/.ssh/authorized_keys >/dev/null
sudo chown ronaldo:ronaldo /home/ronaldo/.ssh/authorized_keys && sudo chmod 600 /home/ronaldo/.ssh/authorized_keys
```

`NOPASSWD` porque os usuários não têm senha (login só por chave): com senha exigida no sudo,
seria preciso criar e guardar uma senha só para isso.

No computador de cada um, uma entrada em `~/.ssh/config`:

```
Host agent-rails-vps
    HostName <IP reservado>
    User <seu usuário>
    IdentityFile ~/.ssh/<sua chave>
    IdentitiesOnly yes
```

`IdentitiesOnly yes` não é enfeite: sem ele o cliente oferece todas as chaves do diretório, o
servidor corta em `MaxAuthTries 3` e o fail2ban (§4) bane o seu próprio IP.

**No Windows (Git Bash), não use `ControlMaster`.** O OpenSSH de lá falha no repasse do socket
(`mm_send_fd: Broken pipe`). E agrupe comandos numa conexão só: em 24/09, uma rajada de
conexões seguidas rendeu ~5 min de timeout sem o pacote sequer chegar ao servidor — o log do
sshd não registrou nada. É um bloqueio no caminho, não o fail2ban.

---

## 4. Endurecimento da VM ✅

Feito na micro em 24/09; a A1 recebe o mesmo.

| Item | Como | Por quê |
|---|---|---|
| SSH | `/etc/ssh/sshd_config.d/00-hardening.conf`: `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `MaxAuthTries 3`, `X11Forwarding no` | O nome `00-` é o ponto: no sshd **o primeiro valor lido vale**, e o drop-in do cloud-init (`60-cloudimg-settings.conf`) viria antes com outro nome. Validar com `sudo sshd -t` antes de `systemctl reload ssh`. |
| fail2ban | `/etc/fail2ban/jail.local`: jail `sshd`, `backend = auto`, `logpath = /var/log/auth.log`, 5 falhas em 10 min → 1 h | No Ubuntu o serviço é `ssh.service`. Com `backend = systemd`, o filtro casa com `sshd.service`, que não existe: o fail2ban fica "ativo" e não vê nada. Conferir com `sudo fail2ban-regex /var/log/auth.log /etc/fail2ban/filter.d/sshd.conf` — tem de haver *matched*. |
| Swap | `/swapfile` 2 GB, `vm.swappiness=10`, no `fstab` | 1 GB sem swap trava em qualquer pico. (`mkswap -q` não existe no 22.04.) |
| Atualizações | `unattended-upgrades` ligado (padrão da imagem); `full-upgrade` + reboot aplicados | O reboot da micro leva ~5 min. Não fique martelando a porta enquanto isso. |
| Runtime | Node 22 (NodeSource), pnpm 10.6.5 via corepack, git | As versões que o `package.json` da raiz exige. |

Um scanner da internet bateu na porta 22 minutos depois de o IP existir. É o normal, e é por
isso que esta seção vem antes de qualquer serviço.

---

## 5. Firewall: são duas camadas ⏳

Hoje só a 22 está aberta. Para servir HTTP/HTTPS é preciso abrir **nos dois lugares**:

1. **Security List** da sub-rede: *ingress* TCP 80 e 443 de `0.0.0.0/0`.
2. **iptables da própria imagem**, que termina em `REJECT`. A regra nova entra *antes* do
   REJECT e é persistida:

```bash
sudo iptables -I INPUT 5 -p tcp -m state --state NEW -m multiport --dports 80,443 -j ACCEPT
sudo netfilter-persistent save
```

Abrir só a Security List é o erro clássico: a porta continua fechada e nada no painel explica
por quê.

---

## 6. Etapa 1 — dashboard na A1 ⏳

Pré-requisitos: A1 de pé, domínio decidido, ADR-019 aceita.

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

**Rollback:** apontar o DNS de volta. A Vercel continua de pé até a etapa 1 estar estável.

## 7. Etapa 2 — Supabase na A1 ⏳

Não agendar antes de verificar:

- imagens arm64 de todos os serviços do Compose self-hosted;
- versão do Auth self-hosted com o provider **Web3/Solana** (o `signInWithWeb3` da ADR-017);
- **backup noturno fora da VM** (`pg_dump` para Object Storage) funcionando e **restaurado uma
  vez** — sem isso, o gerenciado era mais seguro.

Migração: `pg_dump` do projeto gerenciado → `pg_restore` local → providers Google e Web3
reconfigurados → redirect do Google Cloud apontando para o callback do Auth próprio → troca de
`NEXT_PUBLIC_SUPABASE_URL` e das chaves → rebuild (as `NEXT_PUBLIC_*` são inlinadas no build).

---

## 8. Segredos

Nenhum segredo no repositório, no chat ou em `argv` (mesmo aviso do `deploy-vercel.md` §1).
No servidor: arquivos `0600` de root em `/etc/agent-rails/`. Entre os sócios: um cofre
compartilhado de gerenciador de senhas. Chave de sessão de agente gerada **no servidor**, nunca
colada de fora.
