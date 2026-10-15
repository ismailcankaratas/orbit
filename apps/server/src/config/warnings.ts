/**
 * Suppress ONLY node:sqlite's ExperimentalWarning (ADR-001 #1). All other
 * warnings keep flowing. Idempotent.
 */
let installed = false;

export function suppressSqliteExperimentalWarning(): void {
  if (installed) return;
  installed = true;
  const original = process.emitWarning.bind(process) as (...args: unknown[]) => void;
  process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    const first = rest[0];
    const type =
      typeof first === 'string'
        ? first
        : first && typeof first === 'object' && 'type' in first
          ? String((first as { type?: unknown }).type)
          : warning instanceof Error
            ? warning.name
            : '';
    const message = warning instanceof Error ? warning.message : String(warning);
    if (type === 'ExperimentalWarning' && /sqlite/i.test(message)) return;
    original(warning, ...rest);
  }) as typeof process.emitWarning;
}
