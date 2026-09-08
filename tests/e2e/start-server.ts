import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../src/server/config.js";
import { buildApp } from "../../src/server/app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dbPath = path.resolve(root, process.env.DB_PATH ?? "runtime/e2e.sqlite");
const port = process.env.PORT ?? "8790";

async function main() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath);

  process.env.NODE_ENV = "production";
  process.env.APP_PROFILE = "test";
  process.env.AUTO_SEED = "1";
  process.env.DB_PATH = dbPath;
  process.env.BACKUP_DIR = path.resolve(root, "runtime/backups");
  process.env.HOUSEHOLD_TIMEZONE = process.env.HOUSEHOLD_TIMEZONE ?? "America/New_York";
  process.env.HOST = process.env.HOST ?? "127.0.0.1";
  process.env.PORT = port;
  process.env.PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`;
  process.env.EVAL_LAN_ACCESS = "0";

  if (!fs.existsSync(path.resolve(root, "dist/client/index.html"))) {
    console.error("dist/client missing — run npm run build first.");
    process.exit(1);
  }

  const config = loadConfig();
  const { app } = await buildApp(config);
  await app.listen({ host: config.host, port: config.port });
  console.log(`E2E server ready on http://${config.host}:${config.port}`);

  const shutdown = async (signal: string) => {
    console.log(`E2E server shutting down (${signal})`);
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
