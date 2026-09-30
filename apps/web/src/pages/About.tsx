import { useEffect, useState } from 'react';
import { DAY, fmtNum, formatAge, formatDateTime } from '@orq/core';
import type { ProviderDeviceDto } from '@orq/core';
import { CalcChip, Chip, EstChip, MeasuredChip, Notice } from '../components/ui';
import { hashQuery } from '../hooks/useHashRoute';
import type { LiveState } from '../hooks/useLive';
import { ApiError, api, getAdminToken, setViewToken } from '../lib/api';
import type { Meta } from '../lib/api';

/** Pontes Zigbee SONOFF (UIID 66 ZBBridge, 168 ZBBridge-P, 243 ZBBridge-U): não medem nada, só conectam os sensores. */
const BRIDGE_UIIDS = new Set([66, 168, 243]);

const CALLBACK_REASON: Record<string, string> = {
  invalid_state: 'o pedido de conexão expirou ou foi reutilizado. Clique em "Conectar" de novo.',
  invalid_code: 'o eWeLink não devolveu um código válido.',
  invalid_region: 'o eWeLink devolveu uma região desconhecida.',
  ewelink_token_failed: 'o eWeLink recusou a troca do código pelos tokens (veja o erro abaixo).',
  ewelink_not_configured: 'a credencial do app eWeLink não está configurada no servidor.',
};

export function About({ live, meta, nowMs }: { live: LiveState & { refresh: () => void }; meta: Meta; nowMs: number }) {
  const eu = live.data?.integration.ewelink;
  const config = live.data?.config;
  const [devices, setDevices] = useState<ProviderDeviceDto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(() => {
    const q = hashQuery();
    if (q.get('ewelink') === 'conectado') return { kind: 'ok', text: 'Conta eWeLink conectada. Agora vincule os sensores e a bomba em Configurações.' };
    if (q.get('ewelink') === 'erro') return { kind: 'bad', text: `Não foi possível conectar: ${CALLBACK_REASON[q.get('motivo') ?? ''] ?? 'erro inesperado.'}` };
    return null;
  });
  const [vt, setVt] = useState('');
  const hasAdmin = !!getAdminToken();

  const loadDevices = () =>
    api
      .ewelinkDevices()
      .then((r) => setDevices(r.devices))
      .catch(() => setDevices([]));
  useEffect(() => {
    loadDevices();
  }, [eu?.lastSuccessAt]);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      const err = e as ApiError;
      setMsg({ kind: 'bad', text: err.status === 401 ? 'Token de administração ausente ou inválido. Informe-o em Configurações → "Acesso para editar".' : err.message });
    } finally {
      setBusy(null);
    }
  };

  const callbackUrl = `${location.origin}/api/ewelink/callback`;
  const usage = eu ? eu.callsThisMonth / eu.monthlyLimit : 0;
  const appDaysLeft = eu?.appExpiresAt ? Math.floor((Date.parse(eu.appExpiresAt) - nowMs) / DAY) : null;
  const linkedTo = (id: string) => {
    const s = config?.sensors.find((x) => x.externalId === id);
    if (s) return `${s.id.toUpperCase()} · ${s.name}`;
    return config?.pump.deviceId === id ? 'Bomba' : '—';
  };

  return (
    <main className="container">
      {msg && <Notice kind={msg.kind === 'bad' ? 'bad' : undefined}>{msg.text}</Notice>}

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Conexão eWeLink</h2>
            <div className="card__sub">Sensores SONOFF (temperatura/umidade) e o Sonoff da bomba são lidos pela API oficial do eWeLink a cada 2 min.</div>
          </div>
          {eu && <Chip kind={!eu.configured ? 'warn' : !eu.connected ? 'warn' : eu.lastError ? 'bad' : 'ok'}>{!eu.configured ? 'Não configurado' : !eu.connected ? 'Não conectado' : eu.lastError ? 'Com falha' : 'Conectado'}</Chip>}
        </div>

        {eu && !eu.configured && (
          <Notice kind="warn">
            Falta a credencial do app eWeLink no servidor (<code>EWELINK_APP_ID</code> e <code>EWELINK_APP_SECRET</code>). Veja o passo a passo abaixo.
          </Notice>
        )}

        {eu && eu.connected && (
          <div className="kpi-grid" style={{ marginBottom: '0.8rem' }}>
            <div>
              <div className="tiny mute">Última leitura bem-sucedida</div>
              <b>{eu.lastSuccessAt ? formatAge(nowMs - Date.parse(eu.lastSuccessAt)) : '—'}</b>
              <div className="tiny dim">{eu.lastSuccessAt ? formatDateTime(Date.parse(eu.lastSuccessAt)) : 'ainda não leu'}</div>
            </div>
            <div>
              <div className="tiny mute">Chamadas à API neste mês</div>
              <b>
                {eu.callsThisMonth.toLocaleString('pt-BR')} / {eu.monthlyLimit.toLocaleString('pt-BR')}
              </b>
              <div className="tiny dim">
                <span style={{ display: 'inline-block', width: '6rem', height: '0.4rem', background: 'var(--line)', borderRadius: 4, verticalAlign: 'middle' }}>
                  <span style={{ display: 'block', width: `${Math.min(100, usage * 100)}%`, height: '100%', background: usage > 0.9 ? 'var(--red)' : usage > 0.7 ? 'var(--amber)' : 'var(--green)', borderRadius: 4 }} />
                </span>{' '}
                {fmtNum(usage * 100, 0)} % da cota gratuita
              </div>
            </div>
            <div>
              <div className="tiny mute">Autorização (renovada automaticamente)</div>
              <b>{eu.refreshExpiresAt ? `até ${formatDateTime(Date.parse(eu.refreshExpiresAt)).slice(0, 10)}` : '—'}</b>
              <div className="tiny dim">região {eu.region ?? '—'} · conectado em {eu.connectedAt ? formatDateTime(Date.parse(eu.connectedAt)).slice(0, 10) : '—'}</div>
            </div>
            <div>
              <div className="tiny mute">Credencial do app (1 ano)</div>
              <b style={{ color: appDaysLeft !== null && appDaysLeft < 30 ? 'var(--amber)' : undefined }}>{appDaysLeft === null ? 'não informada' : appDaysLeft < 0 ? 'vencida' : `${appDaysLeft} dias`}</b>
              <div className="tiny dim">{eu.appExpiresAt ? `vence ${formatDateTime(Date.parse(eu.appExpiresAt)).slice(0, 10)}` : 'defina EWELINK_APP_EXPIRES_AT para receber aviso'}</div>
            </div>
          </div>
        )}
        {eu?.lastError && (
          <Notice kind="bad">
            <strong>
              Última falha ({formatDateTime(Date.parse(eu.lastError.at))}, {eu.consecutiveFailures}× seguidas):
            </strong>{' '}
            {eu.lastError.message}
          </Notice>
        )}

        <div className="toolbar" style={{ marginTop: '0.8rem' }}>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!eu?.configured || !!busy || !hasAdmin}
            onClick={() =>
              run('connect', async () => {
                const { url } = await api.ewelinkAuthorize();
                location.href = url;
              })
            }
          >
            {eu?.connected ? 'Reconectar conta eWeLink' : 'Conectar conta eWeLink'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!eu?.connected || !!busy || !hasAdmin}
            onClick={() =>
              run('poll', async () => {
                const r = await api.ewelinkPoll();
                live.refresh();
                await loadDevices();
                setMsg(r.reason ? { kind: 'bad', text: `A leitura falhou (${r.reason}).` } : { kind: 'ok', text: `Leitura concluída: ${r.devices ?? 0} dispositivo(s), ${r.inserted ?? 0} leitura(s) nova(s).` });
              })
            }
          >
            {busy === 'poll' ? 'Lendo…' : '↻ Ler agora'}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={!eu?.connected || !!busy || !hasAdmin}
            onClick={() => {
              if (!confirm('Desconectar a conta eWeLink? As leituras já gravadas são mantidas.')) return;
              run('disc', async () => {
                await api.ewelinkDisconnect();
                live.refresh();
                setDevices([]);
                setMsg({ kind: 'ok', text: 'Conta desconectada. Os tokens foram apagados do servidor.' });
              });
            }}
          >
            Desconectar
          </button>
          {!hasAdmin && <span className="small" style={{ color: 'var(--amber)' }}>Para conectar, informe o token de administração em Configurações.</span>}
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Dispositivos encontrados na conta</h2>
            <div className="card__sub">Retrato da última leitura (não é histórico). Vincule em Configurações.</div>
          </div>
          <Chip kind="plain">{devices?.length ?? 0}</Chip>
        </div>
        {!devices || devices.length === 0 ? (
          <div className="empty">{eu?.connected ? 'Nenhum dispositivo na última leitura.' : 'Conecte a conta eWeLink para listar os dispositivos.'}</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome no eWeLink</th>
                  <th>Tipo</th>
                  <th>Situação</th>
                  <th>Valores</th>
                  <th>Medido em</th>
                  <th>Vinculado a</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.deviceId}>
                    <td>
                      <b>{d.name}</b>
                      <div className="tiny mute">
                        {d.deviceId}
                        {d.model ? ` · ${d.model}` : ''}
                      </div>
                    </td>
                    <td>
                      {d.kind === 'climate' ? <Chip kind="ok">Temperatura/umidade</Chip> : d.kind === 'switch' ? <Chip kind="plain">Liga/desliga</Chip> : d.uiid !== null && BRIDGE_UIIDS.has(d.uiid) ? <Chip kind="plain">Ponte Zigbee</Chip> : <Chip kind="warn">Não suportado (UIID {d.uiid ?? '?'})</Chip>}
                    </td>
                    <td>{d.online === true ? <Chip kind="ok">Online</Chip> : d.online === false ? <Chip kind="bad">Offline</Chip> : '—'}</td>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {d.kind === 'climate' ? `${fmtNum(d.temperatureC, 1)} °C · ${fmtNum(d.humidityPct, 0)} % UR` : d.kind === 'switch' ? (d.switchState === 'on' ? 'ligado' : d.switchState === 'off' ? 'desligado' : '—') : '—'}
                    </td>
                    <td>{d.measuredAt ? formatDateTime(Date.parse(d.measuredAt)) : '—'}</td>
                    <td>{linkedTo(d.deviceId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {devices?.some((d) => d.kind === 'unsupported' && !(d.uiid !== null && BRIDGE_UIIDS.has(d.uiid))) && (
          <p className="tiny mute" style={{ margin: '0.5rem 0 0' }}>
            “Não suportado”: o formato desse modelo não está na documentação pública do eWeLink e, por segurança, não é lido. Se for um sensor que você quer usar, envie o modelo e o número UIID para adicionarmos com teste.
          </p>
        )}
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Passo a passo da conexão</h2>
        </div>
        <ol className="list">
          <li>
            Em <strong>dev.ewelink.cc</strong>, entre com sua conta eWeLink, faça o cadastro de desenvolvedor pessoal (gratuito, aprovado pelo eWeLink) e crie um app.
          </li>
          <li>
            No app, cadastre o endereço de retorno exatamente assim: <code>{callbackUrl}</code>
          </li>
          <li>
            Guarde o <strong>APPID</strong> e o <strong>APP SECRET</strong> como segredos do servidor (<code>wrangler secret put EWELINK_APP_ID</code> e <code>EWELINK_APP_SECRET</code>). Nunca os envie por mensagem nem os coloque no código.
          </li>
          <li>Informe o token de administração em Configurações e clique em “Conectar conta eWeLink”. Você entra na página oficial do eWeLink; a senha não passa por este sistema.</li>
          <li>Em Configurações, escolha qual dispositivo corresponde a cada sensor e qual é o Sonoff da bomba.</li>
          <li>A credencial pessoal do eWeLink vale 1 ano: anote a data em <code>EWELINK_APP_EXPIRES_AT</code> para o painel avisar com antecedência.</li>
        </ol>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Origem de cada valor</h2>
        </div>
        <div className="stack" style={{ gap: '0.5rem' }}>
          <div>
            <MeasuredChip /> <span className="small dim">leitura enviada por um sensor, com o horário da medição informado pelo próprio sensor (trigTime) e o horário de recebimento guardados separadamente.</span>
          </div>
          <div>
            <CalcChip /> <span className="small dim">calculado a partir das leituras: médias, diferenças, DPV, ponto de orvalho, extremos.</span>
          </div>
          <div>
            <EstChip /> <span className="small dim">cor do mapa entre sensores, estimada por interpolação (IDW); não é medição.</span>
          </div>
          <div>
            <Chip kind="warn">Atrasado</Chip> <Chip kind="bad">Sem comunicação</Chip> <span className="small dim">leitura mais antiga que os limites configurados: sai das médias e do mapa; nada é assumido como “normal”.</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Fórmulas</h2>
        </div>
        <ul className="list">
          <li>Pressão de saturação (Magnus): es(T) = 0,61094 · exp(17,625·T / (T + 243,04)) kPa.</li>
          <li>DPV do ar: es(T) · (1 − UR/100). Usa a temperatura do ar; não é DPV foliar.</li>
          <li>Ponto de orvalho: Td = 243,04·γ / (17,625 − γ), γ = ln(UR/100) + 17,625·T/(243,04 + T).</li>
          <li>Média dos sensores nos gráficos: cada sensor pesa igual; só entram intervalos com leitura de todos os sensores.</li>
          <li>Mapas: IDW (potência 2) só com sensores atualizados; com menos de 3, não há mapa. Fora do triângulo dos sensores o valor é extrapolado (hachurado).</li>
        </ul>
      </section>

      {(meta.viewProtected || live.error?.status === 401) && (
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Token de visualização deste aparelho</h2>
          </div>
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              setViewToken(vt.trim() || null);
              location.reload();
            }}
          >
            <input className="input" style={{ maxWidth: '22rem' }} type="password" autoComplete="off" placeholder="Token de visualização" value={vt} onChange={(e) => setVt(e.target.value)} aria-label="Token de visualização" />
            <button className="btn" type="submit">
              Guardar
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
