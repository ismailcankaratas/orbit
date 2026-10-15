import type { ParseWarning } from '../schemas/types.js';
import { makeWarning, parseLineDetailed, type ParseLineDetailed } from './parseLine.js';
import type { JsonlLine } from './readJsonl.js';

/** Parse a line produced by readJsonlIncrement, adding reader-level warnings (too long, invalid UTF-8). */
export function parseJsonlLine(line: JsonlLine): ParseLineDetailed {
  if (line.tooLong) {
    const w = makeWarning('LINE_TOO_LONG', line.offset);
    return { result: { kind: 'warning', warning: w }, warnings: [w] };
  }
  const d = parseLineDetailed(line.text, line.offset);
  if (line.invalidUtf8) {
    const extra: ParseWarning = makeWarning('INVALID_UTF8', line.offset);
    return { result: d.result, warnings: [extra, ...d.warnings] };
  }
  return d;
}
