/**
 * 内测数据采集层
 *
 * 目的：让「有人用过」这句话有据可查。
 * 采集三类数据：
 *   1. 漏斗事件 —— 每个关键节点的进入/完成，用来算完成率
 *   2. 结果摘要 —— 每次分析产出的结构化摘要，用来算效果指标
 *   3. 主观反馈 —— 参与者填写的问卷，用来算满意度与改进项
 *
 * 落盘为 JSONL（每行一个事件），便于用任何工具统计。
 * 不采集任何个人身份信息：参与者只带自选的匿名编号。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const EVENTS_FILE = join(DATA_DIR, 'events.jsonl');
const FEEDBACK_FILE = join(DATA_DIR, 'feedback.jsonl');

/* ---------- 漏斗节点定义 ----------
 * 顺序即漏斗顺序，统计时按此顺序算每一跳的转化率。
 */
export const FUNNEL_STEPS = [
  { id: 'visit', label: '进入首页' },
  { id: 'input_start', label: '开始填写经历' },
  { id: 'input_done', label: '完成经历填写' },
  { id: 'jd_done', label: '完成 JD 填写' },
  { id: 'analysis_start', label: '发起分析' },
  { id: 'analysis_done', label: '分析完成' },
  { id: 'view_plan', label: '查看行动计划' },
  { id: 'feedback', label: '提交反馈' },
];

const EVENT_IDX = new Map(FUNNEL_STEPS.map((s, i) => [s.id, i]));

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function appendJsonl(file, obj) {
  try {
    ensureDir();
    appendFileSync(file, JSON.stringify(obj) + '\n', 'utf-8');
    return true;
  } catch (e) {
    console.warn(`[telemetry] 写入失败：${e.message}`);
    return false;
  }
}

/**
 * 记录一个漏斗事件
 * @param {object} p
 * @param {string} p.participant  匿名参与者编号（同学自选，如 "cq-01"）
 * @param {string} p.step         FUNNEL_STEPS 里的 id
 * @param {string} [p.track]      求职方向：test / dev / pm / backend / other
 * @param {object} [p.meta]       附加信息（不含个人身份）
 *
 * 去重：同一个参与者的同一个节点在 3 秒内只记一次。
 * 原因：前端有些节点会被连续触发（如重复点击、go() 与按钮回调同时上报），
 * 不去重会让漏斗上出现「1 人完成 3 次」这种失真数据。
 */
const recentEvents = new Map(); // key: participant|step|track -> ts

export function track({ participant, step, track: trackName, meta }) {
  if (!participant || !step) return false;
  if (!EVENT_IDX.has(step)) {
    console.warn(`[telemetry] 未知节点：${step}`);
    return false;
  }

  const key = `${participant}|${step}|${trackName || 'unknown'}`;
  const now = Date.now();
  const last = recentEvents.get(key) || 0;
  if (now - last < 3000) return false;   // 3 秒内重复，忽略
  recentEvents.set(key, now);

  // 防止 Map 无限增长（长跑的内测服务）
  if (recentEvents.size > 5000) {
    const cutoff = now - 60000;
    for (const [k, ts] of recentEvents) {
      if (ts < cutoff) recentEvents.delete(k);
    }
  }

  return appendJsonl(EVENTS_FILE, {
    ts: new Date().toISOString(),
    participant: String(participant),
    step,
    step_index: EVENT_IDX.get(step),
    track: trackName || 'unknown',
    meta: meta || {},
  });
}

/**
 * 记录一次完整分析的结果摘要 —— 用于算效果指标
 * @param {object} p
 * @param {string} p.participant
 * @param {string} [p.track]
 * @param {object} p.result  publicState 的输出
 * @param {object} [p.perf]  性能数据
 */
export function trackResult({ participant, track: trackName, result, perf }) {
  if (!participant || !result) return false;
  const gaps = result.gap_report?.items || [];
  const tasks = result.action_plan?.tasks || [];
  const have = gaps.filter((g) => g.status === 'have');
  const improve = gaps.filter((g) => g.status === 'improve');
  const unknown = gaps.filter((g) => g.status === 'unknown');

  // 可判定性检查：任务是否都带可判定的完成标准
  const judgeable = tasks.filter((t) => {
    const c = String(t.completion_criteria || '');
    return /\d|至少|不少于|包含|齐全|一致|不超过/.test(c);
  });

  // 计划时长约束是否成立
  const totalHours = Number(result.action_plan?.total_hours ?? 0);
  const weeklyBudget = Number(perf?.weekly_hours ?? 10);

  return appendJsonl(EVENTS_FILE, {
    ts: new Date().toISOString(),
    participant: String(participant),
    step: 'analysis_done',
    step_index: EVENT_IDX.get('analysis_done'),
    track: trackName || 'unknown',
    meta: {
      type: 'result_summary',
      directions: (result.directions || []).length,
      gap_total: gaps.length,
      gap_have: have.length,
      gap_improve: improve.length,
      gap_unknown: unknown.length,
      task_total: tasks.length,
      task_judgeable: judgeable.length,
      total_hours: totalHours,
      weekly_budget: weeklyBudget,
      within_budget: weeklyBudget > 0 ? totalHours <= weeklyBudget * 2 : null,
      violations: (result.violations || []).length,
      elapsed_ms: Number(perf?.elapsed_ms ?? 0) || null,
      model: perf?.model || 'unknown',
    },
  });
}

/**
 * 记录主观反馈
 */
export function trackFeedback({ participant, track: trackName, feedback }) {
  if (!participant || !feedback) return false;
  return appendJsonl(FEEDBACK_FILE, {
    ts: new Date().toISOString(),
    participant: String(participant),
    track: trackName || 'unknown',
    feedback,
  });
}

/* ---------- 统计 ---------- */

/**
 * 汇总漏斗与效果指标
 */
export function summarize() {
  ensureDir();
  const events = existsSync(EVENTS_FILE)
    ? readFileSync(EVENTS_FILE, 'utf-8').split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean)
    : [];

  const feedbacks = existsSync(FEEDBACK_FILE)
    ? readFileSync(FEEDBACK_FILE, 'utf-8').split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean)
    : [];

  // 按参与者聚合
  const byParticipant = new Map();
  const push = (pid, ev) => {
    if (!byParticipant.has(pid)) byParticipant.set(pid, { pid, events: [], track: ev.track, results: [], feedback: null });
    const p = byParticipant.get(pid);
    p.events.push(ev);
    if (ev.track && ev.track !== 'unknown') p.track = ev.track;
    if (ev.meta?.type === 'result_summary') p.results.push(ev.meta);
  };

  for (const ev of events) {
    if (ev.meta?.type === 'result_summary') push(ev.participant, ev);
    else if (ev.step) push(ev.participant, ev);
  }
  for (const fb of feedbacks) {
    if (!byParticipant.has(fb.participant)) {
      byParticipant.set(fb.participant, { pid: fb.participant, events: [], track: fb.track, results: [], feedback: null });
    }
    byParticipant.get(fb.participant).feedback = fb.feedback;
  }

  const participants = [...byParticipant.values()];
  const total = participants.length;

  // 漏斗：到达过该节点的人数 / 总参与者数
  const reached = new Set();
  const funnel = FUNNEL_STEPS.map((s) => {
    const n = participants.filter((p) =>
      p.events.some((e) => e.step === s.id) || (s.id === 'feedback' && p.feedback)
    ).length;
    reached.add(s.id);
    return {
      step: s.id,
      label: s.label,
      count: n,
      rate: total ? +(n / total * 100).toFixed(1) : 0,
    };
  });

  // 逐跳转化率
  const stepRate = funnel.map((f, i) => {
    if (i === 0) return { ...f, fromPrev: null };
    const prev = funnel[i - 1].count;
    return { ...f, fromPrev: prev ? +(f.count / prev * 100).toFixed(1) : null };
  });

  // 效果指标（仅统计真正跑出结果的人）
  const allResults = participants.flatMap((p) => p.results);
  const n = allResults.length;
  const avg = (arr) => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : 0;

  const sum = (key) => allResults.reduce((a, r) => a + (Number(r[key]) || 0), 0);
  const judgeableTotal = sum('task_total');
  const judgeableOk = sum('task_judgeable');

  const metrics = {
    analyzers: n,
    avg_elapsed_ms: avg(allResults.map((r) => r.elapsed_ms)),
    avg_gaps: avg(allResults.map((r) => r.gap_total)),
    avg_have: avg(allResults.map((r) => r.gap_have)),
    avg_improve: avg(allResults.map((r) => r.gap_improve)),
    avg_unknown: avg(allResults.map((r) => r.gap_unknown)),
    avg_tasks: avg(allResults.map((r) => r.task_total)),
    judgeable_rate: judgeableTotal ? +(judgeableOk / judgeableTotal * 100).toFixed(1) : null,
    within_budget_rate: (() => {
      const checked = allResults.filter((r) => r.within_budget !== null && r.within_budget !== undefined);
      return checked.length ? +(checked.filter((r) => r.within_budget).length / checked.length * 100).toFixed(1) : null;
    })(),
    violation_free_rate: n ? +((allResults.filter((r) => !r.violations).length / n) * 100).toFixed(1) : null,
  };

  // 按方向拆分
  const byTrack = {};
  for (const p of participants) {
    const t = p.track || 'unknown';
    if (!byTrack[t]) byTrack[t] = { track: t, participants: 0, analyzers: 0, tasks: 0 };
    byTrack[t].participants += 1;
    byTrack[t].analyzers += p.results.length;
    byTrack[t].tasks += p.results.reduce((a, r) => a + (Number(r.task_total) || 0), 0);
  }

  // 主观反馈汇总
  const fbList = feedbacks.map((f) => f.feedback || {});
  const withRating = fbList.filter((f) => Number.isFinite(Number(f.overall)));
  const feedbackSummary = {
    count: fbList.length,
    avg_overall: withRating.length
      ? +(withRating.reduce((a, f) => a + Number(f.overall), 0) / withRating.length).toFixed(2)
      : null,
    would_recommend: fbList.filter((f) => f.would_recommend === true || f.would_recommend === 'yes').length,
    avg_effort_min: (() => {
      const e = fbList.map((f) => Number(f.effort_minutes)).filter(Number.isFinite);
      return e.length ? +(e.reduce((a, b) => a + b, 0) / e.length).toFixed(1) : null;
    })(),
    useful_parts: tally(fbList.flatMap((f) => toArray(f.useful_parts))),
    pain_points: tally(fbList.flatMap((f) => toArray(f.pain_points))),
    quotes: fbList.map((f) => f.quote).filter(Boolean),
  };

  return {
    generated_at: new Date().toISOString(),
    participants: total,
    analyzers: n,
    feedback_count: feedbacks.length,
    funnel: stepRate,
    metrics,
    by_track: Object.values(byTrack).sort((a, b) => b.participants - a.participants),
    feedback_summary: feedbackSummary,
    // 原始事件，便于二次分析
    events,
    feedbacks,
  };
}

function toArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (v === undefined || v === null || v === '') return [];
  return String(v).split(/[,，;；、]/).map((s) => s.trim()).filter(Boolean);
}

function tally(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

/**
 * 重置采集数据（重新开始一轮内测时用）
 */
export function resetData() {
  try {
    ensureDir();
    writeFileSync(EVENTS_FILE, '', 'utf-8');
    writeFileSync(FEEDBACK_FILE, '', 'utf-8');
    return true;
  } catch (e) {
    console.warn(`[telemetry] 重置失败：${e.message}`);
    return false;
  }
}
