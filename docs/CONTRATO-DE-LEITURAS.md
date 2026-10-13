# Contrato de leituras

Há duas rotas de entrada, com o mesmo token (`INGEST_TOKEN`) e a **mesma gravação idempotente** (chave sensor + instante da medição):
- **`POST /api/v1/ingest/zigbee`:** usada pelo **coletor local**, a origem principal dos sensores. Identifica os sensores pelo endereço IEEE do Zigbee.
- **`POST /api/v1/ingest/readings`:** genérica, para outras origens (ESP32, scripts). Identifica os sensores por S1, S2, S3.

## Coletor Zigbee — `POST /api/v1/ingest/zigbee`

Um envio leva o estado do coletor (sempre), a lista de dispositivos (a cada 5 min ou quando muda) e até 100 leituras novas.

```json
{
  "collector": { "version": "1.0.0", "startedAt": "2026-10-13T12:00:00Z", "sentAt": "2026-10-13T12:05:00Z",
                 "mqttConnected": true, "bridgeOnline": true, "queued": 0, "problem": null },
  "devices": [ { "ieee": "0xa4c1380000000001", "name": "Orquidario 1", "model": "SNZB-02WD", "vendor": "SONOFF",
                 "climate": true, "temperatureC": 25.1, "humidityPct": 70.2, "batteryPct": 100,
                 "linkQuality": 150, "lastSeen": "2026-10-13T12:04:58Z" } ],
  "readings": [ { "ieee": "0xa4c1380000000001", "measuredAt": "2026-10-13T12:04:58Z",
                  "temperatureC": 25.1, "humidityPct": 70.2, "batteryPct": 100, "linkQuality": 150 } ]
}
```

| Regra | Comportamento |
|---|---|
| Sensor não vinculado em Configurações | `unlinked`: a leitura não é gravada, mas o aparelho aparece para vincular |
| `measuredAt` mais de 5 min no futuro / mais antigo que a retenção | `rejected` (`future_timestamp` / `too_old`) |
| Reenvio da mesma leitura | `duplicate` (não grava de novo) |
| `sentAt` do coletor × relógio do servidor | Diferença guardada e exibida; acima de 2 min, o painel avisa |
| Campos desconhecidos | 400 |

**Resposta:** `{ accepted, duplicates, unlinked, rejected, results: [{ index, status, reason? }] }`.

**Horário da medição:** é o `last_seen` do Zigbee2MQTT, o instante em que a mensagem do sensor chegou ao adaptador. O SNZB-02WD envia temperatura e umidade separadamente. A cada mensagem nova, o coletor monta a leitura com o valor que chegou e o último valor informado da outra grandeza; pela regra do aparelho, essa outra não mudou mais que 0,2 °C ou 1 % desde então.

## Genérica — `POST /api/v1/ingest/readings`

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
