# Sugestões (sensores, arquitetura) e plano por fases

Você pediu ideias melhores, sensores melhores ou um plano mais assertivo. Abaixo, com **o que é fato, o que é opinião e o que precisa ser verificado**.

## 1. Riscos do plano atual (SNZB-02WD + ZBBridge-P + eWeLink)

| Risco | Situação |
|---|---|
| Depende de uma cadeia: sensor Zigbee → ponte → nuvem eWeLink → API → nosso Worker | 4 elos que você não controla |
| API do eWeLink: acesso, cotas e webhooks não validados | pendente ([INTEGRACAO-EWELINK.md](INTEGRACAO-EWELINK.md)) |
| SNZB-02WD: ±0,2 °C e ±2 % UR segundo o fabricante; em ~90–100 % UR de orquidário, sensores de umidade podem saturar/derivar | **verificar** com um psicrômetro/higrômetro de referência antes de confiar nos valores absolutos |
| Frequência de envio desconhecida (Zigbee costuma reportar por variação + intervalo) | medir na fase piloto |
| 3 pontos em 60 m² | o IDW só suaviza; não mede gradiente real |

## 2. Alternativas e melhorias (ordenadas por custo-benefício)

1. **Piloto barato antes de comprar tudo**: 1 SNZB-02WD + 1 ponte por ~1 semana. Objetivo: medir o intervalo real de envio e testar a API do eWeLink com um script descartável. Só depois comprar os outros 2.
2. **Sensor Wi-Fi próprio (ESP32 + SHT31/SHT4x)** enviando direto à API de ingestão: independe de nuvem e de ponte, controle total de frequência e horário (`measuredAt` correto), custo unitário baixo. Contras: montagem, alimentação, caixa vedada contra condensação. Há um sketch de partida em `examples/esp32-sht31/` (**não testado em hardware**). O SHT4x tem aquecedor interno, útil para recuperar o sensor após condensação (**verificar** na folha de dados do modelo escolhido).
3. **Confirmar a bomba de verdade**: hoje só há o estado do relé. Um Sonoff com **medição de potência** (ou uma tomada com medição) na bomba mostraria consumo — prova de que a bomba realmente girou, sem sensor de vazão. **Verificar** compatibilidade e API do modelo antes de comprar. Um sensor de vazão ou pressostato fecharia o ciclo (etapa futura).
4. **Mais pontos**: 4–6 sensores (inclusive um externo de referência) melhoram muito a leitura espacial; posicione à altura das plantas, longe de bicos de nebulização e do sol direto.
5. **Luz** (BH1750/VEML7700 ou PAR): orquídeas são sensíveis à luminosidade; ESP32 + sensor de luz usa o mesmo contrato (seria um novo tipo de grandeza — requer extensão do esquema).
6. **Substrato**: umidade do ar não diz nada sobre as raízes. Sensores capacitivos em casca/musgo costumam ser pouco confiáveis; pesagem do vaso é uma ideia a investigar. **Não** implementado.
7. **TV**: um dongle/TV com navegador abrindo `?tv=1&k=…` em tela cheia basta; nenhum computador dedicado.
8. **Alertas** (WhatsApp/e-mail/push) só depois de definir seus limites reais; hoje há apenas destaque na tela.

## 3. Plano por fases (com critério de decisão)

| Fase | Entrega | Critério para avançar |
|---|---|---|
| 0 — agora | Demonstração completa e API de ingestão prontas | Você aprova layout, textos e escopo |
| 1 — levantamento | Identificar o modelo do Sonoff da bomba; medir posições reais (12 × 5 m), definir nº e posição dos aspersores; decidir quais limites de alerta usar | Dados preenchidos em Configurações |
| 2 — piloto (1 semana) | 1 sensor + ponte; medir frequência efetiva; script descartável de teste da API eWeLink; comparar com um higrômetro de referência | **Go**: API acessível de graça e frequência ≥ 1 leitura/15 min **e** erro aceitável. **No-go**: usar sensores Wi-Fi próprios (item 2) |
| 3 — instalação | 3+ sensores nas posições reais; ajustar limites de atraso; conectar (adaptador eWeLink validado **ou** ingestão direta) | 48 h sem lacunas inesperadas |
| 4 — publicação | Deploy manual ([PUBLICACAO.md](PUBLICACAO.md)) com `VIEW_TOKEN`; TV em tela cheia | Cotas observadas < 50 % no 1º dia |
| 5 — opcional | Confirmação da bomba (potência/vazão); comandos à bomba **somente com aprovação específica** e teste do modelo | Decisão sua |

## 4. Decisões que dependem de você

- Modelo do Sonoff da bomba; posições e quantidade de aspersores; orientação (Norte) do orquidário.
- Limites de alerta próprios (o sistema não impõe faixas “ideais”).
- Se aceita começar pelo piloto de 1 sensor em vez de comprar os 3.
