-- Orquidário Inteligente — esquema (Cloudflare D1 / SQLite). Somente dados reais.
-- Instantes em milissegundos UTC (epoch). Tabelas WITHOUT ROWID com chave primária composta: sem índices extras
-- (D1 conta linhas escritas, incluindo as de índices).

-- Leituras de temperatura/umidade. Chave (sensor, instante da medição) => repetição é ignorada pelo banco.
CREATE TABLE readings (
  sensor_id     TEXT    NOT NULL,
  measured_at   INTEGER NOT NULL,           -- instante da medição informado pela origem (eWeLink: trigTime)
  received_at   INTEGER NOT NULL,           -- instante em que o sistema recebeu
  time_basis    TEXT    NOT NULL CHECK (time_basis IN ('source', 'received')),
  temperature_c REAL    NOT NULL,
  humidity_pct  REAL    NOT NULL,
  battery_pct   REAL,                       -- NULL quando a origem não informa
  link_quality  REAL,
  rssi_dbm      REAL,
  source        TEXT    NOT NULL,
  PRIMARY KEY (sensor_id, measured_at)
) WITHOUT ROWID;

-- Agregado por hora, recalculado a partir das leituras brutas (idempotente). Mantido por mais tempo.
CREATE TABLE readings_hourly (
  sensor_id  TEXT    NOT NULL,
  hour_start INTEGER NOT NULL,
  t_avg REAL NOT NULL, t_min REAL NOT NULL, t_max REAL NOT NULL,
  h_avg REAL NOT NULL, h_min REAL NOT NULL, h_max REAL NOT NULL,
  n     INTEGER NOT NULL,
  PRIMARY KEY (sensor_id, hour_start)
) WITHOUT ROWID;

-- Último estado conhecido de cada dispositivo do provedor (eWeLink). Uma linha por dispositivo, sobrescrita
-- a cada leitura da integração: NÃO é histórico. Serve para vincular sensores/bomba e para o estado da bomba.
CREATE TABLE provider_devices (
  provider      TEXT    NOT NULL,
  device_id     TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  uiid          INTEGER,
  model         TEXT,
  online        INTEGER,                    -- 1/0/NULL
  kind          TEXT    NOT NULL CHECK (kind IN ('climate', 'switch', 'unsupported')),
  temperature_c REAL,
  humidity_pct  REAL,
  battery_pct   REAL,
  rssi_dbm      REAL,
  switch_state  TEXT CHECK (switch_state IN ('on', 'off')),
  switches_json TEXT,                       -- estados por canal (Sonoff multicanal)
  measured_at   INTEGER,
  seen_at       INTEGER NOT NULL,           -- leitura bem-sucedida da integração que incluiu o dispositivo
  PRIMARY KEY (provider, device_id)
);

-- Configuração (JSON), credenciais cifradas da integração, estado da integração.
CREATE TABLE settings (
  key        TEXT    NOT NULL PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);
