-- Ações da automação da bomba (ligar/desligar/Inching), com o motivo e se o Sonoff aceitou.
CREATE TABLE automation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('on', 'off', 'inching')),
  reason TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX automation_log_at ON automation_log (at);
