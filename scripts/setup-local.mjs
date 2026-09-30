#!/usr/bin/env node
// Prepara o ambiente local: cria apps/worker/.dev.vars com tokens ALEATÓRIOS (se ainda não existir) e aplica as
// migrações no D1 local. Não publica nada e não cria nenhum dado.
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
  writeFileSync(
    vars,
    `ADMIN_TOKEN=${admin}\nINGEST_TOKEN=${tok()}\n# Credencial do app eWeLink (dev.ewelink.cc):\n# EWELINK_APP_ID=\n# EWELINK_APP_SECRET=\n`,
    { mode: 0o600 },
  );
  console.log('Criado apps/worker/.dev.vars (ignorado pelo git) com tokens aleatórios.');
  console.log(`  ADMIN_TOKEN = ${admin}   (cole em Configurações → "Acesso para editar")`);
} else {
  console.log('apps/worker/.dev.vars já existe — mantido.');
}

const r = spawnSync('npm', ['run', 'db:migrate:local'], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('\nPronto. Rode: npm run dev   e abra http://localhost:8787');
