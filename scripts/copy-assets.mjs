import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

mkdirSync(join(root, "dist", "web"), { recursive: true });
copyFileSync(join(root, "web", "index.html"), join(root, "dist", "web", "index.html"));
copyFileSync(join(root, "web", "app.js"), join(root, "dist", "web", "app.js"));

console.log("copied web assets");
