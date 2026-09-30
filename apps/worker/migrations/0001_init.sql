-- Orquidário Inteligente — esquema inicial (Cloudflare D1 / SQLite).
--
-- Todos os instantes são inteiros em milissegundos UTC (epoch).
-- A coluna `dataset` separa DEMONSTRAÇÃO ('demo') de MEDIÇÕES REAIS ('real'); os dois nunca se misturam.
-- Tabelas WITHOUT ROWID com a chave primária composta servem de índice: não há índices secundários,
-- o que reduz as linhas escritas (D1 cobra/limita linhas escritas, incluindo as de índices).

-- Leituras brutas. Chave (dataset, sensor, instante da medição) => a duplicidade é ignorada pelo banco.
CREATE TABLE readings (
  dataset       TEXT    NOT NULL CHECK (dataset IN ('demo', 'real')),
  sensor_id     TEXT    NOT NULL,
  measured_at   INTEGER NOT NULL,           -- instante da medição (da origem, se informado; senão = received_at)
  received_at   INTEGER NOT NULL,           -- instante em que o sistema recebeu
  time_basis    TEXT    NOT NULL CHECK (time_basis IN ('source', 'received')),
  temperature_c REAL    NOT NULL,
  humidity_pct  REAL    NOT NULL,
  battery_pct   REAL,                       -- NULL quando a integração não fornece
  link_quality  REAL,                       -- Zigbee LQI 0–255, NULL quando não fornecido
  rssi_dbm      REAL,
  source        TEXT    NOT NULL,
  PRIMARY KEY (dataset, sensor_id, measured_at)
) WITHOUT ROWID;

-- Agregado por hora (mantido a cada ingestão, recalculado a partir das leituras brutas: idempotente).
-- Mantido por mais tempo que as leituras brutas; é o que alimenta períodos longos.
CREATE TABLE readings_hourly (
  dataset    TEXT    NOT NULL CHECK (dataset IN ('demo', 'real')),
  sensor_id  TEXT    NOT NULL,
  hour_start INTEGER NOT NULL,              -- início da hora UTC
  t_avg REAL NOT NULL, t_min REAL NOT NULL, t_max REAL NOT NULL,
  h_avg REAL NOT NULL, h_min REAL NOT NULL, h_max REAL NOT NULL,
  n     INTEGER NOT NULL,
  PRIMARY KEY (dataset, sensor_id, hour_start)
) WITHOUT ROWID;

-- Transições de estado informadas pelo controlador (Sonoff). NÃO confirmam passagem de água.
CREATE TABLE relay_events (
  dataset     TEXT    NOT NULL CHECK (dataset IN ('demo', 'real')),
  device_id   TEXT    NOT NULL,
  changed_at  INTEGER NOT NULL,
  state       TEXT    NOT NULL CHECK (state IN ('on', 'off')),
  received_at INTEGER NOT NULL,
  source      TEXT    NOT NULL,
  PRIMARY KEY (dataset, device_id, changed_at)
) WITHOUT ROWID;

-- Último estado conhecido e última mensagem vista de cada relé.
CREATE TABLE relay_status (
  dataset       TEXT NOT NULL CHECK (dataset IN ('demo', 'real')),
  device_id     TEXT NOT NULL,
  last_state    TEXT CHECK (last_state IN ('on', 'off')),
  last_state_at INTEGER,
  last_seen_at  INTEGER,
  online        INTEGER,                    -- 1/0/NULL (desconhecido)
  PRIMARY KEY (dataset, device_id)
);

-- Configurações (JSON) e cursores internos, por dataset.
CREATE TABLE settings (
  dataset    TEXT    NOT NULL CHECK (dataset IN ('demo', 'real')),
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (dataset, key)
);
