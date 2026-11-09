// 生成 8 屏原型截图（供 README 与作品集使用）
// 屏号映射（从 public/index.html 解析得出，不要靠猜）：
//   s1=首页  s2=背景录入  s3=追问  s4=岗位方向  s5=能力差距  s6=两周行动计划  s7=确认行动
//
// 关键：离线版「用预置结果演示」只填输入框不填结果，
//      必须调 applyResult(snapshot) 才会渲染出方向/差距/计划三屏。
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', '图', '原型');
fs.mkdirSync(OUT, { recursive: true });

const FILE_URL = 'file:///' + path.join(ROOT, 'demo-offline.html').replace(/\\/g, '/');
const SNAPSHOT = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'demo', 'snapshot.json'), 'utf8')
);

const SCREENS = [
  ['01', 's1', '首页'],
  ['02', 's2', '背景录入'],
  ['03', 's3', '追问'],
  ['04', 's4', '岗位方向'],
  ['05', 's5', '能力差距'],
  ['06', 's6', '两周行动计划'],
  ['07', 's7', '确认行动'],
  ['08', 's2', '背景录入 + 展开追问区'],
];

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

// 注入预置结果（真实模型产出），渲染方向/差距/计划三屏
await page.evaluate((snap) => {
  applyResult(snap.result, '原型截图 · 预置的真实模型产出');
}, SNAPSHOT);
await page.waitForTimeout(900);

for (const [num, sid, label] of SCREENS) {
  await page.evaluate((id) => go(id), sid);
  await page.waitForTimeout(700);

  // 第 8 张：在录入屏上展开追问区，展示「AI 追问」这一交互
  if (num === '08') {
    await page.evaluate(() => {
      const a = document.getElementById('ask');
      if (a) a.classList.add('on');
    });
    await page.waitForTimeout(600);
  }

  const out = path.join(OUT, `原型-${num}.png`);
  await page.screenshot({ path: out });
  console.log(`  ✅ 原型-${num}.png  ${label}`);
}

await browser.close();
console.log('\n输出目录：', OUT);
