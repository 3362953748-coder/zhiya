/**
 * 单文件版离线验证：后端完全不可达时，仍能走完整个流程
 * 运行：node test/single-file-offline.test.mjs
 */
import { chromium } from 'playwright';

const FILE = 'C:/Users/33629/Desktop/知涯最终版.html';
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '\n     ' + detail : ''}`); }
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 500, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

console.log('\n═══ 单文件版离线验证（后端不可达）═══\n');

// 拦截所有指向 5178 的请求，模拟后端没启动
await context.route('**://127.0.0.1:5178/**', (route) => route.abort('connectionrefused'));
await context.route('**://localhost:5178/**', (route) => route.abort('connectionrefused'));

await page.goto('file:///' + FILE.replace(/\\/g, '/'));
await page.waitForTimeout(2500);

console.log('── 首页 ──');
const conn = (await page.textContent('#connHint')).trim();
console.log(`     连接状态：${conn.replace(/\s+/g, ' ').slice(0, 60)}`);
check('提示未连接后端', conn.includes('未连接'), conn);
check('页面无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log('\n── 走完整流程 ──');
await page.click('#btnDemoFill');
await page.waitForTimeout(300);
await page.click('[data-go="s4"]');
await page.waitForTimeout(300);
await page.click('#jdSample');
await page.waitForTimeout(300);

const t0 = Date.now();
await page.click('#btnToGap');
await page.waitForSelector('#dirList .dcard', { timeout: 30000 });
const elapsed = Date.now() - t0;
check(`离线分析可用（${elapsed}ms）`, elapsed < 5000, `实际 ${elapsed}ms`);

check('方向卡渲染', (await page.locator('#dirList .dcard').count()) >= 1);
check('JD 能力清单渲染', (await page.locator('#jdList .card').count()) > 0);
check('显示离线模式提示', (await page.textContent('#demoBanner').catch(() => '')).includes('离线'));

await page.click('#btnToGap');
await page.waitForTimeout(400);
check('进入 05 差距页', await page.isVisible('#s5.on'));
check('差距条目渲染', (await page.locator('#gapList .gapcard').count()) > 0);
check('有信息不足虚线卡', (await page.locator('#gapList .gapcard.unknown').count()) > 0);
check('每条有判断依据', (await page.textContent('#gapList')).includes('判断依据'));

await page.click('#btnToPlan');
await page.waitForTimeout(400);
check('进入 06 计划页', await page.isVisible('#s6.on'));
check('任务卡渲染', (await page.locator('#planList .task').count()) > 0);

await page.click('#btnPlanDone');
await page.waitForTimeout(400);
check('进入 07 调整页', await page.isVisible('#s7.on'));
check('全程无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n═══ 通过 ${pass} · 失败 ${fail} ═══`);
process.exit(fail ? 1 : 0);
