# Lista de compras

Pesquisa de 05/10/2026, revisada em 13/10/2026. **Preços vistos em resultados de busca; as páginas das lojas não puderam ser abertas para conferência. Confira preço, estoque e vendedor antes de comprar.**

## O que comprar

| # | Item | Qtd |
|---|---|---|
| 1 | Ponte **SONOFF Zigbee Bridge Pro (ZBBridge-P)** | 1 |
| 2 | Sensor **SONOFF SNZB-02WD** | 3 |
| — | Carregador USB 5 V / 1 A (de celular) | 1 (use um que você já tem; a ponte vem com cabo micro-USB) |

Cada SNZB-02WD mede **temperatura e umidade**. São 3 sensores no total.

## O que é garantido e o que não é

| Ponto | Situação |
|---|---|
| SNZB-02WD funciona com a ZBBridge-P e aparece no app eWeLink | **Garantido** (lista oficial de compatibilidade da SONOFF) |
| O SNZB-02WD mede temperatura e umidade, IP65, para estufa | **Garantido** (ficha oficial) |
| O sistema entende o formato de leitura do SNZB-02WD | Testado com o JSON real de um SNZB-02WD publicado pela comunidade |
| **O app de desenvolvedor *pessoal* (gratuito) do eWeLink entrega o SNZB-02WD para o sistema** | **Não garantido.** A documentação oficial diz que apps pessoais acessam "tipos de dispositivo principais, liberados aos poucos", e o SNZB-02WD não está na lista oficial. A nuvem eWeLink entrega esse sensor a outros integradores, o que é um bom sinal, mas só o teste com a sua conta confirma |

**Se o eWeLink não entregar o sensor (plano B, garantido):** o SNZB-02WD é suportado oficialmente pelo **Zigbee2MQTT** (https://www.zigbee2mqtt.io/devices/SNZB-02WD.html). O sistema já tem a entrada de leituras para isso (`/api/v1/ingest/readings`). O plano B troca a ponte por:
- um **adaptador Zigbee USB** SONOFF (ZBDongle-E ou ZBDongle-P), por cerca de R$ 150–250;
- um **computador ligado o tempo todo** no local, como um Raspberry Pi ou um notebook antigo.

**Os sensores servem nos dois caminhos.** Só a ponte é específica do caminho A, e mesmo assim continua útil no app eWeLink.

**Para acelerar, peça tudo junto, hoje.** O sensor quase não existe em loja brasileira, e a importação leva de 2 a 4 semanas. Pedir 1 agora e 2 depois dobra a espera. O custo de pedir os 3 juntos: o pedido passa de US$ 50 e o imposto fica um pouco maior, cerca de R$ 25 a mais no total. Confira no checkout.

## Especificação exata

### Sensor: SONOFF SNZB-02WD
Ficha oficial: https://help.sonoff.tech/docs/snzb-02wd

| Confira no anúncio | Valor correto |
|---|---|
| Modelo | **SNZB-02WD** |
| Proteção | **IP65** (à prova de respingos e umidade) |
| Tela | LCD de 2,2" |
| Protocolo | Zigbee 3.0 |
| Pilha | CR2477 (vem instalada; o fabricante estima mais de 2 anos) |
| Faixa | −20 a 60 °C; 0–100 % UR |
| Precisão | ±0,2 °C; ±2 % UR |
| Tamanho | 62,8 × 58,5 × 21,8 mm |

**Não compre:**
- **SNZB-02, SNZB-02D, SNZB-02P:** funcionam com o sistema, mas não são à prova d'água.
- **SNZB-02LD:** é a versão com sonda externa, para medir líquidos.
- **Sensores "Tuya" ou genéricos:** são de outro ecossistema e não aparecem no eWeLink.

### Ponte: SONOFF Zigbee Bridge Pro (ZBBridge-P)

| Confira no anúncio | Valor correto |
|---|---|
| Modelo | **ZBBridge-P** ("Bridge **Pro**") |
| Rádios | Zigbee 3.0 + Wi-Fi **2,4 GHz** (802.11 b/g/n) |
| Alimentação | 5 V / 1 A, **micro-USB** (cabo incluso, fonte não) |
| Capacidade | até 128 dispositivos Zigbee |
| Temperatura de operação | −10 a 40 °C: **fica fora do orquidário**, em lugar seco |

**Não compre:**
- **"Sonoff ZBBridge" antiga, sem "Pro"/"-P":** não está na lista de compatíveis do SNZB-02WD.
- **Gateways Zigbee Tuya/genéricos:** não funcionam com o eWeLink.
- **ZBBridge-U:** também funciona, mas é mais cara e não traz vantagem aqui.

## Onde comprar

Somente as 4 lojas: **AliExpress, Mercado Livre, Amazon e Shopee**. Busca de 13/10/2026: as páginas das lojas não abrem daqui, então os links abaixo são buscas prontas. Confira cada anúncio com o checklist.

### Ponte ZBBridge-P (existe no Brasil, entrega rápida)

| Loja | Link | Preço visto na busca |
|---|---|---|
| Amazon Brasil | https://www.amazon.com.br/SONOFF-Atualizada-Protocolo-Subdispositivos-Inteligentes/dp/B09ZQQZSQZ | R$ 234,99 (mais de 2.300 avaliações) |
| Mercado Livre | https://lista.mercadolivre.com.br/sonoff-zigbee-bridge-pro | R$ 188–218 |
| AliExpress | https://pt.aliexpress.com/w/wholesale-zbbridge-p.html | Mais barato, mas demora semanas. Só se for junto com os sensores |
| Shopee | https://shopee.com.br/search?keyword=sonoff%20zigbee%20bridge%20pro | Não conferido |

### Sensor SNZB-02WD (não achei em loja brasileira; o caminho seguro é o AliExpress)

| Loja | Link | Observação |
|---|---|---|
| **AliExpress, loja "SONOFF Official Store"** | https://pt.aliexpress.com/w/wholesale-snzb-02wd.html | **Primeira opção.** Faixa vista: US$ 20–39. Participa do Remessa Conforme: o imposto já vem no checkout |
| Mercado Livre | https://lista.mercadolivre.com.br/snzb-02wd | Nenhum anúncio encontrado na busca; confira, pois isso muda rápido |
| Amazon Brasil | https://www.amazon.com.br/s?k=SNZB-02WD | Nenhum anúncio encontrado. Nos EUA e na Europa é o ASIN **B0FCG88WW6** |
| Shopee | https://shopee.com.br/search?keyword=snzb-02wd | Nenhum anúncio encontrado; confira |

**Checklist do anúncio do sensor:**
- O título diz **SNZB-02WD**. Não serve 02, 02D, 02P nem 02LD.
- Aparece **IP65** e **Zigbee**.
- **Foto:** um aparelho branco com tela LCD; a caixa mostra "IP65". O 02D é parecido, mas não diz IP65.
- **Vendedor:** loja oficial SONOFF ou vendedor com muitas vendas e nota acima de 4,7.
- **Desconfie** de preço abaixo de US$ 15 ou de anúncio que diga "Tuya" ou "Wi-Fi".

**Imposto de importação:** até onde sei, compras de até US$ 50 pagam 20 % mais ICMS; acima disso, a alíquota é maior, com desconto fixo. Para 3 sensores, a diferença é pequena. O AliExpress cobra o imposto no checkout, o que evita retenção na alfândega.

## Estimativa de gasto

Câmbio assumido: R$ 5,50.

| Compra | Estimativa |
|---|---|
| Ponte ZBBridge-P (Brasil) | R$ 190–240 |
| 3 × SNZB-02WD importados (R$ 115–160 cada, com impostos) | R$ 345–480 |
| **Total** | **~R$ 535–720** |
| Mensal (sistema) | R$ 0 |
| Mensal (energia da ponte + pilhas, diluído) | ~R$ 3 |
