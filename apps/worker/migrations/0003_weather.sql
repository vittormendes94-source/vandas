-- Cache do clima da cidade (Open-Meteo): uma linha por local. Evita consultar o serviço a cada tela aberta.
CREATE TABLE weather_cache (
  place_key TEXT NOT NULL PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  payload TEXT NOT NULL
) WITHOUT ROWID;
