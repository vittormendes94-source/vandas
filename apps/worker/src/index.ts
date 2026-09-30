import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import type { Dataset } from '@orq/core';
import { app } from './app';
import { topUpDemo } from './demo';
import type { Env } from './env';
import { demoEnabled } from './http';
import { realAdapters } from './integrations';
import { logError, logInfo } from './logging';
import { applyRetention, getConfig } from './repo';

/**
 * Tarefa agendada (cron do wrangler.toml, a cada 5 min):
 *  - demonstração: avança o histórico simulado;
 *  - adaptadores de dados reais: consulta as origens habilitadas (hoje nenhuma; eWeLink é esqueleto);
 *  - uma vez por dia (03:00 em America/Sao_Paulo = 06:00 UTC): aplica a retenção.
 */
export async function runScheduled(env: Env, scheduledTime: number): Promise<void> {
  const now = scheduledTime;
  try {
    if (demoEnabled(env)) await topUpDemo(env.DB, now, 6 * 3_600_000);
    for (const adapter of realAdapters) {
      const res = await adapter.poll(env, now);
      if (res.kind === 'skipped') logInfo('adapter', `${adapter.id}: ${res.reason}`);
    }
    const d = new Date(now);
    if (d.getUTCHours() === 6 && d.getUTCMinutes() < 5) {
      for (const ds of (demoEnabled(env) ? ['demo', 'real'] : ['real']) as Dataset[]) {
        const r = await applyRetention(env.DB, ds, await getConfig(env.DB, ds), now);
        logInfo('retention', `${ds}: ${r.rawDeleted} leituras brutas e ${r.hourlyDeleted} agregados removidos`);
      }
    }
  } catch (err) {
    logError('scheduled', err, env);
  }
}

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env, controller.scheduledTime));
  },
};
