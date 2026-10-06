import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../src/server/config.js";
import { buildApp } from "../../src/server/app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dbPath = path.resolve(root, process.env.DB_PATH ?? "runtime/e2e.sqlite");
const port = process.env.PORT ?? "8790";
const preserveDb = process.env.E2E_PRESERVE_DB === "1";
const restartFlagPath = path.resolve(
  path.dirname(dbPath),
  `.e2e-restart-${port}`,
);
const wipeFlagPath = path.resolve(path.dirname(dbPath), `.e2e-wipe-${port}`);
const generationPath = path.resolve(
  path.dirname(dbPath),
  `.e2e-gen-${port}`,
);

type Listening = {
  app: Awaited<ReturnType<typeof buildApp>>["app"];
};

let current: Listening | null = null;
let restartInFlight: Promise<void> | null = null;

function bumpListenGeneration(): number {
  const prev = fs.existsSync(generationPath)
    ? Number(fs.readFileSync(generationPath, "utf8")) || 0
    : 0;
  const next = prev + 1;
  fs.writeFileSync(generationPath, `${next}\n`, "utf8");
  return next;
}

async function listenFresh(): Promise<Listening> {
  process.env.NODE_ENV = "production";
  process.env.APP_PROFILE = "test";
  process.env.AUTO_SEED = process.env.AUTO_SEED ?? "1";
  const controlPathEnv = process.env.INSTALLATION_CONTROL_PATH;
  if (controlPathEnv && !path.isAbsolute(controlPathEnv)) {
    process.env.INSTALLATION_CONTROL_PATH = path.resolve(root, controlPathEnv);
  }
  process.env.DB_PATH = dbPath;
  process.env.BACKUP_DIR = path.resolve(root, "runtime/backups");
  process.env.HOUSEHOLD_TIMEZONE =
    process.env.HOUSEHOLD_TIMEZONE ?? "America/New_York";
  process.env.HOST = process.env.HOST ?? "127.0.0.1";
  process.env.PORT = port;
  process.env.PUBLIC_ORIGIN =
    process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`;
  process.env.EVAL_LAN_ACCESS = "0";

  const config = loadConfig();
  const { app } = await buildApp(config);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await app.listen({ host: config.host, port: config.port });
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (lastErr) throw lastErr;
  const generation = bumpListenGeneration();
  console.log(
    `E2E server listening on http://${config.host}:${config.port} (generation ${generation})`,
  );
  return { app };
}

async function rebindHttpServer(): Promise<void> {
  if (restartInFlight) {
    await restartInFlight;
    return;
  }
  restartInFlight = (async () => {
    const previous = current;
    if (previous) {
      try {
        await previous.app.close();
      } catch {
        /* already closed */
      }
    }
    current = await listenFresh();
    console.log(
      `E2E server rebound (generation advanced; DB preserved)`,
    );
  })();
  try {
    await restartInFlight;
  } finally {
    restartInFlight = null;
  }
}

function rmSqliteFamily(filePath: string): void {
  for (const target of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  }
}

function wipeHouseholdArtifacts(): void {
  rmSqliteFamily(dbPath);
  const dir = path.dirname(dbPath);
  const stem = path.basename(dbPath, path.extname(dbPath));
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir)) {
      if (entry === stem || entry.startsWith(`${stem}.`)) {
        rmSqliteFamily(path.join(dir, entry));
      }
    }
  }
  const controlPathEnv = process.env.INSTALLATION_CONTROL_PATH;
  if (controlPathEnv) {
    const controlAbs = path.isAbsolute(controlPathEnv)
      ? controlPathEnv
      : path.resolve(root, controlPathEnv);
    rmSqliteFamily(controlAbs);
  }
}

async function wipeAndRebindHttpServer(): Promise<void> {
  if (restartInFlight) {
    await restartInFlight;
  }
  restartInFlight = (async () => {
    const previous = current;
    if (previous) {
      try {
        await previous.app.close();
      } catch {
        /* already closed */
      }
    }
    wipeHouseholdArtifacts();
    current = await listenFresh();
    console.log(`E2E server rebound after wipe (generation advanced)`);
  })();
  try {
    await restartInFlight;
  } finally {
    restartInFlight = null;
  }
}

async function main() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (!preserveDb) {
    wipeHouseholdArtifacts();
    for (const side of [restartFlagPath, wipeFlagPath, generationPath]) {
      if (fs.existsSync(side)) fs.rmSync(side, { force: true });
    }
  }
  if (fs.existsSync(restartFlagPath)) fs.rmSync(restartFlagPath);
  if (fs.existsSync(wipeFlagPath)) fs.rmSync(wipeFlagPath);

  if (!fs.existsSync(path.resolve(root, "dist/client/index.html"))) {
    console.error("dist/client missing — run npm run build first.");
    process.exit(1);
  }

  current = await listenFresh();
  console.log(`E2E server ready on http://${process.env.HOST}:${port}`);

  // Soft restart (preserve DB) and wipe+rebind seams for e2e isolation.
  const watch = setInterval(() => {
    if (fs.existsSync(wipeFlagPath)) {
      try {
        fs.rmSync(wipeFlagPath);
      } catch {
        return;
      }
      void wipeAndRebindHttpServer().catch((err) => {
        console.error("E2E server wipe-rebind failed", err);
      });
      return;
    }
    if (!fs.existsSync(restartFlagPath)) return;
    try {
      fs.rmSync(restartFlagPath);
    } catch {
      return;
    }
    void rebindHttpServer().catch((err) => {
      console.error("E2E server rebind failed", err);
    });
  }, 200);

  const shutdown = async (signal: string) => {
    clearInterval(watch);
    console.log(`E2E server shutting down (${signal})`);
    try {
      if (current) await current.app.close();
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
