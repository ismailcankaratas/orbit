import { access, realpath, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { stat as statCb } from 'node:fs';
import type { ZodError } from 'zod';
import type {
  DatasetMode,
  RateSchedule,
  ScanState,
  SettingsDTO,
  SettingsPatch,
  SseEvent,
  StatusDTO,
} from '@orbit/core';
import { ensureDataDir, redactPath, type ServerConfig } from './config/index.js';
import { isForbiddenSourceRoot } from './security/sourceRoot.js';
import { patchSchema, SettingsStore, validateRateOverrides, type StoredSettings } from './config/settings.js';
import { Store } from './db/index.js';
import { HttpError } from './errors.js';
import { demoSourceDir, ensureDemoSource } from './demo/index.js';
import { repriceIfNeeded } from './scanner/pricing.js';
import { runScan, ScanError, type ScanStats } from './scanner/scan.js';
import { Watcher } from './watcher/index.js';

export type Listener = (e: SseEvent) => void;

export interface RuntimeOptions {
  clock?: () => number;
  /** Skip fs.watch and use the stat polling loop (tests / unsupported platforms). */
  forcePolling?: boolean;
}

const MANUAL_SCAN_MIN_GAP_MS = 3000;

export class Runtime {
  readonly settings: SettingsStore;
  readonly clock: () => number;
  /** Read aggregates from the maintained rollup when it is clean (tests flip this to compare against direct queries). */
  rollupEnabled = true;
  private readonly forcePolling: boolean;
  private real: Store;
  private demo: Store | null = null;
  private revisionN = 1;
  private scanState: ScanState = {
    state: 'idle',
    startedAt: null,
    finishedAt: null,
    filesTotal: 0,
    filesDone: 0,
    lastError: null,
  };
  private current: Promise<void> | null = null;
  private rerun = false;
  private lastManualAt = 0;
  private autoScanPaused = false;
  private watcher: Watcher | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(
    readonly config: ServerConfig,
    opts: RuntimeOptions = {},
  ) {
    this.clock = opts.clock ?? Date.now;
    this.forcePolling = opts.forcePolling ?? false;
    ensureDataDir(config.dataDir);
    this.settings = new SettingsStore(config.dataDir);
    this.real = new Store('real', config.dataDir);
  }

  /* ---------- basics ---------- */

  get revision(): number {
    return this.revisionN;
  }

  get watcherState(): StatusDTO['watcher'] {
    return this.watcher?.state ?? 'off';
  }

  get activeDataset(): 'real' | 'demo' {
    return this.settings.get().activeDataset;
  }

  mode(): DatasetMode {
    const s = this.settings.get();
    if (s.activeDataset === 'demo') return 'demo';
    return s.consentGranted ? 'real' : 'none';
  }

  /** The store queries read from. Demo and real never mix. */
  store(): Store {
    if (this.activeDataset === 'demo') return this.demoStore();
    return this.real;
  }

  realStore(): Store {
    return this.real;
  }

  private demoStore(): Store {
    if (!this.demo) this.demo = new Store('demo', this.config.dataDir);
    return this.demo;
  }

  schedule(): RateSchedule {
    return this.settings.schedule();
  }

  sourceRoot(): string {
    return this.settings.get().sourceRoot ?? this.config.defaultSourceRoot;
  }

  sourceLabel(): string | null {
    const s = this.settings.get();
    if (s.activeDataset === 'demo') return null;
    return redactPath(this.sourceRoot());
  }

  /** True once a scan of the active store has completed. */
  hasScanned(): boolean {
    return this.store().getMeta('last_scan') !== null;
  }

  lastScan(): ScanStats | null {
    const raw = this.store().getMeta('last_scan');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ScanStats;
    } catch {
      return null;
    }
  }

  /* ---------- events ---------- */

  /** Number of live SSE subscribers (diagnostics/tests). */
  listenerCount(): number {
    return this.listeners.size;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(e: SseEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        /* a broken client must not break the scanner */
      }
    }
  }

  /** Invalidate clients after a local write (e.g. alias change). */
  notifyChanged(changedProjects: string[] = []): void {
    this.bump(changedProjects);
  }

  private bump(changedProjects: string[] = []): void {
    this.revisionN += 1;
    this.emit({ event: 'usage.updated', data: { revision: this.revisionN, changedProjects } });
  }

  /* ---------- status / settings DTOs ---------- */

  status(): StatusDTO {
    const s = this.settings.get();
    return {
      mode: this.mode(),
      consentGranted: s.consentGranted,
      sourceLabel: this.sourceLabel(),
      archiveEnabled: s.archiveEnabled,
      scan: { ...this.scanState },
      watcher: this.watcherState,
      lastScanAt: this.lastScan()?.finishedAt ?? null,
      revision: this.revisionN,
      version: this.config.version,
    };
  }

  settingsDTO(): SettingsDTO {
    const s = this.settings.get();
    return {
      consentGranted: s.consentGranted,
      sourceLabel: redactPath(this.sourceRoot()),
      sourceIsDefault: s.sourceRoot === null,
      archiveEnabled: s.archiveEnabled,
      watchIntervalMs: s.watchIntervalMs,
      locale: s.locale,
      timezone: s.timezone,
      activeDataset: s.activeDataset,
      rateOverrides: s.rateOverrides,
      dataDirLabel: redactPath(this.config.dataDir),
    };
  }

  /* ---------- scanning ---------- */

  private target(): { store: Store; root: string; archive: boolean } | null {
    const s = this.settings.get();
    if (s.activeDataset === 'demo') {
      ensureDemoSource(this.config.dataDir);
      return { store: this.demoStore(), root: demoSourceDir(this.config.dataDir), archive: false };
    }
    if (!s.consentGranted) return null;
    return { store: this.real, root: this.sourceRoot(), archive: s.archiveEnabled };
  }

  /** Request a scan; coalesces with an in-flight scan (which then reruns once). Resolves when all queued work is done. */
  scan(): Promise<void> {
    if (this.current) {
      this.rerun = true;
      return this.current;
    }
    const run = async (): Promise<void> => {
      do {
        this.rerun = false;
        await this.doScan();
      } while (this.rerun);
    };
    this.current = run().finally(() => {
      this.current = null;
    });
    return this.current;
  }

  private async doScan(): Promise<void> {
    let t;
    try {
      t = this.target();
    } catch {
      this.scanState = { ...this.scanState, state: 'error', lastError: 'INTERNAL' };
      return;
    }
    if (!t) return;
    const startedAt = new Date(this.clock()).toISOString();
    this.scanState = { state: 'scanning', startedAt, finishedAt: null, filesTotal: 0, filesDone: 0, lastError: null };
    this.emit({ event: 'scan.updated', data: { revision: this.revisionN, state: 'scanning' } });
    let changedProjects: string[] = [];
    let changed = false;
    try {
      const res = await runScan({
        store: t.store,
        root: t.root,
        archive: t.archive,
        schedule: this.schedule(),
        now: this.clock,
        onProgress: (done, total) => {
          this.scanState = { ...this.scanState, filesDone: done, filesTotal: total };
        },
      });
      changed = res.changed;
      changedProjects = res.changedProjects;
      this.scanState = { ...this.scanState, state: 'idle', finishedAt: new Date(this.clock()).toISOString(), lastError: null };
    } catch (e) {
      const code = e instanceof ScanError ? e.code : 'INTERNAL';
      this.scanState = { ...this.scanState, state: 'error', finishedAt: new Date(this.clock()).toISOString(), lastError: code };
    }
    if (changed) this.bump(changedProjects);
    this.emit({ event: 'scan.updated', data: { revision: this.revisionN, state: this.scanState.state } });
    this.emit({ event: 'diagnostics.updated', data: { revision: this.revisionN } });
  }

  /** Watcher-triggered scan; honours the pause set by an archive purge. */
  private autoScan(): void {
    if (this.autoScanPaused) return;
    void this.scan();
  }

  /** Manual rescan. Throws HttpError for consent / rate limit. */
  manualScan(): ScanState {
    const s = this.settings.get();
    if (s.activeDataset === 'real' && !s.consentGranted) {
      throw new HttpError(403, 'CONSENT_REQUIRED', 'Scanning requires your explicit consent first.');
    }
    const now = this.clock();
    if (now - this.lastManualAt < MANUAL_SCAN_MIN_GAP_MS) {
      throw new HttpError(429, 'RATE_LIMITED', 'Please wait a few seconds before rescanning.', true);
    }
    this.lastManualAt = now;
    this.autoScanPaused = false;
    void this.scan();
    return { ...this.scanState, state: 'scanning' };
  }

  /* ---------- watcher ---------- */

  private async knownFilesChanged(): Promise<boolean> {
    const s = this.settings.get();
    if (s.activeDataset !== 'real' || !s.consentGranted) return false;
    const root = await realpath(this.sourceRoot());
    const rows = this.real.all<{ rel_path: string; size: number; mtime_ms: number; ino: number | null; present: number }>(
      'SELECT rel_path, size, mtime_ms, ino, present FROM source_files WHERE present = 1',
    );
    for (const r of rows) {
      const st = await new Promise<import('node:fs').Stats | null>((res) =>
        statCb(join(root, r.rel_path), (err, v) => res(err ? null : v)),
      );
      if (!st || st.size !== r.size || st.mtimeMs !== r.mtime_ms || st.ino !== r.ino) return true;
    }
    return false;
  }

  syncWatcher(): void {
    const s = this.settings.get();
    this.watcher?.stop();
    this.watcher = null;
    if (s.activeDataset !== 'real' || !s.consentGranted) return;
    this.watcher = new Watcher({
      root: this.sourceRoot(),
      intervalMs: () => this.settings.get().watchIntervalMs,
      onChange: () => this.autoScan(),
      knownFilesChanged: () => this.knownFilesChanged(),
      polling: this.forcePolling,
    });
    this.watcher.start();
  }

  /** Begin background operation (called by main.ts, not by tests). */
  start(): void {
    if (this.mode() === 'demo' || this.mode() === 'real') void this.scan();
    this.syncWatcher();
  }

  async stop(): Promise<void> {
    this.watcher?.stop();
    this.watcher = null;
    await this.current?.catch(() => undefined);
    this.real.close();
    this.demo?.close();
  }

  /* ---------- settings mutation ---------- */

  private async resolveSourceRoot(input: string): Promise<string> {
    if (input.includes('\0') || !isAbsolute(input)) {
      throw new HttpError(400, 'INVALID_FILTER', 'sourceRoot must be an absolute directory path.');
    }
    const notAllowed = (): HttpError =>
      new HttpError(400, 'SOURCE_NOT_ALLOWED', 'This folder cannot be used as a source (home folder, system, credential or Orbit data folders are blocked).');
    const policy = { dataDir: this.config.dataDir };
    if (isForbiddenSourceRoot(input, policy)) throw notAllowed();
    let real: string;
    try {
      real = await realpath(input);
      if (isForbiddenSourceRoot(real, policy)) throw notAllowed();
      const st = await stat(real);
      if (!st.isDirectory()) throw new HttpError(400, 'SOURCE_NOT_FOUND', 'The selected source is not a directory.');
      await access(real, fsConstants.R_OK);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        throw new HttpError(400, 'PERMISSION_DENIED', 'The selected source directory is not readable.');
      }
      throw new HttpError(400, 'SOURCE_NOT_FOUND', 'The selected source directory does not exist.');
    }
    return real;
  }

  async patchSettings(raw: unknown): Promise<SettingsDTO> {
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) throw zodToHttp(parsed.error);
    const body = parsed.data as SettingsPatch;
    const before = this.settings.get();
    const next: Partial<StoredSettings> = {};

    if (body.rateOverrides !== undefined) {
      try {
        next.rateOverrides = validateRateOverrides(body.rateOverrides);
      } catch {
        throw new HttpError(400, 'INVALID_FILTER', 'Invalid rate overrides (check model ids, rates and date intervals).');
      }
    }
    let rootChanged = false;
    if (body.sourceRoot !== undefined) {
      const resolved = body.sourceRoot === 'default' ? null : await this.resolveSourceRoot(body.sourceRoot);
      if (resolved !== before.sourceRoot) {
        rootChanged = true;
        next.sourceRoot = resolved;
      }
    }
    for (const k of ['consentGranted', 'archiveEnabled', 'watchIntervalMs', 'locale', 'timezone', 'activeDataset'] as const) {
      if (body[k] !== undefined) (next as Record<string, unknown>)[k] = body[k];
    }

    if (rootChanged) {
      await this.current?.catch(() => undefined);
      this.real.clearData();
    }
    this.settings.update(next);
    const after = this.settings.get();

    if (next.rateOverrides) {
      repriceIfNeeded(this.store(), this.schedule());
      this.bump([]);
    }
    if (rootChanged) {
      this.autoScanPaused = false;
      this.bump([]);
    }
    if (next.consentGranted === true) this.autoScanPaused = false;

    const datasetChanged = after.activeDataset !== before.activeDataset;
    if (datasetChanged && after.activeDataset === 'demo') {
      await this.scan(); // demo is small; the UI expects data on return
      this.bump([]);
    } else if (datasetChanged) {
      this.bump([]);
    }

    const needsRealScan =
      after.activeDataset === 'real' &&
      after.consentGranted &&
      (rootChanged || next.consentGranted === true || next.archiveEnabled !== undefined || datasetChanged);
    this.syncWatcher();
    if (needsRealScan) void this.scan();
    return this.settingsDTO();
  }

  /** Deletes ONLY Orbit's real database. Source files are never touched. */
  async purgeArchive(): Promise<void> {
    await this.current?.catch(() => undefined);
    this.real.destroy();
    this.real = new Store('real', this.config.dataDir);
    this.autoScanPaused = true;
    this.scanState = { ...this.scanState, state: 'idle', filesDone: 0, filesTotal: 0, lastError: null };
    this.bump([]);
    this.emit({ event: 'diagnostics.updated', data: { revision: this.revisionN } });
  }
}

export function zodToHttp(e: ZodError): HttpError {
  const fields = [...new Set(e.issues.map((i) => String(i.path[0] ?? 'body')))].slice(0, 5).join(', ');
  return new HttpError(400, 'INVALID_FILTER', `Invalid request: ${fields}`);
}
