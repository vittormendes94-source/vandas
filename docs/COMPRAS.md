# Lista de compras

Revisada em 13/10/2026. **Preços vistos em resultados de busca; as páginas das lojas não puderam ser abertas para conferência. Confira preço, estoque e vendedor antes de comprar.** Lojas: somente **AliExpress, Mercado Livre, Amazon e Shopee**.

## Decisão: leitura dos sensores pelo caminho garantido

Os sensores são lidos **direto pelo rádio Zigbee**, num computador no local, com o **Zigbee2MQTT** (programa livre e gratuito, o padrão de mercado para Zigbee). Não há dependência de permissão de nuvem de terceiros.

| Ponto | Situação | Prova |
|---|---|---|
| SNZB-02WD suportado pelo Zigbee2MQTT | ✅ Garantido | Código oficial do Zigbee2MQTT (`zigbee-herdsman-converters`, `sonoff.ts`): modelo `SNZB-02WD`, "Waterproof (IP65) temperature and humidity sensor with screen", com temperatura, umidade e bateria |
| Frequência de leitura | ✅ Definida | Mesmo arquivo: envia a cada variação de 0,2 °C ou 1 % UR e, **no máximo, a cada 1 hora** |
| Adaptador SONOFF ZBDongle-P / ZBDongle-E | ✅ Garantido | Documentação oficial do Zigbee2MQTT: ambos na lista de adaptadores **recomendados** (zStack e EmberZNet) |
| Configuração do Zigbee2MQTT gerada pelo instalador | ✅ Testada | Validada pela versão 2.14.2 real do Zigbee2MQTT (formato 5, adaptador ember) |
| Coletor → painel, com fila contra queda de internet | ✅ Testado | Mosquitto e Zigbee2MQTT reais em contêiner; mensagens no formato do Zigbee2MQTT; internet derrubada e restabelecida sem perda |
| Bomba (Sonoff Wi-Fi) pelo eWeLink | ⚠️ Testar antes, sem custo | O Sonoff da bomba já existe: o teste (dev.ewelink.cc) não exige compra. Se não funcionar, só a bomba fica de fora; os sensores não dependem disso |

A ponte ZBBridge-P **não é mais necessária**: o adaptador USB faz o papel dela.

## O que comprar

| # | Item | Qtd | Estimativa |
|---|---|---|---|
| 1 | Sensor **SONOFF SNZB-02WD** | 3 | R$ 115–160 cada (importado) |
| 2 | Adaptador **SONOFF Zigbee 3.0 USB Dongle Plus**, modelo **ZBDongle-E** ou **ZBDongle-P** | 1 | R$ 190–280 |
| 3 | **Cabo extensor USB 2.0, macho-fêmea, 1 m** | 1 | R$ 20–40 |
| 4 | **Computador** que fica ligado no local (veja abaixo) | 1 | R$ 0 a R$ 1.430 |

### Computador: uma das duas opções

| Opção | Quando escolher | Custo |
|---|---|---|
| **A. Notebook ou PC que você já tem**, de 64 bits, com 2 GB de RAM ou mais | Se tiver um parado. Notebook é o melhor: a **bateria segura quedas de energia** | R$ 0 |
| **B. Kit Raspberry Pi 4 Model B 4 GB**, com **fonte oficial 5 V/3 A USB-C**, cartão **32 GB "High Endurance"** e case | Se não tiver computador disponível. É a plataforma de referência do Zigbee2MQTT | R$ 1.100–1.430 (kits no Mercado Livre) |

O computador precisa de **Wi-Fi ou cabo de rede** e deve ficar **perto do orquidário**, em lugar coberto. O alcance do Zigbee chega a dezenas de metros, mas paredes reduzem.

## Especificação exata e checklist do anúncio

### Sensor: SONOFF SNZB-02WD (×3)

Ficha oficial: https://help.sonoff.tech/docs/snzb-02wd

- O título diz **SNZB-02WD**. Não serve 02, 02D, 02P nem 02LD.
- **IP65**, tela LCD de 2,2", **Zigbee 3.0**, pilha CR2477 (vem instalada).
- Faixa de −20 a 60 °C e 0–100 % UR; precisão de ±0,2 °C e ±2 % UR.
- Desconfie de preço abaixo de US$ 15 e de anúncio que fale em "Tuya" ou "Wi-Fi".

### Adaptador: SONOFF Zigbee 3.0 USB Dongle Plus (×1)

- Modelo **ZBDongle-E** (também chamado "Dongle Plus V2", chip EFR32MG21) **ou ZBDongle-P** (chip CC2652P). Os dois servem e vêm prontos para uso.
- Marca **SONOFF/ITEAD**, com antena externa.
- Não compre: adaptadores genéricos sem marca, "Tuya Zigbee gateway" (Wi-Fi) e a ponte ZBBridge.

### Cabo extensor USB 2.0 (×1)

Afasta o adaptador do computador. A própria documentação do Zigbee2MQTT recomenda, para evitar interferência das portas USB 3.

## Onde comprar (só as 4 lojas)

### Sensor SNZB-02WD

| Loja | Link | Observação |
|---|---|---|
| **AliExpress, loja "SONOFF Official Store"** | https://pt.aliexpress.com/w/wholesale-snzb-02wd.html | **Primeira opção.** US$ 20–39. Remessa Conforme: o imposto já vem no checkout |
| Mercado Livre | https://lista.mercadolivre.com.br/snzb-02wd | Nenhum anúncio encontrado na busca; confira |
| Amazon Brasil | https://www.amazon.com.br/s?k=SNZB-02WD | Nenhum anúncio encontrado (lá fora é o ASIN B0FCG88WW6) |
| Shopee | https://shopee.com.br/search?keyword=snzb-02wd | Nenhum anúncio encontrado; confira |

### Adaptador ZBDongle-E / ZBDongle-P

| Loja | Link | Preço visto |
|---|---|---|
| **Mercado Livre** | https://lista.mercadolivre.com.br/sonoff-dongle-zigbee | R$ 190–280 (ZBDongle-E e ZBDongle-P) |
| Amazon Brasil | https://www.amazon.com.br/s?k=sonoff+zigbee+usb+dongle+plus | Confira |
| AliExpress | https://pt.aliexpress.com/w/wholesale-sonoff-zbdongle.html | Na SONOFF Official Store; pode ir no mesmo pedido dos sensores |
| Shopee | https://shopee.com.br/search?keyword=sonoff%20zbdongle | Confira o vendedor |

### Raspberry Pi 4 (só se for a opção B)

| Loja | Link | Preço visto |
|---|---|---|
| Mercado Livre | https://lista.mercadolivre.com.br/kit-raspberry-pi-4-4gb | Kits de R$ 1.090 a R$ 1.433 |
| Amazon Brasil | https://www.amazon.com.br/Raspberry-Pi-Computer-Model-RAM/dp/B07TC2BK1X | Placa avulsa: R$ 778,73 (sem fonte nem cartão) |

**Prefira o kit com fonte oficial.** Fonte fraca é a causa número 1 de problemas no Raspberry Pi.

## Estimativa de gasto

| Compra | Opção A (notebook que você tem) | Opção B (Raspberry Pi) |
|---|---|---|
| 3 × SNZB-02WD | R$ 345–480 | R$ 345–480 |
| ZBDongle-E/P + cabo extensor | R$ 210–320 | R$ 210–320 |
| Computador | R$ 0 | R$ 1.100–1.430 |
| **Total** | **~R$ 555–800** | **~R$ 1.655–2.230** |
| Mensal (sistema na nuvem) | R$ 0 | R$ 0 |
| Mensal (energia do computador) | ~R$ 5–10 (notebook) | ~R$ 3 |
