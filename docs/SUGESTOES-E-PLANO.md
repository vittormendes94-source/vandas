# Decisões e plano

## Decisões tomadas

- **Sem simulador nem modo demonstração:** o sistema só mostra dados reais. Sem leitura, mostra "aguardando".
- **Sensores: SwitchBot Outdoor Meter + Hub Mini, pela API oficial SwitchBot (13/10/2026).**
  - **Requisitos:** tudo online; sem computador ligado no local; suporte garantido em documentação.
  - **Por que SwitchBot:** a documentação oficial da API lista o Outdoor Meter (`WoIOSensor`) com leitura de status (temperatura, umidade, bateria). O sensor é IP65. A credencial é gerada no app, gratuita, com 10 000 chamadas/dia.
  - **Por que não SONOFF SNZB-02WD:**
    - **Pela nuvem eWeLink:** a documentação diz que o app gratuito de desenvolvedor pessoal acessa só "tipos principais, liberados aos poucos", e o SNZB-02WD não está na lista pública. Não é garantido.
    - **Pelo Zigbee2MQTT:** garantido, mas exige computador ligado o tempo todo (a pasta `coletor/` fica como alternativa).
  - **Limitação aceita:**
    - **Atualização da nuvem:** a SwitchBot atualiza a nuvem a cada 2 a 30 min, conforme a variação.
    - **Horário da medição:** a API não informa. O sistema grava o horário da leitura e só quando o valor muda; sensor parado vira "atrasado", nunca valor renovado.
- **Bomba pelo eWeLink:** o app eWeLink já mostra ligada/desligada, e o sistema lê esse mesmo estado pela API oficial (Sonoff Wi-Fi liga/desliga é tipo documentado). "Desconhecido" quando não há confirmação. Sem histórico e sem comandos.
- **Painel:**
  - **Mapas:** de temperatura e umidade.
  - **Gráficos:** média dos 3 sensores (temperatura e umidade), com máxima, mínima, média do período e maior diferença entre sensores.
  - **Tempo real e TV:** indicadores em tempo real e modo TV.

## Alternativas avaliadas para os sensores

| Caminho | Por que não é o principal |
|---|---|
| SONOFF SNZB-02WD + ponte + API gratuita do eWeLink | Acesso do app pessoal ao SNZB-02WD não garantido pela documentação |
| SONOFF SNZB-02WD + Zigbee2MQTT | Garantido, mas exige computador ligado no local |
| Tuya | Renovação manual a cada 6 meses |
| SmartThings | Tokens de 24 h desde 2025 |
| Webhooks do eWeLink | Pagos, 100/dia e sem valores |
| Shelly H&T (Wi-Fi) | Não é à prova d'água |
| ESP32 + sensor SHT4x montado à mão | Exige montagem, alimentação em cada ponto e vedação contra água |

## Plano

| Etapa | O que fazer | Critério para seguir |
|---|---|---|
| 1 | Pedir o kit (3 Outdoor Meter + Hub Mini); publicar o painel; cadastro no dev.ewelink.cc | Painel abre (mostra "aguardando") |
| 2 | Bomba: conectar o eWeLink e vincular o Sonoff | Estado muda na TV ao ligar/desligar pelo app |
| 3 | Kit chegou: hub, sensores perto do hub, token SwitchBot no GitHub, "Ler agora", vincular S1–S3 | Os 3 sensores com valores no painel |
| 4 | Instalar nas posições reais e informar as posições | 48 h sem "sem comunicação" |
| 5 | Ajustar "atualizado/atrasado" à frequência real e definir seus limites de alerta | — |
