# Lista de compras

Revisada em 13/10/2026. **Preços vistos em resultados de busca; as páginas das lojas não puderam ser abertas para conferência. Confira preço, estoque e vendedor antes de comprar.** Lojas preferidas: **AliExpress, Mercado Livre, Amazon e Shopee**.

## Decisão: sensores SwitchBot (online, sem computador, suporte documentado)

Requisitos: **tudo online**, **sem computador ligado** no local e **sem depender de liberação incerta**.

| Ponto | Situação | Prova |
|---|---|---|
| A API lê o **Outdoor Meter** (temperatura, umidade, bateria) | ✅ Garantido | Documentação oficial da API SwitchBot (github.com/OpenWonderLabs/SwitchBotAPI): o Outdoor Meter (`WoIOSensor`) consta com "Status ✓" e "Webhook ✓", e os campos `temperature`, `humidity` e `battery` estão listados |
| Acesso à API | ✅ Gratuito | Token e segredo gerados no próprio app. Limite de 10 000 chamadas/dia; o sistema usa ~2 200 |
| Computador no local | ✅ Não precisa | Sensor → **Hub Mini** (na tomada, Wi-Fi) → nuvem SwitchBot → painel |
| À prova d'água | ✅ IP65 | Ficha oficial do Outdoor Meter |
| Integração no sistema | ✅ Pronta e testada | Testes com servidor que reproduz a API oficial e confere a assinatura pelo exemplo oficial |
| Frequência | ⚠️ Limitação conhecida | A SwitchBot atualiza a nuvem a cada **2 a 30 min**, conforme a variação (artigo de suporte da SwitchBot). O painel lê a cada 2 min |
| Bomba (Sonoff) | ✅ eWeLink | O app eWeLink já mostra ligada/desligada; o sistema lê esse mesmo estado pela API oficial do eWeLink |

**O que não compramos mais:** SNZB-02WD, ponte ZBBridge-P, adaptador ZBDongle e computador. A API gratuita do eWeLink **não garante** acesso ao SNZB-02WD, e o caminho garantido para ele (Zigbee2MQTT) exige computador ligado.

## O que comprar

| # | Item | Qtd | Estimativa |
|---|---|---|---|
| 1 | **SwitchBot Outdoor Meter** (termo-higrômetro interno/externo IP65, modelo **W3400010**) | 3 | ~US$ 15–20 cada |
| 2 | **SwitchBot Hub Mini** (o "Hub Mini Matter Enabled" também serve) ou **Hub 2** | 1 | ~US$ 35 |
| — | Carregador USB de celular (5 V / 1 A) para o hub | 1 | Use um que você já tem |

**Mais simples:** o **"Outdoor Meter Kit"** oficial (3 Outdoor Meter + 1 Hub Mini), visto a **US$ 59,99** na loja oficial dos EUA.

Cada Outdoor Meter mede **temperatura e umidade**: 3 aparelhos = 3 pontos de temperatura + 3 de umidade.

## Especificação e checklist do anúncio

### SwitchBot Outdoor Meter (×3)

- Nome: **"SwitchBot Indoor/Outdoor Thermo-Hygrometer"** ou **"Outdoor Meter"**, modelo **W3400010**.
- **IP65**, sensor suíço Sensirion, Bluetooth, 2 pilhas AAA.
- Não confundir com o **Meter**, o **Meter Plus** ou o **Meter Pro**: funcionam com o sistema, mas **não são à prova d'água**.

### Hub (×1)

- **Hub Mini** (W0202200), **Hub Mini Matter** ou **Hub 2**. Qualquer um serve.
- Wi-Fi **2,4 GHz**. **Uso interno:** fica coberto, numa tomada perto do orquidário.
- **Alcance do Bluetooth:** até 120 m em campo aberto, segundo o fabricante. Paredes reduzem. Deixe o hub a poucos metros do orquidário, de preferência com visão direta.

## Onde comprar

A busca **não encontrou** o Outdoor Meter à venda em lojas brasileiras. Confira nas 4 lojas; se não houver, a compra é importada.

| Loja | Link | Observação |
|---|---|---|
| AliExpress | https://pt.aliexpress.com/w/wholesale-switchbot-outdoor-meter.html | Procure a loja oficial "SwitchBot Official Store" |
| Amazon Brasil | https://www.amazon.com.br/s?k=switchbot+outdoor+meter | Não confirmado |
| Mercado Livre | https://lista.mercadolivre.com.br/switchbot | Há anúncios SwitchBot importados (envio dos EUA); confira se é o Outdoor Meter (W3400010) |
| Shopee | https://shopee.com.br/search?keyword=switchbot%20outdoor%20meter | Não confirmado |
| Loja oficial SwitchBot (EUA) | https://us.switch-bot.com/products/outdoor-meter-kit | **Kit 3 sensores + Hub Mini: US$ 59,99.** Confira se envia para o Brasil |
| Amazon EUA | https://www.amazon.com/SwitchBot-Hygrometer-Thermometer-Bluetooth-Refrigerator/dp/B0BVLYPYT1 | Outdoor Meter avulso. Confira o envio para o Brasil |

**Imposto de importação:** até onde sei, até US$ 50 paga-se 20 % + ICMS; acima disso, a alíquota é maior, com desconto fixo. Confira no checkout.

## Estimativa de gasto

| Compra | Estimativa |
|---|---|
| Kit 3 Outdoor Meter + Hub Mini (US$ 60 + frete + impostos de importação, câmbio R$ 5,50) | **~R$ 500–750** |
| Mensal (sistema na nuvem) | R$ 0 |
| Mensal (energia do hub + pilhas AAA) | ~R$ 2 |
