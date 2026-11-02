#!/usr/bin/env node
/**
 * Set or rotate LinkStore's admin code directly in D1.
 *
 * Default: interactive target selection + custom admin code.
 * Flags:
 *   --local       use local dev D1
 *   --remote      use remote D1
 *   --generate    generate a 256-bit random code instead of prompting
 *
 * The custom code is read from an interactive prompt, never from a CLI
 * argument or file. Only its SHA-256 hash is sent to D1.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";

const databaseName = process.env.D1_DATABASE_NAME?.trim() || "linkstore-db";
const wranglerEnv = process.env.WRANGLER_ENV?.trim();
const args = process.argv.slice(2);
const knownFlags = new Set([
  "--local",
  "--remote",
  "--generate",
  "--yes",
  "--help",
  "-h",
]);

for (const argument of args) {
  if (!knownFlags.has(argument)) {
    console.error(`未知参数: ${argument}`);
    console.error("可用参数: --local | --remote | --generate");
    process.exit(1);
  }
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`LinkStore 管理码设置

  pnpm admin:set-code                 交互选择 D1，并输入自定义管理码
  pnpm admin:set-code -- --local      直接设置本地开发 D1
  pnpm admin:set-code -- --remote     直接设置远端 D1
  pnpm admin:set-code -- --generate   生成 256 bit 随机管理码
  pnpm admin:set-code -- --remote --yes  自动化场景跳过远端确认

自定义管理码只从终端输入读取，不写入文件，也不会出现在 shell 历史中。
`);
  process.exit(0);
}

if (args.includes("--local") && args.includes("--remote")) {
  console.error("--local 和 --remote 不能同时使用。");
  process.exit(1);
}

const wranglerBin = path.resolve("node_modules/wrangler/bin/wrangler.js");
if (!existsSync(wranglerBin)) {
  console.error("未找到本地 wrangler，请先运行 pnpm install。");
  process.exit(1);
}

const interactive = Boolean(process.stdin.isTTY);
const rl = interactive
  ? createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })
  : null;

// Non-interactive stdin is supported for tests/automation by reading complete
// lines from stdin. Normal use is interactive and never requires a pipe.
const pipedLines = interactive
  ? null
  : readFileSync(0, "utf8").split(/\r?\n/);
let pipedIndex = 0;

async function ask(question) {
  process.stdout.write(question);

  if (pipedLines) {
    const answer = pipedLines[pipedIndex] ?? "";
    pipedIndex += 1;
    process.stdout.write(answer + "\n");
    return answer.trim();
  }

  if (!rl) throw new Error("无法读取终端输入。");
  const answer = await rl.question("");
  return answer.trim();
}

async function chooseTarget() {
  if (args.includes("--local")) return true;
  if (args.includes("--remote")) return false;

  if (!interactive) {
    console.log("未指定写入目标，非交互终端默认使用远端 D1。");
    return false;
  }

  for (;;) {
    console.log("\n管理码要写入哪个 D1？");
    console.log("  1) 远端 D1（已在 Cloudflare 部署的网站）");
    console.log("  2) 本地 D1（pnpm dev 本地开发）");
    const answer = (await ask("请选择 [1]: ")) || "1";
    if (answer === "1") return false;
    if (answer === "2") return true;
    console.log("请输入 1 或 2。");
  }
}

function hasValidLocalSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) {
    return true;
  }

  const envFile = path.resolve(".dev.vars");
  if (!existsSync(envFile)) return false;

  const content = readFileSync(envFile, "utf8");
  const match = /^SESSION_SECRET=(.*)$/m.exec(content);
  if (!match) return false;
  const value = match[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
  return value.length >= 32 && !value.includes("replace-with");
}

function remoteDatabaseConfigured() {
  const configFile = path.resolve("wrangler.toml");
  if (!existsSync(configFile)) return false;
  const content = readFileSync(configFile, "utf8");
  const match = /^\s*database_id\s*=\s*"([^"]+)"/m.exec(content);
  const id = match?.[1]?.trim() ?? "";
  return Boolean(id) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id);
}

function validateCustomCode(code) {
  if ([...code].length < 8) return "管理码至少需要 8 个字符。";
  if ([...code].length > 128) return "管理码不能超过 128 个字符。";
  if (/[\u0000-\u001f\u007f]/.test(code)) return "管理码不能包含控制字符。";
  return "";
}

async function confirmRemoteWrite() {
  if (args.includes("--yes")) return true;

  if (!interactive) {
    console.error(
      "\n✗ 拒绝在非交互终端修改远端 D1。确认要执行时请显式添加 --yes。",
    );
    process.exitCode = 1;
    return false;
  }

  const answer = await ask(
    "即将修改云端生产管理码并使所有旧会话失效。输入 yes 继续: ",
  );
  if (answer !== "yes") {
    console.log("已取消，未修改任何数据。");
    return false;
  }
  return true;
}

async function readCustomCode() {
  console.log("\n安全提示：");
  console.log("自定义管理码不会写入文件或 shell 历史，但会显示在当前终端。");
  console.log("短码可能被暴力猜测。建议使用 4 个随机词或 20 个以上随机字符。");
  console.log("如需最高安全性，请改用：pnpm admin:rotate -- --generate\n");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = await ask("输入自定义管理码（8-128 字符）: ");
    const error = validateCustomCode(code);
    if (error) {
      console.error(`✗ ${error}`);
      continue;
    }

    const confirmation = await ask("再次输入以确认: ");
    if (code !== confirmation) {
      console.error("✗ 两次输入不一致，请重试。");
      continue;
    }

    if ([...code].length < 16) {
      console.warn("⚠ 该管理码较短，请确认它不会被轻易猜到。");
    }
    return code;
  }

  throw new Error("连续三次输入无效，未修改管理码。");
}

async function main() {
  const useLocal = await chooseTarget();

  if (useLocal && !hasValidLocalSecret()) {
    console.error("\n✗ 未检测到有效的本地 SESSION_SECRET。");
    console.error("  即使管理码写入成功，本地登录也会返回 500。");
    console.error("  请在 .dev.vars 中添加一行：");
    console.error("  SESSION_SECRET=<至少 32 字节的随机值>");
    console.error("  可直接用下面的命令写入随机密钥（不会打印密钥）：");
    console.error(
      "  node -e \"require('fs').appendFileSync('.dev.vars','SESSION_SECRET='+require('crypto').randomBytes(32).toString('base64url')+'\\n')\"",
    );
    console.error("  然后重新运行此脚本。\n");
    process.exitCode = 1;
    return;
  }

  if (!useLocal && !remoteDatabaseConfigured()) {
    console.error("\n✗ wrangler.toml 中的 database_id 仍是占位值。");
    console.error("  请先运行 pnpm exec wrangler d1 create linkstore-db，并填写真实 ID。\n");
    process.exitCode = 1;
    return;
  }

  if (!useLocal && !(await confirmRemoteWrite())) return;

  const generated = args.includes("--generate");
  const plaintext = generated
    ? `lsa_${randomBytes(32).toString("base64url")}`
    : await readCustomCode();

  const hash = createHash("sha256").update(plaintext, "utf8").digest("hex");
  const rotatedAt = new Date().toISOString();
  const target = useLocal ? "本地 D1" : "远端 D1";

  const sql = [
    "INSERT INTO admin_config (id, admin_code_hash, session_version, rotated_at)",
    `VALUES (1, '${hash}', 1, '${rotatedAt}')`,
    "ON CONFLICT(id) DO UPDATE SET",
    "  admin_code_hash = excluded.admin_code_hash,",
    "  session_version = admin_config.session_version + 1,",
    "  rotated_at = excluded.rotated_at;",
  ].join("\n");

  const commandArgs = [
    wranglerBin,
    "d1",
    "execute",
    databaseName,
    useLocal ? "--local" : "--remote",
    "--command",
    sql,
  ];
  if (wranglerEnv) commandArgs.push("--env", wranglerEnv);

  console.log(`\n正在写入${target}（${databaseName}）…`);
  const result = spawnSync(process.execPath, commandArgs, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error || result.status !== 0) {
    console.error("\n✗ 更新失败，管理码没有改变。");
    console.error(
      useLocal
        ? "  请检查本地 D1 是否已执行 pnpm db:migrate:local。"
        : "  请检查 wrangler 登录态、database_id 与远端迁移。",
    );
    process.exitCode = result.status || 1;
    return;
  }

  console.log("\n" + "=".repeat(66));
  if (generated) {
    console.log("新的随机管理码（只显示这一次，请立即保存）：");
    console.log("");
    console.log(plaintext);
  } else {
    console.log("✓ 自定义管理码已设置（不会再次回显）。");
  }
  console.log("");
  console.log("=".repeat(66));
  console.log("数据库只保存 SHA-256 哈希，所有旧会话都已立即失效。");
  console.log(
    useLocal
      ? "请使用 pnpm dev 输出的 HTTPS 地址打开站点，并输入刚设置的管理码。"
      : "请打开部署后的 HTTPS 站点，并输入刚设置的管理码。",
  );
  if (!useLocal) {
    console.log(
      "生产登录还需要已设置 SESSION_SECRET；可用 pnpm exec wrangler secret list 检查。",
    );
  }
  console.log("如果仍然无效，请确认当前站点连接的 D1 与本次写入目标一致。");
}

try {
  await main();
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rl?.close();
}
