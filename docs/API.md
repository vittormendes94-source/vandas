# API

Base: mesma origem da interface. JSON. Datas em ISO 8601 UTC (`...Z`) nas respostas; a interface converte para America/Sao_Paulo. Erros: `{ "error": { "code", "message", "details?" } }`.

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| GET | `/api/health` | aberto | Saúde |
| GET | `/api/meta` | aberto | Flags não sensíveis (demo habilitada, conjunto padrão, se há token de visualização/edição/ingestão configurados) |
| GET | `/api/live?dataset=demo\|real` | visualização | Configuração, última leitura de cada sensor (pode estar vencida), estado do relé, irrigação das últimas 24 h, informações de integração |
| GET | `/api/history?dataset&from&to&res&detail` | visualização | Histórico (ver abaixo) |
| GET | `/api/config?dataset` | visualização | Configuração atual |
| PUT | `/api/config?dataset` | **admin** | Grava configuração (controle de revisão) |
| POST | `/api/v1/ingest/readings` | **ingestão** | Leituras — ver [CONTRATO-DE-LEITURAS.md](CONTRATO-DE-LEITURAS.md) |
| POST | `/api/v1/ingest/relay` | **ingestão** | Estado do relé |
| POST | `/api/admin/maintenance` | **admin** | Aplica a retenção agora |

**Acesso**: *visualização* = aberto, ou exige `VIEW_TOKEN` (`x-view-token`, `Authorization: Bearer` ou `?k=`) se configurado; o token de admin também lê. *admin* = `Authorization: Bearer <ADMIN_TOKEN>`. *ingestão* = `Authorization: Bearer <INGEST_TOKEN>`. Tokens diferentes não são intercambiáveis (exceto admin lendo).

## `/api/history`

- `from`, `to`: ISO 8601 obrigatórios; `to > from`.
- `res`: `raw` (janela ≤ 48 h, até 3000 leituras por sensor, mantém as mais recentes se cortar — `truncated:true`), `hourly` (até 400 dias) ou `auto` (padrão: bruto se ≤ 48 h, senão horário).
- `detail=full` (só bruto): inclui recebimento, bateria, sinal e base do horário.
- Formato compacto (menos bytes e CPU):
  - bruto: `[medidoEm_ms, temperaturaC, umidadePct]`; com `detail=full`: `[..., recebidoEm_ms, bateria|null, lqi|null, rssi|null, baseTempo(0 origem/1 recebimento)]`
  - horário: `[inicioHora_ms, tMédia, tMín, tMáx, uMédia, uMín, uMáx, n]`
- `irrigation`: períodos com estado “ligado” observado que tocam a janela (`endedAt: null` = ainda ligado).

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
- Comparação: `Δ = média(depois: [fim, fim+W)) − média(antes: [início−W, início))`, ≥ 2 leituras por janela, janelas recortadas na vizinhança de outro evento. É variação observada, sem causalidade.
