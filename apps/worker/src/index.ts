import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import { app } from './app';
import type { Env } from './env';
import { PROVIDER, pollEwelink } from './ewelink';
import { trackPumpFromDb } from './irrigation';
import { runAutomation } from './automation';
import { pollSwitchbot } from './switchbot';
import { logError, logInfo } from './logging';
import { applyRetention, getConfig } from './repo';

/**
 * Tarefa agendada (wrangler.toml, a cada 2 min):
 *  - lê os sensores SwitchBot e o estado da bomba (eWeLink), de forma independente, e registra as irrigações;
 *  - executa a automação da bomba (horários, proteção, Inching);
 *  - uma vez por dia (06:00 UTC = 03:00 em America/Sao_Paulo) aplica a retenção.
 */
export async function runScheduled(env: Env, scheduledTime: number): Promise<void> {
  try {
    const config = await getConfig(env.DB);
    // Sensores (SwitchBot) e bomba (eWeLink) são independentes: a falha de um não impede o outro.
    const [sb, r] = await Promise.allSettled([pollSwitchbot(env, env.DB, config, scheduledTime), pollEwelink(env, env.DB, config, scheduledTime)]);
    if (sb.status === 'fulfilled' && sb.value.ran && sb.value.reason) logInfo('switchbot', `leitura com falha: ${sb.value.reason}`);
    if (sb.status === 'rejected') logError('switchbot', sb.reason, env);
    if (r.status === 'fulfilled' && r.value.ran && r.value.reason) logInfo('ewelink', `leitura falhou: ${r.value.reason}`);
    if (r.status === 'rejected') logError('ewelink', r.reason, env);
    // Irrigações: aplica o último estado conhecido da bomba (também fecha uma irrigação se o Sonoff sumir).
    await trackPumpFromDb(env.DB, config, PROVIDER, scheduledTime).catch((e) => logError('irrigacao', e, env));
    // Automação da bomba: liga nos horários e desliga fora das regras ou do tempo.
    await runAutomation(env, env.DB, config, scheduledTime).catch((e) => logError('automacao', e, env));
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
