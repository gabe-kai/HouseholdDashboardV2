import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { installationStartupDiagnostic } from "./lifecycle-runtime.js";

async function main() {
  const config = loadConfig();
  const { app, runtime } = await buildApp(config);

  await app.listen({ host: config.host, port: config.port });
  app.log.info(installationStartupDiagnostic(runtime), "Installation paths");
  app.log.info(
    {
      host: config.host,
      port: config.port,
      profile: config.profile,
      publicOrigin: config.publicOrigin,
      allowLan: config.allowLan,
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
