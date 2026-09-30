import { ewelinkAdapter } from './ewelink';
import type { SourceAdapter } from './types';

/** Adaptadores de dados REAIS registrados. O de demonstração é separado (src/demo.ts) e só grava em "demo". */
export const realAdapters: SourceAdapter[] = [ewelinkAdapter];
export { ewelinkAdapter };
export type { AdapterStatus, PollResult, SourceAdapter } from './types';
