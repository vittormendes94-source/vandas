import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import { app } from './app';
import type { Env } from './env';
import { PROVIDER, loadState as loadEwelinkState, pollEwelink } from './ewelink';
import { pendingAfter, saveAfter, trackPumpFromDb } from './irrigation';
import { runAutomation } from './automation';
import { runPushAlerts } from './push';
import { loadSwitchbotState, pollSwitchbot } from './switchbot';
import { logError, logInfo } from './logging';
import { applyRetention, getConfig, listProviderDevices } from './repo';
import { localDateTimeString } from '@orq/core';
import type { AppConfig } from '@orq/core';

/**
 * Tarefa agendada (wrangler.toml, a cada 2 min):
 *  - lê os sensores SwitchBot e o estado da bomba (eWeLink), de forma independente, e registra as irrigações;
 *  - executa a automação da bomba (horários, proteção, Inching);
 *  - uma vez por dia (06:00 UTC = 03:00 em America/Sao_Paulo) aplica a retenção.
 */
/** Passou o intervalo desde a última leitura (com 30 s de folga para o relógio do agendador)? */
const due = (last: number | null, everyMin: number, now: number) => last === null || now - last >= everyMin * 60_000 - 30_000;

/** Conferência antes de irrigar: nos 2 min que antecedem um horário programado sensores e bomba são lidos uma vez. */
function preCheck(config: AppConfig, now: number): boolean {
  const nowMin = Number(localDateTimeString(now).slice(11, 13)) * 60 + Number(localDateTimeString(now).slice(14, 16));
  return config.automation.schedule.some((t) => {
    const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    return nowMin >= m - 2 && nowMin < m;
  });
}

export async function runScheduled(env: Env, scheduledTime: number, opts: { always?: boolean } = {}): Promise<void> {
  try {
    const config = await getConfig(env.DB);
    // Sensores (SwitchBot) e bomba (eWeLink) são independentes: a falha de um não impede o outro.
    const sbState = await loadSwitchbotState(env.DB, scheduledTime);
    const ewState = await loadEwelinkState(env.DB, scheduledTime);
    const pumpDev = config.pump.deviceId ? (await listProviderDevices(env.DB, PROVIDER)).find((d) => d.deviceId === config.pump.deviceId) : undefined;
    const pumpOn = pumpDev?.switchState === 'on';
    const pre = preCheck(config, scheduledTime);
    // bomba ligada: a cada 2 min (para confirmar o desligamento); antes de irrigar: conferência única; senão no ritmo lento
    // Depois de uma irrigação: 1 min após o fim, lê os sensores uma vez para registrar o que mudou.
    const post = await pendingAfter(env.DB, scheduledTime).catch(() => null);
    const postDue = !!post && scheduledTime - post.endedAt >= 60_000 && (sbState.lastPollAt ?? 0) < post.endedAt + 60_000;
    const doSb = opts.always || postDue || due(sbState.lastPollAt, pre ? 3 : config.polling.sensorsMin, scheduledTime);
    const doEw = opts.always || due(ewState.lastPollAt, pumpOn ? 2 : pre ? 3 : config.polling.pumpIdleMin, scheduledTime);
    const skipped = { ran: false, reason: 'not_due' } as const;
    const [sb, r] = await Promise.allSettled([doSb ? pollSwitchbot(env, env.DB, config, scheduledTime) : Promise.resolve(skipped), doEw ? pollEwelink(env, env.DB, config, scheduledTime) : Promise.resolve(skipped)]);
    if (sb.status === 'fulfilled' && sb.value.ran && sb.value.reason) logInfo('switchbot', `leitura com falha: ${sb.value.reason}`);
    if (sb.status === 'rejected') logError('switchbot', sb.reason, env);
    if (r.status === 'fulfilled' && r.value.ran && r.value.reason) logInfo('ewelink', `leitura falhou: ${r.value.reason}`);
    if (r.status === 'rejected') logError('ewelink', r.reason, env);
    if (post && scheduledTime - post.endedAt >= 60_000 && (doSb || (sbState.lastPollAt ?? 0) >= post.endedAt + 60_000)) await saveAfter(env.DB, config, post.startedAt, scheduledTime).catch((e) => logError('irrigacao', e, env));
    // Irrigações: aplica o último estado conhecido da bomba (também fecha uma irrigação se o Sonoff sumir).
    await trackPumpFromDb(env.DB, config, PROVIDER, scheduledTime).catch((e) => logError('irrigacao', e, env));
    // Automação da bomba: liga nos horários e desliga fora das regras ou do tempo.
    await runAutomation(env, env.DB, config, scheduledTime).catch((e) => logError('automacao', e, env));
    // Avisos no celular (só quando algo muda).
    await runPushAlerts(env, env.DB, config, scheduledTime).catch((e) => logError('push', e, env));
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
