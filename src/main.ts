import { buildApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './migrate.js';
import { runSeed } from './seed.js';

async function main() {
  const applied = await runMigrations();
  if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
  await runSeed();
  console.log('seed ok');
  const app = await buildApp({ logger: true });
  const close = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
  await app.listen({ host: '0.0.0.0', port: config.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
