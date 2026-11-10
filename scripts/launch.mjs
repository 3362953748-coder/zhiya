#!/usr/bin/env node
/**
 * 知涯 ZHIYA · 一键启动器
 *
 * 解决的问题：以前桌面上的「启动知涯后端.bat」会 cd 到桌面目录再执行
 * node server/index.js，而 server/ 实际在项目目录里 —— 于是每次双击都报
 * "Cannot find module ...\\Desktop\\server\\index.js"，后端根本起不来，
 * 表现就是「知涯总是离线」。
 *
 * 现在这个启动器：
 *   1. 先探活：后端已经在跑就直接开浏览器，不重复起进程
 *   2. 端口体检：5178 被别的程序占用时给出明确提示，而不是静默失败
 *   3. 守护模式：子进程崩溃后自动退避重启（最多 10 次）
 *   4. 起成功后自动打开浏览器
 *
 * 用法：
 *   node scripts/launch.mjs              启动（或复用）后端并打开浏览器
 *   node scripts/launch.mjs --supervise  守护模式（由本脚本自动拉起）
 *   node scripts/launch.mjs --status     查看运行状态
 *   node scripts/launch.mjs --stop       停止守护进程
 *   node scripts/launch.mjs --no-open    启动但不打开浏览器
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, openSync, writeFileSync, readFileSync as rf, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(__dirname, '..');
const LOG_DIR = join(ROOT, 'logs');
const LOG_FILE = join(LOG_DIR, 'server.log');
const PID_FILE = join(LOG_DIR, 'server.pid');
const MAX_RESTARTS = 10;

/* ---------- 读取 .env.local / .env（零依赖） ---------- */
function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const p = join(ROOT, name);
    if (!existsSync(p)) continue;
    try {
      for (const line of readFileSync(p, 'utf-8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!(m[1] in process.env)) process.env[m[1]] = v;
      }
    } catch (e) {
      console.warn(`[env] 读取 ${name} 失败：${e.message}`);
    }
  }
}
loadEnv();

const PORT = Number(process.env.PORT) || 5178;
const URL_LOCAL = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line, 'utf-8');
  } catch (_) { /* 日志写不进去也不该影响主流程 */ }
  process.stdout.write(line);
}

/* ---------- 健康检查 ---------- */
async function health() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${URL_LOCAL}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const d = await res.json();
    return d && d.ok === true ? d : null;
  } catch (_) {
    return null;
  }
}

/* ---------- 端口占用检测 ---------- */
function portBusy(port) {
  return new Promise((resolveBusy) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (v) => { sock.destroy(); resolveBusy(v); };
    sock.setTimeout(1200);
    sock.on('connect', () => done(true));
    sock.on('timeout', () => done(false));
    sock.on('error', () => done(false));
  });
}

/* ---------- 打开浏览器 ---------- */
function openBrowser() {
  if (process.platform !== 'win32') {
    spawn('open', [URL_LOCAL], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  // Windows：用 explorer 打开 http URL，避免 start 的引号转义问题
  spawn('explorer.exe', [URL_LOCAL], { detached: true, stdio: 'ignore' }).unref();
}

/* ---------- 守护模式 ---------- */
async function supervise() {
  let stopping = false;
  let restarts = 0;

  const onSignal = () => { stopping = true; process.exit(0); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const boot = () => {
    const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'inherit',
    });
    child.on('exit', (code, signal) => {
      if (stopping) return;
      restarts += 1;
      if (restarts > MAX_RESTARTS) {
        log(`后端连续退出超过 ${MAX_RESTARTS} 次，停止自动重启。请检查 logs/server.log`);
        process.exit(1);
      }
      const delay = Math.min(restarts * 2000, 15000);
      log(`后端退出（code=${code} signal=${signal ?? '-'}），${delay / 1000}s 后第 ${restarts} 次重启`);
      setTimeout(boot, delay);
    });
  };

  log(`守护模式启动 · 端口 ${PORT}`);
  boot();
}

/* ---------- 主流程 ---------- */
async function launch({ open = true } = {}) {
  const alive = await health();
  if (alive) {
    console.log(`\n  ✓ 知涯后端已在运行（:${PORT}）`);
    console.log(`    模型：${alive.model ?? '-'}`);
    console.log(`    地址：${URL_LOCAL}\n`);
    if (open) openBrowser();
    return 0;
  }

  if (await portBusy(PORT)) {
    console.error(`\n  ✗ 端口 ${PORT} 已被其他程序占用，且不是知涯后端。`);
    console.error(`    请关闭占用该端口的程序，或在 .env.local 里改一个 PORT 再启动。\n`);
    return 1;
  }

  mkdirSync(LOG_DIR, { recursive: true });
  const out = openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [SELF, '--supervise'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, PORT: String(PORT) },
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid), 'utf-8');

  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    const h = await health();
    if (h) {
      console.log(`\n  ✓ 知涯后端已启动（:${PORT}）`);
      console.log(`    模型：${h.model ?? '-'}`);
      console.log(`    地址：${URL_LOCAL}`);
      console.log(`    日志：${LOG_FILE}\n`);
      if (open) openBrowser();
      return 0;
    }
  }

  console.error(`\n  ✗ 启动超时（30s）。请查看日志：${LOG_FILE}\n`);
  return 1;
}

async function status() {
  const h = await health();
  if (h) {
    console.log(`运行中 · 端口 ${PORT} · 模型 ${h.model ?? '-'}`);
    return 0;
  }
  console.log(`未运行 · 端口 ${PORT} 无响应`);
  return 1;
}

async function stop() {
  if (!existsSync(PID_FILE)) {
    console.log('没有找到守护进程记录，可能本来就没在跑。');
    return 0;
  }
  const pid = Number(rf(PID_FILE, 'utf-8').trim());
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`已停止守护进程（pid=${pid}）。`);
  } catch (e) {
    console.log(`停止失败：${e.message}`);
  }
  return 0;
}

const args = process.argv.slice(2);
if (args.includes('--supervise')) {
  await supervise();
} else if (args.includes('--status')) {
  process.exit(await status());
} else if (args.includes('--stop')) {
  process.exit(await stop());
} else {
  process.exit(await launch({ open: !args.includes('--no-open') }));
}
