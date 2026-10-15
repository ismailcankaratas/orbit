import { watch, type FSWatcher } from 'node:fs';
import type { WatcherState } from '@orbit/core';

export const DEBOUNCE_MS = 750;
export const FULL_DISCOVERY_MS = 60_000;

export interface WatcherOptions {
  root: string;
  intervalMs: () => number;
  /** Request an (incremental) scan. Must be cheap and coalescing. */
  onChange: () => void;
  /** Cheap stat-based check of already-known files. */
  knownFilesChanged: () => Promise<boolean>;
  /** Skip fs.watch entirely. */
  polling?: boolean;
}

/**
 * fs.watch(root, recursive) with a 750 ms debounce; on error/unsupported falls back
 * to a stat polling loop. A full discovery is requested at most every 60 s.
 */
export class Watcher {
  state: WatcherState = 'off';
  private fsw: FSWatcher | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private poll: NodeJS.Timeout | null = null;
  private safety: NodeJS.Timeout | null = null;
  private lastFull = Date.now();
  private stopped = true;

  constructor(private readonly opts: WatcherOptions) {}

  start(): void {
    this.stop();
    this.stopped = false;
    this.lastFull = Date.now();
    if (this.opts.polling) {
      this.fallbackToPolling();
      return;
    }
    try {
      this.fsw = watch(this.opts.root, { recursive: true, persistent: false }, () => this.schedule());
      this.fsw.on('error', () => this.fallbackToPolling());
      this.state = 'watching';
      this.safety = setInterval(() => this.fullDiscovery(), FULL_DISCOVERY_MS);
      this.safety.unref();
    } catch {
      this.fallbackToPolling();
    }
  }

  private schedule(): void {
    if (this.stopped) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      if (!this.stopped) {
        this.lastFull = Date.now();
        this.opts.onChange();
      }
    }, DEBOUNCE_MS);
    this.debounce.unref();
  }

  private fullDiscovery(): void {
    if (this.stopped) return;
    this.lastFull = Date.now();
    this.opts.onChange();
  }

  private fallbackToPolling(): void {
    if (this.poll) return;
    this.closeFsWatch();
    this.stopped = false;
    this.state = 'polling';
    const tick = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        if (Date.now() - this.lastFull >= FULL_DISCOVERY_MS || (await this.opts.knownFilesChanged())) {
          this.lastFull = Date.now();
          this.opts.onChange();
        }
      } catch {
        this.state = 'error';
      }
    };
    const every = Math.min(60_000, Math.max(2_000, this.opts.intervalMs()));
    this.poll = setInterval(() => void tick(), every);
    this.poll.unref();
  }

  private closeFsWatch(): void {
    if (this.fsw) {
      try {
        this.fsw.close();
      } catch {
        /* ignore */
      }
      this.fsw = null;
    }
    if (this.safety) clearInterval(this.safety);
    this.safety = null;
  }

  stop(): void {
    this.stopped = true;
    this.closeFsWatch();
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.state = 'off';
  }
}
