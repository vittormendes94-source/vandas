# Instalação passo a passo

```
3 × SNZB-02WD ──Zigbee──► ZBDongle (USB) ─► computador do orquidário ─► internet ─► painel (Cloudflare) ─► TV / celular
                                             Zigbee2MQTT + coletor
Sonoff da bomba ──Wi-Fi──► nuvem eWeLink ────────────────────────────────────────► painel (só ligada/desligada)
```

## Caminho rápido: tudo em paralelo

| Quando | Você faz | Tempo |
|---|---|---|
| Hoje | **Pedir 3 × SNZB-02WD + ZBDongle-E/P + cabo extensor USB** ([COMPRAS.md](COMPRAS.md)) | 20 min |
| Hoje | **Conta Cloudflare + segredos no GitHub + publicar pelo botão** ([PUBLICACAO.md](PUBLICACAO.md), caminho A) | 15 min |
| Hoje (opcional, bomba) | **Cadastro de desenvolvedor em dev.ewelink.cc**, com a mesma conta da bomba | 10 min + espera |
| Quando o adaptador chegar (2–5 dias) | Preparar o computador e rodar o instalador (passos 2 e 3) | 30 min |
| Quando os sensores chegarem | Parear, vincular e posicionar (passos 4 e 5) | 1 h |
| Depois | TV (passo 6) | 5 min |

## 1. Contas e publicação (gratuitas)

Siga [PUBLICACAO.md](PUBLICACAO.md), caminho A. Você cria a conta na Cloudflare, cadastra os segredos no GitHub (incluindo o **`INGEST_TOKEN`**, a senha que o coletor usa para enviar as leituras) e clica em **Publicar**.

## 2. Preparar o computador do orquidário

### Opção A: notebook ou PC que você já tem
1. Instale o **Ubuntu Server 24.04 LTS** (64 bits) a partir de um pendrive (https://ubuntu.com/download/server).
   - Na instalação, marque **"Install OpenSSH server"**.
   - Conecte ao Wi-Fi ou ao cabo de rede.
2. **Na BIOS:** ative "ligar ao receber energia" ("Restore on AC power loss: Power On"), se existir. Assim ele volta sozinho após falta de luz.
3. Feche a tampa: o instalador desliga a suspensão automaticamente.

### Opção B: Raspberry Pi 4
1. No seu computador, use o **Raspberry Pi Imager** (https://www.raspberrypi.com/software/) para gravar o **Raspberry Pi OS Lite (64-bit)** no cartão.
2. **Antes de gravar:** em "Editar configurações", defina o nome de usuário e a senha, o **Wi-Fi** e ative o **SSH**.
3. Coloque o cartão no Pi e ligue-o com a **fonte oficial**.

### Nos dois casos
- Conecte o **ZBDongle no cabo extensor USB** e o cabo ao computador. Deixe o adaptador **longe do computador e do roteador** (pelo menos 50 cm).
- **Lugar do computador:** coberto, seco e o mais perto possível do orquidário.

## 3. Rodar o instalador (um comando)

Acesse o computador (teclado e tela, ou `ssh usuario@IP`) e rode:

```bash
curl -fsSL https://raw.githubusercontent.com/vittormendes94-source/vandas/main/coletor/instalar.sh | sudo bash
```

O instalador:
1. Instala o Docker.
2. Baixa o sistema.
3. **Encontra o adaptador** e identifica o modelo (ZBDongle-E ou ZBDongle-P).
4. Pede o **endereço do painel** e o **`INGEST_TOKEN`**, e confere os dois com o servidor antes de seguir.
5. Gera a configuração do Zigbee2MQTT. A chave da rede Zigbee é criada no primeiro início e fica só no computador.
6. Sobe três serviços que **reiniciam sozinhos**, inclusive após falta de energia:
   - **Mosquitto:** mensageiro interno, sem porta exposta;
   - **Zigbee2MQTT:** tela na porta 8080, protegida por senha;
   - **coletor:** envia as leituras ao painel e guarda em disco se a internet cair.
7. No fim, mostra o endereço e a senha da tela do Zigbee2MQTT.

**Rodar de novo** atualiza tudo sem perder os pareamentos: `sudo orquidario atualizar`.

**Outros comandos:**
- `orquidario status`: situação dos serviços;
- `orquidario logs`: últimas mensagens;
- `orquidario senha`: senha da tela do Zigbee2MQTT.

## 4. Parear os sensores

1. **Teste antes de instalar:** faça os passos abaixo com os sensores **em cima da mesa**, perto do adaptador.
2. Abra no navegador (mesma rede) `http://IP-DO-COMPUTADOR:8080` e informe a senha mostrada pelo instalador.
3. Clique em **"Permitir entrada" / "Permit join (All)"**.
4. No sensor, **segure o botão por cerca de 5 s** até o ícone de sinal piscar. Em segundos ele aparece na lista como **SONOFF SNZB-02WD**.
5. **Renomeie** para "Orquidario 1" (depois 2 e 3). O nome ajuda a reconhecer no painel.
6. No painel, em **Configurações → Sensores**, escolha qual sensor Zigbee corresponde a S1, S2 e S3 e salve.
7. Em **Dados e integração**, o cartão do coletor deve mostrar **"Funcionando"**, e os sensores, valores e bateria.

## 5. Instalação final dos 3 sensores

- **Altura:** a das plantas, cerca de 1,0–1,5 m, pendurado ou preso na vertical.
- **Sombra sempre:** sol direto no sensor mede o aquecimento do próprio aparelho, não o ar.
- **Longe da água:** não fique **embaixo de aspersor ou nebulizador**, porque molhado ele marca 100 % de umidade de forma falsa.
- **Longe das bordas:** afaste de paredes, porta e cobertura, onde o ar é diferente.
- **Distribuição:** algo como início, meio e fundo do orquidário (12 m). O mapa é mais útil com os 3 formando um triângulo, não em linha.
- **Posições:** meça **x** (ao longo dos 12 m) e **y** (ao longo dos 5 m) a partir de um canto fixo. Informe em Configurações e desmarque "Provisória".
- **Aspersores e orientação:** informe também a posição dos aspersores e a direção do Norte (bússola do celular).
- **Sinal:** depois de instalados, confira no Zigbee2MQTT a coluna **LQI** de cada sensor.
  - Abaixo de ~30, aproxime o computador ou adicione um **repetidor Zigbee**: qualquer tomada inteligente Zigbee SONOFF ligada na tomada serve.

## 6. TV

Abra `https://…workers.dev/?tv=1&k=<VIEW_TOKEN>` no navegador da TV (ou Chromecast/Fire TV), use **Tela cheia** e salve nos favoritos. Esse endereço só permite ver, nunca editar.

## 7. Bomba (opcional, eWeLink)

1. Em **dev.ewelink.cc**, com a conta onde está o Sonoff da bomba, faça o cadastro de desenvolvedor pessoal e aguarde a aprovação.
2. Crie um app com o retorno `https://<seu-endereço>/api/ewelink/callback`. A tela "Dados e integração" mostra o valor exato.
3. Cadastre `EWELINK_APP_ID` e `EWELINK_APP_SECRET` nos segredos do GitHub e publique de novo.
4. No painel: **Dados e integração → Conectar conta eWeLink**; depois, **Configurações → Bomba**.
5. Ligue e desligue a bomba pelo app eWeLink: em até 2 min o painel acompanha.

## 8. Manutenção

- **Nada a fazer no dia a dia.**
  - **Falta de energia:** tudo volta sozinho.
  - **Queda de internet:** as leituras ficam guardadas no computador e chegam depois, com o horário certo.
- **Bateria dos sensores (CR2477):** o fabricante estima mais de 2 anos. A bateria aparece em "Dados e integração".
- **Atualizar o sistema local:** `sudo orquidario atualizar`, quando eu avisar que há melhoria.
- **eWeLink (só bomba), uma vez por ano:** crie um app novo em dev.ewelink.cc, troque `EWELINK_APP_ID`/`EWELINK_APP_SECRET` e conecte de novo. O painel avisa 30 dias antes.
