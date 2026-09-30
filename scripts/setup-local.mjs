#!/usr/bin/env node
// Prepara o ambiente local: cria apps/worker/.dev.vars com tokens ALEATÓRIOS (se ainda não existir),
// aplica as migrações no D1 local e gera o histórico de demonstração. Não publica nada.
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vars = resolve(root, 'apps/worker/.dev.vars');
const tok = () => randomBytes(24).toString('base64url');

if (!existsSync(vars)) {
  const admin = tok();
  const ingest = tok();
  writeFileSync(vars, `ADMIN_TOKEN=${admin}\nINGEST_TOKEN=${ingest}\n`, { mode: 0o600 });
  console.log('Criado apps/worker/.dev.vars (ignorado pelo git) com tokens aleatórios.');
  console.log(`  ADMIN_TOKEN  = ${admin}   (cole em Configurações → "Desbloquear edição")`);
  console.log(`  INGEST_TOKEN = ${ingest}   (usado pelos dispositivos/scripts de ingestão)`);
} else {
  console.log('apps/worker/.dev.vars já existe — mantido.');
}

const run = (args) => {
  const r = spawnSync('npm', args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(['run', 'db:migrate:local']);
run(['run', 'db:seed:demo', '--', '--reset']);
console.log('\nPronto. Rode: npm run dev   e abra http://localhost:8787');
