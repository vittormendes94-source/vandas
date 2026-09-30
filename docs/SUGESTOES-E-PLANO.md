# Decisões e plano

## Decisões tomadas

- **Sem simulador nem modo demonstração:** o sistema só mostra dados reais. Sem leitura, mostra "aguardando".
- **Ecossistema SONOFF, lido por uma única integração: a API oficial do eWeLink.**
  - **Por que eWeLink:** é o único caminho gratuito que lê também o Sonoff da bomba sem trocá-lo. O sensor informa o horário exato da medição.
  - **Alternativas avaliadas:**
    - Tuya: renovação manual a cada 6 meses.
    - SmartThings: tokens de 24 h desde 2025.
    - Webhooks do eWeLink: pagos, limitados a 100/dia e sem valores.
    - Regravar a ponte com Tasmota: técnico demais.
    - SwitchBot: bom plano B só para sensores.
- **Bomba:** só ligada/desligada agora, com "desconhecido" quando não há confirmação. Sem histórico e sem comandos.
- **Painel:**
  - **Mapas:** de temperatura e umidade.
  - **Gráficos:** média dos 3 sensores (temperatura e umidade), com máxima, mínima, média do período e maior diferença entre sensores.
  - **Tempo real e TV:** indicadores em tempo real e modo TV.

## Plano de menor risco

| Etapa | O que fazer | Custo | Critério para seguir |
|---|---|---|---|
| 1 | Cadastro de desenvolvedor em dev.ewelink.cc e conta gratuita na Cloudflare | R$ 0 | App aprovado |
| 2 | Publicar o sistema ([PUBLICACAO.md](PUBLICACAO.md)) e conectar a conta eWeLink | R$ 0 | O **Sonoff da bomba** aparece e o estado muda na TV quando você liga/desliga pelo app |
| 3 | Comprar **1 sensor SNZB-02WD + 1 ponte** | 1 kit | O sensor aparece como "Temperatura/umidade" e a leitura chega com o horário certo por 1 semana |
| 4 | Comprar os outros 2 sensores, instalar nas posições reais e informar as posições | 2 sensores | 48 h sem "sem comunicação" inesperado |
| 5 | Ajustar "atualizado/atrasado" à frequência observada e definir seus limites de alerta | — | — |

A etapa 2 usa um aparelho que você **já tem**. Se a API do eWeLink falhar ali, nada foi comprado.

## Plano B (se o sensor não for legível pela API)

A tela mostra "Não suportado (UIID X)". Opções, em ordem:
1. Me enviar o UIID para adicionar o formato. Depende de o eWeLink expor os valores.
2. Sensores SwitchBot Outdoor Meter (IP65) + Hub, lidos pela API da SwitchBot. A bomba continua pelo eWeLink.
3. A rota genérica de ingestão ([CONTRATO-DE-LEITURAS.md](CONTRATO-DE-LEITURAS.md)) aceita qualquer outra origem.
