import { appendFileSync } from 'node:fs';
import { assistantLine, type ToolUseOpt, type UsageOpts } from './lines.js';

export type AppendRequestOpts = {
  sessionId: string;
  messageId: string;
  model?: string;
  timestamp?: string | null;
  cwd?: string;
  agentId?: string;
  usage: UsageOpts;
  tools?: ToolUseOpt[];
  text?: string;
  stopReason?: string | null;
  eol?: string;
};

/** Render one complete assistant line (no trailing newline). */
export function renderRequestLine(o: AppendRequestOpts): string {
  return assistantLine({
    sessionId: o.sessionId,
    uuid: `append-${o.messageId}`,
    timestamp: o.timestamp === undefined ? new Date().toISOString() : o.timestamp,
    cwd: o.cwd,
    agentId: o.agentId,
    messageId: o.messageId,
    requestId: `req_append_${o.messageId}`,
    model: o.model ?? 'claude-sonnet-5-5',
    usage: o.usage,
    tools: o.tools,
    text: o.text ?? 'PRIVATE_CANARY_900 appended reply',
    stopReason: o.stopReason === undefined ? 'end_turn' : o.stopReason,
  });
}

/** Append one complete line (with eol) to an existing JSONL file. */
export function appendRequest(filePath: string, opts: AppendRequestOpts): void {
  appendFileSync(filePath, renderRequestLine(opts) + (opts.eol ?? '\n'));
}

/** Append raw text without a newline (simulates a partially flushed line). */
export function appendPartial(filePath: string, text: string): void {
  appendFileSync(filePath, text);
}
