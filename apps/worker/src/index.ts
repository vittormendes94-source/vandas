import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import { app } from './app';
import type { Env } from './env';
import { pollEwelink } from './ewelink';
import { logError, logInfo } from './logging';
import { applyRetention, getConfig } from './repo';

/**
 * Tarefa agendada (wrangler.toml, a cada 2 min):
 *  - lê o eWeLink (sensores + estado da bomba);
 *  - uma vez por dia (06:00 UTC = 03:00 em America/Sao_Paulo) aplica a retenção.
 */
export async function runScheduled(env: Env, scheduledTime: number): Promise<void> {
  try {
    const config = await getConfig(env.DB);
    const r = await pollEwelink(env, env.DB, config, scheduledTime);
    if (r.ran && r.reason) logInfo('ewelink', `leitura falhou: ${r.reason}`);
    const d = new Date(scheduledTime);
    if (d.getUTCHours() === 6 && d.getUTCMinutes() < 2) {
      const ret = await applyRetention(env.DB, config, scheduledTime);
      logInfo('retention', `${ret.rawDeleted} leituras brutas e ${ret.hourlyDeleted} agregados removidos`);
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
