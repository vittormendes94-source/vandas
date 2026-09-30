# Custos, cotas e dimensionamento

**Meta: R$ 0/mês, sem compra de domínio, sem serviço pago.** Nada neste repositório contrata, compra ou publica algo.

## Cotas gratuitas — status da verificação

> **Cloudflare:** as páginas oficiais (`developers.cloudflare.com`) estavam bloqueadas no ambiente de desenvolvimento. Os valores vêm de **resumos de busca** delas. **Confirme no painel antes de depender deles.**
> **eWeLink:** valores lidos na **documentação oficial** (repositório CoolKit-Technologies/eWeLink-API, 30/09/2026).

| Recurso (plano gratuito) | Valor obtido | Fonte | Uso deste projeto |
|---|---|---|---|
| D1 — linhas lidas | 5 milhões/dia | página de preços do D1 (via busca) | ~12 linhas por atualização de tela |
| D1 — linhas escritas | 100 mil/dia | idem | 2 por leitura (bruta + agregado horário) |
| D1 — armazenamento | 5 GB no total | idem | dezenas de MB |
| Workers — requisições | 100 mil/dia | página de preços/limites do Workers (via busca) | milhares/dia |
| Workers — CPU | 10 ms por invocação | idem | ver “Risco de CPU” |
| Arquivos estáticos (Static Assets) | requisições gratuitas e ilimitadas | idem | interface inteira |
| Cron Triggers | até 5 por conta | idem | 1 usado (a cada 2 min) |
| eWeLink — app de desenvolvedor pessoal | 50 mil chamadas/mês por região; ≥ 500 ms entre chamadas | documentação oficial | ~21,6 mil/mês (43 %) |

Limites diários reiniciam às 00:00 UTC (informação da mesma fonte). O plano gratuito é **bloqueado** (não cobrado) ao estourar cotas; **não** ative o “Workers Paid”. Confirme esse comportamento no painel.

## Dimensionamento

Premissas: 3 sensores + 1 Sonoff; leitura do eWeLink a cada 2 min (720 por dia); 5 telas abertas 24 h atualizando a cada 60 s.

| Item | Conta | Resultado | % da cota |
|---|---|---|---|
| Chamadas eWeLink | 720/dia × 30 + renovações | ~21,6 mil/mês | 43 % de 50 mil |
| Escritas D1: leituras novas | cada medição nova = 1 bruta + 1 agregado; se cada sensor mede a cada 5 min: 864 × 2 | ~1.700 linhas/dia | 1,7 % |
| Escritas D1: retrato dos aparelhos e estado da integração | 720 × (1 exclusão + ~5 aparelhos + 1 estado) | ~5 mil linhas/dia | 5 % |
| Leituras D1: telas | ≈ 15 linhas × 1.440 × 5 telas | ~110 mil/dia | 2 % |
| Requisições Worker | 1.440 × 5 telas + 720 cron + histórico | ~9 mil/dia | 9 % |
| Armazenamento | leituras brutas 45 dias + agregado 730 dias | ~20 MB | 0,4 % |

Consultar de novo a mesma medição não gera escrita: a chave é (sensor, instante da medição).

## Como o crescimento é limitado

- **Retenção**: leituras brutas por `retention.rawDays` (padrão 45 dias, configurável 7–90); agregados horários por 730 dias. Cron diário 03:00 (America/Sao_Paulo); também `POST /api/admin/maintenance`.
- **Agregação**: `readings_hourly` recalculado a cada gravação (idempotente). Períodos > 48 h leem só o agregado (≈ 720 linhas/sensor/mês em vez de 8.600+).
- **Sem índices secundários**: tabelas `WITHOUT ROWID` com PK composta (menos linhas escritas).
- **Consultas limitadas**: bruto ≤ 48 h e ≤ 3000 linhas/sensor; horário ≤ 400 dias; `LIMIT 1` por sensor para a última leitura.
- **Atualização das telas**: polling a cada 60 s (30/60/120/300 s), pausado com a aba oculta, recuo exponencial (até 5 min) em falhas, com indicação da última atualização. Não há SSE/WebSocket: conexões longas não cabem no Worker gratuito sem Durable Objects (complexidade e cotas próprias); a frequência dos sensores é de minutos, então o polling não perde nada relevante.

## Risco de CPU (10 ms/invocação no plano gratuito)

O trabalho por requisição é pequeno: respostas compactas, histórico bruto limitado, uma chamada ao eWeLink por execução do cron. Isso ainda **não foi medido no ambiente gratuito real**. Se aparecer "CPU time exceeded" em `/api/history`, reduza `RAW_ROW_LIMIT` em `apps/worker/src/repo.ts`. Relate o problema; não migre para plano pago por conta própria.

## Arquitetura: limitação concreta encontrada?

Nenhuma que obrigue a sair da arquitetura pedida (React + Workers + D1 + Static Assets no domínio `*.workers.dev`), **desde que** as cotas acima se confirmem e o eWeLink permita coleta compatível. A leitura do eWeLink por cron a cada 2 min cabe na cota documentada; falta só o teste com a sua conta ([INTEGRACAO-EWELINK.md](INTEGRACAO-EWELINK.md)).
