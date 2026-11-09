/**
 * 演示模式浏览器验证：点一下按钮，零延迟走完完整流程
 * 运行：node test/browser-demo.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5178';
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '\n     ' + detail : ''}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

console.log('\n═══ 演示模式浏览器验证 ═══\n');

await page.goto(BASE, { waitUntil: 'networkidle' });

/* ---------- 首页 ---------- */
console.log('── 首页 ──');
check('有「用预置结果演示」按钮', await page.isVisible('#btnDemoToggle'));
check('有「填入示例内容」按钮', await page.isVisible('#btnDemoFill'));

/* ---------- 开演示模式 ---------- */
console.log('\n── 开启演示模式 ──');
await page.click('#btnDemoToggle');
await page.waitForTimeout(300);
check('按钮变为已开状态', (await page.textContent('#btnDemoToggle')).includes('已开'));
check('显示演示模式说明', await page.isVisible('#demoNote'));

/* ---------- 填入示例 ---------- */
await page.click('#btnDemoFill');
await page.waitForTimeout(300);
check('跳转到 02 背景录入页', await page.isVisible('#s2.on'));
const rawVal = await page.inputValue('#rawText');
check('背景已自动填入', rawVal.includes('计算机专业'), rawVal.slice(0, 30));
check('「继续」按钮可点击', !(await page.getAttribute('#btnParse', 'class')).includes('dis'));

/* ---------- 去 04 页填 JD ---------- */
await page.click('[data-go="s4"]');
await page.waitForTimeout(300);
await page.click('#jdSample');
await page.waitForTimeout(300);
const jdVal = await page.inputValue('#jdText');
check('JD 已自动填入', jdVal.includes('AI 产品经理'), jdVal.slice(0, 30));

/* ---------- 触发演示分析（应瞬时完成） ---------- */
console.log('\n── 演示分析（应零延迟）──');
const t0 = Date.now();
await page.click('#btnToGap');
await page.waitForSelector('#dirList .dcard', { timeout: 15000 });
const elapsed = Date.now() - t0;
check(`演示分析瞬时完成（${elapsed}ms < 3000ms）`, elapsed < 3000, `实际 ${elapsed}ms`);
check('回到 04 岗位方向页', await page.isVisible('#s4.on'));

/* ---------- 演示标识 ---------- */
check('显示演示模式提示条', await page.isVisible('#demoBanner'));
const banner = await page.textContent('#demoBanner');
check('提示条说明是预置结果', banner.includes('预置'), banner);
check('底部注明预置结果', (await page.textContent('#footNote')).includes('预置'));

/* ---------- 走完整流程 ---------- */
console.log('\n── 完整流程 ──');
const dirCount = await page.locator('#dirList .dcard').count();
check('方向卡渲染', dirCount >= 1 && dirCount <= 3, `实际 ${dirCount}`);
const jdCards = await page.locator('#jdList .card').count();
check('JD 能力清单渲染', jdCards > 0, `实际 ${jdCards}`);

await page.click('#btnToGap');
await page.waitForTimeout(400);
check('进入 05 差距页', await page.isVisible('#s5.on'));
const gapCount = await page.locator('#gapList .gapcard').count();
check('差距条目渲染', gapCount > 0, `实际 ${gapCount}`);
check('有信息不足虚线卡', await page.locator('#gapList .gapcard.unknown').count() > 0);
check('每条有判断依据', (await page.textContent('#gapList')).includes('判断依据'));

await page.click('#btnToPlan');
await page.waitForTimeout(400);
check('进入 06 计划页', await page.isVisible('#s6.on'));
const taskCount = await page.locator('#planList .task').count();
check('任务卡渲染', taskCount > 0, `实际 ${taskCount}`);
check('任务含四要素', (await page.textContent('#planList')).includes('预期产出'));

await page.click('#btnPlanDone');
await page.waitForTimeout(400);
check('进入 07 调整页', await page.isVisible('#s7.on'));

check('全程无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n═══ 通过 ${pass} · 失败 ${fail} ═══`);
process.exit(fail ? 1 : 0);
