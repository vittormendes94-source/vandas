// Persistência em disco: fila de leituras ainda não confirmadas pelo servidor e estado dos sensores.
// Gravação atômica (arquivo temporário + rename) para não corromper em queda de energia.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** ~23 dias de 3 sensores informando a cada 2 min. Acima disso, descarta as mais antigas (e avisa). */
export const QUEUE_MAX = 50_000;

export class JsonFile {
  constructor(dir, name) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, name);
  }

  read(fallback) {
    try {
      return JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      return fallback;
    }
  }

  write(value) {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, this.path);
  }
}

export class ReadingQueue {
  constructor(file, log = () => {}) {
    this.file = file;
    this.log = log;
    const items = file.read([]);
    this.items = Array.isArray(items) ? items : [];
  }

  get size() {
    return this.items.length;
  }

  push(reading) {
    this.items.push(reading);
    if (this.items.length > QUEUE_MAX) {
      const dropped = this.items.length - QUEUE_MAX;
      this.items.splice(0, dropped);
      this.log(`Fila cheia: ${dropped} leitura(s) mais antiga(s) descartada(s).`);
    }
    this.file.write(this.items);
  }

  peek(n) {
    return this.items.slice(0, n);
  }

  /** Remove as `n` primeiras (confirmadas pelo servidor). */
  drop(n) {
    if (n <= 0) return;
    this.items.splice(0, n);
    this.file.write(this.items);
  }
}
