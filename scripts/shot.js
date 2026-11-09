// 为 GitHub 仓库生成首屏截图
// 目的：招聘方在仓库列表页只停留几秒，没有视觉图就没有代入感
//
// 关键点（踩过的坑）：
//  1. 离线单文件版默认不连后端，「用预置结果演示」只填输入框、不填结果
//  2. 结果必须走 applyResult(snapshot) 才会渲染到各屏
//  3. 屏号映射：s2=背景录入 s3=追问 s4=岗位方向 s5=能力差距 s6=行动计划 s7=确认行动
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'images');
fs.mkdirSync(OUT, { recursive: true });

const FILE_URL = 'file:///' + path.join(ROOT, 'demo-offline.html').replace(/\\/g, '/');
const SNAPSHOT = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'demo', 'snapshot.json'), 'utf8')
);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();

await page.goto(FILE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

async function shot(name, note) {
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('  ✅', name, '—', note);
}

// 1. 主页
await shot('01-home.png', '主页：产品定位与入口');

// 注入预置结果（真实模型产出），渲染方向 / 差距 / 计划三屏
await page.evaluate((snap) => {
  applyResult(snap.result, '离线截图 · 预置的真实模型产出');
}, SNAPSHOT);
await page.waitForTimeout(900);

// 2. 背景录入
await page.evaluate(() => go('s2'));
await page.waitForTimeout(600);
await shot('02-input.png', '背景录入：口述经历 + 目标岗位 JD');

// 3. 岗位方向
await page.evaluate(() => go('s4'));
await page.waitForTimeout(700);
await shot('03-directions.png', '岗位方向：AI 给出的方向 + 匹配依据 + 不确定性');

// 4. 能力差距（三分类）
await page.evaluate(() => go('s5'));
await page.waitForTimeout(700);
await shot('04-gap.png', '能力差距：已有 / 待提升 / 信息不足 三分类');

// 5. 行动计划
await page.evaluate(() => go('s6'));
await page.waitForTimeout(700);
await shot('05-plan.png', '两周行动计划：优先级 + 产出物 + 完成标准');

// 6. 确认行动（可勾选调整）
await page.evaluate(() => go('s7'));
await page.waitForTimeout(700);
await shot('06-confirm.png', '确认行动：每周时间投入 + 任务勾选调整');

await browser.close();
console.log('\n截图目录：', OUT);
