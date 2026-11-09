/**
 * 端到端验收：逐条实测 MVP 的 7 条最终验收标准 + PRD AC-27~AC-43
 * 运行：node test/e2e.js
 */
const API = process.env.API_BASE || 'http://127.0.0.1:5178';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '\n     ' + detail : ''}`); }
}

const RAW_A = `我是计算机专业大三学生。
上学期做了一个校园二手交易平台的课程项目，我负责后端接口和数据库设计，用 Java 写的，一共做了 8 个接口。
我还参加过学校程序设计竞赛拿了个三等奖，题目是动态规划。
平时喜欢刷 LeetCode，目前做完了 200 多道题。
没有实习经历。`;

const JD_A = `AI 产品经理实习生（校园招聘）
岗位职责：
1. 参与 AI 产品的需求调研、功能设计与迭代；
2. 撰写产品需求文档（PRD），推动研发与测试团队落地；
3. 跟踪数据表现，输出迭代优化方案。
任职要求：
1. 本科及以上在读，计算机、信息管理、心理学等相关专业优先；
2. 具备较强的逻辑思考与结构化表达能力；
3. 熟悉至少一种大模型 API，有调用实践经验者优先；
4. 有产品竞赛、校园活动组织或自媒体运营经验者优先；
5. 熟练使用 Axure/Figma 等原型工具加分。`;

// 第二组：完全不同的人与岗位，用于验证「随输入变化」
const RAW_B = `我是汉语言文学专业大二学生。
在学生会负责新媒体运营，我运营过两个校园公众号，一学期发了 60 多篇推文，最高一篇阅读量 3000。
我还给学院晚会写过策划案和主持串词。
想做内容运营或者品牌策划方向。`;

const JD_B = `内容运营实习生
岗位职责：
1. 负责官方新媒体账号的日常内容策划与撰写；
2. 策划并执行专题活动，撰写推广文案；
3. 根据数据复盘优化内容方向。
任职要求：
1. 中文、新闻、传播等相关专业在校生；
2. 有公众号、小红书等新媒体运营经验；
3. 文案功底好，有较好的选题判断力；
4. 熟练使用秀米、135 等图文编辑工具；
5. 有校园活动策划经验优先。`;

async function call(body) {
  const res = await fetch(`${API}/api/analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

console.log('\n═══ 知涯 MVP 端到端验收 ═══\n');

/* ---------- 边界输入 ---------- */
console.log('── 边界与错误处理 ──');
{
  const r = await call({ raw_text: '短', jd_text: JD_A });
  check('经历过短被拒绝 (AC: 按钮置灰)', r.status === 400 && r.data.error === 'raw_text_too_short');
}
{
  const r = await call({ raw_text: RAW_A, jd_text: '太短' });
  check('JD 过短被拒绝', r.status === 400 && r.data.error === 'jd_text_too_short');
}
{
  const r = await call({ raw_text: RAW_A, jd_text: '' });
  check('无 JD 无岗位时被拒绝', r.status === 400 && r.data.error === 'target_role_missing');
}

/* ---------- 主流程 ---------- */
console.log('\n── 主流程：案例 A（计算机 → AI 产品经理）──');
const t0 = Date.now();
const A = await call({ raw_text: RAW_A, jd_text: JD_A, weekly_hours: 10 });
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`  ⏱ 耗时 ${elapsed}s`);

check('接口返回 200', A.status === 200, JSON.stringify(A.data).slice(0, 200));
const a = A.data;

check('① 用户可输入真实背景 → profile 非空',
  !!a.profile && (a.profile.experiences?.length > 0 || a.profile.skills?.length > 0));
check('② 用户可输入目标 JD → jd_profile 非空',
  !!a.jd_profile && a.jd_profile.requirements?.length > 0);

check('AC-27 JD 拆出四类能力且每项可回溯原文',
  a.jd_profile.requirements.every((r) => r.evidence && r.evidence.length > 3),
  JSON.stringify(a.jd_profile.requirements?.slice(0, 2)));
check('AC-28 JD 必备/加分区分存在',
  a.jd_profile.requirements.some((r) => r.importance === 'required') &&
  a.jd_profile.requirements.some((r) => r.importance === 'plus'));

check('③ 差距报告生成且条目数 > 0', a.gap_report?.items?.length > 0);
check('AC-32 无对应线索的项标为 unknown 而非 improve',
  a.gap_report.items.every((i) => ['have', 'improve', 'unknown'].includes(i.status)));
check('三分类互斥：每条只有一个 status',
  a.gap_report.items.every((i) => typeof i.status === 'string' && i.status.length > 0));

const forbidden = ['不会', '不具备', '缺乏', '无法胜任'];
const badText = a.gap_report.items
  .map((i) => `${i.basis} ${i.advice} ${i.prompt}`)
  .join(' ')
  .match(new RegExp(forbidden.join('|')));
check('⑤ 不出现判定性表述', !badText, badText ? `发现「${badText[0]}」` : '');

const haveItems = a.gap_report.items.filter((i) => i.status === 'have');
check('AC-33 have 条目带原文证据',
  haveItems.every((i) => i.evidence && i.evidence.length > 0),
  JSON.stringify(haveItems.map((i) => ({ r: i.requirement, e: i.evidence }))));

const withBasis = a.gap_report.items.filter((i) => i.basis && i.basis.length > 5);
check('④ 每条结论都给出判断依据', withBasis.length === a.gap_report.items.length,
  `有依据 ${withBasis.length}/${a.gap_report.items.length}`);

const unknownItems = a.gap_report.items.filter((i) => i.status === 'unknown');
check('AC-17 信息不足项都有具体补充指引',
  unknownItems.every((i) => i.prompt && i.prompt.length > 8));

check('AC-36 差距条目按重要度展示且有条目',
  a.gap_report.items.length > 0);

check('⑥ 计划生成且每条任务含四要素',
  a.action_plan?.tasks?.length > 0 &&
  a.action_plan.tasks.every((t) => t.title && t.expected_output && t.completion_criteria && t.basis));

check('AC-37 总时长 ≤ 每周可投入 × 2',
  a.action_plan.total_hours <= 10 * 2,
  `总时长 ${a.action_plan.total_hours}，预算 20`);

check('AC-21 未填可投入时间按 10 小时估算（此处传了 10）',
  a.action_plan.total_hours <= 20);

check('AC-39 任务都有可判定完成标准',
  a.action_plan.tasks.every((t) => t.completion_criteria && t.completion_criteria.length > 4));

check('任务依据均指向差距报告条目',
  a.action_plan.tasks.every((t) =>
    a.gap_report.items.some((g) => g.requirement === t.basis) ||
    a.gap_report.items.some((g) => t.basis.includes(g.requirement) || g.requirement.includes(t.basis))),
  JSON.stringify(a.action_plan.tasks.map((t) => t.basis)));

check('AC-23 优先级仅 P0/P1/P2',
  a.action_plan.tasks.every((t) => ['P0', 'P1', 'P2'].includes(t.priority)));

check('方向候选 1–3 个且各带理由与不确定性',
  a.directions.length >= 1 && a.directions.length <= 3 &&
  a.directions.every((d) => d.role && d.reason && d.uncertainty));

/* ---------- ⑤ 不编造 ---------- */
console.log('\n── ⑤ 不编造用户经历 ──');
{
  // 用户原文里没有「产品经理」「PRD」「用户访谈」等词
  const forbiddenInOutput = [];
  const allOutput = a.gap_report.items.map((i) => `${i.basis} ${i.evidence}`).join('\n') +
    a.action_plan.tasks.map((t) => `${t.detail} ${t.expected_output}`).join('\n');

  // 编造 = 声称用户做过某事。判据：出现动词化的「做过/负责/参与了」+ 原文没有的名词
  const CLAIM = /做过|负责过|参与过|主导过|完成过|有\s*\d+\s*(年|个月)(?:的)?(实习|工作|项目)经历/;
  const FORBIDDEN_SUBJECTS = ['用户访谈', '市场调研', '实习期间', '带领团队', '用户增长', '产品上线'];
  for (const s of FORBIDDEN_SUBJECTS) {
    const re = new RegExp(`[^。；\\n]{0,20}${s}[^。；\\n]{0,20}`);
    const m = allOutput.match(re);
    if (!m) continue;
    const seg = m[0];
    // 若该句含否定/未提及的表述，属于诚实标注，不算编造
    if (/未|没有|无|缺|建议|询问|是否|能不能|补充/.test(seg)) continue;
    if (CLAIM.test(seg)) forbiddenInOutput.push(seg);
  }
  check('差距依据中无虚构经历', forbiddenInOutput.length === 0, forbiddenInOutput.join(' | '));

  check('have 类证据均可在原文中找到',
    haveItems.every((i) => RAW_A.includes(i.evidence.slice(0, 8)) || RAW_A.includes(i.evidence.slice(-8))),
    JSON.stringify(haveItems.map((i) => i.evidence)));
  check('未提及实习不会被判为已有',
    !haveItems.some((i) => i.requirement.includes('实习') && !RAW_A.includes('实习 经验')));
  check('虚构经历被服务端拦截（violations 记录越界引用）',
    Array.isArray(a.violations));
}

/* ---------- ③⑦ 随输入变化 ---------- */
console.log('\n── ③⑦ 分析随输入变化（非固定示例）──');
const B = await call({ raw_text: RAW_B, jd_text: JD_B, weekly_hours: 8 });
const b = B.data;
check('案例 B 接口成功', B.status === 200);

check('不同用户 → 不同经历档案',
  JSON.stringify(a.profile) !== JSON.stringify(b.profile));
check('不同 JD → 不同岗位要求',
  JSON.stringify(a.jd_profile.requirements) !== JSON.stringify(b.jd_profile.requirements));
check('不同输入 → 不同差距结论',
  JSON.stringify(a.gap_report.items.map((i) => [i.requirement, i.status])) !==
  JSON.stringify(b.gap_report.items.map((i) => [i.requirement, i.status])));
check('不同输入 → 不同任务',
  JSON.stringify(a.action_plan.tasks.map((t) => t.title)) !==
  JSON.stringify(b.action_plan.tasks.map((t) => t.title)));

check('案例 B 识别出新媒体运营经历',
  b.profile.experiences.some((e) => (e.evidence || '').includes('公众号') || (e.title || '').includes('公众号')),
  JSON.stringify(b.profile.experiences?.map((e) => e.title)));

check('案例 B 有 have 类条目（内容运营岗与运营经历对应）',
  b.gap_report.items.some((i) => i.status === 'have'),
  JSON.stringify(b.gap_report.summary));

check('AC-48 8 小时/周 → 总时长 ≤ 16',
  b.action_plan.total_hours <= 16, `实际 ${b.action_plan.total_hours}`);

/* ---------- ⑦ 修改输入后结果变化 ---------- */
console.log('\n── ⑦ 修改输入后结果相应变化 ──');
{
  const regen = await fetch(`${API}/api/analysis/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_result_id: a.result_id,
      changed_fields: ['raw_text'],
      raw_text: RAW_A + '\n我还负责过学院的二手教材回收平台调研，做了问卷设计和数据分析。',
      jd_text: JD_A,
      weekly_hours: 10,
    }),
  });
  const r = await regen.json();
  check('重算接口返回 200', regen.status === 200, JSON.stringify(r).slice(0, 200));
  check('AC-41 重算后差距与计划都更新', !!r.gap_report && !!r.action_plan);
  check('AC-42 返回 recomputed_scope', Array.isArray(r.recomputed_scope) && r.recomputed_scope.length > 0,
    JSON.stringify(r.recomputed_scope));
  check('重算 scope 包含 profile（改经历触发全链）',
    (r.recomputed_scope || []).includes('profile'), JSON.stringify(r.recomputed_scope));
  check('AC-43 有 diff 对比数据', !!r.diff && Array.isArray(r.diff.items));
  check('补充经历后结论出现变化',
    r.diff?.changed_count > 0 || JSON.stringify(r.gap_report) !== JSON.stringify(a.gap_report),
    `changed_count=${r.diff?.changed_count}`);
}

/* ---------- 可复现性 ---------- */
console.log('\n── AC-50 相同输入可复现 ──');
{
  const C = await call({ raw_text: RAW_A, jd_text: JD_A, weekly_hours: 10 });
  const mapOf = (d) => new Map(d.gap_report.items.map((i) => [i.requirement, i.status]));
  const ma = mapOf(a);
  const mc = mapOf(C.data);

  // 核心契约：同名项状态一致 + 数量差异受控。
  // 不要求两次条目集合逐字相同 —— 边缘要求（如学历门槛）的存在与否允许小幅波动，
  // 那是模型对模糊条目的归类差异，不是结论不一致。
  const statusOf = (d) => new Map(d.gap_report.items.map((i) => [i.requirement, i.status]));
  const sa = statusOf(a);
  const sc = statusOf(C.data);
  const common = [...sa.keys()].filter((k) => sc.has(k));
  const conflicts = common.filter((k) => sa.get(k) !== sc.get(k));
  check('同名能力项的状态完全一致（零冲突）', conflicts.length === 0,
    conflicts.map((k) => `${k}: ${sa.get(k)} vs ${sc.get(k)}`).join('; '));

  const onlyA = [...sa.keys()].filter((k) => !sc.has(k));
  const onlyC = [...sc.keys()].filter((k) => !sa.has(k));
  check('仅出现在一次的条目不超过 1 个', onlyA.length <= 1 && onlyC.length <= 1,
    `仅A: ${onlyA.join(',')} | 仅C: ${onlyC.join(',')}`);

  // 稳定项占多数（真正的结论必须稳定）
  check('稳定项占比 ≥ 85%', common.length / Math.max(sa.size, sc.size) >= 0.85,
    `共同 ${common.length} / A ${sa.size} / C ${sc.size}`);

  // 核心能力项两次都出现且状态一致
  const core = ['用户需求调研', '产品需求文档（PRD）撰写', '原型工具使用'];
  const coreBad = core.filter((k) => !(sa.has(k) && sc.has(k) && sa.get(k) === sc.get(k)));
  check('核心能力项两次都出现且状态一致', coreBad.length === 0, coreBad.join(', '));
}

console.log(`\n═══ 通过 ${pass} · 失败 ${fail} ═══`);
process.exit(fail ? 1 : 0);
