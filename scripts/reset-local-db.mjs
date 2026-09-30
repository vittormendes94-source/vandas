#!/usr/bin/env node
// Apaga o estado LOCAL do D1 (apps/worker/.wrangler/state). Não afeta nenhum banco remoto.
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/worker/.wrangler/state');
rmSync(dir, { recursive: true, force: true });
console.log('Estado local do D1 removido. Rode `npm run setup` para recriar.');
