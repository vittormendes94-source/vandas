export type CsvCell = string | number | boolean | null | undefined;

export interface CsvOptions {
  /** Separador de campo. Padrão ",". Use ";" para Excel em pt-BR. */
  delimiter?: ',' | ';';
  /** Vírgula decimal (Excel pt-BR). */
  decimalComma?: boolean;
  /** BOM UTF-8 para o Excel reconhecer acentos. */
  bom?: boolean;
}

/** Neutraliza injeção de fórmula em planilhas: textos que começam com = + - @ (ou controle) recebem apóstrofo. */
export function neutralizeFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function cell(v: CsvCell, o: Required<CsvOptions>): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    const s = String(v);
    return o.decimalComma ? s.replace('.', ',') : s;
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = neutralizeFormula(v);
  const needsQuote = s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(o.delimiter) || (o.decimalComma && s.includes(','));
  return needsQuote ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvCell[][], options: CsvOptions = {}): string {
  const o: Required<CsvOptions> = { delimiter: options.delimiter ?? ',', decimalComma: options.decimalComma ?? false, bom: options.bom ?? true };
  const lines = [header, ...rows].map((r, i) => r.map((v) => (i === 0 ? cell(String(v), { ...o, decimalComma: false }) : cell(v, o))).join(o.delimiter));
  return (o.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}
