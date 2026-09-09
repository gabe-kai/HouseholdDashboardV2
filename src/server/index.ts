import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

async function main() {
  const config = loadConfig();
  const { app } = await buildApp(config);

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    {
      host: config.host,
      port: config.port,
      profile: config.profile,
    },
    config.profile === "hosted"
      ? "Authenticated household server listening behind configured HTTPS proxy"
      : "Authenticated household server listening for local development",
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : "Server startup failed";
  console.error(message);
  process.exit(1);
});
