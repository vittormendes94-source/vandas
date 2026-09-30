import type { D1Database } from '@cloudflare/workers-types';
import { DEMO_RELAY_ID, DEMO_SAMPLE_INTERVAL_MS, DEMO_SOURCE, HOUR, demoRelayTransitions, generateDemoReadings } from '@orq/core';
import { getCursor, persistReadings, recordRelay, setCursor } from './repo';

const CURSOR_KEY = 'demo_cursor';

/**
 * Adaptador de DEMONSTRAÇÃO: gera leituras simuladas determinísticas e as grava no dataset "demo".
 * É a única origem que escreve em "demo"; a ingestão HTTP escreve apenas em "real".
 *
 * Roda dentro de uma requisição (mantém o "agora" avançando em `wrangler dev`, sem cron) ou no cron.
 * `maxGapMs` limita o trabalho por chamada (o plano gratuito do Workers permite ~10 ms de CPU por requisição).
 * O histórico inicial de 10 dias é gerado por `npm run db:seed:demo`, fora do Worker.
 */
export async function topUpDemo(db: D1Database, now: number, maxGapMs = 2 * HOUR): Promise<{ inserted: number }> {
  const to = now - 10_000;
  const cursor = await getCursor(db, 'demo', CURSOR_KEY);
  const from = Math.max(cursor ?? 0, to - maxGapMs);
  if (to - from < DEMO_SAMPLE_INTERVAL_MS) return { inserted: 0 };

  const readings = generateDemoReadings(from, to);
  const flags = await persistReadings(db, 'demo', readings);

  // Relé simulado: estado inicial "desligado" na primeira execução e transições do intervalo.
  for (const tr of demoRelayTransitions(from, to)) {
    await recordRelay(db, 'demo', { deviceId: DEMO_RELAY_ID, state: tr.state, changedAt: tr.at, receivedAt: Math.min(now, tr.at + 2000), source: DEMO_SOURCE });
  }
  await recordRelay(db, 'demo', { deviceId: DEMO_RELAY_ID, changedAt: to, receivedAt: now, online: true, source: DEMO_SOURCE });
  await setCursor(db, 'demo', CURSOR_KEY, to, now);
  return { inserted: flags.filter(Boolean).length };
}
