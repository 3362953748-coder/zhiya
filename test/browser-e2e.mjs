/**
 * 真实浏览器端到端：填表 → 解析 → 看差距报告 → 看行动计划
 * 运行：node test/browser-e2e.mjs
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

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

console.log('\n═══ 真实浏览器端到端 ═══\n');

await page.goto(BASE, { waitUntil: 'networkidle' });

/* ---------- 1. 首页连接状态 ---------- */
console.log('── 首页 ──');
const conn = (await page.textContent('#connHint')).trim();
check('首页显示已连接', conn.includes('已连接'), conn);

/* ---------- 2. 录入背景 ---------- */
console.log('\n── 录入背景 ──');
await page.click('[data-go="s2"]');
await page.waitForTimeout(300);
check('进入 02 背景录入页', await page.isVisible('#rawText'));

await page.fill('#rawText',
  '我是计算机专业大三学生。上学期做了一个校园二手交易平台的课程项目，我负责后端接口和数据库设计，用 Java 写的，一共做了 8 个接口。我还参加过学校程序设计竞赛拿了个三等奖。平时喜欢刷 LeetCode。');
await page.waitForTimeout(300);

const btnDisabled = await page.getAttribute('#btnParse', 'class');
check('输入足够字数后「继续」可点击', !btnDisabled.includes('dis'), btnDisabled);

/* ---------- 3. 填 JD ---------- */
console.log('\n── 填写 JD ──');
await page.click('[data-go="s4"]');
await page.waitForTimeout(300);
await page.fill('#jdText',
  'AI 产品经理实习生（校园招聘）\n岗位职责：\n1. 参与 AI 产品的需求调研、功能设计与迭代；\n2. 撰写产品需求文档（PRD），推动研发与测试团队落地；\n任职要求：\n1. 本科及以上在读，计算机、信息管理、心理学等相关专业优先；\n2. 具备较强的逻辑思考与结构化表达能力；\n3. 熟悉至少一种大模型 API，有调用实践经验者优先；\n4. 熟练使用 Axure/Figma 等原型工具加分。');
await page.waitForTimeout(300);
const toGapDisabled = await page.getAttribute('#btnToGap', 'class');
check('JD 足够字数后「继续」可点击', !toGapDisabled.includes('dis'), toGapDisabled);

/* ---------- 4. 触发分析 ---------- */
console.log('\n── AI 分析（约 30 秒）──');
await page.click('#btnToGap');
await page.waitForTimeout(1200);
const loadingVisible = await page.isVisible('#s8.on').catch(() => false);
check('显示加载态', loadingVisible);

await page.waitForSelector('#dirList .dcard', { timeout: 180000 });
await page.waitForTimeout(500);
check('分析完成并返回 04 岗位方向页', await page.isVisible('#s4.on'));

/* ---------- 5. 方向卡 ---------- */
console.log('\n── 方向卡 ──');
const dirCount = await page.locator('#dirList .dcard').count();
check('渲染出 1–3 张方向卡', dirCount >= 1 && dirCount <= 3, `实际 ${dirCount}`);
const dirText = await page.textContent('#dirList');
check('方向卡含推荐理由', dirText.includes('你在') || dirText.includes('你具备') || dirText.includes('经历'));
check('方向卡含不确定性说明', dirText.includes('未提及'));
check('方向卡含依据来源块', dirText.includes('依据来源'));
const jdCards = await page.locator('#jdList .card').count();
check('渲染出 JD 能力清单', jdCards > 0, `实际 ${jdCards}`);
const jdText = await page.textContent('#jdList');
check('JD 清单区分必备与加分', jdText.includes('必备') && jdText.includes('加分'));

/* ---------- 6. 差距报告 ---------- */
console.log('\n── 能力差距分析 ──');
// 04 页「继续」：已分析过则直接进入 05 页
await page.click('#btnToGap');
await page.waitForTimeout(600);
check('进入 05 能力差距页', await page.isVisible('#s5.on'));

const gapCount = await page.locator('#gapList .gapcard').count();
check('渲染出差距条目', gapCount > 0, `实际 ${gapCount}`);
const gapText = await page.textContent('#gapList');
check('每条都有判断依据', gapText.includes('判断依据'));
check('有信息不足条目（虚线卡）', await page.locator('#gapList .gapcard.unknown').count() > 0);
check('信息不足条目有补充指引', gapText.includes('补充指引'));
check('信息不足条目有补充入口', gapText.includes('点击补充这段经历'));
check('无判定性表述', !/不会|不具备|缺乏|无法胜任/.test(gapText),
  (gapText.match(/[^。]{0,15}(?:不会|不具备|缺乏)[^。]{0,15}/) || [''])[0]);
const honest = await page.textContent('.honest');
check('展示诚实声明块', honest.includes('不等于'));

/* ---------- 7. 行动计划 ---------- */
console.log('\n── 两周行动计划 ──');
await page.click('#btnToPlan');
await page.waitForTimeout(400);
check('进入 06 行动计划页', await page.isVisible('#s6.on'));

const taskCount = await page.locator('#planList .task').count();
check('渲染出任务卡', taskCount > 0, `实际 ${taskCount}`);
const planText = await page.textContent('#planList');
check('任务含预期产出', planText.includes('预期产出'));
check('任务含完成标准', planText.includes('完成标准'));
check('任务含依据', planText.includes('依据'));
check('按周分组', planText.includes('第 1 周') && planText.includes('第 2 周'));
check('显示总时长', (await page.textContent('#planFoot')).includes('小时'));

/* ---------- 8. 调整页 ---------- */
console.log('\n── 确认调整 ──');
await page.click('#btnPlanDone');
await page.waitForTimeout(400);
check('进入 07 确认调整页', await page.isVisible('#s7.on'));
check('任务清单可勾选', await page.locator('#taskList .box').count() > 0);

await page.locator('#taskList .box').first().click();
await page.waitForTimeout(300);
check('取消勾选生效', await page.locator('#taskList .box.e').count() > 0);

/* ---------- 9. 控制台无报错 ---------- */
console.log('\n── 运行时健康 ──');
check('页面无 JS 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n═══ 通过 ${pass} · 失败 ${fail} ═══`);
process.exit(fail ? 1 : 0);
