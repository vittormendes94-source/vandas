# Contrato de leituras (ingestão genérica v1)

A origem principal é o **eWeLink** (lido automaticamente pelo servidor). Esta rota existe para outras origens, se um dia forem usadas (ESP32, script, Home Assistant). As leituras do eWeLink e desta rota passam pela **mesma gravação idempotente**.

## Leituras — `POST /api/v1/ingest/readings`

Cabeçalhos: `Authorization: Bearer <INGEST_TOKEN>`, `Content-Type: application/json`. Corpo máximo: 64 KB. 

```json
{
  "source": "esp32",
  "readings": [
    {
      "sensorId": "s1",
      "measuredAt": "2026-09-30T17:05:00Z",
      "temperatureC": 27.4,
      "humidityPct": 68.2,
      "batteryPct": 91,
      "linkQuality": 180,
      "rssiDbm": -67
    }
  ]
}
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `source` | sim | `[A-Za-z0-9._-]{1,40}` — identifica a origem (auditoria) |
| `readings` | sim | 1 a 100 itens |
| `sensorId` | sim | `[a-z0-9_-]{1,32}`; deve existir em Configurações (senão `unknown_sensor`) |
| `measuredAt` | recomendado | ISO 8601 **com fuso** (ex.: `Z`). Se ausente, usa-se o horário de recebimento e a leitura é marcada `time_basis=received` |
| `temperatureC` | sim | −40 a 85 |
| `humidityPct` | sim | 0 a 100 |
| `batteryPct` | não | 0 a 100 — só é exibida se enviada |
| `linkQuality` | não | 0 a 255 (Zigbee LQI) — só é exibida se enviada |
| `rssiDbm` | não | −130 a 20 — só é exibida se enviada |

Campos desconhecidos são **recusados** (evita erros de digitação silenciosos).

### Resposta (200)

```json
{ "accepted": 1, "duplicates": 0, "rejected": 0,
  "results": [ { "index": 0, "status": "accepted" } ] }
```

`status`: `accepted`, `duplicate` ou `rejected` (com `reason`: `unknown_sensor`, `future_timestamp`, `too_old`). Payload estruturalmente inválido → **400** com `error.details`.

### Semântica

- **Horário da medição × recebimento**: guardados em colunas separadas (`measured_at`, `received_at`), sempre em UTC. A idade usada nos indicadores é `agora − measured_at`.
- **Duplicidade**: chave `(sensorId, measuredAt)`. Reenviar a mesma leitura é seguro (idempotente, `duplicate`). Sem `measuredAt` não há como detectar reenvio — informe-o sempre que a origem tiver o horário.
- **Fora de ordem**: aceito. Entra no histórico; a “última leitura” é sempre a de maior `measuredAt`. Agregados horários são recalculados a partir das leituras brutas.
- **Relógio**: `measuredAt` mais de 5 min no futuro → `future_timestamp`; mais antigo que a retenção (padrão 45 dias) → `too_old`.
- **Frequência**: não há mínimo. Ajuste em Configurações os limites de “atrasado” e “sem comunicação” à frequência **observada** dos sensores.

## Autenticação

Token enviado só no cabeçalho `Authorization`. Sem `INGEST_TOKEN` configurado no servidor: **503**. Token ausente/errado: **401**. Comparação em tempo constante.
