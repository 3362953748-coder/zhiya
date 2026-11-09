/**
 * 计划周分配与差距排序单元测试
 * 不调模型，直接测 validateActionPlan / validateGapReport
 */
import { validateActionPlan, validateGapReport } from '../server/validate.js';

let pass = 0, fail = 0;
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '\n     ' + detail : ''}`); }
}

console.log('\n═══ 周分配与排序单元测试 ═══\n');

const GAP = { items: [{ requirement: '用户需求调研' }, { requirement: 'PRD撰写' }] };

/* ---------- 1. 单周超预算 → 均衡 ---------- */
console.log('── 单周时长均衡 ──');
{
  // 构造一个第 1 周严重超载的场景：6 条任务全在第 1 周
  const tasks = Array.from({ length: 6 }, (_, i) => ({
    title: `任务${i + 1}`,
    expected_output: '产出',
    completion_criteria: '标准',
    basis: '用户需求调研',
    estimated_hours: 4,
    week: 1,
    priority: i < 3 ? 'P0' : 'P2',
  }));
  const r = validateActionPlan({ tasks }, GAP, 10);
  const w1 = r.tasks.filter((t) => t.week === 1);
  const w2 = r.tasks.filter((t) => t.week === 2);
  const h1 = w1.reduce((s, t) => s + t.estimated_hours, 0);
  const h2 = w2.reduce((s, t) => s + t.estimated_hours, 0);
  t('单周时长不超过该周预算', h1 <= 10 && h2 <= 10, `第1周 ${h1}h，第2周 ${h2}h，预算 10h`);
  t('每周任务数不超过 5 条', w1.length <= 5 && w2.length <= 5, `第1周 ${w1.length}，第2周 ${w2.length}`);
  t('均衡后总时长仍受总预算约束', r.total_hours <= 20, `实际 ${r.total_hours}h`);
  t('记录了均衡动作', r.violations.some((v) => v.type === 'week_rebalanced' || v.type === 'trimmed'),
    `violations: ${r.violations.map((v) => v.type).join(', ')}`);
}

/* ---------- 2. 两周分布 ---------- */
console.log('\n── 两周分布 ──');
{
  const tasks = [
    { title: 'A', expected_output: 'x', completion_criteria: 'y', basis: '用户需求调研', estimated_hours: 3, week: 1, priority: 'P0' },
    { title: 'B', expected_output: 'x', completion_criteria: 'y', basis: '用户需求调研', estimated_hours: 3, week: 1, priority: 'P1' },
    { title: 'C', expected_output: 'x', completion_criteria: 'y', basis: '用户需求调研', estimated_hours: 3, week: 1, priority: 'P1' },
    { title: 'D', expected_output: 'x', completion_criteria: 'y', basis: '用户需求调研', estimated_hours: 3, week: 2, priority: 'P2' },
  ];
  const r = validateActionPlan({ tasks }, GAP, 10);
  const w1 = r.tasks.filter((t) => t.week === 1);
  const w2 = r.tasks.filter((t) => t.week === 2);
  t('原本平衡的输入不被破坏', w1.length === 3 && w2.length === 1,
    `实际 第1周 ${w1.length}，第2周 ${w2.length}`);
  t('两周时长都在预算内',
    w1.reduce((s, x) => s + x.estimated_hours, 0) <= 10 &&
    w2.reduce((s, x) => s + x.estimated_hours, 0) <= 10,
    `第1周 ${w1.reduce((s, x) => s + x.estimated_hours, 0)}h，第2周 ${w2.reduce((s, x) => s + x.estimated_hours, 0)}h`);
}

/* ---------- 3. 任务数过多 ---------- */
console.log('\n── 每周任务数上限 ──');
{
  const tasks = Array.from({ length: 8 }, (_, i) => ({
    title: `任务${i + 1}`, expected_output: 'x', completion_criteria: 'y',
    basis: '用户需求调研', estimated_hours: 1, week: 1, priority: 'P2',
  }));
  const r = validateActionPlan({ tasks }, GAP, 20);
  const w1 = r.tasks.filter((t) => t.week === 1).length;
  const w2 = r.tasks.filter((t) => t.week === 2).length;
  t('8 条全在第 1 周 → 被匀到两周', w1 <= 5 && w2 <= 5, `第1周 ${w1}，第2周 ${w2}`);
  t('任务总数不减少（只匀不删）', r.tasks.length === 8, `实际 ${r.tasks.length}`);
}

/* ---------- 4. P0 不被挪走 ---------- */
console.log('\n── 高优先级保护 ──');
{
  const tasks = [
    { title: 'P0任务', expected_output: 'x', completion_criteria: 'y', basis: '用户需求调研', estimated_hours: 4, week: 1, priority: 'P0' },
    { title: 'P2任务1', expected_output: 'x', completion_criteria: 'y', basis: '用户需求调研', estimated_hours: 4, week: 1, priority: 'P2' },
    { title: 'P2任务2', expected_output: 'x', completion_criteria: 'y', basis: '用户需求调研', estimated_hours: 4, week: 1, priority: 'P2' },
  ];
  const r = validateActionPlan({ tasks }, GAP, 10);
  const p0 = r.tasks.find((x) => x.title === 'P0任务');
  t('P0 任务被保留', !!p0, 'P0 任务不应被裁掉');
}

/* ---------- 5. 差距按权重降序 ---------- */
console.log('\n── 差距权重排序 ──');
{
  const raw = {
    items: [
      { requirement: '低权重项', status: 'unknown', basis: '依据', prompt: '问题', weight: 1 },
      { requirement: '高权重项', status: 'unknown', basis: '依据', prompt: '问题', weight: 3 },
      { requirement: '中权重项', status: 'unknown', basis: '依据', prompt: '问题', weight: 2 },
      { requirement: '另一个高权重项', status: 'unknown', basis: '依据', prompt: '问题', weight: 3 },
    ],
  };
  const r = validateGapReport(raw, { major: '计算机', grade: '大三', skills: [], experiences: [] },
    { requirements: [] });
  const ws = r.items.map((i) => i.weight);
  t('权重序列降序', ws.every((w, i) => i === 0 || ws[i - 1] >= w), `实际 ${ws.join(',')}`);
  t('最高权重项排在最前', r.items[0].weight === 3, `实际首项权重 ${r.items[0].weight}`);
}

/* ---------- 6. 同权重保持稳定顺序 ---------- */
console.log('\n── 稳定排序 ──');
{
  const raw = {
    items: [
      { requirement: '甲', status: 'unknown', basis: '依据', prompt: '问题', weight: 2 },
      { requirement: '乙', status: 'unknown', basis: '依据', prompt: '问题', weight: 2 },
      { requirement: '丙', status: 'unknown', basis: '依据', prompt: '问题', weight: 2 },
    ],
  };
  const r = validateGapReport(raw, { major: '', grade: '', skills: [], experiences: [] },
    { requirements: [] });
  const names = r.items.map((i) => i.requirement);
  t('同权重保持原相对顺序',
    names.indexOf('甲') < names.indexOf('乙') && names.indexOf('乙') < names.indexOf('丙'),
    `实际顺序：${names.join(',')}`);
}


/* __EXIT_BLOCK__ */

/* ---------- 低质任务过滤 ---------- */
console.log('\n── 低质任务过滤 ──');
{
  const { isLowValueTask } = await import('../server/validate.js');
  // 应被过滤
  const lowValue = [
    ['写一份社群运营与用户沟通经历自查清单', '一份自查清单'],
    ['写一份跨团队协作经历自查清单', '一份自查清单'],
    ['把三份自查清单整理成一页经历补充说明', '一页经历补充说明'],
    ['写一份校园活动组织经历自查清单', '自查清单'],
    ['回顾并盘点已有经历', '经历盘点笔记'],
  ];
  for (const [title, output] of lowValue) {
    t(`过滤低质任务：「${title.slice(0, 18)}」`, isLowValueTask(title, output) === true,
      `标题=${title} 产出=${output}`);
  }

  // 不应被过滤（有真实交付物）
  const good = [
    ['写出小红书账号从 0 到 8000 粉的 3 个关键动作并标注数据', '3 个带数据的关键动作'],
    ['把 3 个关键增长动作改写成岗位能看懂的 STAR 案例', '一份 STAR 案例'],
    ['用 Canva 做一张小红书封面和一张公众号首图', '两张封面图'],
    ['梳理两次活动宣传的协作对象与自己的具体分工', '分工说明'],
    ['写一份 PRD 文档初稿', '一份 PRD 文档'],
    ['做 1 个可点击的原型图', '1 个原型图'],
    ['整理出 3 个可写进简历的项目要点', '3 个简历要点'],
  ];
  for (const [title, output] of good) {
    t(`保留正常任务：「${title.slice(0, 18)}」`, isLowValueTask(title, output) === false,
      `标题=${title} 产出=${output}`);
  }
}

console.log(`\n═══ 通过 ${pass} · 失败 ${fail} ═══`);
process.exit(fail ? 1 : 0);
