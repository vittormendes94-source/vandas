-- Celulares inscritos para receber avisos (Web Push).
CREATE TABLE push_subscriptions (
  endpoint TEXT NOT NULL PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
