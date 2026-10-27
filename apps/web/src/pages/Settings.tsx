import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AppConfigSchema, ROOM, fmtNum } from '@orq/core';
import type { AppConfig, GeoPlace, Limits, ProviderDeviceDto } from '@orq/core';
import { PlanEditor } from '../components/PlanEditor';
import { Chip, Notice } from '../components/ui';
import type { LiveState } from '../hooks/useLive';
import { ApiError, api, getAdminToken, setAdminToken } from '../lib/api';
import type { Meta } from '../lib/api';

type Draft = AppConfig;

function Num({ label, value, onChange, nullable, step = 1, min, max, hint, unit }: { label: string; value: number | null; onChange: (v: number | null) => void; nullable?: boolean; step?: number; min?: number; max?: number; hint?: string; unit?: string }) {
  return (
    <label className="field">
      <span>
        {label}
        {unit ? ` (${unit})` : ''}
      </span>
      <input
        className="input"
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={value === null || Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? (nullable ? null : NaN) : Number(e.target.value))}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Section({ title, sub, children, chip }: { title: string; sub?: string; children: ReactNode; chip?: ReactNode }) {
  return (
    <section className="card">
      <div className="card__head">
        <div>
          <h2 className="card__title">{title}</h2>
          {sub && <div className="card__sub">{sub}</div>}
        </div>
        {chip}
      </div>
      {children}
    </section>
  );
}

export function Settings({ live, meta }: { live: LiveState & { refresh: () => void }; meta: Meta }) {
  const base = live.data?.config ?? null;
  const [draft, setDraft] = useState<Draft | null>(base);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(false);
  const [hasToken, setHasToken] = useState(() => !!getAdminToken());

  useEffect(() => {
    if (base) setDraft(base);
    // Recarrega o rascunho quando a revisão do servidor muda (após salvar ou conflito).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base?.revision]);

  const [devices, setDevices] = useState<ProviderDeviceDto[] | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    api.devices(ac.signal).then((r) => setDevices(r.devices)).catch(() => setDevices([]));
    return () => ac.abort();
  }, []);

  const validation = useMemo(() => (draft ? AppConfigSchema.safeParse(draft) : null), [draft]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(base), [draft, base]);

  if (!draft || !base) return <div className="container"><div className="empty">{live.error ? live.error.message : 'Carregando…'}</div></div>;
  const set = (fn: (d: Draft) => void) => {
    setMsg(null);
    setDraft((d) => {
      const n = structuredClone(d!);
      fn(n);
      return n;
    });
  };
  const setLimit = (k: 'temperature' | 'humidity' | 'dpv', side: keyof Limits, v: number | null) =>
    set((d) => {
      d.alerts[k][side] = v;
    });

  const issues = validation && !validation.success ? validation.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || 'config'}: ${i.message}`) : [];

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.saveConfig(draft);
      setMsg({ kind: 'ok', text: 'Configuração salva.' });
      live.refresh();
    } catch (e) {
      const err = e as ApiError;
      setMsg({
        kind: 'bad',
        text:
          err.status === 401
            ? 'Token de administração ausente ou inválido. Informe-o em “Acesso para editar”.'
            : err.status === 503
              ? 'O servidor não tem ADMIN_TOKEN configurado: a edição está desativada (veja o README).'
              : err.status === 409
                ? 'Outra sessão alterou a configuração. Recarregando a versão atual…'
                : err.message,
      });
      if (err.status === 409) live.refresh();
    } finally {
      setSaving(false);
    }
  };

  const next = (arr: { id: string }[], prefix: string) => {
    for (let i = 1; i < 100; i++) if (!arr.some((a) => a.id === `${prefix}${i}`)) return `${prefix}${i}`;
    return `${prefix}${Date.now()}`;
  };

  return (
    <main className="container">
      <Section title="Acesso para editar" sub="Gravar configuração exige o token de administração do servidor. Ele nunca é exibido nem enviado a terceiros." chip={hasToken ? <Chip kind="ok">Token informado</Chip> : <Chip kind="warn">Somente leitura</Chip>}>
        {!meta.writeAuthConfigured && (
          <Notice kind="warn">
            O servidor não tem <code>ADMIN_TOKEN</code> configurado, portanto a gravação está desativada. Rode <code>npm run setup</code> (local) ou <code>wrangler secret put ADMIN_TOKEN</code> (produção).
          </Notice>
        )}
        <form
          className="toolbar"
          style={{ marginTop: '0.6rem' }}
          onSubmit={(e) => {
            e.preventDefault();
            setAdminToken(token.trim() || null, remember);
            setHasToken(!!token.trim());
            setToken('');
            setMsg({ kind: 'ok', text: token.trim() ? 'Token guardado neste navegador. Ele será verificado ao salvar.' : 'Token removido.' });
          }}
        >
          <input className="input" style={{ maxWidth: '24rem' }} type="password" autoComplete="off" placeholder="Token de administração" aria-label="Token de administração" value={token} onChange={(e) => setToken(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Lembrar neste dispositivo
          </label>
          <button className="btn" type="submit">
            {token ? 'Desbloquear edição' : hasToken ? 'Remover token' : 'Desbloquear edição'}
          </button>
        </form>
        <p className="tiny mute" style={{ margin: '0.5rem 0 0' }}>
          Sem “lembrar”, o token fica só na sessão desta aba. Não use “lembrar” em TV ou aparelho compartilhado.
        </p>
      </Section>

      <Section
        title="Sensores"
        sub={`Nomes e posições em metros (planta em pé, como a estufa — x: 0–${ROOM.lengthM} m de cima para baixo; y: 0–${ROOM.widthM} m da esquerda para a direita). Arraste no mapa ou digite.`}
        chip={draft.sensors.some((s) => s.positionProvisional) ? <Chip kind="warn">Há posições provisórias</Chip> : <Chip kind="ok">Posições informadas</Chip>}
      >
        <div className="split">
          <PlanEditor
            kind="sensor"
            ariaLabel="Posições dos sensores"
            items={draft.sensors.map((s) => ({ id: s.id, label: s.id.toUpperCase(), xM: s.xM, yM: s.yM }))}
            onMove={(id, x, y) =>
              set((d) => {
                const s = d.sensors.find((z) => z.id === id)!;
                s.xM = x;
                s.yM = y;
                s.positionProvisional = false;
              })
            }
          />
          <div className="rowlist">
            {draft.sensors.map((s, i) => (
              <div className="rowlist__row" key={s.id}>
                <label className="field">
                  <span>{s.id.toUpperCase()} · Nome</span>
                  <input className="input" value={s.name} maxLength={60} onChange={(e) => set((d) => void (d.sensors[i]!.name = e.target.value))} />
                </label>
                <Num label="x" unit="m" step={0.05} min={0} max={ROOM.lengthM} value={s.xM} onChange={(v) => set((d) => void ((d.sensors[i]!.xM = v as number), (d.sensors[i]!.positionProvisional = false)))} />
                <Num label="y" unit="m" step={0.05} min={0} max={ROOM.widthM} value={s.yM} onChange={(v) => set((d) => void ((d.sensors[i]!.yM = v as number), (d.sensors[i]!.positionProvisional = false)))} />
                <label className="check" title="Marque enquanto a posição não tiver sido medida no local">
                  <input type="checkbox" checked={s.positionProvisional} onChange={(e) => set((d) => void (d.sensors[i]!.positionProvisional = e.target.checked))} />
                  Provisória
                </label>
                {draft.sensors.length > 1 ? (
                  <button className="btn btn--sm btn--danger" type="button" onClick={() => set((d) => void d.sensors.splice(i, 1))} aria-label={`Remover ${s.name}`}>
                    Remover
                  </button>
                ) : (
                  <span />
                )}
                <label className="field" style={{ gridColumn: '1 / -1' }}>
                  <span>Sensor deste ponto</span>
                  <DeviceSelect
                    devices={devices}
                    kind="climate"
                    value={s.externalId ?? null}
                    taken={[...draft.sensors.filter((_, j) => j !== i).map((x) => x.externalId ?? ''), draft.pump.deviceId ?? '']}
                    onChange={(v) => set((d) => void (d.sensors[i]!.externalId = v))}
                  />
                </label>
              </div>
            ))}
            {draft.sensors.length < 8 && (
              <button className="btn btn--sm" type="button" onClick={() => set((d) => void d.sensors.push({ id: next(d.sensors, 's'), name: `Sensor ${d.sensors.length + 1}`, xM: 6, yM: 2.5, positionProvisional: true, externalId: null }))}>
                + Adicionar sensor
              </button>
            )}
          </div>
        </div>
      </Section>

      <Section title="Aspersores (irrigação)" sub="Desenho de referência da planta: ajuste quantidade e posições conforme a instalação real." chip={draft.irrigation.layoutProvisional ? <Chip kind="warn">Layout provisório</Chip> : <Chip kind="ok">Layout informado</Chip>}>
        <div className="split">
          <PlanEditor
            kind="sprinkler"
            ariaLabel="Posições dos aspersores"
            items={draft.irrigation.sprinklers.map((s) => ({ id: s.id, label: s.label, xM: s.xM, yM: s.yM, radiusM: s.radiusM }))}
            onMove={(id, x, y) =>
              set((d) => {
                const s = d.irrigation.sprinklers.find((z) => z.id === id)!;
                s.xM = x;
                s.yM = y;
                d.irrigation.layoutProvisional = false;
              })
            }
          />
          <div className="rowlist">
            {draft.irrigation.sprinklers.map((s, i) => (
              <div className="rowlist__row rowlist__row--spr" key={s.id}>
                <label className="field">
                  <span>Rótulo</span>
                  <input className="input" value={s.label} maxLength={60} onChange={(e) => set((d) => void (d.irrigation.sprinklers[i]!.label = e.target.value))} />
                </label>
                <Num label="x" unit="m" step={0.05} min={0} max={ROOM.lengthM} value={s.xM} onChange={(v) => set((d) => void ((d.irrigation.sprinklers[i]!.xM = v as number), (d.irrigation.layoutProvisional = false)))} />
                <Num label="y" unit="m" step={0.05} min={0} max={ROOM.widthM} value={s.yM} onChange={(v) => set((d) => void ((d.irrigation.sprinklers[i]!.yM = v as number), (d.irrigation.layoutProvisional = false)))} />
                <Num label="Alcance" unit="m" step={0.1} min={0.5} max={6} value={s.radiusM} onChange={(v) => set((d) => void (d.irrigation.sprinklers[i]!.radiusM = v as number))} />
                <button className="btn btn--sm btn--danger" type="button" onClick={() => set((d) => void d.irrigation.sprinklers.splice(i, 1))} aria-label={`Remover ${s.label}`}>
                  Remover
                </button>
              </div>
            ))}
            {draft.irrigation.sprinklers.length < 40 && (
              <button className="btn btn--sm" type="button" onClick={() => set((d) => void d.irrigation.sprinklers.push({ id: next(d.irrigation.sprinklers, 'a'), label: `A${d.irrigation.sprinklers.length + 1}`, xM: 6, yM: 2.5, radiusM: 1.8 }))}>
                + Adicionar aspersor
              </button>
            )}
            <label className="check">
              <input type="checkbox" checked={draft.irrigation.layoutProvisional} onChange={(e) => set((d) => void (d.irrigation.layoutProvisional = e.target.checked))} />
              Layout ainda provisório / ilustrativo
            </label>
          </div>
        </div>
      </Section>

      <Section title="Bomba (Sonoff)" sub="O painel mostra se a bomba está ligada ou desligada, conforme o Sonoff informa ao eWeLink, e registra cada irrigação. Os comandos de ligar/desligar vêm da Automação (abaixo).">
        <div className="form-grid">
          <label className="field">
            <span>Sonoff da bomba</span>
            <DeviceSelect devices={devices} kind="switch" value={draft.pump.deviceId} taken={draft.sensors.map((x) => x.externalId ?? '')} onChange={(v) => set((d) => void (d.pump.deviceId = v))} />
          </label>
          <Num label="Canal" min={0} max={3} value={draft.pump.outlet} onChange={(v) => set((d) => void (d.pump.outlet = (v as number) || 0))} hint="0 = primeiro canal. Só muda em Sonoff de vários canais." />
          <Num
            label="Tempo de cada irrigação"
            unit="min"
            min={1}
            max={180}
            value={draft.pump.maxRunMin}
            onChange={(v) => set((d) => void (d.pump.maxRunMin = v as number))}
            hint="Duração de cada irrigação automática. Com a automação ligada, o Sonoff é configurado para desligar sozinho após este tempo (Inching) e o servidor desliga se passar. A TV avisa em vermelho se passar (+2 min de margem)."
          />
        </div>
      </Section>

      <Section
        title="Regras de irrigação"
        sub="Quando NÃO irrigar. A automação não liga fora destas regras e DESLIGA a bomba se ela estiver ligada fora delas. A TV mostra “Pode irrigar agora?”. Deixe em branco para desativar uma regra."
      >
        <div className="form-grid">
          <Num
            label="Não irrigar com a estufa acima de"
            unit="°C"
            nullable
            step={0.5}
            min={0}
            max={60}
            value={draft.irrigationRules.maxTempC}
            onChange={(v) => set((d) => void (d.irrigationRules.maxTempC = v))}
            hint="Usa o ponto mais quente entre os sensores da estufa."
          />
          <Num
            label="Não irrigar com sol direto acima de"
            unit="W/m²"
            nullable
            step={50}
            min={0}
            max={1400}
            value={draft.irrigationRules.maxSunWm2}
            onChange={(v) => set((d) => void (d.irrigationRules.maxSunWm2 = v))}
            hint="Estimativa para a cidade (Open-Meteo). Referência: céu limpo ao meio-dia 700–900; manhã cedo/fim de tarde abaixo de 300; nublado abaixo de 150."
          />
          <label className="field">
            <span>Período a evitar · início</span>
            <input className="input" type="time" value={draft.irrigationRules.avoidFrom ?? ''} onChange={(e) => set((d) => void (d.irrigationRules.avoidFrom = e.target.value || null))} />
            <small>Opcional. Ex.: 10:00</small>
          </label>
          <label className="field">
            <span>Período a evitar · fim</span>
            <input className="input" type="time" value={draft.irrigationRules.avoidTo ?? ''} onChange={(e) => set((d) => void (d.irrigationRules.avoidTo = e.target.value || null))} />
            <small>Opcional. Ex.: 16:00</small>
          </label>
        </div>
      </Section>

      <AutomationSection value={draft.automation} onChange={(fn) => set((d) => fn(d.automation))} runMin={draft.pump.maxRunMin} />

      <LocationSection value={draft.location} onChange={(v) => set((d) => void (d.location = v))} />

      <Section title="Frescor dos dados e replay" sub="O sistema lê a nuvem SwitchBot a cada 2 min e só grava quando o valor muda. A SwitchBot atualiza a nuvem a cada 2 a 30 min, conforme a variação. Com o padrão (atrasado após 60 min, sem comunicação após 180 min), um sensor parado é sinalizado. Ajuste depois de observar a frequência real.">
        <div className="form-grid">
          <Num label="Leitura “atualizada” até" unit="min" min={1} value={draft.freshness.freshMaxMin} onChange={(v) => set((d) => void (d.freshness.freshMaxMin = v as number))} hint="Acima disso o sensor fica ATRASADO e sai das médias e do mapa." />
          <Num label="“Sem comunicação” após" unit="min" min={1} value={draft.freshness.offlineAfterMin} onChange={(v) => set((d) => void (d.freshness.offlineAfterMin = v as number))} hint="Deve ser maior que o limite de atualizado." />
          <Num label="Tolerância do replay" unit="min" min={1} max={180} value={draft.replay.toleranceMin} onChange={(v) => set((d) => void (d.replay.toleranceMin = v as number))} hint="Leituras de sensores diferentes até esta distância do instante são combinadas." />
          <Num label="Retenção das leituras brutas" unit="dias" min={7} max={90} value={draft.retention.rawDays} onChange={(v) => set((d) => void (d.retention.rawDays = v as number))} hint="Agregados horários são mantidos por 730 dias." />
        </div>
      </Section>

      <Section title="Limites de alerta" sub="Faixa ideal da estufa: define as cores da TV e quando o celular avisa. Sugestão para Vandas: temperatura 16 a 32 °C, umidade 60 a 85 %. DPV pode ficar em branco.">
        <div className="form-grid" style={{ marginTop: '0.6rem' }}>
          {(
            [
              ['temperature', 'Temperatura', '°C', 0.5],
              ['humidity', 'Umidade relativa', '% UR', 1],
              ['dpv', 'DPV do ar', 'kPa', 0.05],
            ] as const
          ).map(([k, name, unit, step]) => (
            <div key={k} style={{ display: 'contents' }}>
              <Num label={`${name} · mínimo`} unit={unit} nullable step={step} value={draft.alerts[k].min} onChange={(v) => setLimit(k, 'min', v)} />
              <Num label={`${name} · máximo`} unit={unit} nullable step={step} value={draft.alerts[k].max} onChange={(v) => setLimit(k, 'max', v)} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Mapas: escalas e orientação" sub="As escalas podem ficar como estão (só afetam o Painel completo). Preencha apenas a bússola.">
        <div className="form-grid">
          <Num label="Temperatura · escala mínima" unit="°C" value={draft.scales.temperature.min} onChange={(v) => set((d) => void (d.scales.temperature.min = v as number))} />
          <Num label="Temperatura · escala máxima" unit="°C" value={draft.scales.temperature.max} onChange={(v) => set((d) => void (d.scales.temperature.max = v as number))} />
          <Num label="Umidade · escala mínima" unit="% UR" value={draft.scales.humidity.min} onChange={(v) => set((d) => void (d.scales.humidity.min = v as number))} />
          <Num label="Umidade · escala máxima" unit="% UR" value={draft.scales.humidity.max} onChange={(v) => set((d) => void (d.scales.humidity.max = v as number))} />
          <Num
            label="Bússola: graus olhando do Fundo para o Início"
            unit="°"
            nullable
            min={0}
            max={359}
            value={draft.orientation.northAngleDeg === null ? null : (360 - draft.orientation.northAngleDeg) % 360}
            onChange={(v) => set((d) => void (d.orientation.northAngleDeg = v === null ? null : (360 - Math.round(v)) % 360))}
            hint="Abra o app Bússola do celular, fique no FUNDO da estufa e aponte o celular para o INÍCIO. Digite o número de graus que aparece (ex.: 70). Vazio = não informado."
          />
        </div>
      </Section>

      <div className="sticky-save">
        <button className="btn btn--primary" type="button" disabled={!dirty || saving || !validation?.success} onClick={save}>
          {saving ? 'Salvando…' : 'Salvar alterações'}
        </button>
        <button className="btn" type="button" disabled={!dirty || saving} onClick={() => setDraft(base)}>
          Descartar
        </button>
        {dirty && <Chip kind="warn">Alterações não salvas</Chip>}
        {issues.length > 0 && (
          <span className="small" style={{ color: 'var(--red)' }} role="alert">
            {issues.join(' · ')}
          </span>
        )}
        {msg && (
          <span className="small" role="status" style={{ color: msg.kind === 'ok' ? 'var(--green)' : 'var(--red)' }}>
            {msg.text}
          </span>
        )}
      </div>
    </main>
  );
}

/** Automação da bomba: horários, proteção e limites (ver packages/core/src/automation.ts). */
function AutomationSection({ value: a, onChange, runMin }: { value: AppConfig['automation']; onChange: (fn: (a: AppConfig['automation']) => void) => void; runMin: number }) {
  const modes: [AppConfig['automation']['mode'], string, string][] = [
    ['automatico', 'Automático', 'Liga nos horários abaixo (se as regras permitirem) e desliga fora das regras ou ao passar do tempo.'],
    ['protecao', 'Só proteção', 'Não liga nunca; só desliga a bomba fora das regras ou ao passar do tempo (timers do app eWeLink continuam valendo).'],
    ['desligado', 'Desligado', 'Só monitora. Nenhum comando é enviado à bomba.'],
  ];
  return (
    <Section
      title="Automação da bomba"
      sub="Funciona sozinha, sem ninguém: precisa da conta eWeLink conectada e do Sonoff da bomba escolhido acima. Cada ação fica registrada no Histórico."
      chip={<Chip kind={a.mode === 'desligado' ? 'warn' : 'ok'}>{modes.find((m) => m[0] === a.mode)![1]}</Chip>}
    >
      <div className="rowlist">
        {modes.map(([m, label, help]) => (
          <label key={m} className="check" style={{ alignItems: 'flex-start' }}>
            <input type="radio" name="automation-mode" checked={a.mode === m} onChange={() => onChange((x) => void (x.mode = m))} />
            <span>
              <b>{label}</b> — <span className="small mute">{help}</span>
            </span>
          </label>
        ))}
      </div>

      {a.mode === 'automatico' && (
        <div style={{ marginTop: '0.8rem' }}>
          <div className="small" style={{ fontWeight: 700, marginBottom: '0.4rem' }}>
            Horários de irrigação ({runMin} min cada)
          </div>
          <div className="toolbar">
            {a.schedule.map((t, i) => (
              <span key={i} className="toolbar" style={{ gap: '0.25rem' }}>
                <input
                  className="input"
                  type="time"
                  style={{ width: '8rem' }}
                  value={t}
                  onChange={(e) => e.target.value && onChange((x) => void (x.schedule[i] = e.target.value))}
                  aria-label={`Horário ${i + 1}`}
                />
                <button className="btn btn--sm btn--danger" type="button" onClick={() => onChange((x) => void x.schedule.splice(i, 1))} aria-label={`Remover horário ${t}`}>
                  ✕
                </button>
              </span>
            ))}
            {a.schedule.length < 24 && (
              <button className="btn btn--sm" type="button" onClick={() => onChange((x) => void x.schedule.push(nextFreeTime(x.schedule)))}>
                + Adicionar horário
              </button>
            )}
          </div>
          {a.schedule.length === 0 && <p className="small" style={{ color: 'var(--amber)' }}>Nenhum horário definido: no modo automático, a bomba só será ligada pela regra de umidade (se ativada).</p>}
        </div>
      )}

      <div className="form-grid" style={{ marginTop: '0.8rem' }}>
        <Num label="Se as regras bloquearem, tentar por até" unit="min" min={0} max={720} value={a.postponeMaxMin} onChange={(v) => onChange((x) => void (x.postponeMaxMin = v as number))} hint="Ex.: sol forte às 07:00 → tenta de novo até liberar; depois disso, pula o horário." />
        <Num label="Intervalo mínimo entre irrigações" unit="min" min={5} max={1440} value={a.minGapMin} onChange={(v) => onChange((x) => void (x.minGapMin = v as number))} />
        <Num label="Máximo de irrigações por dia" min={1} max={48} value={a.maxPerDay} onChange={(v) => onChange((x) => void (x.maxPerDay = v as number))} hint="Conta todas, inclusive as ligadas por outro meio." />
        <Num
          label="Irrigação extra se a umidade da estufa ficar abaixo de"
          unit="%"
          nullable
          min={10}
          max={95}
          value={a.humidityBelowPct}
          onChange={(v) => onChange((x) => void (x.humidityBelowPct = v))}
          hint="Opcional. Só irriga se as regras puderem ser avaliadas e permitirem."
        />
      </div>
      <div className="rowlist" style={{ marginTop: '0.6rem' }}>
        <label className="check">
          <input type="checkbox" checked={a.skipIfRaining} onChange={(e) => onChange((x) => void (x.skipIfRaining = e.target.checked))} />
          Não irrigar enquanto estiver chovendo na cidade
        </label>
        <label className="check">
          <input type="checkbox" checked={a.syncInching} onChange={(e) => onChange((x) => void (x.syncInching = e.target.checked))} />
          Configurar o Sonoff para desligar sozinho após {runMin} min (Inching) — recomendado: funciona mesmo sem internet
        </label>
      </div>
    </Section>
  );
}

function nextFreeTime(list: string[]): string {
  for (const t of ['07:00', '17:00', '12:00', '09:00', '15:00', '06:00', '18:00']) if (!list.includes(t)) return t;
  for (let h = 0; h < 24; h++) {
    const t = `${String(h).padStart(2, '0')}:30`;
    if (!list.includes(t)) return t;
  }
  return '00:00';
}

/** Cidade do orquidário: usada só para o clima de fora (Open-Meteo). */
function LocationSection({ value, onChange }: { value: AppConfig['location']; onChange: (v: AppConfig['location']) => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<GeoPlace[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const search = async () => {
    setBusy(true);
    setErr(null);
    try {
      setPlaces((await api.geocode(q)).places);
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.status === 401 ? 'Informe o token de administração (no topo da página) para buscar.' : ae.message);
      setPlaces(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Cidade do orquidário (previsão do tempo)"
      sub="Usada para mostrar na TV o tempo lá fora e a previsão de chuva dos próximos 7 dias (Open-Meteo, gratuito). É previsão para a cidade, não medição na estufa."
      chip={value ? <Chip kind="ok">{value.name}</Chip> : <Chip kind="warn">Não informada</Chip>}
    >
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 2) void search();
        }}
      >
        <input className="input" style={{ maxWidth: '22rem' }} placeholder="Nome da cidade" aria-label="Nome da cidade" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" type="submit" disabled={busy || q.trim().length < 2}>
          {busy ? 'Buscando…' : 'Buscar'}
        </button>
        {value && (
          <button className="btn btn--sm btn--danger" type="button" onClick={() => onChange(null)}>
            Remover cidade
          </button>
        )}
      </form>
      {err && <p className="small" style={{ color: 'var(--red)' }}>{err}</p>}
      {places && places.length === 0 && <p className="small mute">Nenhuma cidade encontrada.</p>}
      {places && places.length > 0 && (
        <div className="rowlist" style={{ marginTop: '0.6rem' }}>
          {places.map((p) => (
            <button
              key={`${p.lat},${p.lon}`}
              type="button"
              className="btn"
              style={{ justifyContent: 'flex-start' }}
              onClick={() => {
                onChange({ name: p.name, lat: Math.round(p.lat * 1e4) / 1e4, lon: Math.round(p.lon * 1e4) / 1e4 });
                setPlaces(null);
                setQ('');
              }}
            >
              {p.label} <span className="tiny mute">({fmtNum(p.lat, 2)}, {fmtNum(p.lon, 2)})</span>
            </button>
          ))}
          <p className="tiny mute" style={{ margin: 0 }}>Depois de escolher, clique em “Salvar alterações”.</p>
        </div>
      )}
    </Section>
  );
}

function DeviceSelect({ devices, kind, value, taken, onChange }: { devices: ProviderDeviceDto[] | null; kind: 'climate' | 'switch'; value: string | null; taken: string[]; onChange: (v: string | null) => void }) {
  if (devices === null) return <select className="input" disabled><option>Carregando…</option></select>;
  // Sensores: SwitchBot (principal) ou coletor Zigbee (opcional) — origens com suporte documentado. Bomba: Sonoff no eWeLink.
  const options = devices.filter((d) => d.kind === kind && (kind === 'climate' ? d.provider === 'switchbot' || d.provider === 'zigbee2mqtt' : d.provider === 'ewelink'));
  const known = value === null || options.some((d) => d.deviceId === value);
  const describe = (d: ProviderDeviceDto) =>
    kind === 'climate'
      ? `${d.name} · ${d.model ?? ''} · ${fmtNum(d.temperatureC, 1)} °C · ${fmtNum(d.humidityPct, 0)} % UR`
      : `${d.name} · ${d.switchState === 'on' ? 'ligado' : d.switchState === 'off' ? 'desligado' : '—'}${d.online === false ? ' · offline' : ''}`;
  return (
    <>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— não vinculado —</option>
        {!known && <option value={value!}>{value} (não encontrado na última leitura)</option>}
        {options.map((d) => (
          <option key={d.deviceId} value={d.deviceId} disabled={taken.includes(d.deviceId) && d.deviceId !== value}>
            {describe(d)}
          </option>
        ))}
      </select>
      {options.length === 0 && (
        <small>{kind === 'climate' ? 'Nenhum sensor ainda: cadastre a credencial SwitchBot e clique em "Ler agora" em "Dados e integração".' : 'Nenhum Sonoff encontrado: conecte o eWeLink em "Dados e integração".'}</small>
      )}
    </>
  );
}
