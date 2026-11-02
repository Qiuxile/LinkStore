#!/usr/bin/env node
/**
 * Rotate LinkStore's admin code directly in D1.
 *
 * Usage:
 *   pnpm admin:rotate            # remote D1 (requires wrangler login/token)
 *   pnpm admin:rotate -- --local # local dev D1
 *
 * The plaintext code is printed only after the database update succeeds. It is
 * never written to a file or passed to a shell/CLI argument.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const databaseName = process.env.D1_DATABASE_NAME?.trim() || "linkstore-db";
const wranglerEnv = process.env.WRANGLER_ENV?.trim();
const useLocal = process.argv.includes("--local");
const knownFlags = new Set(["--local"]);

for (const argument of process.argv.slice(2)) {
  if (!knownFlags.has(argument)) {
    console.error(`未知参数: ${argument}`);
    process.exit(1);
  }
}

const wranglerBin = path.resolve("node_modules/wrangler/bin/wrangler.js");
if (!existsSync(wranglerBin)) {
  console.error("未找到本地 wrangler，请先运行 pnpm install。");
  process.exit(1);
}

// 32 random bytes = 256 bits of entropy. The prefix identifies the code type
// and is not secret. The plaintext stays only in this process until printed.
const plaintext = `lsa_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(plaintext, "utf8").digest("hex");
const rotatedAt = new Date().toISOString();

const sql = [
  "INSERT INTO admin_config (id, admin_code_hash, session_version, rotated_at)",
  `VALUES (1, '${hash}', 1, '${rotatedAt}')`,
  "ON CONFLICT(id) DO UPDATE SET",
  "  admin_code_hash = excluded.admin_code_hash,",
  "  session_version = admin_config.session_version + 1,",
  "  rotated_at = excluded.rotated_at;",
].join("\n");

const args = [
  wranglerBin,
  "d1",
  "execute",
  databaseName,
  useLocal ? "--local" : "--remote",
  "--command",
  sql,
];
if (wranglerEnv) args.push("--env", wranglerEnv);

const target = useLocal ? "本地 D1" : "远端 D1";
console.log(`正在更新${target}（${databaseName}）…`);

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
});

if (result.error || result.status !== 0) {
  console.error(
    "\n更新失败，未生成可用的新管理码。请检查 wrangler 登录态、D1 配置与迁移是否完成。",
  );
  process.exit(result.status || 1);
}

console.log("\n" + "=".repeat(66));
console.log("新的管理码（只显示这一次，请立即保存到密码管理器）：");
console.log("");
console.log(plaintext);
console.log("");
console.log("=".repeat(66));
console.log("数据库只保存了 SHA-256 哈希，任何旧会话都已立即失效。");
console.log("如果此终端已开启会话记录，请清理对应的终端历史。");
