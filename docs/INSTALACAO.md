# Instalação passo a passo

Ordem pensada para gastar o mínimo e descobrir problemas antes de comprar tudo.

## 0. Lista de compras

| Etapa | Item | Qtd | Observação |
|---|---|---|---|
| Piloto | **SONOFF SNZB-02WD** (IP65, tela LCD, sensor SHT40, pilha CR2477 inclusa) | 1 | Feito para ambiente úmido/estufa |
| Piloto | **SONOFF ZBBridge-P** (Zigbee Bridge **Pro**) | 1 | Alimentação USB 5 V (use um carregador de celular que você já tenha) |
| Depois do piloto | SNZB-02WD | 2 | Só depois de a primeira semana funcionar |

**Atenção na compra:**
- **Ponte:** a ponte **antiga "Sonoff ZBBridge"** (sem "-P" ou "-U") **não** consta como compatível com o SNZB-02WD. Compre **ZBBridge-P** (a mais barata compatível) ou **ZBBridge-U** (mais nova e mais cara, sem vantagem para este uso).
- **Sensor:** confira que o anúncio diz **SNZB-02WD**. O SNZB-02D, o SNZB-02P e o SNZB-02 não são à prova d'água. O sistema lê esses modelos também, mas não são indicados para o orquidário.
- **Wi-Fi:** a ponte precisa de sinal **2,4 GHz**.

## 1. Contas (gratuitas)

1. **Cloudflare** (dash.cloudflare.com): crie a conta, abra "Workers & Pages" e escolha o subdomínio `*.workers.dev`. Ele define o endereço do sistema: `https://orquidario-inteligente.<subdominio>.workers.dev`.
2. **eWeLink para desenvolvedor** (dev.ewelink.cc): entre com a **mesma conta do app eWeLink onde está o Sonoff da bomba**, faça o cadastro de desenvolvedor pessoal e aguarde a aprovação.
3. Com a aprovação, crie um app e cadastre como retorno: `https://orquidario-inteligente.<subdominio>.workers.dev/api/ewelink/callback`. Anote o **APPID**, o **APP SECRET** e a data de criação; a credencial vale 1 ano.

## 2. Publicar o sistema (no seu computador, uma vez)

Requisitos: Node.js 22+ e git. Siga [PUBLICACAO.md](PUBLICACAO.md). Em resumo:

```bash
git clone https://github.com/vittormendes94-source/vandas.git && cd vandas
npm install
npx wrangler login
cd apps/worker && npx wrangler d1 create orquidario     # copie o database_id para wrangler.toml
# em wrangler.toml: EWELINK_REDIRECT_URL e EWELINK_APP_EXPIRES_AT
npm run db:migrate:remote
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put VIEW_TOKEN
npx wrangler secret put EWELINK_APP_ID
npx wrangler secret put EWELINK_APP_SECRET
cd ../.. && npm run build && cd apps/worker && npx wrangler deploy
```

## 3. Teste com o que você já tem (custo zero)

1. Abra o endereço publicado. Em **Configurações → Acesso para editar**, cole o `ADMIN_TOKEN`.
2. Em **Dados e integração → Conectar conta eWeLink**, faça o login na página oficial.
3. Em **Configurações → Bomba**, escolha o Sonoff da bomba e salve.
4. Ligue e desligue a bomba pelo app eWeLink. Em até 2 min, o painel deve acompanhar.

Se isso funcionar, a API está liberada para a sua conta e você pode comprar o piloto.

## 4. Piloto: 1 sensor + ponte

1. **Ponte:** ligue-a na tomada (USB) num lugar **coberto e seco**, perto do orquidário e com Wi-Fi 2,4 GHz. No app eWeLink: "+" → adicionar dispositivo → siga o manual da ZBBridge-P.
2. **Sensor:** retire a lingueta da pilha. No app, abra a ponte → **adicionar subdispositivo** e segure o botão do sensor até piscar (veja o manual). Faça o pareamento **perto da ponte**.
3. Dê um nome claro no app, por exemplo "Orquidário 1".
4. No sistema, **Dados e integração → Ler agora**: o sensor deve aparecer como **"Temperatura/umidade"**.
   - Se aparecer "Não suportado (UIID …)", me envie o número.
5. Em **Configurações → Sensores**, vincule o sensor ao S1 e salve.
6. Deixe rodando **uma semana**. Observe:
   - **Intervalo entre leituras:** veja no Histórico → Lacunas. Ajuste "atualizado/atrasado" em Configurações.
   - **Estabilidade:** se ele fica "online" sem quedas.
   - **Precisão:** se os valores batem com um termo-higrômetro comum colocado ao lado.

## 5. Instalação final dos 3 sensores

- **Altura:** a das plantas, cerca de 1,0–1,5 m, pendurado ou preso na vertical.
- **Sombra sempre:** sol direto no sensor mede o aquecimento do próprio aparelho, não o ar.
- **Longe da água:** não fique **embaixo de aspersor ou nebulizador**, porque molhado ele mede 100 % de umidade de forma falsa.
- **Longe das bordas:** afaste de paredes, porta e cobertura, onde o ar é diferente.
- **Distribuição:** algo como início, meio e fundo do orquidário (12 m). O mapa é mais útil com os 3 formando um triângulo, não em linha.
- **Posições:** meça **x** (ao longo dos 12 m) e **y** (ao longo dos 5 m) a partir de um canto fixo. Informe em Configurações e desmarque "Provisória".
- **Aspersores e orientação:** informe também a posição dos aspersores e a direção do Norte (bússola do celular).

## 6. TV

Abra `https://…workers.dev/?tv=1&k=<VIEW_TOKEN>` no navegador da TV (ou Chromecast/Fire TV), use **Tela cheia** e salve nos favoritos. Esse endereço só permite ver, nunca editar.

## 7. Manutenção

- **Nada a fazer no dia a dia.** A conexão com o eWeLink se renova sozinha.
- **Uma vez por ano:** crie um app novo em dev.ewelink.cc, troque `EWELINK_APP_ID`/`EWELINK_APP_SECRET`, atualize `EWELINK_APP_EXPIRES_AT` e conecte de novo. O painel avisa 30 dias antes.
- **Pilha CR2477:** o fabricante estima mais de 2 anos. A bateria aparece no painel.
