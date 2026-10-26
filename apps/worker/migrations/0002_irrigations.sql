-- Irrigações: períodos em que o Sonoff da bomba foi visto LIGADO (leitura do eWeLink a cada 2 min).
-- Início = primeira leitura "ligada"; fim = primeira leitura "desligada" (cada um com até ~2 min de atraso).
-- ended_at NULL = em andamento. end_reason 'sem_sinal' = o Sonoff sumiu por mais de 30 min durante a irrigação;
-- nesse caso o fim registrado é o último instante em que foi visto ligado.
CREATE TABLE irrigations (
  started_at INTEGER NOT NULL PRIMARY KEY,
  ended_at   INTEGER,
  last_on_at INTEGER NOT NULL,
  end_reason TEXT CHECK (end_reason IN ('off', 'sem_sinal'))
) WITHOUT ROWID;
