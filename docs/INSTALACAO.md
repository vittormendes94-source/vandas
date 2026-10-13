# Instalação passo a passo

## Caminho rápido: tudo em paralelo

O que mais demora é a **entrega do sensor**, importado, de 2 a 4 semanas, e a **aprovação do eWeLink**, de alguns dias. Por isso, comece os dois **hoje**, ao mesmo tempo:

| Dia | Você faz | Tempo |
|---|---|---|
| Hoje | **Pedir os 3 sensores SNZB-02WD + 1 ponte ZBBridge-P** ([COMPRAS.md](COMPRAS.md)) | 20 min |
| Hoje | **Cadastro de desenvolvedor em dev.ewelink.cc**, com a mesma conta da bomba (passo 1.2) | 10 min + espera |
| Hoje | **Conta na Cloudflare + segredos no GitHub + publicar pelo botão** ([PUBLICACAO.md](PUBLICACAO.md), caminho A) | 15 min |
| Quando o eWeLink aprovar | Cadastrar APPID/SECRET no GitHub, publicar de novo e **testar com a bomba** (passo 3) | 10 min |
| Quando a ponte chegar (2–5 dias) | Instalar a ponte (passo 4.1) | 10 min |
| Quando os sensores chegarem | Parear, vincular e posicionar (passos 4 e 5) | 1 h |
| Depois | TV (passo 6) | 5 min |

**Risco de comprar antes do teste:** se o app pessoal do eWeLink não enxergar os sensores da ponte, o sistema não lê os sensores. Mesmo assim, ponte e sensores continuam funcionando no **app eWeLink**, com tela, histórico e alertas do próprio app. O dinheiro não se perde e há alternativas de leitura.

## 0. Lista de compras

Especificação exata, lojas, links e preços: [COMPRAS.md](COMPRAS.md).

| Item | Qtd | Observação |
|---|---|---|
| **SONOFF SNZB-02WD** (IP65, tela LCD, pilha CR2477 inclusa) | 3 | Feito para ambiente úmido/estufa. Cada um mede temperatura **e** umidade |
| **SONOFF ZBBridge-P** (Zigbee Bridge **Pro**) | 1 | Micro-USB 5 V/1 A (cabo incluso; use um carregador de celular que você já tenha) |

**Atenção na compra:**
- **Ponte:** a ponte **antiga "Sonoff ZBBridge"**, sem "-P" ou "-U", **não** consta como compatível com o SNZB-02WD. Compre a **ZBBridge-P**.
- **Sensor:** confira que o anúncio diz **SNZB-02WD**. O SNZB-02D, o SNZB-02P e o SNZB-02 não são à prova d'água.
- **Wi-Fi:** a ponte precisa de sinal **2,4 GHz**.

## 1. Contas (gratuitas)

1. **Cloudflare** (dash.cloudflare.com): crie a conta, abra "Workers & Pages" e escolha o subdomínio `*.workers.dev`. O endereço do sistema será `https://orquidario-inteligente.<subdominio>.workers.dev`.
2. **eWeLink para desenvolvedor** (dev.ewelink.cc): entre com a **mesma conta do app eWeLink onde está o Sonoff da bomba**, faça o cadastro de desenvolvedor pessoal e aguarde a aprovação.
3. Com a aprovação, crie um app e cadastre como retorno `https://orquidario-inteligente.<subdominio>.workers.dev/api/ewelink/callback`. Anote o **APPID**, o **APP SECRET** e a data de criação; a credencial vale 1 ano.

## 2. Publicar o sistema

Pelo navegador, sem instalar nada: [PUBLICACAO.md](PUBLICACAO.md), caminho **A**. Você cria um token na Cloudflare, cadastra os segredos no GitHub e clica em **Actions → Publicar na Cloudflare → Run workflow**. O banco é criado sozinho.

## 3. Teste com o que você já tem (custo zero)

1. Abra o endereço publicado. Em **Configurações → Acesso para editar**, cole o `ADMIN_TOKEN`.
2. Em **Dados e integração → Conectar conta eWeLink**, faça o login na página oficial.
3. Em **Configurações → Bomba**, escolha o Sonoff da bomba e salve.
4. Ligue e desligue a bomba pelo app eWeLink. Em até 2 min, o painel deve acompanhar.

Se isso funcionar, a API está liberada para a sua conta.

## 4. Ponte e primeiro sensor

1. **Ponte:** ligue-a na tomada (USB) num lugar **coberto e seco**, perto do orquidário e com Wi-Fi 2,4 GHz. No app eWeLink: "+" → adicionar dispositivo → siga o manual da ZBBridge-P.
2. **Sensor:** retire a lingueta da pilha. No app, abra a ponte → **adicionar subdispositivo** e segure o botão do sensor até piscar (veja o manual). Faça o pareamento **perto da ponte**.
3. Dê um nome claro no app, por exemplo "Orquidário 1".
4. No sistema, **Dados e integração → Ler agora**: o sensor deve aparecer como **"Temperatura/umidade"**.
   - Se aparecer "Não suportado (UIID …)", me envie o número.
5. Em **Configurações → Sensores**, vincule o sensor ao S1 e salve.
6. Repita com os outros dois sensores (S2 e S3). Nos primeiros dias, observe:
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
