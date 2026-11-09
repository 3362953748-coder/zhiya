/**
 * 稳定性测试：同一输入连跑 N 次，统计哪些结论在波动
 * 运行：node test/stability.js
 */
const API = process.env.API_BASE || 'http://127.0.0.1:5178';
const N = Number(process.env.N || 4);

const RAW = `我是计算机专业大三学生。
上学期做了一个校园二手交易平台的课程项目，我负责后端接口和数据库设计，用 Java 写的，一共做了 8 个接口。
我还参加过学校程序设计竞赛拿了个三等奖，题目是动态规划。
平时喜欢刷 LeetCode，目前做完了 200 多道题。`;

const JD = `AI 产品经理实习生（校园招聘）
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

async function run() {
  const r = await fetch(`${API}/api/analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_text: RAW, jd_text: JD, weekly_hours: 10 }),
  });
  return r.json();
}

console.log(`\n═══ 稳定性测试：同一输入连跑 ${N} 次 ═══\n`);

const runs = [];
for (let i = 0; i < N; i++) {
  process.stdout.write(`  第 ${i + 1} 次… `);
  const d = await run();
  runs.push(d);
  console.log(`${d.gap_report.items.length} 项 / ${d.action_plan.tasks.length} 任务`);
}

// 统计每个能力项的状态分布
const statusMap = new Map();
for (const d of runs) {
  for (const it of d.gap_report.items) {
    if (!statusMap.has(it.requirement)) statusMap.set(it.requirement, []);
    statusMap.get(it.requirement).push(it.status);
  }
}

console.log('\n── 各项状态分布 ──');
let unstable = 0;
for (const [req, arr] of statusMap) {
  const uniq = [...new Set(arr)];
  const flag = uniq.length > 1 ? '  ⚠️ 波动' : '  ✅ 稳定';
  if (uniq.length > 1) unstable++;
  console.log(`${flag} ${req} → ${uniq.join(' / ')} (${arr.length}次)`);
}

// 条目集合波动
const sets = runs.map((d) => new Set(d.gap_report.items.map((i) => i.requirement)));
const allItems = [...new Set(runs.flatMap((d) => d.gap_report.items.map((i) => i.requirement)))];
const missingRate = allItems.map((it) => ({
  item: it,
  miss: sets.filter((s) => !s.has(it)).length,
}));
console.log('\n── 条目出现率 ──');
for (const m of missingRate.sort((a, b) => b.miss - a.miss)) {
  const rate = N - m.miss;
  console.log(`  ${rate}/${N}  ${m.item}${rate < N ? '  ⚠️ 偶尔缺失' : ''}`);
}

// 任务稳定性
const taskTitles = runs.map((d) => new Set(d.action_plan.tasks.map((t) => t.title)));
console.log('\n── 任务稳定性 ──');
const allTasks = [...new Set(runs.flatMap((d) => d.action_plan.tasks.map((t) => t.title)))];
let unstableTask = 0;
for (const t of allTasks) {
  const cnt = taskTitles.filter((s) => s.has(t)).length;
  if (cnt < N) { unstableTask++; console.log(`  ${cnt}/${N}  ${t.slice(0, 40)}`); }
}
console.log(`  ${allTasks.length - unstableTask}/${allTasks.length} 个任务名在 ${N} 次中稳定`);

// 时长稳定性
const hours = runs.map((d) => d.action_plan.total_hours);
console.log(`\n── 总时长 ── ${hours.join(' / ')} 小时（上限 20）`);

console.log(`\n═══ 结论 ═══`);
console.log(`状态波动的能力项：${unstable} 个`);
console.log(`偶尔缺失的能力项：${missingRate.filter((m) => m.miss > 0).length} 个`);
console.log(`波动的任务：${unstableTask} 个`);
console.log(unstable === 0 && missingRate.every((m) => m.miss === 0)
  ? '✅ 差距结论完全可复现'
  : '⚠️ 存在波动，需加强确定性规则');
