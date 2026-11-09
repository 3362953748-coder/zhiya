/**
 * 测试 04 · 计划生成测试
 *
 * 验证项：行动计划是否具体可执行
 * 覆盖：四要素齐全、时长受预算约束、按周分组、优先级、
 *      任务可执行性、任务与差距的对应关系、重算后计划变化
 */
import { pathToFileURL } from 'node:url';
import { group, analyze, cachedAnalyze } from './framework.js';
import { CASE_A, CASE_B } from './fixtures.js';

export async function runPlanTests() {
  const g = group('04 计划生成测试');

  const A = await cachedAnalyze('A', CASE_A);
  const B = await cachedAnalyze('B', CASE_B);

  const plan = A.data?.action_plan || {};
  const tasks = plan.tasks || [];
  const gapItems = A.data?.gap_report?.items || [];

  g.check('案例A计划生成成功', A.status === 200, `实际 ${A.status}`);
  g.check('计划任务非空', tasks.length > 0, `任务数 ${tasks.length}`);
  g.check(
    '任务数量合理（4-12 条）',
    tasks.length >= 4 && tasks.length <= 12,
    `实际 ${tasks.length} 条`
  );

  /* ---------- 1. 四要素齐全 ---------- */
  const needFields = [
    ['title', '任务标题'],
    ['expected_output', '预期产出'],
    ['completion_criteria', '完成标准'],
    ['basis', '依据'],
  ];
  for (const [f, label] of needFields) {
    const missing = tasks.filter((t) => !String(t[f] || '').trim());
    g.check(
      `每条任务都有「${label}」`,
      missing.length === 0,
      `缺失 ${missing.length} 条：${missing.map((t) => t.title).join(', ')}`
    );
  }
  g.check(
    '每条任务都有时长估计',
    tasks.every((t) => Number(t.estimated_hours) > 0),
    tasks.filter((t) => !(Number(t.estimated_hours) > 0)).map((t) => `${t.title}=${t.estimated_hours}`).join(', ')
  );
  g.check(
    '每条任务有优先级 P0/P1/P2',
    tasks.every((t) => ['P0', 'P1', 'P2'].includes(t.priority)),
    tasks.filter((t) => !['P0', 'P1', 'P2'].includes(t.priority)).map((t) => `${t.title}=${t.priority}`).join(', ')
  );
  g.check(
    '每条任务标注所属周（1 或 2）',
    tasks.every((t) => t.week === 1 || t.week === 2),
    tasks.filter((t) => t.week !== 1 && t.week !== 2).map((t) => `${t.title}=${t.week}`).join(', ')
  );

  /* ---------- 2. 完成标准可判定 ---------- */
  const vagueWords = ['认真', '努力', '尽量', '多做', '加强练习', '熟练掌握'];
  const vague = tasks.filter((t) => vagueWords.some((w) => (t.completion_criteria || '').includes(w)) &&
    (t.completion_criteria || '').length < 15);
  g.check(
    '完成标准是可判定的（含数量/产物/标准，不是「多练习」）',
    vague.length === 0,
    `模糊标准：${vague.map((t) => `${t.title} → ${t.completion_criteria}`).join('\n')}`
  );
  g.check(
    '完成标准普遍带数字或明确产物',
    tasks.filter((t) => /[0-9]|份|篇|页|张|条|次|文档|原型|表/.test(t.completion_criteria || '')).length >= tasks.length * 0.6,
    `仅 ${tasks.filter((t) => /[0-9]|份|篇|页|张|条|次|文档|原型|表/.test(t.completion_criteria || '')).length}/${tasks.length} 条达标`
  );

  /* ---------- 3. 时长预算约束 ---------- */
  const total = tasks.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0);
  const budget = CASE_A.weekly_hours * 2;
  g.check(
    `总时长 ≤ 每周可投入×2（${budget} 小时）`,
    total <= budget,
    `实际 ${total} 小时：${tasks.map((t) => `${t.title}(${t.estimated_hours}h)`).join(', ')}`
  );
  g.check(
    '总时长字段与任务实际累加一致',
    Math.abs((plan.total_hours || 0) - total) < 0.5,
    `total_hours=${plan.total_hours}，实际累加=${total}`
  );
  g.check(
    '时长估计合理（单条 0.5-8 小时）',
    tasks.every((t) => Number(t.estimated_hours) >= 0.5 && Number(t.estimated_hours) <= 8),
    tasks.filter((t) => !(Number(t.estimated_hours) >= 0.5 && Number(t.estimated_hours) <= 8)).map((t) => `${t.title}=${t.estimated_hours}`).join(', ')
  );

  /* ---------- 4. 按周分组 ---------- */
  const w1 = tasks.filter((t) => t.week === 1);
  const w2 = tasks.filter((t) => t.week === 2);
  g.check('两周都有任务', w1.length > 0 && w2.length > 0, `第1周 ${w1.length} 条，第2周 ${w2.length} 条`);
  g.check(
    '每周任务数不超过 5 条（保证可完成）',
    w1.length <= 5 && w2.length <= 5,
    `第1周 ${w1.length} 条，第2周 ${w2.length} 条`
  );
  g.check(
    '每周时长不超过该周预算',
    w1.reduce((s, t) => s + Number(t.estimated_hours || 0), 0) <= budget / 2 + 0.5 &&
      w2.reduce((s, t) => s + Number(t.estimated_hours || 0), 0) <= budget / 2 + 0.5,
    `第1周 ${w1.reduce((s, t) => s + Number(t.estimated_hours || 0), 0)}h，第2周 ${w2.reduce((s, t) => s + Number(t.estimated_hours || 0), 0)}h，预算/周 ${budget / 2}h`
  );

  /* ---------- 5. 任务与差距的对应关系 ---------- */
  const gapReqs = gapItems.map((i) => i.requirement);
  const orphan = tasks.filter((t) => {
    const b = String(t.basis || '');
    return gapReqs.length > 0 && !gapReqs.some((r) => b.includes(r) || r.includes(b.slice(0, 10)));
  });
  g.check(
    '每条任务的依据都指向差距报告里的真实条目',
    orphan.length === 0,
    `孤立任务 ${orphan.length} 条：${orphan.map((t) => `${t.title} → ${t.basis}`).join('\n')}`
  );
  g.check(
    '任务覆盖了重要的待提升/信息不足项',
    tasks.some((t) => {
      const b = t.basis || '';
      return gapItems.some((i) => (i.status === 'improve' || i.status === 'unknown') && b.includes(i.requirement));
    }),
    '计划应针对差距项展开'
  );

  /* ---------- 6. 优先级与排序 ---------- */
  const order = { P0: 0, P1: 1, P2: 2 };
  g.check(
    '任务按优先级排序（P0 在前）',
    tasks.every((t, i) => i === 0 || order[tasks[i - 1].priority] <= order[t.priority]),
    `优先级序列：${tasks.map((t) => t.priority).join(',')}`
  );

  /* ---------- 7. 时间预算裁剪逻辑（纯函数层，不烧模型） ---------- */
  // 服务端 validateActionPlan 是纯函数，直接用它验证裁剪行为，
  // 比再跑一次完整模型快两个数量级。
  const { validateActionPlan } = await import('../server/validate.js');
  const budgetCases = [
    [4, 8], [6, 12], [10, 20], [20, 40], [60, 120],
  ];
  for (const [hours, expectBudget] of budgetCases) {
    const r = validateActionPlan(
      {
        tasks: [
          { title: '任务1', expected_output: '产出1', completion_criteria: '标准1', basis: '用户需求调研', estimated_hours: 6, week: 1, priority: 'P0' },
          { title: '任务2', expected_output: '产出2', completion_criteria: '标准2', basis: '用户需求调研', estimated_hours: 6, week: 1, priority: 'P1' },
          { title: '任务3', expected_output: '产出3', completion_criteria: '标准3', basis: '用户需求调研', estimated_hours: 6, week: 2, priority: 'P2' },
          { title: '任务4', expected_output: '产出4', completion_criteria: '标准4', basis: '用户需求调研', estimated_hours: 6, week: 2, priority: 'P2' },
        ],
      },
      { items: [{ requirement: '用户需求调研' }] },
      hours
    );
    const total = r.tasks.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0);
    g.check(
      `裁剪逻辑：每周 ${hours}h → 总时长 ≤ ${expectBudget}h`,
      total <= expectBudget,
      `实际 ${total}h（${r.tasks.length} 条任务，trimmed=${r.trimmed_count}）`
    );
  }
  g.check(
    '可投入时间减少 → 计划任务数减少（4h/周 裁剪后 ≤ 10h/周）',
    (() => {
      const mk = () => ({
        tasks: Array.from({ length: 8 }, (_, i) => ({
          title: `任务${i}`, expected_output: '产出', completion_criteria: '标准',
          basis: '用户需求调研', estimated_hours: 4, week: i < 4 ? 1 : 2, priority: 'P2',
        })),
      });
      const gap = { items: [{ requirement: '用户需求调研' }] };
      const a = validateActionPlan(mk(), gap, 10);
      const b = validateActionPlan(mk(), gap, 4);
      return b.tasks.length <= a.tasks.length;
    })(),
    '4h/周 的任务数应不多于 10h/周'
  );
  g.check(
    '四要素不全的任务被丢弃（缺失 expected_output）',
    (() => {
      const r = validateActionPlan(
        { tasks: [
          { title: '完整任务', expected_output: '产出', completion_criteria: '标准', basis: '用户需求调研', estimated_hours: 2 },
          { title: '残缺任务', completion_criteria: '标准', basis: '用户需求调研', estimated_hours: 2 },
        ] },
        { items: [{ requirement: '用户需求调研' }] },
        10
      );
      return r.tasks.length === 1 && r.violations.some((v) => v.type === 'incomplete_task');
    })(),
    '残缺任务应被丢弃并记录违规'
  );

  /* ---------- 8. 案例B：内容岗计划应产出内容类任务 ---------- */
  const bTasks = B.data?.action_plan?.tasks || [];
  // 关键：不靠标题关键词 —— 任务措辞本身有自由度。
  // 该检验的是「任务产出了具体的东西」，而不是「标题里有没有某个词」。
  // 交付物类型要覆盖得全：静态产物（案例/文档/稿/图）
  //           + 行为记录（活动/互动 + 参与人数/回复数等数据）
  const hasDeliverable = bTasks.filter((t) => {
    const s = `${t.title}${t.expected_output}${t.completion_criteria}`;
    // 静态产物
    if (/案例|文档|原型|稿|作品|简历|话术|讲稿|数据|表格|说明|方案|报告|清单|封面|图|模板|规律|结构|要点|提纲|大纲|描述|记录|复盘|脚本|推文|文案/.test(s)) return true;
    // 行为型交付：做了一件事并留下了可核对的记录
    if (/(活动|互动|运营|发布|测试|调研|访谈|复盘|练习|训练|拆解|回忆|写下|整理)/.test(s) &&
        /(记录|人数|数据|结果|反馈|截图|日志|指标|回复|阅读|参与|描述|模板|规律|要点|字以内|条)/.test(s)) return true;
    return false;
  });
  g.check(
    '案例B：计划里的任务都产出了具体的东西',
    hasDeliverable.length === bTasks.length,
    `无交付物的任务：${bTasks.filter((t) => !hasDeliverable.includes(t)).map((t) => t.title).join(', ')}`
  );
  g.check(
    '案例B：无低质元任务（自查清单/纯说明）',
    bTasks.every((t) => !/自查|检查表|盘点/.test(t.title)),
    bTasks.filter((t) => /自查|检查表|盘点/.test(t.title)).map((t) => t.title).join(', ')
  );
  g.check(
    '案例B：任务依据指向该岗位的能力项（内容/运营相关）',
    bTasks.some((t) => {
      const b = t.basis || '';
      return (B.data?.gap_report?.items || []).some(
        (i) => b.includes(i.requirement) && /内容|文案|选题|运营|社群|设计|增长/.test(i.requirement)
      );
    }),
    `任务依据：${bTasks.map((t) => t.basis).join(' | ')}`
  );
  g.check(
    '案例B：总时长 ≤ 8×2=16 小时',
    (bTasks.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0)) <= 16,
    `实际 ${bTasks.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0)} 小时`
  );

  return { g, A, B };
}


/* ---------- CLI 入口：node test/t04-plan.js ---------- */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await runPlanTests();
  const g = r.g || r;
  console.log(`\n结果：${g.passed} 通过 · ${g.failed} 失败 · 共 ${g.total} 项`);
  if (g.failed) {
    console.log('\n失败项：');
    for (const c of g.cases.filter((x) => !x.ok)) {
      console.log(`  ✗ ${c.name}`);
      if (c.detail) console.log(`     ${c.detail}`);
    }
  }
  process.exit(g.failed ? 1 : 0);
}
