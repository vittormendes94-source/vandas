# Custos, cotas e dimensionamento

**Meta: R$ 0/mês, sem compra de domínio, sem serviço pago.** Nada neste repositório contrata, compra ou publica algo.

## Cotas gratuitas — status da verificação

> **Aviso importante:** durante o desenvolvimento, as páginas oficiais da Cloudflare (`developers.cloudflare.com`) e do eWeLink **estavam bloqueadas pelo proxy do ambiente**. Os números abaixo vêm de **resumos de busca** dessas páginas oficiais, **não** de leitura direta. **Confirme cada valor no painel/página oficial antes de depender dele.** Cotas mudam.

| Recurso (plano gratuito) | Valor obtido | Fonte | Uso deste projeto |
|---|---|---|---|
| D1 — linhas lidas | 5 milhões/dia | página de preços do D1 (via busca) | ~12 linhas por atualização de tela |
| D1 — linhas escritas | 100 mil/dia | idem | 2 por leitura (bruta + agregado horário) |
| D1 — armazenamento | 5 GB no total | idem | dezenas de MB |
| Workers — requisições | 100 mil/dia | página de preços/limites do Workers (via busca) | milhares/dia |
| Workers — CPU | 10 ms por invocação | idem | ver “Risco de CPU” |
| Arquivos estáticos (Static Assets) | requisições gratuitas e ilimitadas | idem | interface inteira |
| Cron Triggers | até 5 por conta | idem | 1 usado (a cada 5 min) |
| eWeLink — app de desenvolvedor | ~50 mil chamadas/mês, OAuth2 | resultado de busca / fórum (**não** documentação oficial lida) | não usado ainda |

Limites diários reiniciam às 00:00 UTC (informação da mesma fonte). O plano gratuito é **bloqueado** (não cobrado) ao estourar cotas; **não** ative o “Workers Paid”. Confirme esse comportamento no painel.

## Dimensionamento (pior caso realista)

Premissas: 3 sensores; cada leitura grava 2 linhas (bruta + agregado da hora); 5 telas abertas 24 h (celular, PC, TV) atualizando a cada 60 s.

| Item | Conta | Resultado | % da cota |
|---|---|---|---|
| Escritas — 1 leitura/5 min/sensor | 864 leituras × 2 | ~1.700 linhas/dia | 1,7 % |
| Escritas — 1 leitura/min/sensor (pior caso) | 4.320 × 2 | ~8.600 linhas/dia | 8,6 % |
| Leituras (linhas) — atualização de tela | ≈ 12 linhas × 1.440 × 5 telas | ~86 mil/dia | 1,7 % |
| Requisições Worker | 1.440 × 5 telas + cron 288 + histórico | ~8 mil/dia | ~8 % |
| Armazenamento | ≈ 90 B × 4.320 × 45 dias + agregado 730 dias | ~20 MB | 0,4 % |
| Demonstração ativa em produção | cron 5 min: 3 leituras × 2 | +1.700 linhas/dia | 1,7 % |
| Semear 10 dias de demonstração no D1 remoto (uma vez) | ~8,2 mil leituras × 2 + agregados | ~17 mil linhas | 17 % (uma única vez) |

Desligue a demonstração em produção com `DEMO_ENABLED=false` quando só houver dados reais.

## Como o crescimento é limitado

- **Retenção**: leituras brutas por `retention.rawDays` (padrão 45 dias, configurável 7–90); agregados horários e eventos do relé por 730 dias. Cron diário 03:00 (America/Sao_Paulo); também `POST /api/admin/maintenance`.
- **Agregação**: `readings_hourly` recalculado a cada gravação (idempotente). Períodos > 48 h leem só o agregado (≈ 720 linhas/sensor/mês em vez de 8.600+).
- **Sem índices secundários**: tabelas `WITHOUT ROWID` com PK composta (menos linhas escritas).
- **Consultas limitadas**: bruto ≤ 48 h e ≤ 3000 linhas/sensor; horário ≤ 400 dias; `LIMIT 1` por sensor para a última leitura.
- **Atualização das telas**: polling a cada 60 s (30/60/120/300 s), pausado com a aba oculta, recuo exponencial (até 5 min) em falhas, com indicação da última atualização. Não há SSE/WebSocket: conexões longas não cabem no Worker gratuito sem Durable Objects (complexidade e cotas próprias); a frequência dos sensores é de minutos, então o polling não perde nada relevante.

## Risco de CPU (10 ms/invocação no plano gratuito)

A demonstração local não impõe esse limite. Mantivemos o trabalho por requisição pequeno (respostas compactas em arrays; histórico bruto limitado; o histórico inicial da demonstração é gerado fora do Worker, por `npm run db:seed:demo`; no Worker a demonstração só completa até 2 h de atraso por chamada). Ainda assim **não foi medido no ambiente gratuito real**. Se aparecer erro “CPU time exceeded” em `/api/history`, reduza `RAW_ROW_LIMIT` em `apps/worker/src/repo.ts` ou use períodos horários. Relate; não migre para plano pago por conta própria.

## Arquitetura: limitação concreta encontrada?

Nenhuma que obrigue a sair da arquitetura pedida (React + Workers + D1 + Static Assets no domínio `*.workers.dev`), **desde que** as cotas acima se confirmem e o eWeLink permita coleta compatível. Ressalvas: (1) coleta contínua pelo eWeLink por cron (mínimo 1 min) depende da API e de cotas ainda não validadas; (2) o fallback mais simples e gratuito para dados reais é o dispositivo enviar direto à API de ingestão (ver [SUGESTOES-E-PLANO.md](SUGESTOES-E-PLANO.md)).
