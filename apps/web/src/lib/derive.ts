import type { Bucket, Reading } from '@orq/core';

/** Ponto de histórico → leitura, para reutilizar a lógica de instantes (replay). Sem recebimento/bateria/sinal. */
export function bucketToReading(b: Bucket, source = 'historico'): Reading {
  return {
    sensorId: b.sensorId,
    measuredAt: b.t,
    receivedAt: b.t,
    timeBasis: 'source',
    temperatureC: b.tAvg,
    humidityPct: b.hAvg,
    batteryPct: null,
    linkQuality: null,
    rssiDbm: null,
    source,
  };
}

/** Download de texto no navegador. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
