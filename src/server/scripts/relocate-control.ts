import { relocateInstallationControl } from "../relocate-control.js";

const sourceArg = process.argv[2];
const destArg = process.argv[3];
if (!sourceArg || !destArg) {
  throw new Error(
    "Usage: npm run db:relocate-control -- <source-control.sqlite> <dest-control.sqlite>",
  );
}

const result = await relocateInstallationControl({
  sourcePath: sourceArg,
  destPath: destArg,
  backupDir: process.env.BACKUP_DIR?.trim() || undefined,
});

console.log(
  `Installation control relocated to ${result.destPath} (epoch ${result.datasetEpoch}, active ${result.activeDatabasePath}). Source left unchanged at ${result.sourcePath}. Set INSTALLATION_CONTROL_PATH to the destination on persistent storage before the next start.`,
);
