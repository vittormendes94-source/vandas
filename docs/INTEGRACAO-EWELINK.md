# Integração eWeLink — o que se sabe, o que falta validar

**Estado: NÃO integrado, NÃO implementado, NÃO testado.** O arquivo `apps/worker/src/integrations/ewelink.ts` é um esqueleto explícito que **não faz nenhuma chamada de rede**. Implementar endpoints “de memória” seria declarar uma integração que ninguém verificou.

## Por que não foi implementado

1. A documentação oficial do eWeLink **não pôde ser acessada** neste ambiente (bloqueio de rede).
2. Não há credenciais de desenvolvedor, ponte, sensores nem o modelo do Sonoff da bomba para teste real.
3. Só há indícios (resultados de busca, fóruns; **não** documentação primária):
   - o app de desenvolvedor gratuito parece dar ~50 mil chamadas/mês, com OAuth2 que exige login humano;
   - desenvolvedores relatam que o **webhook não devolve temperatura/umidade**, apenas o resultado do gatilho;
   - o SNZB-02WD é Zigbee 3.0 e funciona com a ZBBridge-P; o app eWeLink mostra o histórico e exporta CSV (até 180 dias).
   Tudo isso precisa ser confirmado.

## Checklist de validação (antes de escrever código)

- [ ] Condições **atuais** de acesso à API para desenvolvedor (custo, aprovação, região do servidor para conta brasileira).
- [ ] Autenticação/autorização: fluxo OAuth2, validade e renovação de tokens; dá para operar sem navegador (cron)?
- [ ] Compatibilidade oficial: ZBBridge-P + SNZB-02WD como sub-dispositivo; a API expõe o sub-dispositivo?
- [ ] Campos de temperatura/umidade (e bateria/sinal) na API; existe horário da medição na resposta?
- [ ] Estado do Sonoff da bomba (modelo a identificar) e como ele é reportado (só em mudanças? heartbeat?).
- [ ] Limites de chamadas e frequência de atualização; cota gratuita realmente cobre 3 sensores + 1 relé.
- [ ] Viabilidade de coleta contínua **dentro do Worker gratuito** (cron ≥ 1 min, sem conexão persistente, 10 ms de CPU, subrequests).
- [ ] Webhooks: gratuitos? entregam dados de sensor? (não presumir).

## Como implementar depois de validar

1. Crie o app de desenvolvedor e guarde as credenciais **somente** como secrets do Worker (`wrangler secret put …`); nunca no front-end ou no repositório.
2. Em `ewelink.ts`, implemente `poll()` devolvendo um `IngestReadingsBody` e/ou `IngestRelayBody[]` (o mesmo contrato de [CONTRATO-DE-LEITURAS.md](CONTRATO-DE-LEITURAS.md)), com `measuredAt` da origem quando existir, e mapeie `externalId` (deviceid) → `sensorId` a partir de Configurações.
3. Faça o `scheduled()` de `src/index.ts` persistir o resultado com `persistReadings`/`recordRelay` (dataset `real`). **Sem fallback para simulação.**
4. Teste com o equipamento real e só então marque a integração como concluída na documentação e na tela “Dados e integração”.

## Se a validação falhar

O restante do sistema não muda. Alternativas (ver [SUGESTOES-E-PLANO.md](SUGESTOES-E-PLANO.md)): sensor Wi-Fi próprio enviando direto à API de ingestão; ponte local (Home Assistant/Node-RED) que repassa leituras; importar CSV exportado pelo app do eWeLink (formato ainda não verificado).
