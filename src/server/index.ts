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
      allowLan: config.allowLan,
      evaluationMode: true,
    },
    config.allowLan
      ? "EVALUATION BUILD listening with LAN exposure enabled — not secure individual login"
      : "EVALUATION BUILD listening on loopback",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
