#!/usr/bin/env node
// Envia leituras de EXEMPLO para a API de ingestão (dataset "real") de um servidor local, usando o INGEST_TOKEN de
// apps/worker/.dev.vars. Serve para ver o modo real funcionando sem sensores. Os valores são inventados: não use em produção.
//
//   node scripts/send-sample-readings.mjs                 # 3 sensores atualizados
//   node scripts/send-sample-readings.mjs --stale         # s1 atualizado, s2 atrasado (30 min), s3 sem comunicação (2 h)
//   BASE=http://localhost:8787 node scripts/send-sample-readings.mjs
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vars = Object.fromEntries(
  readFileSync(resolve(root, 'apps/worker/.dev.vars'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const base = process.env.BASE ?? 'http://localhost:8787';
const stale = process.argv.includes('--stale');
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const ages = stale ? [1, 30, 120] : [1, 1, 1];
const base_ = [
  { sensorId: 's1', temperatureC: 27.1, humidityPct: 66.4, batteryPct: 92, linkQuality: 180 },
  { sensorId: 's2', temperatureC: 25.8, humidityPct: 72.0, batteryPct: 88, linkQuality: 201 },
  { sensorId: 's3', temperatureC: 24.9, humidityPct: 79.3, batteryPct: 85, linkQuality: 170 },
];
const readings = base_.map((r, i) => ({ ...r, measuredAt: ago(ages[i]) }));
const res = await fetch(`${base}/api/v1/ingest/readings`, {
  method: 'POST',
  headers: { authorization: `Bearer ${vars.INGEST_TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify({ source: 'exemplo-local', readings }),
});
console.log(res.status, await res.text());
