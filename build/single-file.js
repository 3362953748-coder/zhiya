/**
 * 构建单文件最终版
 * 把 index.html + style.css + app.js + demo/snapshot.json 合成一个自包含的 HTML。
 *
 * 产出特点：
 *  - 单文件，双击即开，不需要服务器
 *  - 演示快照内联 → 完全断网也能走完整个流程
 *  - 后端可达时自动用真实模型，不可达时自动降级到内置快照
 *
 * 运行：node build/single-file.js
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const html = readFileSync(resolve(ROOT, 'public/index.html'), 'utf-8');
const css = readFileSync(resolve(ROOT, 'public/style.css'), 'utf-8');
const js = readFileSync(resolve(ROOT, 'public/app.js'), 'utf-8');
const snapshot = JSON.parse(readFileSync(resolve(ROOT, 'demo/snapshot.json'), 'utf-8'));

const BUILD_TIME = new Date().toISOString().slice(0, 16).replace('T', ' ');
const VERSION = '1.0.0';

/* ---------- 把 CSS 内联 ---------- */
let out = html.replace(
  /<link rel="stylesheet"[^>]*>/,
  `<style>\n${css}\n</style>`
);

/* ---------- 把 JS 内联 ----------
 * 注入内置快照 + 离线降级逻辑。
 * 快照用 JSON 字符串常量，避免 </script> 截断。
 */
const snapshotJson = JSON.stringify(snapshot.result).replace(/<\/script/gi, '<\\/script');

const offlineBootstrap = `
/* ============================================================
 * 单文件版内置数据 —— 完全断网也能演示
 * 由 build/single-file.js 在构建时注入，勿手改
 * ============================================================ */
const BUILTIN_SNAPSHOT = ${snapshotJson};
const BUILD_META = { version: '${VERSION}', built_at: '${BUILD_TIME}' };
`;

// 在 app.js 的第一个注释块之后插入离线引导
out = out.replace(
  /<script src="app\.js[^"]*"><\/script>/,
  `<script>\n${offlineBootstrap}\n${js}\n</script>`
);

/* ---------- 追加离线降级逻辑 ----------
 * app.js 本身已支持「内置快照存在时走离线路径」，
 * 这里只需注入 BUILTIN_SNAPSHOT 常量即可，无需再包装 detectApiBase。
 */

/* ---------- showDemoBanner 支持自定义文案 ---------- */
out = out.replace(
  /function showDemoBanner\(\) \{/,
  'function showDemoBanner(customText) {'
);
out = out.replace(
  /banner\.textContent = '演示模式 · 以下为预置分析结果（真实模型产出，非现场生成）';/,
  "banner.textContent = customText || '演示模式 · 以下为预置分析结果（真实模型产出，非现场生成）';"
);

/* ---------- 更新标题与版本信息 ---------- */
out = out.replace(
  /<title>.*?<\/title>/,
  `<title>知涯 ZHIYA · 最终版 v${VERSION}</title>`
);

/* ---------- 追加页脚版本条 ---------- */
const footerStyle = `
<style>
.buildfoot{font-size:10px;color:var(--t4);text-align:center;padding:6px 0 10px;letter-spacing:.3px}
.buildfoot b{font-weight:500;color:var(--t3)}
</style>`;
out = out.replace('</head>', `${footerStyle}\n</head>`);

out = out.replace(
  /<div class="hintbar">/,
  `<div class="buildfoot">知涯 ZHIYA 最终版 <b>v${VERSION}</b> · 构建于 ${BUILD_TIME} · 单文件离线可用</div>\n<div class="hintbar">`
);

/* ---------- 单文件版：连接状态提示改为「离线演示」 ----------
   源文件 public/app.js 的 init() 在探测不到后端时统一报红：
   「未连接到知涯后端 —— 请用 http://127.0.0.1:5178 打开本页，或先执行 bash start.sh」。
   但单文件版本身就内置了快照、并不需要后端，探不到后端是正常状态。
   原样发布会让访客（面试官）以为页面坏了，因此在构建期改写这一分支：
   有内置快照 → 中性灰字提示离线演示；没有快照（服务端版）→ 保留原报错。
   只改构建产物，不动 public/app.js 源码。 */
out = out.replace(
  /(\r?\n\s*)hint\.innerHTML = '<span style="color:var\(--err\)">●<\/span> 未连接到知涯后端 —— 请用 http:\/\/127\.0\.0\.1:5178 打开本页，或先执行 bash start\.sh';\r?\n(\s*)hint\.classList\.add\('bad'\);/,
  `$1if (typeof BUILTIN_SNAPSHOT !== 'undefined' && BUILTIN_SNAPSHOT) {
$1  hint.innerHTML = '<span style="color:var(--t3)">●</span> 离线演示模式 · 内置真实分析结果，无需启动后端';
$1  hint.classList.remove('bad');
$1} else {
$1  hint.innerHTML = '<span style="color:var(--err)">●</span> 未连接到知涯后端 —— 请用 http://127.0.0.1:5178 打开本页，或先执行 bash start.sh';
$1  hint.classList.add('bad');
$1}`
);
const OUT_DIR = 'C:/Users/33629/Desktop';
const OUT_FILE = resolve(OUT_DIR, '知涯最终版.html');
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, out, 'utf-8');

// 同时写回仓库，保证 GitHub 上的 demo-offline.html 与桌面版一致。
// 以前只写桌面版，导致仓库里那份长期停留在旧版本（不含内测模式），
// 面试官从 GitHub 拿到的离线版和线上行为不一致。
const REPO_FILE = resolve(ROOT, 'demo-offline.html');
writeFileSync(REPO_FILE, out, 'utf-8');

console.log(`✔ 单文件最终版已生成：${OUT_FILE}`);
console.log(`  体积 ${(Buffer.byteLength(out) / 1024).toFixed(1)} KB`);
console.log(`  内置快照：${snapshot.result.gap_report.items.length} 项能力 · ${snapshot.result.action_plan.tasks.length} 个任务`);
console.log(`  版本 ${VERSION} · ${BUILD_TIME}`);
console.log(`  仓库同步：${REPO_FILE}`);
