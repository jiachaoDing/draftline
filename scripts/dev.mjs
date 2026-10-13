import { spawn } from "node:child_process";
const children = [
  spawn(process.execPath, ["--import", "tsx", "server/dev.ts"], {
    stdio: "inherit",
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    stdio: "inherit",
  }),
];
const stop = () => {
  children.forEach((child) => child.kill());
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach((child) =>
  child.on("exit", (code) => {
    if (code) stop();
  }),
);
