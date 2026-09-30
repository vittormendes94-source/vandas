# API

Base: mesma origem da interface. JSON. Datas em ISO 8601 UTC (`...Z`) nas respostas; a interface converte para America/Sao_Paulo. Erros: `{ "error": { "code", "message", "details?" } }`.

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| GET | `/api/health` | aberto | Saúde |
| GET | `/api/meta` | aberto | Flags não sensíveis (se há token de visualização/edição/ingestão configurados) |
| GET | `/api/live` | visualização | Configuração, última leitura de cada sensor (pode estar vencida), vínculo eWeLink de cada sensor, estado atual da bomba, saúde da integração |
| GET | `/api/history?from&to&res&detail` | visualização | Histórico (ver abaixo) |
| GET | `/api/ewelink/devices` | visualização | Aparelhos encontrados na última leitura do eWeLink (retrato, não histórico) |
| GET | `/api/config` | visualização | Configuração atual |
| PUT | `/api/config` | **admin** | Grava configuração (controle de revisão) |
| POST | `/api/ewelink/authorize` | **admin** | Devolve o endereço da página oficial de login do eWeLink |
| GET | `/api/ewelink/callback` | `state` de uso único | Retorno do login; troca o código pelos tokens e redireciona para a interface |
| POST | `/api/ewelink/poll` | **admin** | Lê o eWeLink agora |
| POST | `/api/ewelink/disconnect` | **admin** | Apaga os tokens e o retrato dos aparelhos |
| POST | `/api/v1/ingest/readings` | **ingestão** | Leituras — ver [CONTRATO-DE-LEITURAS.md](CONTRATO-DE-LEITURAS.md) |
| POST | `/api/admin/maintenance` | **admin** | Aplica a retenção agora |

**Acesso**: *visualização* = aberto, ou exige `VIEW_TOKEN` (`x-view-token`, `Authorization: Bearer` ou `?k=`) se configurado; o token de admin também lê. *admin* = `Authorization: Bearer <ADMIN_TOKEN>`. *ingestão* = `Authorization: Bearer <INGEST_TOKEN>`. Tokens diferentes não são intercambiáveis (exceto admin lendo).

## `/api/history`

- `from`, `to`: ISO 8601 obrigatórios; `to > from`.
- `res`: `raw` (janela ≤ 48 h, até 3000 leituras por sensor, mantém as mais recentes se cortar — `truncated:true`), `hourly` (até 400 dias) ou `auto` (padrão: bruto se ≤ 48 h, senão horário).
- `detail=full` (só bruto): inclui recebimento, bateria, sinal e base do horário.
- Formato compacto (menos bytes e CPU):
  - bruto: `[medidoEm_ms, temperaturaC, umidadePct]`; com `detail=full`: `[..., recebidoEm_ms, bateria|null, lqi|null, rssi|null, baseTempo(0 origem/1 recebimento)]`
  - horário: `[inicioHora_ms, tMédia, tMín, tMáx, uMédia, uMín, uMáx, n]`

## `PUT /api/config`

Corpo: a configuração completa (mesma forma de `GET /api/config`), com `revision` igual à que você leu. Se outra gravação ocorreu, **409** `revision_conflict`. Validações: sensores dentro de 12 × 5 m, ids únicos, limites coerentes, “atrasado” < “sem comunicação”, campos desconhecidos recusados.

## Fórmulas

- Pressão de saturação (Magnus, Alduchov & Eskridge): `es(T) = 0,61094·exp(17,625·T/(T+243,04))` kPa.
- DPV do ar: `es(T)·(1 − UR/100)` (temperatura do **ar**; não é DPV foliar).
- Ponto de orvalho: `Td = 243,04·γ/(17,625 − γ)`, `γ = ln(UR/100) + 17,625·T/(243,04+T)`; indefinido com UR = 0.
- Testes: `packages/core/test/psychro.test.ts` (referências: es 20/25/30 °C = 2,339/3,169/4,246 kPa, erro < 0,5 %; Td(25 °C, 50 %) ≈ 13,9 °C).
- IDW: `v = Σ wᵢvᵢ/Σ wᵢ`, `wᵢ = 1/dᵢ²`; grade 96×40; extrapolação = fora do casco convexo dos sensores válidos; cobertura insuficiente (< 3 pontos não colineares) → sem mapa.
- Frescor: `fresh` ≤ `freshMaxMin` < `delayed` ≤ `offlineAfterMin` < `unavailable`; só `fresh` entra em médias/mapas.
- Replay: por sensor, leitura mais recente com `measuredAt ≤ t` dentro da tolerância; senão “sem leitura no instante”.
- Média dos sensores (gráficos): o período é dividido em intervalos (10 min, 1 h ou 3 h); em cada intervalo, média de cada sensor e depois média simples entre sensores; só entram intervalos com **todos** os sensores. Faixa = menor e maior sensor.
- Bomba: `ok` só com Sonoff online e leitura do eWeLink de até 10 min; senão o estado é `unknown`.
