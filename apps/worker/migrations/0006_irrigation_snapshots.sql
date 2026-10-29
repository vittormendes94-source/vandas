-- Medições dos sensores perto de cada irrigação: ao ligar (valores de antes) e ~1 min depois de desligar.
-- JSON: [{"id": sensorId, "t": temperatura, "h": umidade, "m": instante da medição (ms)}]
ALTER TABLE irrigations ADD COLUMN before_json TEXT;
ALTER TABLE irrigations ADD COLUMN after_json TEXT;
ALTER TABLE irrigations ADD COLUMN before_at INTEGER;
ALTER TABLE irrigations ADD COLUMN after_at INTEGER;
