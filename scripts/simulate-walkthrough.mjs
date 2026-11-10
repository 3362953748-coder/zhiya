/**
 * 模拟走查执行器（研究者代演）
 *
 * ⚠️ 重要说明 —— 这不是"真人用户测试"：
 *   参与者由研究者按预设脚本扮演，经历文本与问卷回答都是预设的。
 *   但**分析结果是真实的**：真实调用云端大模型、真实经过服务端强校验、
 *   真实走完浏览器 UI 的每一步、真实产生埋点与反馈数据。
 *
 *   这在用户研究里叫「专家走查 / 代演走查（expert walkthrough）」，
 *   是正式方法，但报告中必须如实标注为「研究者代演」，
 *   绝不能对面试官说成是真人用户数据。
 *
 * 用途：为内测报告提供第一批结构完整、可复现的数据，
 *      同时用真实链路暴露产品缺陷（这才是它最大的价值）。
 *
 * 用法：
 *   node scripts/simulate-walkthrough.mjs              跑全部剧本
 *   node scripts/simulate-walkthrough.mjs --only 3     只跑第 3 个剧本
 *   node scripts/simulate-walkthrough.mjs --headed     显示浏览器窗口
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.SIM_PORT) || 5188;
const BASE = `http://127.0.0.1:${PORT}`;

/* ---------- 剧本 ----------
 * 每个角色 = 一个模拟参与者：编号、方向、经历、目标 JD、预期观察点。
 * 经历文本取自《知涯内测-JD测试素材.md》的示例库，
 * JD 取自同文件的真实 JD 改写版。
 */
const SCRIPTS = [
  {
    pid: 'sim-01', track: 'backend', jd: 'A4',
    name: '后端项目完整型',
    raw: '大三上学期做的校园二手交易平台，我负责后端。Spring Boot + MySQL + Redis，实现了用户、商品、订单、支付、评论 5 个模块、60 多个接口。用 JMeter 压到 500 QPS，商品列表接口 P99 从 820ms 优化到 190ms，主要靠加索引和 Redis 缓存。用 Docker Compose 部署，Git 上有 43 次提交。',
    expect: '应识别出高并发/性能优化为核心优势，不应把「有项目」笼统判为已有而漏掉分布式、监控等真实差距',
    fb: { overall: 5, useful: ['岗位方向建议', '能力差距判断', '行动计划'], pains: [], effort: 15, rec: 'yes', quote: '差距判断挺准的，直接告诉我还缺分布式和监控，比我自己瞎投强。' },
  },
  {
    pid: 'sim-02', track: 'test', jd: 'A1',
    name: '软工课程设计型',
    raw: '我们组的软件工程课程设计做了一个智慧选课系统，5 个人，我负责需求分析和数据库设计。写了需求规格说明书和用例图，数据库 8 张表，测试同学照我的用例设计文档跑了 120 多条用例。后来加了 AI 助教问答功能，用 RAG 做了个 demo。',
    expect: '软工「需求分析→用例设计」链条应被识别为测试岗与产品岗的加分资产，而非普通课程作业',
    fb: { overall: 5, useful: ['能力差距判断', '行动计划'], pains: [], effort: 15, rec: 'yes', quote: '它注意到我写过用例图，建议我去投测试开发，这个方向我完全没想到。' },
  },
  {
    pid: 'sim-03', track: 'dev', jd: 'A2',
    name: '竞赛型',
    raw: '参加过两次数模和一次蓝桥杯。C 组校赛二等奖，主要负责建模和 Python 数据处理那段；蓝桥杯 Java 省级二等奖。另有一个 ACM 训练队经历，做过 100 多道题。',
    expect: '竞赛获奖应正确映射到开发岗加分项，不应归为「有竞赛但不知道有什么用」',
    fb: { overall: 4, useful: ['岗位方向建议', '行动计划'], pains: ['等待太久'], effort: 15, rec: 'yes', quote: '方向建议挺准。等待有点久，等的时候不知道在干嘛。' },
  },
  {
    pid: 'sim-04', track: 'pm', jd: 'A3',
    name: '社团运营型（转产品）',
    raw: '我们社团搞校园二手书交换，我负责运营。每学期办 2 场，场均 200 人左右，用问卷收了 180 多条反馈，做了 3 张数据看板分析换书品类偏好。还负责公众号推文，写过 20 多篇，阅读量最高 3000 多。',
    expect: '「反馈收集→数据整理→复盘」应被识别为可迁移的产品能力，而非判为与产品岗无关',
    fb: { overall: 5, useful: ['岗位方向建议', '行动计划'], pains: [], effort: 6, rec: 'yes', quote: '我以为社团运营没用，它说我做过用户调研和数据复盘，这不就是产品经理干的事吗。' },
  },
  {
    pid: 'sim-05', track: 'other', jd: 'B3',
    name: '纯文科型',
    raw: '我是汉语言文学专业的，没写过代码，也没做过项目。选过一门 Python 选修课，考了 88 分。平时喜欢看小红书运营的账号，想做内容或者用户方向。',
    expect: '对非技术背景+非技术岗位用户，应给可行入门路径，绝不能出现「先学 Java 和 MySQL」这类错配建议',
    fb: { overall: 4, useful: ['岗位方向建议', '行动计划'], pains: ['不符合我的目标岗位'], effort: 6, rec: 'maybe', quote: '方向是给对了，但有几个建议还是让我去学技术，不太适合我。' },
  },
  {
    pid: 'sim-06', track: 'backend', jd: 'C4',
    name: '零基础信息不足型',
    raw: '基本上没做过什么项目，就想找个实习。',
    expect: '绝不能乱猜经历。理想表现是明说信息不足并追问，而不是虚构经历或套模板',
    fb: { overall: 4, useful: ['经历追问'], pains: [], effort: 3, rec: 'yes', quote: '它没有瞎编我的经历，一直在问我做过什么，这点我觉得挺靠谱的。' },
  },
  {
    pid: 'sim-07', track: 'dev', jd: 'C2',
    name: '模糊描述型',
    raw: '做过一个网站的作业，就那样。',
    expect: '应识破「做过」不等于「有产出」，并追问人数/负责模块/是否上线 —— 主动追问是分水岭',
    fb: { overall: 4, useful: ['经历追问'], pains: ['看不懂'], effort: 3, rec: 'maybe', quote: '追问挺细的，不过结果页面有点难懂，得看两遍。' },
  },
  {
    pid: 'sim-08', track: 'backend', jd: 'A4',
    name: '转专业型',
    raw: '我原来是学新闻的，大二转到了软件工程。现在大三，Java 学了一学期，做过一个学生成绩管理的小系统，用的是 Spring Boot，还没部署。',
    expect: '不应因「有项目」就判为已具备项目经验，需暴露部署、测试、协作等真实差距',
    fb: { overall: 4, useful: ['能力差距判断', '行动计划'], pains: [], effort: 15, rec: 'yes', quote: '它说我这个项目还没部署不算完整，给了要补什么，比我自己判断准。' },
  },
  {
    pid: 'sim-09', track: 'dev', jd: 'A2',
    name: '参与非负责人型（易误判）',
    raw: '我们团队做了一个校园活动报名的小程序，我是组员，一共 4 个人。我参与写了一些接口，主要是报名和签到这两个功能，大概 8 个接口。我们组还拿了个校级立项。',
    expect: '重点：不能把「参与」误判成「已有独立项目能力」，应指出缺少独立负责模块，且不能给「再做一个项目」的空话',
    fb: { overall: 3, useful: ['能力差距判断'], pains: ['结果不准确', '任务太大做不了'], effort: 15, rec: 'no', quote: '有点失望，它好像觉得我项目做得挺好的，但我其实只写了两个接口。' },
  },
  {
    pid: 'sim-10', track: 'pm', jd: 'D3',
    name: '矛盾JD型',
    raw: '大三学生，做过校园公众号运营和一点 Python，想做产品。会写 PRD，做过用户访谈但没上线过产品。',
    expect: '面对自相矛盾的 JD，应稳定输出并把矛盾点标为信息不足，而不是随便选一边',
    fb: { overall: 4, useful: ['证据与依据'], pains: ['结果不准确'], effort: 15, rec: 'maybe', quote: '这个岗位要求写着既要零经验又要三年经验，它处理得还可以。' },
  },
  {
    pid: 'sim-11', track: 'test', jd: 'A1',
    name: '测试工具型',
    raw: '软工专业大三，做过课程设计有测试环节但只是手动点。自学过 Python，能写简单脚本，做过 30 道算法题。用过 Postman 测接口。没用过 JMeter。',
    expect: '应把「会用 Postman/写过脚本」映射为测试岗基础项，同时准确指出 JMeter/自动化框架等缺口',
    fb: { overall: 4, useful: ['能力差距判断', '行动计划'], pains: [], effort: 15, rec: 'yes', quote: '明确告诉我下一步该学 JMeter，还给了练习任务数，这种感觉很实在。' },
  },
  {
    pid: 'sim-12', track: 'backend', jd: 'A4',
    name: '有实习型',
    raw: '大三，在一家小公司实习了两个月，做的是用 Java 写订单系统的接口对接，参与了需求评审和 bug 修复会议。用了 MySQL 和 Redis，没碰过高并发，也没写过技术文档。',
    expect: '实习经历应被正确认可为工程经验，但「需求评审参与」不应被夸大为完整产品职责',
    fb: { overall: 4, useful: ['经历追问', '行动计划'], pains: [], effort: 6, rec: 'yes', quote: '问我实习里具体做了什么细节，比我面试被问的还细。' },
  },
];

/* ---------- 载入 JD ---------- */
function loadJds() {
  const p = join(ROOT, 'docs', '内测JD素材.json');
  if (!existsSync(p)) {
    console.error(`找不到 ${p}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, 'utf-8'));
}

/* ---------- 主流程 ---------- */
const args = process.argv.slice(2);
const only = args.includes('--only') ? Number(args[args.indexOf('--only') + 1]) : null;
const headed = args.includes('--headed');

const JDS = loadJds();
const scripts = only ? SCRIPTS.filter((s) => SCRIPTS.indexOf(s) + 1 === only) : SCRIPTS;

console.log(`\n模拟走查 · 共 ${scripts.length} 个剧本`);
console.log('（数据真实：真实调模型、真实校验、真实 UI 流程；参与者为研究者代演）\n');

/* 启动后端 */
const server = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch (_) { /* retry */ }
    await sleep(400);
  }
  return false;
}

/**
 * 走完一个参与者的完整流程
 */
async function runOne(page, s, chromium) {
  const log = [];
  const rec = (m) => { log.push(m); };

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // 填参与信息
  await page.fill('#betaPid', s.pid);
  await page.waitForTimeout(250);
  await page.click(`.betaTrack[data-track="${s.track}"]`);
  await page.waitForTimeout(250);

  // 进入背景录入
  await page.click('button[data-go="s2"]');
  await page.waitForTimeout(350);
  await page.fill('#rawText', s.raw);
  await page.waitForTimeout(250);

  // 触发分析（内部会先跳到 JD 页）
  await page.click('#btnParse');
  await page.waitForTimeout(500);

  // 填 JD
  const jd = JDS[s.jd];
  if (!jd) throw new Error(`缺少 JD：${s.jd}`);
  await page.fill('#jdText', jd);
  await page.waitForTimeout(300);

  // 发起分析
  const t0 = Date.now();
  await page.click('#btnToGap');

  // 等分析完成 + 等反馈入口出现
  // 完成判据：差距卡片（.gapcard）或方向卡片（.dcard）渲染出来
  // 注意：applyResult 里是「先渲染卡片 → 再插入反馈入口」，
  // 所以卡片出现时入口可能还没建好，必须等入口真的出现。
  let finished = false;
  for (let i = 0; i < 100; i += 1) {
    await sleep(2000);
    const done = await page.evaluate(() => {
      const gap = document.querySelectorAll('.gapcard').length;
      const dir = document.querySelectorAll('.dcard').length;
      return gap > 0 || dir > 0;
    });
    if (done) { finished = true; break; }
  }
  const elapsed = Date.now() - t0;
  if (!finished) {
    rec(`✗ ${s.pid} 分析未在 200 秒内完成`);
    return { pid: s.pid, ok: false, elapsed, log };
  }

  // 抓取结果内容用于质量评估
  const result = await page.evaluate(() => {
    const text = document.body.innerText;
    // 差距卡片的 unknown 态带 .unknown 类
    const gapCards = [...document.querySelectorAll('.gapcard')];
    const gapUnknown = gapCards.filter((e) => e.classList.contains('unknown')).length;
    const gapHave = gapCards.filter((e) => e.querySelector('.tag.th')).length;
    const gapImprove = gapCards.filter((e) => e.querySelector('.tag.tu')).length;
    const tasks = document.querySelectorAll('.task').length;
    const dirs = document.querySelectorAll('.dcard').length;
    return {
      textLen: text.length,
      gapUnknown, gapHave, gapImprove, tasks, dirs,
      hasViolation: /违规|校验失败/.test(text),
    };
  });
  rec(`✓ ${s.pid} ${s.name} · ${(elapsed / 1000).toFixed(1)}s · 方向 ${result.dirs} · 差距 ${result.gapHave}/${result.gapImprove}/${result.gapUnknown} · 任务 ${result.tasks}`);

  // 走到行动计划页，让 view_plan 埋点触发
  //
  // 反馈入口 #navFb 插在 s6 的导航栏里。三个坑要避开：
  //   1. applyResult 里「先渲染卡片 → 再插入入口」，卡片出现时入口可能还没建好
  //   2. s6 屏初始 display:none，未激活时 getBoundingClientRect 全为 0
  // 所以分两步：先等入口「存在」，切屏后再等它「可见」。
  let hasFb = false;
  for (let i = 0; i < 20; i += 1) {
    await sleep(500);
    hasFb = await page.evaluate(() => !!document.querySelector('#navFb'));
    if (hasFb) break;
  }
  if (!hasFb) {
    rec(`  ⚠ ${s.pid} 未生成反馈入口`);
    return { pid: s.pid, ok: true, elapsed, result, noFeedback: true, log };
  }

  // 切到行动计划屏，让入口可见，同时触发 view_plan 埋点
  // 用 go('s6') 而不是点 dot —— dot 索引依赖 NAMES 顺序，直接调更稳
  await page.evaluate(() => {
    if (typeof go === 'function') go('s6');
  });
  await sleep(800);

  for (let i = 0; i < 10; i += 1) {
    const visible = await page.evaluate(() => {
      const nav = document.querySelector('#navFb');
      if (!nav) return false;
      const r = nav.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (visible) break;
    await sleep(400);
  }

  await page.click('#navFb');
  await page.waitForTimeout(700);

  await page.click(`#fbRate .fbR[data-v="${s.fb.overall}"]`);
  await page.waitForTimeout(150);
  for (const u of s.fb.useful) {
    await page.evaluate((label) => {
      const box = [...document.querySelectorAll('#fbUseful input')].find((i) => i.value === label);
      if (box && !box.checked) box.click();
    }, u);
  }
  for (const p of s.fb.pains) {
    await page.evaluate((label) => {
      const box = [...document.querySelectorAll('#fbPain input')].find((i) => i.value === label);
      if (box && !box.checked) box.click();
    }, p);
  }
  await page.click(`#fbEffort .fbC2[data-v="${s.fb.effort}"]`);
  await page.waitForTimeout(120);
  await page.click(`#fbRec .fbC2[data-v="${s.fb.rec}"]`);
  await page.waitForTimeout(120);
  await page.fill('#fbQuote', s.fb.quote);
  await page.waitForTimeout(200);

  const btnDisabled = await page.evaluate(() => document.querySelector('#btnFb').disabled);
  if (btnDisabled) {
    rec(`  ⚠ ${s.pid} 提交按钮仍禁用`);
  } else {
    await page.click('#btnFb');
    await page.waitForTimeout(1500);
    const submitted = await page.evaluate(() => document.querySelector('#btnFb').textContent);
    rec(`  · 问卷提交：${submitted}`);
  }

  return { pid: s.pid, ok: true, elapsed, result, log };
}

/* ---------- 执行 ---------- */
(async () => {
  if (!await waitForServer()) {
    console.error('后端启动失败');
    console.error(serverLog.slice(-800));
    server.kill();
    process.exit(1);
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: !headed });
  const results = [];

  // 并发跑：云端模型有重试与限流。
  // 并发 2 路是实测平衡点 —— 并发 3 时约 1/4 的请求会被限流拖到超时。
  const CONCURRENCY = Number(process.env.SIM_CONCURRENCY) || 2;
  const queue = scripts.map((s) => s);

  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      try {
        const r = await runOne(page, s);
        if (pageErrors.length) r.pageErrors = pageErrors;
        results.push(r);
        (r.log || []).forEach((l) => console.log(l));
        if (pageErrors.length) console.log(`  ⚠ JS 错误：${pageErrors.join(' | ')}`);
      } catch (e) {
        console.log(`✗ ${s.pid} ${s.name} 失败：${e.message}`);
        results.push({ pid: s.pid, ok: false, error: e.message, log: [] });
      }
      await ctx.close();
      await sleep(800);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY, scripts.length); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  await browser.close();
  server.kill();

  results.sort((a, b) => a.pid.localeCompare(b.pid));
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n═══ 走查完成 ═══`);
  console.log(`成功 ${ok} / ${results.length}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log('\n失败清单：');
    for (const f of failed) console.log(`  ${f.pid}: ${f.error || '未知'}`);
  }
  const noFb = results.filter((r) => r.noFeedback);
  if (noFb.length) console.log(`\n未出现反馈入口：${noFb.map((r) => r.pid).join(', ')}`);
  process.exit(0);
})();
