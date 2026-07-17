import { spawnSync } from "node:child_process";

const command = process.argv[2] ?? "apply";

if (!["apply", "reset"].includes(command)) {
  console.error("Usage: node database/scripts/apply-local-migrations.mjs <apply|reset>");
  process.exit(1);
}

const supabaseArgs =
  command === "reset"
    ? ["db", "reset", "--local"]
    : ["migration", "up", "--local"];

const result = spawnSync("supabase", supabaseArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error?.code === "ENOENT") {
  console.error("Supabase CLI was not found. Install it first, then run this command again.");
  process.exit(1);
}

process.exit(result.status ?? 1);
