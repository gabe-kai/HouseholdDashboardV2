import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";

function preferPrivateIPv4() {
  const nets = networkInterfaces();
  const candidates = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries ?? []) {
      const family = String(net.family);
      if ((family === "IPv4" || family === "4") && !net.internal) {
        candidates.push(net.address);
      }
    }
  }
  const preferred = candidates.find(
    (ip) =>
      ip.startsWith("192.168.") ||
      ip.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip),
  );
  return preferred ?? candidates[0] ?? null;
}

const ip = preferPrivateIPv4();
if (!ip) {
  console.error("No usable LAN IPv4 address found.");
  process.exit(1);
}

const vitePort = process.env.VITE_PORT ?? "5173";
const origin = `http://${ip}:${vitePort}`;

process.env.EVAL_LAN_ACCESS = "1";
process.env.PUBLIC_ORIGIN = origin;
process.env.HOST = process.env.HOST && process.env.HOST !== "127.0.0.1" ? process.env.HOST : "0.0.0.0";

console.log(`LAN phone URL: ${origin}`);
console.log("Use that exact origin on the phone (not 127.0.0.1). Allow Node through Windows Firewall if prompted.");

const child = spawn("npm", ["run", "dev"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
