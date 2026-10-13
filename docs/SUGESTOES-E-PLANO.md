# Decisões e plano

## Decisões tomadas

- **Sem simulador nem modo demonstração:** o sistema só mostra dados reais. Sem leitura, mostra "aguardando".
- **Sensores lidos localmente, pelo Zigbee2MQTT (13/10/2026).**
  - **Por que:** é o único caminho com **suporte garantido e documentado** ao SNZB-02WD. Está no código oficial do Zigbee2MQTT, com adaptador SONOFF da lista de recomendados.
  - **Por que não pela nuvem:** a leitura pela API gratuita do eWeLink dependeria de o app de desenvolvedor pessoal liberar esse modelo. A documentação oficial diz que esse app acessa só "tipos principais, liberados aos poucos", e o SNZB-02WD não está na lista pública.
  - **Ganhos:**
    - **Nenhuma permissão de terceiros:** a leitura não depende de liberação de ninguém.
    - **Sem perda na queda de internet:** o coletor guarda e reenvia com o horário original.
    - **Sem cota mensal de chamadas** para os sensores.
  - **Custo:** um computador ligado no local (notebook parado ou Raspberry Pi) e o adaptador USB, que substitui a ponte.
- **Bomba pelo eWeLink, testada antes:** só ligada/desligada agora, com "desconhecido" quando não há confirmação. Sem histórico e sem comandos. O Sonoff da bomba já existe, então o teste não custa nada. Se não funcionar, só a bomba fica de fora.
- **Painel:**
  - **Mapas:** de temperatura e umidade.
  - **Gráficos:** média dos 3 sensores (temperatura e umidade), com máxima, mínima, média do período e maior diferença entre sensores.
  - **Tempo real e TV:** indicadores em tempo real e modo TV.

## Alternativas avaliadas para os sensores

| Caminho | Por que não é o principal |
|---|---|
| Ponte ZBBridge-P + API gratuita do eWeLink | Acesso do app pessoal ao SNZB-02WD não garantido pela documentação |
| Tuya | Renovação manual a cada 6 meses |
| SmartThings | Tokens de 24 h desde 2025 |
| Webhooks do eWeLink | Pagos, 100/dia e sem valores |
| Home Assistant completo | Funciona (usa o mesmo Zigbee2MQTT), mas é muito maior do que o necessário |
| ESP32 + sensor SHT4x montado à mão | Exige montagem, alimentação em cada ponto e vedação contra água |

## Plano

| Etapa | O que fazer | Critério para seguir |
|---|---|---|
| 1 | Pedir 3 × SNZB-02WD, ZBDongle-E/P e cabo extensor; publicar o painel | Painel abre (mostra "aguardando") |
| 2 | Preparar o computador e rodar o instalador | Cartão do coletor "Funcionando" em Dados e integração |
| 3 | Parear os 3 sensores na mesa, perto do adaptador; vincular S1–S3 | Leituras chegando com horário certo |
| 4 | Instalar nas posições reais e informar as posições | 48 h sem "sem comunicação"; LQI de cada sensor acima de ~30 |
| 5 | Ajustar "atualizado/atrasado" e definir seus limites de alerta | — |
| Paralelo | Bomba: cadastro no dev.ewelink.cc e conexão | Estado muda na TV ao ligar/desligar pelo app |
