import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';

/**
 * Implementação mínima da API do D1 sobre `node:sqlite`, só para testes: executa o SQL REAL das migrações
 * e das consultas do Worker (SQLite), sem depender do runtime workerd. Não é usada em produção.
 */
class Stmt {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: unknown[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Stmt(this.db, this.sql, params);
  }
  private isRead() {
    return /^\s*(SELECT|WITH)/i.test(this.sql);
  }
  execSync() {
    const st = this.db.prepare(this.sql);
    const p = this.params as never[];
    if (this.isRead()) {
      const results = st.all(...p).map((r) => ({ ...(r as object) }));
      return { success: true, results, meta: { changes: 0 } };
    }
    const r = st.run(...p);
    return { success: true, results: [], meta: { changes: Number(r.changes) } };
  }
  async first<T = unknown>(): Promise<T | null> {
    const r = this.execSync();
    return (r.results[0] as T) ?? null;
  }
  async all<T = unknown>() {
    return this.execSync() as { success: boolean; results: T[]; meta: { changes: number } };
  }
  async run() {
    return this.execSync();
  }
}

export function createTestDb(): D1Database {
  const db = new DatabaseSync(':memory:');
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(resolve(dir, f), 'utf8'));
  const shim = {
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.execSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return shim as unknown as D1Database;
}
