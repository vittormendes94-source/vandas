# Instalação passo a passo

```
3 × Outdoor Meter (IP65) ──Bluetooth──► Hub Mini (tomada, Wi-Fi) ──► nuvem SwitchBot ──┐
                                                                                         ├─► painel (Cloudflare) ─► TV / celular
Sonoff da bomba ──Wi-Fi──► nuvem eWeLink (ligada/desligada) ─────────────────────────────┘
```

Nada fica ligado no seu computador: o painel lê as duas nuvens sozinho, a cada 2 min.

## Caminho rápido: tudo em paralelo

| Quando | Você faz | Tempo |
|---|---|---|
| Hoje | **Pedir o kit SwitchBot** (3 Outdoor Meter + Hub Mini) ([COMPRAS.md](COMPRAS.md)) | 15 min |
| Hoje | **Conta Cloudflare + segredos no GitHub + publicar pelo botão** ([PUBLICACAO.md](PUBLICACAO.md), caminho A) | 15 min |
| Hoje | **Cadastro de desenvolvedor em dev.ewelink.cc**, com a mesma conta da bomba | 10 min + espera |
| Quando o eWeLink aprovar | Cadastrar APPID/SECRET, publicar de novo e conectar a bomba (passo 4) | 10 min |
| Quando o kit chegar | Hub, sensores, token SwitchBot e vínculo (passos 2 e 3) | 40 min |
| Depois | Posicionar os sensores (passo 5) e a TV (passo 6) | 30 min |

## 1. Contas e publicação (gratuitas)

Siga [PUBLICACAO.md](PUBLICACAO.md), caminho A. Dá para publicar **antes** de o kit chegar: o painel abre e mostra "aguardando".

## 2. SwitchBot: hub, sensores e credencial

1. Instale o app **SwitchBot** e crie a conta.
2. **Hub Mini:** ligue-o num carregador USB, em lugar **coberto e seco**, perto do orquidário (poucos metros, de preferência com visão direta) e com Wi-Fi **2,4 GHz**. No app: "+" → Hub Mini → siga as instruções.
3. **Sensores:** coloque as pilhas e adicione cada **Outdoor Meter** no app ("+" → Outdoor Meter). Associe-os ao Hub Mini quando o app pedir.
   - Nomeie como "Orquídeas 1", "Orquídeas 2" e "Orquídeas 3".
   - **Faça isso com os sensores perto do hub.**
4. **Token e segredo:** no app, **Perfil → Preferências → Sobre**, toque **10 vezes** em "Versão do app", abra **Opções de desenvolvedor** e copie o **Token** e o **Secret** (texto da documentação oficial da API).
5. No GitHub, cadastre os segredos **`SWITCHBOT_TOKEN`** e **`SWITCHBOT_SECRET`** e rode **Actions → Publicar na Cloudflare → Run workflow** de novo. **Não envie esses valores por mensagem.**

## 3. Ligar os sensores ao painel

1. No painel: **Configurações → Acesso para editar**, informe o `ADMIN_TOKEN`.
2. **Dados e integração → Sensores: SwitchBot → Ler agora.** Os 3 Outdoor Meter aparecem em "Dispositivos encontrados" como **Temperatura/umidade**. O Hub aparece como "Hub".
3. **Configurações → Sensores:** escolha qual sensor corresponde a S1, S2 e S3 e salve.
4. Em até alguns minutos, os valores aparecem no Painel.
   - **Se um sensor aparecer "sem comunicação":** abra-o no app e ative o serviço de nuvem ("Cloud Service"), se a opção existir. Confira também a distância até o hub.

**Como o sistema trata os dados SwitchBot:**
- A nuvem SwitchBot é atualizada pelo hub a cada **2 a 30 min**, conforme a variação. O painel lê a cada 2 min.
- A API não informa o horário exato da medição. Por isso, o horário gravado é o da leitura, e **só se grava quando o valor muda**.
- Se um sensor parar, o valor antigo nunca é "renovado": o sensor aparece como **atrasado** e depois **sem comunicação**.

## 4. Bomba (eWeLink)

1. Em **dev.ewelink.cc**, com a conta onde está o Sonoff da bomba, faça o cadastro de desenvolvedor pessoal e aguarde a aprovação.
2. Crie um app com o retorno `https://<seu-endereço>/api/ewelink/callback`. A tela "Dados e integração" mostra o valor exato.
3. Cadastre `EWELINK_APP_ID` e `EWELINK_APP_SECRET` nos segredos do GitHub e publique de novo.
4. No painel: **Dados e integração → Conectar conta eWeLink**; depois, **Configurações → Bomba**.
5. Ligue e desligue a bomba pelo app eWeLink: em até 2 min o painel acompanha (**ligada/desligada**).

## 5. Posição dos sensores

- **Altura:** a das plantas, cerca de 1,0–1,5 m, pendurado ou preso na vertical.
- **Sombra sempre:** sol direto no sensor mede o aquecimento do próprio aparelho, não o ar.
- **Água:** o Outdoor Meter é IP65 (resiste a respingos e chuva), mas **não fique embaixo de aspersor ou nebulizador**. Molhado, ele marca 100 % de umidade de forma falsa.
- **Longe das bordas:** afaste de paredes, porta e cobertura, onde o ar é diferente.
- **Distribuição:** algo como início, meio e fundo do orquidário (12 m). O mapa é mais útil com os 3 formando um triângulo, não em linha.
- **Posições:** meça **x** (ao longo dos 12 m) e **y** (ao longo dos 5 m) a partir de um canto fixo. Informe em Configurações e desmarque "Provisória".
- **Aspersores e orientação:** informe também a posição dos aspersores e a direção do Norte (bússola do celular).
- **Sinal:** depois de instalados, confira no app SwitchBot se os 3 continuam atualizando. Se algum falhar, aproxime o hub.

## 6. TV

Abra `https://…workers.dev/?tv=1&k=<VIEW_TOKEN>` no navegador da TV (ou Chromecast/Fire TV), use **Tela cheia** e salve nos favoritos. Esse endereço só permite ver, nunca editar.

## 7. Manutenção

- **Nada a fazer no dia a dia.** O painel lê sozinho; falhas aparecem na tela com o motivo.
- **Pilhas AAA dos sensores:** a bateria aparece em "Dados e integração".
- **eWeLink (bomba), uma vez por ano:** crie um app novo em dev.ewelink.cc, troque `EWELINK_APP_ID`/`EWELINK_APP_SECRET` e conecte de novo. O painel avisa 30 dias antes.

## Alternativa com computador (não usada)

O repositório também tem um coletor local com **Zigbee2MQTT** (pasta `coletor/`) para sensores SONOFF SNZB-02WD. Ele exige um computador ligado o tempo todo no local e por isso **não faz parte do plano atual**.
