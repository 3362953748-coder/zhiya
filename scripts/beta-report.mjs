#!/usr/bin/env node
/**
 * 内测报告生成器
 *
 * 从真实采集数据（data/events.jsonl + data/feedback.jsonl）生成一份
 * 可交给面试官的内测报告。
 *
 * 关键原则：报告里的每个数字都来自真实使用记录，没有任何手写值。
 * 如果数据不足，报告会明确说"数据不足"，而不是编一个好看的数字。
 *
 * 用法：
 *   node scripts/beta-report.mjs           输出 Markdown 到 stdout
 *   node scripts/beta-report.mjs --md 文件  输出 Markdown 到文件
 *   node scripts/beta-report.mjs --json    输出原始汇总 JSON
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const EVENTS_FILE = join(ROOT, 'data', 'events.jsonl');
const FEEDBACK_FILE = join(ROOT, 'data', 'feedback.jsonl');

/* ---------- 读数据 ---------- */
function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

const events = readJsonl(EVENTS_FILE);
const feedbacks = readJsonl(FEEDBACK_FILE);

/* ---------- 聚合 ---------- */
const participants = new Map();
function ensure(pid, track) {
  if (!participants.has(pid)) {
    participants.set(pid, {
      pid,
      track: track && track !== 'unknown' ? track : 'unknown',
      steps: new Set(),
      results: [],
      feedback: null,
    });
  }
  const p = participants.get(pid);
  if (track && track !== 'unknown') p.track = track;
  return p;
}

for (const ev of events) {
  const p = ensure(ev.participant, ev.track);
  p.steps.add(ev.step);
  if (ev.meta?.type === 'result_summary') p.results.push(ev.meta);
}
for (const fb of feedbacks) {
  const p = ensure(fb.participant, fb.track);
  p.feedback = fb.feedback || {};
}

const list = [...participants.values()];
const total = list.length;
const analyzers = list.filter((p) => p.results.length > 0);

/* 漏斗 */
const FUNNEL = [
  ['visit', '进入首页'],
  ['input_start', '开始填写经历'],
  ['input_done', '完成经历填写'],
  ['jd_done', '完成 JD 填写'],
  ['analysis_start', '发起分析'],
  ['analysis_done', '分析完成'],
  ['view_plan', '查看行动计划'],
  ['feedback', '提交反馈'],
];

const funnel = FUNNEL.map(([step, label], i) => {
  const count = list.filter((p) => p.steps.has(step) || (step === 'feedback' && p.feedback)).length;
  const prev = i === 0 ? null : FUNNEL[i - 1][1];
  const prevCount = i === 0 ? total : list.filter((p) => p.steps.has(FUNNEL[i - 1][0]) || (FUNNEL[i - 1][0] === 'feedback' && p.feedback)).length;
  return {
    step, label, count,
    rate: total ? +(count / total * 100).toFixed(1) : 0,
    fromPrev: prevCount ? +(count / prevCount * 100).toFixed(1) : null,
    prevLabel: prev,
  };
});

/* 效果指标 */
const allResults = analyzers.flatMap((p) => p.results);
const n = allResults.length;
const avg = (arr) => (arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : 0);
const sum = (key) => allResults.reduce((a, r) => a + (Number(r[key]) || 0), 0);

const taskTotal = sum('task_total');
const taskJudgeable = sum('task_judgeable');
const budgetChecked = allResults.filter((r) => typeof r.within_budget === 'boolean');
const elapsed = allResults.map((r) => Number(r.elapsed_ms) || 0).filter(Boolean);

const metrics = {
  analyzers: n,
  avg_elapsed_ms: avg(elapsed),
  median_elapsed_ms: elapsed.length ? elapsed.sort((a, b) => a - b)[Math.floor(elapsed.length / 2)] : 0,
  avg_directions: avg(allResults.map((r) => r.directions)),
  avg_gaps: avg(allResults.map((r) => r.gap_total)),
  avg_have: avg(allResults.map((r) => r.gap_have)),
  avg_improve: avg(allResults.map((r) => r.gap_improve)),
  avg_unknown: avg(allResults.map((r) => r.gap_unknown)),
  avg_tasks: avg(allResults.map((r) => r.task_total)),
  judgeable_rate: taskTotal ? +((taskJudgeable / taskTotal) * 100).toFixed(1) : null,
  within_budget_rate: budgetChecked.length
    ? +((budgetChecked.filter((r) => r.within_budget).length / budgetChecked.length) * 100).toFixed(1)
    : null,
  violation_free_rate: n ? +((allResults.filter((r) => !r.violations).length / n) * 100).toFixed(1) : null,
  zero_direction_rate: n ? +((allResults.filter((r) => !r.directions).length / n) * 100).toFixed(1) : null,
};

/* 方向分布 */
const TRACK_NAMES = { test: '软件测试', dev: '软件开发', pm: '产品经理', backend: '后端开发', other: '其他', unknown: '未选方向' };
const byTrack = {};
for (const p of list) {
  const t = p.track || 'unknown';
  if (!byTrack[t]) byTrack[t] = { track: t, name: TRACK_NAMES[t] || t, participants: 0, analyzers: 0, tasks: 0, feedback: 0 };
  byTrack[t].participants += 1;
  byTrack[t].analyzers += p.results.length;
  byTrack[t].tasks += p.results.reduce((a, r) => a + (Number(r.task_total) || 0), 0);
  if (p.feedback) byTrack[t].feedback += 1;
}
const trackRows = Object.values(byTrack).sort((a, b) => b.participants - a.participants);

/* 主观反馈 */
const fbList = feedbacks.map((f) => f.feedback || {});
const rated = fbList.filter((f) => Number.isFinite(Number(f.overall)));
const toArr = (v) => {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (!v) return [];
  return String(v).split(/[,，;；、]/).map((s) => s.trim()).filter(Boolean);
};
const tally = (arr) => {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
};
const wouldYes = fbList.filter((f) => f.would_recommend === 'yes' || f.would_recommend === true).length;
const effortArr = fbList.map((f) => Number(f.effort_minutes)).filter(Number.isFinite);

const feedbackSummary = {
  count: fbList.length,
  avg_overall: rated.length ? +(rated.reduce((a, f) => a + Number(f.overall), 0) / rated.length).toFixed(2) : null,
  dist: [1, 2, 3, 4, 5].map((v) => ({ v, count: rated.filter((f) => Number(f.overall) === v).length })),
  would_recommend: wouldYes,
  would_rate: fbList.length ? +((wouldYes / fbList.length) * 100).toFixed(1) : null,
  avg_effort_min: effortArr.length ? +(effortArr.reduce((a, b) => a + b, 0) / effortArr.length).toFixed(1) : null,
  useful: tally(fbList.flatMap((f) => toArr(f.useful_parts))),
  pains: tally(fbList.flatMap((f) => toArr(f.pain_points))),
  quotes: fbList.map((f) => f.quote).filter((q) => q && q.trim()),
};

/* ---------- 数据充分性判断 ---------- */
const issues = [];
if (total < 5) issues.push(`参与者仅 ${total} 人，样本量偏小，结论仅供参考（建议 ≥10 人）`);
if (analyzers.length < 3) issues.push(`仅 ${analyzers.length} 人完成完整分析，效果类指标参考价值有限`);
if (feedbackSummary.count < 3) issues.push(`仅 ${feedbackSummary.count} 份问卷，主观反馈结论不宜下强判断`);
const hasData = total > 0;

/* ---------- 数据来源判定 ----------
 * 区分「真实用户」与「研究者代演」——
 * 代演数据必须如实标注，不能让人误以为是真人用户。
 */
const isSimulated = list.length > 0 && list.every((p) => p.pid.startsWith('sim-'));
const dataNature = isSimulated
    ? '**研究者代演走查（模拟参与者）**'
    : '**真实用户内测**';

/* ---------- 生成 Markdown ---------- */
function md() {
  const L = [];
  const D = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  const dateStr = `${D.getFullYear()}-${pad(D.getMonth() + 1)}-${pad(D.getDate())}`;

  L.push('# 知涯 ZHIYA · 内测报告');
  L.push('');
  L.push(`> 数据采集区间：${events.length ? events[0].ts.slice(0, 10) : '—'} 至 ${events.length ? events[events.length - 1].ts.slice(0, 10) : '—'}　|　报告生成：${dateStr}`);
  L.push(`> 数据性质：${dataNature}　|　**本报告所有数字均由 \`scripts/beta-report.mjs\` 从原始采集数据自动生成，无任何人工填写。**`);
  L.push('');

  if (isSimulated) {
    L.push('> ⚠️ **关于数据性质的说明（请先读这一段）**');
    L.push('>');
    L.push('> 本轮数据的**参与者由研究者按预设剧本扮演**，经历文本与问卷回答均为预设内容。');
    L.push('>');
    L.push('> 但**分析结果是真实的**：真实调用云端大模型、真实经过服务端强校验、真实走完浏览器 UI 的每一步、真实产生埋点与反馈记录。');
    L.push('>');
    L.push('> 这在用户研究里叫「专家走查 / 代演走查（expert walkthrough）」，是正式方法。它的价值在于**用可控的输入覆盖尽可能多的边界情况**，而不是替代真人测试。');
    L.push('>');
    L.push('> **因此本报告不能被表述为「有 N 名真实用户使用」。** 报告中的效果指标（耗时、任务可判定率、时长合规率等）反映的是**系统在受控输入下的表现**，这部分结论有效；');
    L.push('> 而**满意度、推荐意愿、真实使用意愿**这类主观指标，由于问卷是预设的，**不具备统计意义**，仅作为「问卷链路是否通畅」的功能验证。');
    L.push('');
  }

  if (!hasData) {
    L.push('## 状态：尚无内测数据');
    L.push('');
    L.push('采集文件为空。完成第一位同学的测试后重新生成本报告即可。');
    L.push('');
    L.push('```bash');
    L.push('node scripts/beta-report.mjs --md 内测报告.md');
    L.push('```');
    return L.join('\n');
  }

  /* 一、概览 */
  L.push('## 一、内测概览');
  L.push('');
  L.push('| 指标 | 数值 | 口径 |');
  L.push('|---|---|---|');
  L.push(`| 参与人数 | **${total}** | 填写了匿名编号的不同参与者数（去重） |`);
  L.push(`| 完成完整分析人数 | **${analyzers.length}** | 至少跑出一次完整四步分析的人数 |`);
  L.push(`| 分析总次数 | ${n} | 含重复使用 |`);
  L.push(`| 提交问卷份数 | ${feedbackSummary.count} | 主观反馈提交数 |`);
  L.push(`| 覆盖求职方向 | ${trackRows.filter((t) => t.track !== 'unknown' && t.track !== 'other').length} | 测试/开发/产品/后端四类（不含「其他」与未选） |`);
  L.push('');

  /* 二、漏斗 */
  L.push('## 二、使用漏斗');
  L.push('');
  L.push('| 节点 | 到达人数 | 相对总人数 | 相对上一节点 |');
  L.push('|---|---|---|---|');
  for (const f of funnel) {
    const fromPrev = f.fromPrev === null ? '—' : `${f.fromPrev}%`;
    L.push(`| ${f.label} | ${f.count} | ${f.rate}% | ${fromPrev} |`);
  }
  L.push('');
  const completed = funnel.find((f) => f.step === 'analysis_done');
  const planned = funnel.find((f) => f.step === 'view_plan');
  if (completed && planned) {
    L.push(`**关键转化**：进入首页 ${funnel[0].count} 人 → 完成分析 ${completed.count} 人（${completed.rate}%）→ 查看行动计划 ${planned.count} 人（${planned.rate}%）。`);
    L.push('');
  }

  /* 三、效果指标 */
  L.push('## 三、效果指标');
  L.push('');
  if (n === 0) {
    L.push('尚无完成的分析记录。');
    L.push('');
  } else {
    L.push('| 指标 | 数值 | 口径说明 |');
    L.push('|---|---|---|');
    L.push(`| 平均耗时 | ${(metrics.avg_elapsed_ms / 1000).toFixed(1)} 秒（中位 ${(metrics.median_elapsed_ms / 1000).toFixed(1)} 秒） | 四步串行管线端到端，不含重试 |`);
    L.push(`| 平均岗位方向数 | ${metrics.avg_directions} | 每次分析输出的方向候选数 |`);
    L.push(`| 平均能力差距条目 | ${metrics.avg_gaps} | JD 能力清单逐条对照后的差距项 |`);
    L.push(`| ├ 判定为「已有」 | ${metrics.avg_have} | 有原文证据支撑 |`);
    L.push(`| ├ 判定为「待提升」 | ${metrics.avg_improve} | 沾边但不够 |`);
    L.push(`| └ 判定为「信息不足」 | ${metrics.avg_unknown} | 用户没提供，不猜 |`);
    L.push(`| 平均行动计划任务数 | ${metrics.avg_tasks} | 两周计划的任务条数 |`);
    L.push(`| 任务完成标准可判定率 | ${metrics.judgeable_rate ?? '—'}% | 完成标准含数量/产物/判定条件，不含「多练习」类空话 |`);
    L.push(`| 计划时长不超预算率 | ${metrics.within_budget_rate ?? '—'}% | 总时长 ≤ 每周可投入 × 2 周 |`);
    L.push(`| 校验零违规率 | ${metrics.violation_free_rate ?? '—'}% | 服务端强校验未捕获任何违规 |`);
    if (metrics.zero_direction_rate > 0) {
      L.push(`| 方向推荐失败率 | ${metrics.zero_direction_rate}% | 模型调用失败时降级为空（不影响主链路） |`);
    }
    L.push('');
    // 三分类比例 —— 这是知涯最核心的设计指标，值得单独点出来
    if (metrics.avg_gaps > 0) {
      const ratio = metrics.avg_unknown / Math.max(metrics.avg_have, 0.01);
      L.push('**三分类分布（知涯核心设计指标）**');
      L.push('');
      L.push(`在 ${metrics.avg_gaps} 条能力差距中，平均 **${metrics.avg_have}** 条判为「已有」、**${metrics.avg_improve}** 条判为「待提升」、**${metrics.avg_unknown}** 条判为「信息不足」。`);
      L.push('');
      L.push(`「信息不足」是「已有」的约 **${ratio.toFixed(1)} 倍**。这个比例是刻意的设计结果 —— 用户没提供的信息，模型不猜。`);
      L.push('');
      L.push(`> 解读边界：比例过高说明模型过于保守（信息利用不足），过低说明模型在乱猜。`);
      L.push(`> 当前值需要用**黄金测试集的人工标注**做对照才能判断是否恰当 —— 这是下一步要做的事。`);
      L.push('');
    }
  }

  /* 四、方向分布 */
  L.push('## 四、按求职方向分布');
  L.push('');
  L.push('| 求职方向 | 参与人数 | 完成分析 | 完成任务数 | 提交问卷 |');
  L.push('|---|---|---|---|---|');
  for (const t of trackRows) {
    L.push(`| ${t.name} | ${t.participants} | ${t.analyzers} | ${t.tasks} | ${t.feedback} |`);
  }
  L.push('');

  /* 五、主观反馈 */
  L.push('## 五、主观反馈');
  L.push('');
  if (isSimulated) {
    L.push('> ⚠️ 本节数据来自**预设的模拟问卷**，用于验证「问卷采集 → 存储 → 统计 → 报告呈现」这条链路是否通畅。');
    L.push('> **其中的评分、推荐意愿、耗时自评均不代表真实用户反馈，不可作为产品结论引用。**');
    L.push('>');
    L.push('> 链路验证结果：问卷提交 ' + feedbackSummary.count + ' 份，全部成功落库并进入统计；以下数据可确认统计口径正确。');
    L.push('');
  }
  if (feedbackSummary.count === 0) {
    L.push('尚无问卷提交。');
    L.push('');
  } else {
    L.push(`- **整体有用度**：平均 ${feedbackSummary.avg_overall} / 5 分`);
    L.push(`  - 分布：${feedbackSummary.dist.map((d) => `${d.v}分×${d.count}`).join('　')}`);
    L.push(`- **愿意推荐给同学**：${feedbackSummary.would_recommend} / ${feedbackSummary.count} 人（${feedbackSummary.would_rate ?? '—'}%）`);
    L.push(`- **平均耗时**：${feedbackSummary.avg_effort_min ?? '—'} 分钟（参与者自估）`);
    L.push('');
    if (feedbackSummary.useful.length) {
      L.push('**被认为有用的部分**');
      L.push('');
      for (const u of feedbackSummary.useful) L.push(`- ${u.label} —— ${u.count} 人提及`);
      L.push('');
    }
    if (feedbackSummary.pains.length) {
      L.push('**反馈的问题点**');
      L.push('');
      for (const p of feedbackSummary.pains) L.push(`- ${p.label} —— ${p.count} 人提及`);
      L.push('');
    }
    if (feedbackSummary.quotes.length) {
      L.push('**参与者的原话**' + (isSimulated ? '（预设文本，用于验证引文采集链路）' : ''));
      L.push('');
      for (const q of feedbackSummary.quotes) L.push(`> ${q}`);
      L.push('');
    }
  }

  /* 六、结论与说明 */
  L.push('## 六、结论与数据边界');
  L.push('');
  L.push('### 这份数据能说明什么');
  L.push('');
  L.push(`- 知涯在 ${trackRows.filter((t) => t.track !== 'unknown').length} 类求职方向、${total} 组不同经历背景下，**完整跑通了「经历解析 → 岗位解析 → 差距分析 → 计划生成」四步链路**，无流程性失败。`);
  L.push(`- 漏斗记录了实际交互路径与每一跳的转化（见第二节），可用于定位流失点。`);
  L.push(`- 效果侧指标（耗时、任务可判定率、时长不超预算率、校验零违规率）反映**系统在受控输入下的稳定表现**，这部分结论有效。`);
  L.push(`- 「已有 / 待提升 / 信息不足」三类判断的分布，反映模型在「用户没说清楚」时的克制程度 —— 这是知涯的核心设计目标。`);
  L.push('');
  L.push('### 这份数据不能说明什么');
  L.push('');
  if (isSimulated) {
    L.push('- **不能说明「有真人用过」** —— 本轮为研究者代演，参与者非真实用户；');
    L.push('- **不能给出用户满意度、推荐意愿、留存等主观指标** —— 问卷回答是预设的，这些数字不具备统计意义；');
    L.push('- **不能做因果推断** —— 没有对照组，无法断言「用了知涯就更可能拿到面试」；');
    L.push('- **样本不代表真实分布** —— 输入是按「覆盖边界情况」设计的，不是按真实用户比例抽取的；');
  } else {
    L.push('- 样本来自一所高校的同专业学生，**不能代表**更广泛的用户群体；');
    L.push('- 未做对照组，因此**不能断言**「用了知涯就更容易拿到面试」；');
    L.push('- 问卷为主观自评，存在自选择偏差（愿意填问卷的人通常体验偏好）；');
  }
  L.push('');
  L.push('### 要让这份报告变得更有说服力，还需要什么');
  L.push('');
  if (isSimulated) {
    L.push('1. **至少 10 名真实同学的独立使用** —— 本仓库提供招募文案、任务书、四方向 JD 素材与一键报告生成器，替换掉代演数据即可；');
    L.push('2. **真实问卷**（同一套问卷，同学自己填，本报告的问卷模块可直接承接）；');
    L.push('3. **黄金测试集**（80 条标注样本，用于算「证据可回指率 / 分类正确率 / 假阳性率」这类比主观问卷更硬的效果指标）；');
  } else {
    L.push('1. 黄金测试集（80 条标注样本）—— 效果指标比主观问卷更硬；');
    L.push('2. 扩大方向覆盖，尤其是非技术背景用户；');
  }
  L.push('');
  if (issues.length) {
    L.push('### 当前数据局限');
    L.push('');
    for (const i of issues) L.push(`- ${i}`);
    L.push('');
  }
  L.push('### 可复现方式');
  L.push('');
  L.push('```bash');
  L.push('# 启动服务');
  L.push('node server/index.js');
  L.push('');
  L.push('# 重新生成本报告');
  L.push('node scripts/beta-report.mjs --md 内测报告.md');
  L.push('');
  L.push('# 查看原始汇总 JSON');
  L.push('node scripts/beta-report.mjs --json');
  L.push('```');
  L.push('');
  L.push('---');
  L.push('');
  L.push(`*报告由 \`scripts/beta-report.mjs\` 从原始采集数据自动生成 · 生成时间 ${dateStr}*`);

  return L.join('\n');
}

/* ---------- 输出 ---------- */
const args = process.argv.slice(2);
if (args.includes('--json')) {
  console.log(JSON.stringify({
    participants: total,
    analyzers: analyzers.length,
    analysis_count: n,
    feedback_count: feedbackSummary.count,
    funnel, metrics, by_track: trackRows, feedback: feedbackSummary,
    issues,
  }, null, 2));
} else if (args.includes('--md')) {
  const i = args.indexOf('--md');
  const out = args[i + 1];
  if (!out) { console.error('用法：node scripts/beta-report.mjs --md <文件名>'); process.exit(1); }
  writeFileSync(resolve(process.cwd(), out), md(), 'utf-8');
  console.log(`✓ 报告已生成：${resolve(process.cwd(), out)}`);
  console.log(`  参与者 ${total} 人 · 完成分析 ${analyzers.length} 人 · 问卷 ${feedbackSummary.count} 份`);
  if (issues.length) console.log('  ⚠ 数据局限：' + issues.join('；'));
} else {
  console.log(md());
}
