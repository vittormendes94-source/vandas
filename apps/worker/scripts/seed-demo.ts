/**
 * Gera o histórico SIMULADO (10 dias, reproduzível) e o grava no D1 como dataset "demo".
 *
 *   npm run db:seed:demo                # D1 local (padrão)
 *   npm run db:seed:demo -- --reset     # apaga antes o conjunto "demo" (nunca toca em "real")
 *   npm run db:seed:demo -- --remote    # D1 REMOTO — só execute com sua aprovação e após `wrangler d1 create`
 *
 * Rode antes: npm run db:migrate:local
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAY, DEMO_HISTORY_DAYS, DEMO_RELAY_ID, DEMO_SOURCE, HOUR, demoRelayTransitions, generateDemoReadings } from '@orq/core';

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = resolve(here, '..');
const args = new Set(process.argv.slice(2));
const remote = args.has('--remote');
const reset = args.has('--reset');

const now = Date.now();
const to = now - 10_000;
const from = to - DEMO_HISTORY_DAYS * DAY;

const num = (v: number | null) => (v === null ? 'NULL' : String(v));
const readings = generateDemoReadings(from, to);
const transitions = demoRelayTransitions(from, to);

const sql: string[] = [];
if (reset) {
  for (const t of ['readings', 'readings_hourly', 'relay_events', 'relay_status']) sql.push(`DELETE FROM ${t} WHERE dataset = 'demo';`);
  sql.push(`DELETE FROM settings WHERE dataset = 'demo' AND key = 'demo_cursor';`);
}
for (let i = 0; i < readings.length; i += 200) {
  const rows = readings.slice(i, i + 200).map(
    (r) =>
      `('demo','${r.sensorId}',${r.measuredAt},${r.receivedAt},'${r.timeBasis}',${r.temperatureC},${r.humidityPct},${num(r.batteryPct)},${num(r.linkQuality)},${num(r.rssiDbm)},'${DEMO_SOURCE}')`,
  );
  sql.push(
    `INSERT OR IGNORE INTO readings (dataset,sensor_id,measured_at,received_at,time_basis,temperature_c,humidity_pct,battery_pct,link_quality,rssi_dbm,source) VALUES ${rows.join(',')};`,
  );
}
sql.push(
  `INSERT OR REPLACE INTO readings_hourly (dataset,sensor_id,hour_start,t_avg,t_min,t_max,h_avg,h_min,h_max,n)
   SELECT dataset, sensor_id, (measured_at / ${HOUR}) * ${HOUR}, AVG(temperature_c), MIN(temperature_c), MAX(temperature_c),
          AVG(humidity_pct), MIN(humidity_pct), MAX(humidity_pct), COUNT(*)
     FROM readings WHERE dataset = 'demo' GROUP BY dataset, sensor_id, measured_at / ${HOUR};`,
);
for (const t of transitions) {
  sql.push(`INSERT OR IGNORE INTO relay_events (dataset,device_id,changed_at,state,received_at,source) VALUES ('demo','${DEMO_RELAY_ID}',${t.at},'${t.state}',${t.at + 2000},'${DEMO_SOURCE}');`);
}
const last = transitions[transitions.length - 1];
sql.push(
  `INSERT OR REPLACE INTO relay_status (dataset,device_id,last_state,last_state_at,last_seen_at,online) VALUES ('demo','${DEMO_RELAY_ID}',${last ? `'${last.state}'` : 'NULL'},${num(last?.at ?? null)},${to},1);`,
);
sql.push(`INSERT OR REPLACE INTO settings (dataset,key,value,updated_at) VALUES ('demo','demo_cursor','${to}',${now});`);

const outDir = resolve(workerDir, '.wrangler/tmp');
mkdirSync(outDir, { recursive: true });
const file = resolve(outDir, 'seed-demo.sql');
writeFileSync(file, sql.join('\n') + '\n');
console.log(`Gerando ${readings.length} leituras simuladas e ${transitions.length} transições de relé (${DEMO_HISTORY_DAYS} dias)…`);

const wranglerArgs = ['wrangler', 'd1', 'execute', 'orquidario', remote ? '--remote' : '--local', `--file=${file}`];
const r = spawnSync('npx', wranglerArgs, { cwd: workerDir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (r.status !== 0) {
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  console.error('Falha ao aplicar o seed. Você rodou `npm run db:migrate:local` antes?');
  process.exit(r.status ?? 1);
}
console.log(`Histórico de demonstração gravado no D1 ${remote ? 'REMOTO' : 'local'}.`);
