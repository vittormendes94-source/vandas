import { useState } from 'react';
import type { Dataset } from '@orq/core';
import { CalcChip, Chip, EstChip, Notice } from '../components/ui';
import type { LiveState } from '../hooks/useLive';
import { setViewToken } from '../lib/api';
import type { Meta } from '../lib/api';

export function About({ dataset, live, meta }: { dataset: Dataset; live: LiveState; meta: Meta }) {
  const info = live.data?.integration;
  const sensors = live.data?.config.sensors ?? [];
  const [vt, setVt] = useState('');
  const origin = location.origin;
  const example = `curl -X POST ${origin}/api/v1/ingest/readings \\
  -H "Authorization: Bearer <INGEST_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "source": "meu-dispositivo",
    "readings": [
      { "sensorId": "${sensors[0]?.id ?? 's1'}",
        "measuredAt": "2026-09-30T17:05:00Z",
        "temperatureC": 27.4,
        "humidityPct": 68.2,
        "batteryPct": 91 }
    ]
  }'`;
  const relayExample = `curl -X POST ${origin}/api/v1/ingest/relay \\
  -H "Authorization: Bearer <INGEST_TOKEN>" -H "Content-Type: application/json" \\
  -d '{ "source": "meu-dispositivo", "state": "on", "measuredAt": "2026-09-30T17:00:00Z" }'`;

  return (
    <main className="container">
      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Origem dos dados</h2>
            <div className="card__sub">Cada valor na tela indica de onde vem.</div>
          </div>
        </div>
        <div className="stack" style={{ gap: '0.5rem' }}>
          <div>
            <Chip kind="sim">Simulado</Chip> <span className="small dim">gerado por simulação no modo demonstração; não vem de nenhum sensor.</span>
          </div>
          <div>
            <Chip kind="measured">Medido</Chip> <span className="small dim">leitura recebida de um sensor (horário da medição e horário de recebimento guardados separadamente).</span>
          </div>
          <div>
            <CalcChip /> <span className="small dim">indicador calculado a partir das leituras (médias, diferenças, DPV, ponto de orvalho, extremos).</span>
          </div>
          <div>
            <EstChip /> <span className="small dim">valor espacial estimado por interpolação entre sensores; não é medição.</span>
          </div>
          <div>
            <Chip kind="warn">Atrasado</Chip> <span className="small dim">leitura mais antiga que o limite de atualização; excluída de médias e mapas.</span>
          </div>
          <div>
            <Chip kind="bad">Sem comunicação</Chip> <span className="small dim">sem leitura há mais que o limite; nunca se assume que “tudo está bem”.</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Estado da integração</h2>
            <div className="card__sub">Conjunto atual: {dataset === 'demo' ? 'DEMONSTRAÇÃO (dados simulados)' : 'DADOS REAIS'}</div>
          </div>
        </div>
        <div className="pending">
          <Chip kind={dataset === 'demo' ? 'sim' : 'measured'}>{dataset === 'demo' ? 'Simulador' : 'API de ingestão'}</Chip>
          <div>
            {dataset === 'demo'
              ? 'Os dados são gerados por um simulador determinístico e gravados no banco como conjunto “demo”. Nada aqui vem de sensores.'
              : 'Modo real: só existem leituras enviadas pela API de ingestão. Sem elas a tela mostra “sem dados”; nunca se usa simulação como reserva.'}
          </div>
        </div>
        <div className="pending">
          <Chip kind="warn">eWeLink · pendente</Chip>
          <div>
            {info?.ewelink.note ?? 'Integração eWeLink não configurada.'}
            <div className="tiny mute">A integração gratuita com o eWeLink ainda precisa ser validada (acesso à API, autenticação, cotas, ponte e sensores). Não é tratada como funcionando.</div>
          </div>
        </div>
        <div className="pending">
          <Chip kind={meta.ingestAuthConfigured ? 'ok' : 'warn'}>Ingestão {meta.ingestAuthConfigured ? 'protegida' : 'desativada'}</Chip>
          <div>{meta.ingestAuthConfigured ? 'INGEST_TOKEN configurado no servidor.' : 'Sem INGEST_TOKEN: as rotas de ingestão respondem 503.'}</div>
        </div>
        <div className="pending">
          <Chip kind={meta.writeAuthConfigured ? 'ok' : 'warn'}>Edição {meta.writeAuthConfigured ? 'protegida' : 'desativada'}</Chip>
          <div>{meta.writeAuthConfigured ? 'ADMIN_TOKEN configurado no servidor.' : 'Sem ADMIN_TOKEN: configurações não podem ser gravadas.'}</div>
        </div>
        <div className="pending">
          <Chip kind={meta.viewProtected ? 'ok' : 'plain'}>Visualização {meta.viewProtected ? 'com token' : 'aberta'}</Chip>
          <div>
            {meta.viewProtected ? 'A leitura da API exige o token de visualização (a URL da TV leva ?k=…). Esse token só permite ler.' : 'Sem VIEW_TOKEN, qualquer pessoa com o endereço pode ver os dados. Defina VIEW_TOKEN antes de publicar dados reais.'}
          </div>
        </div>
        {live.error?.status === 401 || meta.viewProtected ? (
          <form
            className="toolbar"
            style={{ marginTop: '0.6rem' }}
            onSubmit={(e) => {
              e.preventDefault();
              setViewToken(vt.trim() || null);
              location.reload();
            }}
          >
            <input className="input" style={{ maxWidth: '22rem' }} type="password" autoComplete="off" placeholder="Token de visualização (neste dispositivo)" value={vt} onChange={(e) => setVt(e.target.value)} aria-label="Token de visualização" />
            <button className="btn" type="submit">
              Guardar
            </button>
          </form>
        ) : null}
      </section>

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Enviar leituras reais (contrato de ingestão)</h2>
            <div className="card__sub">Funciona com qualquer origem: ESP32, script, Home Assistant, Node-RED ou o futuro adaptador do eWeLink.</div>
          </div>
        </div>
        <div className="code">{example}</div>
        <p className="small dim">
          Sensores cadastrados: {sensors.map((s) => `${s.id} (${s.name})`).join(', ') || '—'}. Informe <code>measuredAt</code> (ISO 8601) sempre que a origem tiver o horário da medição: ele evita duplicidade e permite ordenar mensagens fora de ordem. Duplicatas (mesmo sensor + mesmo instante) são ignoradas.
        </p>
        <div className="code">{relayExample}</div>
        <p className="small dim">O estado do relé é o informado pelo controlador; não confirma passagem de água. Detalhes: docs/CONTRATO-DE-LEITURAS.md e docs/API.md.</p>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Fórmulas e métodos</h2>
        </div>
        <ul className="list">
          <li>
            <strong>Pressão de saturação (Magnus, Alduchov &amp; Eskridge):</strong> es(T) = 0,61094 · exp(17,625·T / (T + 243,04)) kPa.
          </li>
          <li>
            <strong>DPV do ar:</strong> es(T) · (1 − UR/100), com a temperatura do AR do sensor. Não é o DPV da folha (a temperatura foliar não é medida).
          </li>
          <li>
            <strong>Ponto de orvalho:</strong> Td = 243,04·γ / (17,625 − γ), com γ = ln(UR/100) + 17,625·T/(243,04 + T). Indefinido com UR = 0.
          </li>
          <li>
            <strong>Interpolação dos mapas (IDW, potência 2):</strong> v(x,y) = Σ wᵢvᵢ / Σ wᵢ, wᵢ = 1/dᵢ². Nunca sai do intervalo dos sensores. Só usa sensores com leitura atualizada; com menos de 3 pontos não colineares o mapa não é gerado. Fora do polígono entre os sensores o valor é extrapolado (hachurado).
          </li>
          <li>
            <strong>Médias e diferenças:</strong> calculadas sobre os pontos monitorados com leitura válida, depois de calcular DPV e orvalho por sensor. Não representam exatamente todo o espaço.
          </li>
          <li>
            <strong>Umidade do ar</strong> não é umidade do substrato nem hidratação das raízes.
          </li>
        </ul>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Pendências e recursos indisponíveis</h2>
        </div>
        {[
          ['Compra e instalação dos sensores', 'Ainda não confirmadas. Até lá, use a demonstração.'],
          ['Integração eWeLink', 'Depende de validar a documentação oficial atual, credenciais/aprovação do provedor, cotas e compatibilidade da ponte Zigbee.'],
          ['Modelo do Sonoff da bomba', 'Ainda precisa ser identificado; define como o estado do relé é lido.'],
          ['Comandos à bomba', 'Não implementado (versão somente de monitoramento). Exigirá aprovação específica.'],
          ['Posições reais dos sensores e aspersores', 'Provisórias; edite em Configurações.'],
          ['Frequência efetiva de envio', 'Os limites de atraso são iniciais; ajuste depois de observar os sensores.'],
          ['Notificações (push/e-mail)', 'Não implementadas.'],
          ['Limites de alerta reais', 'Definidos por você; os valores da demonstração são apenas ilustrativos.'],
        ].map(([t, d]) => (
          <div className="pending" key={t}>
            <Chip kind="warn">Pendente</Chip>
            <div>
              <strong>{t}</strong>
              <div className="small dim">{d}</div>
            </div>
          </div>
        ))}
      </section>
      <Notice>Fuso horário: datas são guardadas em UTC e exibidas em America/Sao_Paulo.</Notice>
    </main>
  );
}
