import { suppressSqliteExperimentalWarning } from './config/warnings.js';
suppressSqliteExperimentalWarning();

import { buildApp } from './app.js';
import { DataDirError, loadConfig } from './config/index.js';

process.umask(0o077);

async function main(): Promise<void> {
  const config = loadConfig();
  let app: Awaited<ReturnType<typeof buildApp>>;
  try {
    app = await buildApp({ config });
  } catch (e) {
    console.error(e instanceof DataDirError ? e.message : 'Orbit could not start (internal error).');
    process.exit(1);
  }
  const shutdown = (): void => {
    void app.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  try {
    // Loopback only. There is deliberately no host override in v0.1.
    await app.listen({ host: config.host, port: config.port });
  } catch {
    console.error(`Orbit could not start: port ${config.port} is unavailable (set ORBIT_PORT).`);
    process.exit(1);
  }
  app.orbit.start();
  console.info(`Orbit running at http://127.0.0.1:${config.port}`);
}

void main();
