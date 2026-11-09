/**
 * 四步串行编排
 *
 * ① 经历解析 → ② JD 解析 → ③ 差距对照 → ④ 计划生成
 * 后一步只吃前一步的结构化产物，这是「AI 不编造用户经历」的工程约束（R-12）。
 */
import { callModelForJson, callModel } from './cloud.js';
import { stripDangerousMarkup } from './sanitize.js';
import {
  PROFILE_SYSTEM, JD_SYSTEM, GAP_SYSTEM, PLAN_SYSTEM, REGEN_NOTE,
} from './prompts.js';
import {
  validateProfile, validateJdProfile, validateGapReport, validateActionPlan,
} from './validate.js';

export const STEPS = {
  PROFILE: 'profile',
  JD: 'jd_profile',
  GAP: 'gap_report',
  PLAN: 'action_plan',
};

const ALL_STEPS = [STEPS.PROFILE, STEPS.JD, STEPS.GAP, STEPS.PLAN];

/** 依赖图：某步依赖的前置步骤 */
const DEPENDENCIES = {
  [STEPS.PROFILE]: [],
  [STEPS.JD]: [],
  [STEPS.GAP]: [STEPS.PROFILE, STEPS.JD],
  [STEPS.PLAN]: [STEPS.GAP],
};

/**
 * 根据变更字段推导需要重跑的步骤（R-14）
 */
export function deriveScope(changedFields = []) {
  const set = new Set(changedFields);
  const needsProfile = set.has('raw_text') || set.has('followups');
  const needsJd = set.has('jd_text') || set.has('target_role');
  const needsPlan = needsProfile || needsJd || set.has('weekly_hours');

  const scope = new Set();
  if (needsProfile) scope.add(STEPS.PROFILE);
  if (needsJd) scope.add(STEPS.JD);
  if (needsProfile || needsJd) scope.add(STEPS.GAP);
  if (needsPlan) scope.add(STEPS.PLAN);
  return [...scope];
}

/** 用户直接指定 action 时，限定要跑的步骤 */
function scopeByAction(action) {
  switch (action) {
    case 'recheck': return [STEPS.GAP];
    case 'replan': return [STEPS.PLAN];
    default: return ALL_STEPS;
  }
}

function pickModel(state) {
  return state?.model || process.env.ZHIYA_MODEL || 'deepseek-v4.1-flash';
}

/** 第 1 步：经历解析 */
async function runProfile(state, model) {
  // 纵深防御：路由层已清洗过一次，这里再洗一次。
  // 目的是保证任何进入 prompt 的文本都不含 HTML/JS 标记 ——
  // 云端 WAF 会直接拦截这类内容，导致整次分析失败。
  const rawText = stripDangerousMarkup(String(state.raw_text || '')).text;
  const followups = Array.isArray(state.followups) ? state.followups : [];

  const followupText = followups.length
    ? '\n\n【用户对 AI 追问的回答】\n' + followups
      .map((f, i) => `追问${i + 1}：${f?.question || ''}\n回答：${f?.answer || ''}`)
      .join('\n')
    : '';

  const messages = [
    { role: 'system', content: PROFILE_SYSTEM },
    {
      role: 'user',
      content: `【用户原始叙述】\n${rawText}${followupText}\n\n请输出个人背景档案 JSON。`,
    },
  ];
  const raw = await callModelForJson({ model, messages, timeoutMs: 60000, temperature: 0.2 });
  const profile = validateProfile(raw);

  // 追问缺口检查：模型未识别出缺失项时，用原文关键词做一次补充判断
  if (profile.missing_fields.length === 0 && rawText.length > 0) {
    const hasMajor = /专业|院系|系/.test(rawText);
    const hasGrade = /大一|大二|大三|四年级|大四|研一|年级/.test(rawText);
    if (!hasMajor) {
      profile.missing_fields.push({ field: '专业', prompt: '你是什么专业的？这会决定我们优先看哪些岗位。' });
    }
    if (!hasGrade) {
      profile.missing_fields.push({ field: '年级', prompt: '你现在大几？实习一般要求大二及以上或研究生。' });
    }
  }
  return profile;
}

/** 第 2 步：JD 解析 */
async function runJd(state, model) {
  const jdText = stripDangerousMarkup(String(state.jd_text || '')).text;
  const roleHint = state.target_role ? `\n\n【岗位库中的岗位名称】${state.target_role}（仅作参考，优先依据 JD 原文）` : '';

  const messages = [
    { role: 'system', content: JD_SYSTEM },
    {
      role: 'user',
      content: `【目标岗位 JD】\n${jdText}${roleHint}\n\n请输出岗位能力清单 JSON。`,
    },
  ];
  const raw = await callModelForJson({ model, messages, timeoutMs: 60000, temperature: 0.2 });
  const jd = validateJdProfile(raw, jdText);
  if (jd.role_name && !state.target_role) {
    state.target_role = jd.role_name;
  }
  return jd;
}

/** 第 3 步：差距对照 */
async function runGap(state, model, { regen = false } = {}) {
  const profile = state.profile;
  const jd = state.jd_profile;
  if (!profile || !jd) throw new Error('差距对照缺少前置步骤产物');

  const profileJson = JSON.stringify(profile, null, 2);
  const jdJson = JSON.stringify(jd, null, 2);

  let system = GAP_SYSTEM;
  let ref = '';
  if (regen && state.gap_report) {
    system = `${REGEN_NOTE}\n\n${GAP_SYSTEM}`;
    ref = `\n\n【上一轮差距报告（参考）】\n${JSON.stringify(state.gap_report.items, null, 2)}`;
  }

  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content:
        `【用户经历档案】\n${profileJson}\n\n` +
        `【岗位能力清单】\n${jdJson}${ref}\n\n` +
        `请逐条对照输出差距报告 JSON。`,
    },
  ];
  const raw = await callModelForJson({ model, messages, timeoutMs: 90000, temperature: 0.2 });
  const gap = validateGapReport(raw, profile, jd);
  return gap;
}

/** 第 4 步：计划生成 */
async function runPlan(state, model, { regen = false } = {}) {
  const gap = state.gap_report;
  if (!gap) throw new Error('计划生成缺少差距报告');

  const weeklyHours = Number(state.weekly_hours) || 10;
  const gapJson = JSON.stringify(gap.items, null, 2);

  let ref = '';
  if (regen && state.action_plan) {
    ref = `\n\n【上一轮任务清单（参考，用户可勾选取消）】\n${JSON.stringify(state.action_plan.tasks, null, 2)}`;
  }

  const messages = [
    { role: 'system', content: PLAN_SYSTEM },
    {
      role: 'user',
      content:
        `【用户每周可投入时间】${weeklyHours} 小时（两周合计上限 ${weeklyHours * 2} 小时）\n\n` +
        `【能力差距报告】\n${gapJson}${ref}\n\n` +
        `请生成两周行动计划 JSON。`,
    },
  ];
  const raw = await callModelForJson({ model, messages, timeoutMs: 90000, temperature: 0.3 });
  const plan = validateActionPlan(raw, gap, weeklyHours);
  return plan;
}

/**
 * 执行一次完整或局部分析。
 * @param {object} state 输入状态
 * @param {object} opts
 * @param {string[]} [opts.scope] 要执行的步骤
 * @param {boolean} [opts.regen] 是否为重算
 */
export async function runPipeline(state, { scope = ALL_STEPS, regen = false } = {}) {
  const model = pickModel(state);
  const steps = scope.filter((s) => ALL_STEPS.includes(s));
  const trace = [];

  // 依序执行，保证依赖成立
  if (steps.includes(STEPS.PROFILE)) {
    state.profile = await runProfile(state, model);
    trace.push({ step: STEPS.PROFILE, ok: true });
  }
  if (steps.includes(STEPS.JD)) {
    state.jd_profile = await runJd(state, model);
    trace.push({ step: STEPS.JD, ok: true });
  }
  if (steps.includes(STEPS.GAP)) {
    state.gap_report = await runGap(state, model, { regen });
    trace.push({ step: STEPS.GAP, ok: true });
  }
  if (steps.includes(STEPS.PLAN)) {
    state.action_plan = await runPlan(state, model, { regen });
    trace.push({ step: STEPS.PLAN, ok: true });
  }

  state.model = model;
  return state;
}

/** 生成方向候选（F3 的 1–3 个方向） */
export async function runDirections(state, model) {
  const profile = state.profile;
  const jd = state.jd_profile;
  if (!profile || !jd) return [];

  const messages = [
    {
      role: 'system',
      content: `你是知涯 ZHIYA 的岗位方向推荐器。基于用户经历档案与目标岗位，给出 1–3 个可探索方向。

## 绝对规则
1. 每个方向必须同时给出 reason（推荐理由，引用用户具体经历）与 uncertainty（不确定性，指出用户没提及什么）。
2. 绝不说用户「不适合」「不能做」。不确定就写进 uncertainty。
3. 不编造用户的经历。matched_evidence 只能引用经历档案里真实存在的片段。
4. 方向是候选，不是判决。

## 输出 JSON
{
  "directions": [
    {
      "role": "岗位名称",
      "match_level": "匹配度较高 | 可尝试 | 可探索",
      "reason": "推荐理由，指明用户的哪段经历对应这个岗位的哪条要求",
      "uncertainty": "不确定性，明确指出用户未提及的相关信息",
      "matched_evidence": ["经历档案中的原文片段"]
    }
  ]
}

只输出 JSON。`,
    },
    {
      role: 'user',
      content:
        `【用户经历档案】\n${JSON.stringify(profile, null, 2)}\n\n` +
        `【目标岗位能力清单】\n${JSON.stringify(jd, null, 2)}\n\n` +
        `请给出 1–3 个可探索方向 JSON。`,
    },
  ];

  try {
    const raw = await callModelForJson({ model, messages, timeoutMs: 60000, temperature: 0.3 });
    const list = Array.isArray(raw?.directions) ? raw.directions : [];
    return list.slice(0, 3).map((d) => ({
      role: String(d?.role || '').trim(),
      match_level: String(d?.match_level || '可探索').trim(),
      reason: String(d?.reason || '').trim(),
      uncertainty: String(d?.uncertainty || '').trim(),
      matched_evidence: Array.isArray(d?.matched_evidence) ? d.matched_evidence.map(String) : [],
    })).filter((d) => d.role);
  } catch (e) {
    return [];
  }
}

/** 计算两次结果的逐条差异 */
export function diffResults(before, after) {
  const items = [];
  const push = (field, key, b, a) => {
    const bs = JSON.stringify(b ?? null);
    const as = JSON.stringify(a ?? null);
    items.push({ field, key, before: b ?? null, after: a ?? null, changed: bs !== as });
  };

  const bg = before?.gap_report?.items || [];
  const ag = after?.gap_report?.items || [];
  const byReq = new Map(bg.map((g) => [g.requirement, g]));
  const aByReq = new Map(ag.map((g) => [g.requirement, g]));

  const allReq = new Set([...byReq.keys(), ...aByReq.keys()]);
  for (const req of allReq) {
    const b = byReq.get(req);
    const a = aByReq.get(req);
    push('gap_report', req,
      b ? { status: b.status, evidence: b.evidence } : null,
      a ? { status: a.status, evidence: a.evidence } : null);
  }

  const bt = before?.action_plan?.tasks || [];
  const at = after?.action_plan?.tasks || [];
  const bByT = new Map(bt.map((t) => [t.title, t]));
  const aByT = new Map(at.map((t) => [t.title, t]));
  for (const title of new Set([...bByT.keys(), ...aByT.keys()])) {
    const b = bByT.get(title);
    const a = aByT.get(title);
    push('action_plan', title,
      b ? { priority: b.priority, estimated_hours: b.estimated_hours } : null,
      a ? { priority: a.priority, estimated_hours: a.estimated_hours } : null);
  }

  return {
    items,
    changed_count: items.filter((i) => i.changed).length,
  };
}
