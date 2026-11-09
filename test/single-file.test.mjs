/**
 * 单文件最终版验证：file:// 双击打开的场景
 * 运行：node test/single-file.test.mjs
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const FILE = 'C:/Users/33629/Desktop/知涯最终版.html';
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '\n     ' + detail : ''}`); }
}

console.log('\n═══ 单文件最终版验证 ═══\n');

console.log('── 文件检查 ──');
check('桌面文件存在', existsSync(FILE));
const { readFileSync } = await import('node:fs');
const html = readFileSync(FILE, 'utf-8');
check('CSS 已内联（无外链）', !html.includes('<link rel="stylesheet"'), '仍有外链样式');
check('JS 已内联（无外链）', !html.includes('src="app.js'), '仍有外链脚本');
check('演示快照已内联', html.includes('BUILTIN_SNAPSHOT'));
check('包含 8 个屏幕', (html.match(/id="s[0-9]"/g) || []).length === 8);
check('包含页脚版本信息', html.includes('buildfoot'));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 500, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

console.log('\n── file:// 双击打开 ──');
await page.goto('file:///' + FILE.replace(/\\/g, '/'));
await page.waitForTimeout(2500);

check('页面加载无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
check('首页渲染正常', await page.isVisible('#s1.on'));
check('标题已更新', (await page.title()).includes('最终版'), await page.title());

const conn = (await page.textContent('#connHint')).trim();
console.log(`     连接状态：${conn.replace(/\s+/g, ' ').slice(0, 70)}`);

/* 后端在跑时 → 应连上；离线时 → 应降级 */
const backendUp = conn.includes('已连接');
console.log(`     后端${backendUp ? '在线（已连上）' : '离线（应降级到内置快照）'}`);

/* ---------- 走完整流程 ---------- */
console.log('\n── 完整流程 ──');
await page.click('#btnDemoFill');
await page.waitForTimeout(400);
check('示例内容已填入', (await page.inputValue('#rawText')).includes('计算机专业'));

await page.click('[data-go="s4"]');
await page.waitForTimeout(300);
await page.click('#jdSample');
await page.waitForTimeout(300);
check('JD 已填入', (await page.inputValue('#jdText')).includes('AI 产品经理'));

const t0 = Date.now();
await page.click('#btnToGap');
await page.waitForSelector('#dirList .dcard', { timeout: 120000 });
const elapsed = Date.now() - t0;
check(`分析完成（${elapsed}ms）`, true);
check('方向卡渲染', (await page.locator('#dirList .dcard').count()) >= 1);
check('JD 能力清单渲染', (await page.locator('#jdList .card').count()) > 0);

await page.click('#btnToGap');
await page.waitForTimeout(400);
check('进入 05 差距页', await page.isVisible('#s5.on'));
check('差距条目渲染', (await page.locator('#gapList .gapcard').count()) > 0);
check('有信息不足虚线卡', (await page.locator('#gapList .gapcard.unknown').count()) > 0);
check('每条有判断依据', (await page.textContent('#gapList')).includes('判断依据'));
check('无判定性表述', !/不会|不具备|缺乏|无法胜任/.test(await page.textContent('#gapList')));

await page.click('#btnToPlan');
await page.waitForTimeout(400);
check('进入 06 计划页', await page.isVisible('#s6.on'));
check('任务卡渲染', (await page.locator('#planList .task').count()) > 0);
check('任务含四要素', (await page.textContent('#planList')).includes('预期产出'));

await page.click('#btnPlanDone');
await page.waitForTimeout(400);
check('进入 07 调整页', await page.isVisible('#s7.on'));

await browser.close();
console.log(`\n═══ 通过 ${pass} · 失败 ${fail} ═══`);
process.exit(fail ? 1 : 0);
