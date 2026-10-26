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
        sub={`Nomes e posições em metros (x: 0–${ROOM.lengthM} m ao longo do comprimento; y: 0–${ROOM.widthM} m ao longo da largura, a partir do canto superior esquerdo). Arraste no mapa ou digite.`}
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

      <Section title="Bomba (Sonoff)" sub="O painel mostra se a bomba está ligada ou desligada, conforme o Sonoff informa ao eWeLink, e registra cada irrigação. Nenhum comando é enviado à bomba.">
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
            hint="Se a bomba ficar ligada mais que isso (+2 min de margem de leitura), a TV avisa em vermelho. Para a bomba DESLIGAR sozinha, configure o mesmo tempo no modo “Inching” do Sonoff, no app eWeLink."
          />
        </div>
      </Section>

      <LocationSection value={draft.location} onChange={(v) => set((d) => void (d.location = v))} />

      <Section title="Frescor dos dados e replay" sub="O sistema lê a nuvem SwitchBot a cada 2 min e só grava quando o valor muda. A SwitchBot atualiza a nuvem a cada 2 a 30 min, conforme a variação. Com o padrão (atrasado após 60 min, sem comunicação após 180 min), um sensor parado é sinalizado. Ajuste depois de observar a frequência real.">
        <div className="form-grid">
          <Num label="Leitura “atualizada” até" unit="min" min={1} value={draft.freshness.freshMaxMin} onChange={(v) => set((d) => void (d.freshness.freshMaxMin = v as number))} hint="Acima disso o sensor fica ATRASADO e sai das médias e do mapa." />
          <Num label="“Sem comunicação” após" unit="min" min={1} value={draft.freshness.offlineAfterMin} onChange={(v) => set((d) => void (d.freshness.offlineAfterMin = v as number))} hint="Deve ser maior que o limite de atualizado." />
          <Num label="Tolerância do replay" unit="min" min={1} max={180} value={draft.replay.toleranceMin} onChange={(v) => set((d) => void (d.replay.toleranceMin = v as number))} hint="Leituras de sensores diferentes até esta distância do instante são combinadas." />
          <Num label="Retenção das leituras brutas" unit="dias" min={7} max={90} value={draft.retention.rawDays} onChange={(v) => set((d) => void (d.retention.rawDays = v as number))} hint="Agregados horários são mantidos por 730 dias." />
        </div>
      </Section>

      <Section title="Limites de alerta" sub="Você define os limites; o sistema não impõe faixas agronômicas universais. Deixe em branco para desativar.">
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

      <Section title="Mapas: escalas e orientação" sub="Escalas fixas permitem comparar momentos diferentes na mesma cor. Não representam faixas ideais.">
        <div className="form-grid">
          <Num label="Temperatura · escala mínima" unit="°C" value={draft.scales.temperature.min} onChange={(v) => set((d) => void (d.scales.temperature.min = v as number))} />
          <Num label="Temperatura · escala máxima" unit="°C" value={draft.scales.temperature.max} onChange={(v) => set((d) => void (d.scales.temperature.max = v as number))} />
          <Num label="Umidade · escala mínima" unit="% UR" value={draft.scales.humidity.min} onChange={(v) => set((d) => void (d.scales.humidity.min = v as number))} />
          <Num label="Umidade · escala máxima" unit="% UR" value={draft.scales.humidity.max} onChange={(v) => set((d) => void (d.scales.humidity.max = v as number))} />
          <Num label="Direção do Norte" unit="graus, sentido horário a partir do topo do mapa" nullable min={0} max={359} value={draft.orientation.northAngleDeg} onChange={(v) => set((d) => void (d.orientation.northAngleDeg = v))} hint="Vazio = orientação ainda não informada." />
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
