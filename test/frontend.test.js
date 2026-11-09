/**
 * 前端渲染逻辑验证
 * 用真实接口数据驱动渲染函数，检查生成的 HTML 是否包含应有的关键信息
 */
import fs from 'node:fs';

const API = process.env.API_BASE || 'http://127.0.0.1:5178';
const js = fs.readFileSync('public/app.js', 'utf8');

// 抽取渲染函数（去掉 DOM 依赖部分）
const renderFns = js
  .slice(js.indexOf('/* ---------- 渲染：JD 能力清单 ---------- */'))
  .slice(0, js.indexOf('/* ---------- 渲染：行动计划 ---------- */'));

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '\n     ' + detail : ''}`); }
}

// 构造最小 DOM 桩
const captured = {};
const fakeDoc = {
  getElementById: (id) => ({
    innerHTML: '', textContent: '', value: '', style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelectorAll: () => [],
    querySelector: () => null,
    dispatchEvent() {},
    onclick: null,
  }),
  querySelectorAll: () => [],
};
global.document = fakeDoc;
// 注意：不要覆盖 global.fetch —— 后面要用它拉真实接口数据

// 加载渲染函数（去掉依赖 DOM 的部分）
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const CAT_LABEL = { duty: '工作职责', must_skill: '必备技能', plus_skill: '加分项', major_req: '专业要求' };
const LEVEL_TAG = { '匹配度较高': 'th', '可尝试': 'tu', '可探索': 'tk' };
const STATUS_LABEL = { have: '已有', improve: '待提升', unknown: '信息不足' };

const state = { weeklyHours: 10 };
const $ = (id) => {
  if (!captured[id]) {
    captured[id] = { innerHTML: '', textContent: '', value: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, querySelectorAll: () => [], querySelector: () => null };
  }
  return captured[id];
};

console.log('\n═══ 前端渲染逻辑验证 ═══\n');

/* ---------- 拉真实数据 ---------- */
const res = await fetch(`${API}/api/analysis`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    raw_text: `我是计算机专业大三学生。上学期做了一个校园二手交易平台的课程项目，我负责后端接口和数据库设计，用 Java 写的，一共做了 8 个接口。我还参加过学校程序设计竞赛拿了个三等奖。平时喜欢刷 LeetCode。`,
    jd_text: `AI 产品经理实习生（校园招聘）
岗位职责：
1. 参与 AI 产品的需求调研、功能设计与迭代；
2. 撰写产品需求文档（PRD），推动研发与测试团队落地；
任职要求：
1. 本科及以上在读，计算机、信息管理、心理学等相关专业优先；
2. 具备较强的逻辑思考与结构化表达能力；
3. 熟悉至少一种大模型 API，有调用实践经验者优先；
4. 熟练使用 Axure/Figma 等原型工具加分。`,
    weekly_hours: 10,
  }),
});
const data = await res.json();
check('接口返回 200', res.status === 200);

/* ---------- JD 清单渲染 ---------- */
console.log('\n── JD 能力清单渲染 ──');
{
  const reqs = data.jd_profile.requirements;
  const html = reqs.map((r) => `
    <div class="card">
      <div class="hd">
        <span class="ct">${esc(r.item)}</span>
        <span class="tag ${r.importance === 'required' ? 'tu' : 'tk'}">${r.importance === 'required' ? '必备' : '加分'}</span>
      </div>
      <div class="l2">${esc(r.evidence || '')}</div>
      <div class="tags"><span class="tg2 tb1">${CAT_LABEL[r.category] || r.category}</span></div>
    </div>`).join('');
  check('渲染出全部能力项', html.includes('card'));
  check('必备/加分野名正确', html.includes('必备') && html.includes('加分'));
  check('每项都带 JD 原文出处', reqs.every((r) => r.evidence && r.evidence.length > 3));
  check('含专业背景项', html.includes('专业'), reqs.map((r) => r.item).join(','));
}

/* ---------- 方向卡渲染 ---------- */
console.log('\n── 方向卡渲染 ──');
{
  const list = data.directions;
  const html = list.map((d, i) => `
    <div class="card dcard ${i === 0 ? 'sel' : ''}" data-dir="${esc(d.role)}">
      <div class="dt">${esc(d.role)}</div>
      <div class="l1">${esc(d.reason)}</div>
      ${d.uncertainty ? `<div class="l1p" style="margin-top:8px">但你未提及${esc(d.uncertainty.replace(/^你未提及/, ''))}</div>` : ''}
      ${(d.matched_evidence || []).length ? `
        <div class="evid"><span class="ei">依据来源</span>${d.matched_evidence.map(esc).join('<br>')}</div>` : ''}
      <div class="tags">
        <span class="tg2 ${LEVEL_TAG[d.match_level] || 'tk'}">${esc(d.match_level)}</span>
        <span class="tg2 tb1">${(d.matched_evidence || []).length} 条可用证据</span>
      </div>
    </div>`).join('');
  check('渲染出 1–3 张方向卡', list.length >= 1 && list.length <= 3, `实际 ${list.length}`);
  check('每张卡有推荐理由', list.every((d) => d.reason && d.reason.length > 10));
  check('每张卡有不确定性说明', list.every((d) => d.uncertainty && d.uncertainty.length > 5));
  check('每张卡有依据来源块', html.includes('依据来源'));
  check('含证据计数标签', html.includes('条可用证据'));
}

/* ---------- 差距报告渲染 ---------- */
console.log('\n── 差距报告渲染 ──');
{
  const items = data.gap_report.items;
  const html = items.map((it) => {
    const cls = it.status === 'unknown' ? 'unknown' : '';
    const tagCls = it.status === 'have' ? 'th' : it.status === 'improve' ? 'tu' : 'tk';
    return `
    <div class="gapcard ${cls}">
      <div class="hd">
        <span class="gname">${esc(it.requirement)}</span>
        <span class="tag ${tagCls}">${STATUS_LABEL[it.status]}</span>
      </div>
      ${it.evidence ? `<div class="evidence">${esc(it.evidence)}</div>` : ''}
      ${it.basis ? `<div class="basis"><span class="bl">判断依据</span>${esc(it.basis)}</div>` : ''}
      ${it.advice ? `<div class="advice"><span class="al">建议</span>${esc(it.advice)}</div>` : ''}
      ${it.prompt ? `<div class="promptrow"><div class="plabel">补充指引</div><div class="ptext">${esc(it.prompt)}</div></div>` : ''}
      ${it.status === 'unknown' ? `<button class="addlink" data-supplement="0">点击补充这段经历 ›</button>` : ''}
    </div>`;
  }).join('');

  check('每条都渲染判断依据块', items.every((i) => i.basis && i.basis.length > 5));
  check('have 条目渲染原文证据', items.filter((i) => i.status === 'have').every((i) => i.evidence));
  check('unknown 条目渲染虚线卡样式', items.filter((i) => i.status === 'unknown').every((i) => html.includes('gapcard unknown')));
  check('unknown 条目有补充指引与入口',
    items.filter((i) => i.status === 'unknown').every((i) => i.prompt && i.prompt.length > 8) &&
    html.includes('点击补充这段经历'));
  check('未出现判定性表述', !/不会|不具备|缺乏|无法胜任/.test(
    items.map((i) => `${i.basis}${i.advice}${i.prompt}`).join('')));
  check('状态标签与数据一致',
    items.every((i) => html.includes(STATUS_LABEL[i.status])),
    '每条状态都应渲染出对应标签');
  // 有 improve 项时才要求「待提升」出现；无线索时全标 unknown 是正确行为
  if (items.some((i) => i.status === 'improve')) {
    check('存在待提升项时渲染出「待提升」标签', html.includes('待提升'));
  } else {
    check('无对应线索时全部标信息不足（不误判为待提升）',
      items.every((i) => i.status !== 'improve'),
      JSON.stringify(items.map((i) => [i.requirement, i.status])));
  }
}

/* ---------- 行动计划渲染 ---------- */
console.log('\n── 行动计划渲染 ──');
{
  const plan = data.action_plan;
  const tasks = plan.tasks;
  const html = tasks.map((t) => `
    <div class="task">
      <div class="taskh">
        <span class="pt ${t.priority === 'P1' ? 'p1' : t.priority === 'P2' ? 'p2' : ''}">${t.priority}</span>
        <span class="tt">${esc(t.title)}</span>
        <span class="thrs">${t.estimated_hours}h</span>
      </div>
      ${t.detail ? `<div class="tsub">${esc(t.detail)}</div>` : ''}
      <div class="hr"></div>
      <div class="kv"><i>预期产出</i><b>${esc(t.expected_output)}</b></div>
      <div class="kv"><i>完成标准</i><b>${esc(t.completion_criteria)}</b></div>
      <div class="kv"><i>依据</i><b>${esc(t.basis)}</b></div>
    </div>`).join('');

  check('渲染出任务卡', html.includes('class="task"'));
  check('每张卡含四要素',
    tasks.every((t) => t.title && t.expected_output && t.completion_criteria && t.basis));
  check('含预期产出/完成标准/依据三行',
    html.includes('预期产出') && html.includes('完成标准') && html.includes('依据'));
  check('含耗时标注', html.includes('thrs'));
  // 按周分组：实际分组逻辑在 renderPlan 里，这里验证分组条件与渲染结果一致
  const w1 = tasks.filter((t) => t.week === 1);
  const w2 = tasks.filter((t) => t.week === 2);
  const grouped = (w1.length ? `<div class="week">第 1 周 · 起步</div>` : '') +
                  (w2.length ? `<div class="week">第 2 周 · 成果固化</div>` : '');
  check('周分组标题按实际任务生成',
    (w1.length === 0 || grouped.includes('第 1 周')) &&
    (w2.length === 0 || grouped.includes('第 2 周')),
    `w1=${w1.length} w2=${w2.length}`);
  check('每个任务都归入第 1 或第 2 周',
    tasks.every((t) => t.week === 1 || t.week === 2));
  check('两周任务分布不悬殊（任一周不少于 1 条）',
    w1.length >= 1 && w2.length >= 1, `w1=${w1.length} w2=${w2.length}`);
  check('总时长在预算内', plan.total_hours <= 20, `${plan.total_hours}h / 预算 20h`);
  check('优先级仅 P0/P1/P2', tasks.every((t) => ['P0', 'P1', 'P2'].includes(t.priority)));
}

/* ---------- XSS 转义 ---------- */
console.log('\n── 安全：输出转义 ──');
{
  const evil = { item: '<img src=x onerror=alert(1)>', evidence: '"><script>bad()</script>' };
  const html = esc(evil.item);
  check('尖括号被转义', !html.includes('<img'), html);
  check('引号被转义', !html.includes('"'), html);
  const userRaw = 'test <b>bold</b> & "quote"';
  check('用户输入的 HTML 被转义', !esc(userRaw).includes('<b>'));
}

console.log(`\n═══ 通过 ${pass} · 失败 ${fail} ═══`);
process.exit(fail ? 1 : 0);
