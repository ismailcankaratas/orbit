import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canary } from './canaries.js';
import { assistantLine, resolveCache, summaryLine, systemLine, userLine, type ToolUseOpt } from './lines.js';
import type { ExpectedTotals } from './types.js';

/** Models the generator treats as unpriced. Everything else is assumed to be in the rate schedule. */
export const UNKNOWN_MODELS: ReadonlySet<string> = new Set(['acme-unknown-model', 'model-unsupported-for-test']);

export const encodeProject = (cwd: string): string => cwd.replace(/\//g, '-');

export class FileBuf {
  readonly lines: string[] = [];
  eol = '\n';
  /** Raw text appended after the last newline (partial line). */
  tail = '';
  constructor(
    readonly rel: string,
    readonly kind: 'main' | 'agent' | 'meta',
    readonly sessionId: string,
    readonly cwd: string | undefined,
    readonly agentId: string | undefined,
  ) {}
  render(): string {
    return this.lines.map((l) => l + this.eol).join('') + this.tail;
  }
  /** Bytes as written to disk: INVALID_UTF8_SENTINEL is replaced by bytes that are not valid UTF-8. */
  renderBytes(): Buffer {
    const text = Buffer.from(this.render(), 'utf8');
    if (!text.includes(INVALID_UTF8_SENTINEL)) return text;
    const parts: Buffer[] = [];
    let from = 0;
    for (;;) {
      const i = text.indexOf(INVALID_UTF8_SENTINEL, from);
      if (i === -1) break;
      parts.push(text.subarray(from, i), Buffer.from([0xff, 0xfe, 0xc3, 0x28]));
      from = i + INVALID_UTF8_SENTINEL.length;
    }
    parts.push(text.subarray(from));
    return Buffer.concat(parts);
  }
}

/** ASCII marker used inside generated text; replaced with invalid UTF-8 bytes when written. */
export const INVALID_UTF8_SENTINEL = '@@INVALID_UTF8@@';

export type ToolSpec = { id?: string; name: 'Agent' | 'Task' | 'Bash'; role?: string };

export type ReqSpec = {
  id?: string;
  model?: string;
  input: number;
  output: number;
  cacheRead?: number;
  cw5?: number;
  cw1?: number;
  cwAgg?: number;
  noCacheFields?: boolean;
  /** Explicit streaming snapshot outputs; last value must equal `output`. */
  outputs?: number[];
  snapshots?: number;
  /** undefined => auto clock; null => omit timestamp. */
  ts?: string | null;
  tools?: ToolSpec[];
  text?: string;
  /** false => written to the file but NOT counted (e.g. partial line). */
  count?: boolean;
};

type ChildRecord = { toolUseId: string | null; inferred: boolean };

export class Tree {
  readonly files = new Map<string, FileBuf>();
  private clock = Date.parse('2026-09-01T10:00:00.000Z');
  private canaryN = 0;
  private idN = 0;
  private readonly toolIds = new Set<string>();
  private readonly children: ChildRecord[] = [];
  private readonly projects = new Set<string>();
  private readonly sessions = new Set<string>();
  private malformed = 0;
  private readonly acc = { reqs: 0, unk: 0, input: 0, output: 0, cr: 0, c5: 0, c1: 0, unsplit: 0 };

  constructor(readonly prefix = 'fx') {}

  canary(): string {
    return canary(++this.canaryN);
  }
  id(kind: string): string {
    return `${kind}_${this.prefix}_${String(++this.idN).padStart(3, '0')}`;
  }
  setClock(iso: string): void {
    this.clock = Date.parse(iso);
  }
  tick(ms = 2000): string {
    this.clock += ms;
    return new Date(this.clock).toISOString();
  }

  /** Create a main session file with summary/user/system preamble lines. */
  main(cwd: string, sessionId: string, opts: { preamble?: boolean; eol?: string } = {}): FileBuf {
    const rel = join(encodeProject(cwd), `${sessionId}.jsonl`);
    const f = new FileBuf(rel, 'main', sessionId, cwd, undefined);
    if (opts.eol) f.eol = opts.eol;
    this.files.set(rel, f);
    this.projects.add(cwd);
    this.sessions.add(`${cwd}\0${sessionId}`);
    if (opts.preamble !== false) {
      f.lines.push(summaryLine({ text: `${this.canary()} earlier session summary`, leafUuid: this.id('uuid') }));
      f.lines.push(
        userLine({
          sessionId,
          uuid: this.id('uuid'),
          timestamp: this.tick(),
          cwd,
          text: `${this.canary()} please refactor module. api_key=sk-ant-FAKE0000`,
        }),
      );
      f.lines.push(
        systemLine({ sessionId, uuid: this.id('uuid'), timestamp: this.tick(), cwd, text: `${this.canary()} system notice` }),
      );
    }
    return f;
  }

  /** Create a subagent file + meta file. `toolUseId: null` writes no toolUseId in meta. */
  child(
    cwd: string,
    sessionId: string,
    agentId: string,
    o: { role: string; toolUseId: string | null; depth?: number; inferred?: boolean },
  ): FileBuf {
    const dir = join(encodeProject(cwd), sessionId, 'subagents');
    const f = new FileBuf(join(dir, `agent-${agentId}.jsonl`), 'agent', sessionId, undefined, agentId);
    this.files.set(f.rel, f);
    const meta = new FileBuf(join(dir, `agent-${agentId}.meta.json`), 'meta', sessionId, undefined, agentId);
    const m: Record<string, unknown> = { agentId, agentType: o.role, spawnDepth: o.depth ?? 1 };
    if (o.toolUseId !== null) m.toolUseId = o.toolUseId;
    meta.lines.push(JSON.stringify(m));
    this.files.set(meta.rel, meta);
    this.children.push({ toolUseId: o.toolUseId, inferred: o.inferred === true });
    return f;
  }

  /** Append a complete-but-invalid JSON line. Counted as malformed. */
  malformedLine(f: FileBuf, text = `{"type":"assistant","message":{"id":"${this.canary()}","usage":{"input_tokens":`): void {
    f.lines.push(text);
    this.malformed++;
  }

  /** Append an assistant request (one or more streaming snapshot lines). */
  req(f: FileBuf, s: ReqSpec): { messageId: string; toolIds: string[] } {
    const messageId = s.id ?? this.id('msg');
    const model = s.model ?? 'claude-sonnet-5-5';
    const tools: ToolUseOpt[] = (s.tools ?? []).map((t) => {
      const id = t.id ?? this.id('toolu');
      if (t.name === 'Bash') {
        return {
          id,
          name: 'Bash',
          input: { command: `echo ${this.canary()} && curl -H "x-api-key: sk-ant-FAKE0000" https://example.invalid/`, description: this.canary() },
        };
      }
      this.toolIds.add(id);
      return {
        id,
        name: t.name,
        input: { subagent_type: t.role ?? 'general-purpose', description: this.canary(), prompt: `${this.canary()} do the task. password=hunter2-FAKE` },
      };
    });
    const n = s.outputs ? s.outputs.length : (s.snapshots ?? 1);
    const outs: number[] = [];
    for (let i = 0; i < n; i++) {
      if (s.outputs) outs.push(s.outputs[i] as number);
      else if (i === n - 1) outs.push(s.output);
      else outs.push(Math.max(1, Math.min(s.output - 1, Math.floor((s.output * (i + 1)) / (n + 1)))));
    }
    const text = s.text ?? `${this.canary()} assistant reply. password=hunter2-FAKE`;
    const ts = s.ts === undefined ? this.tick() : s.ts;
    const requestId = this.id('req');
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      f.lines.push(
        assistantLine({
          sessionId: f.sessionId,
          uuid: this.id('uuid'),
          timestamp: ts === null ? null : i === 0 || s.ts !== undefined ? ts : this.tick(1000),
          cwd: f.cwd,
          agentId: f.agentId,
          messageId,
          requestId,
          model,
          usage: {
            input: s.input,
            output: outs[i] as number,
            cacheRead: s.cacheRead,
            cacheWriteAgg: s.cwAgg,
            cacheWrite5m: s.cw5,
            cacheWrite1h: s.cw1,
            omitCacheFields: s.noCacheFields,
          },
          tools,
          text,
          stopReason: last ? (tools.some((t) => t.name !== 'Bash') ? 'tool_use' : 'end_turn') : null,
        }),
      );
    }
    if (s.count !== false) {
      const c = resolveCache({ input: s.input, output: s.output, cacheRead: s.cacheRead, cacheWriteAgg: s.cwAgg, cacheWrite5m: s.cw5, cacheWrite1h: s.cw1, omitCacheFields: s.noCacheFields });
      this.acc.reqs++;
      if (UNKNOWN_MODELS.has(model)) this.acc.unk++;
      this.acc.input += s.input;
      this.acc.output += s.output;
      this.acc.cr += s.noCacheFields ? 0 : (s.cacheRead ?? 0);
      this.acc.c5 += c.c5;
      this.acc.c1 += c.c1;
      this.acc.unsplit += c.unsplit;
    }
    return { messageId, toolIds: tools.map((t) => t.id) };
  }

  totals(): ExpectedTotals {
    let exact = 0;
    let inferred = 0;
    let unlinked = 0;
    for (const c of this.children) {
      if (c.toolUseId !== null && this.toolIds.has(c.toolUseId)) exact++;
      else if (c.toolUseId === null && c.inferred) inferred++;
      else unlinked++;
    }
    return {
      uniqueRequests: this.acc.reqs,
      uncachedInput: this.acc.input,
      output: this.acc.output,
      cacheRead: this.acc.cr,
      cacheWrite5m: this.acc.c5,
      cacheWrite1h: this.acc.c1,
      unsplitCacheWrite: this.acc.unsplit,
      exactLinks: exact,
      inferredLinks: inferred,
      unlinkedAgents: unlinked,
      unknownModelRequests: this.acc.unk,
      malformedLines: this.malformed,
      projects: this.projects.size,
      sessions: this.sessions.size,
    };
  }

  writeTo(root: string): void {
    for (const f of this.files.values()) {
      const p = join(root, f.rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.renderBytes());
    }
  }
}
