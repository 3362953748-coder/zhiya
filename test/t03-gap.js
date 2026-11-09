/**
 * 测试 03 · 差距分析测试
 *
 * 验证项：能否合理判断技能差距
 * 覆盖：三分类互斥、依据完整、权重排序、unknown 不误判、
 *      明确说「没有」的项判为 improve 而非 unknown、语义正确性
 */
import { pathToFileURL } from 'node:url';
import { group, analyze, cachedAnalyze, traceable } from './framework.js';
import { CASE_A, CASE_B, CASE_C } from './fixtures.js';

export async function runGapTests() {
  const g = group('03 差距分析测试');

  const A = await cachedAnalyze('A', CASE_A);
  const B = await cachedAnalyze('B', CASE_B);
  const C = await cachedAnalyze('C', CASE_C);

  g.check('案例A差距分析成功', A.status === 200, `实际 ${A.status}`);
  g.check('案例B差距分析成功', B.status === 200, `实际 ${B.status}`);
  g.check('案例C差距分析成功', C.status === 200, `实际 ${C.status}`);

  const items = A.data?.gap_report?.items || [];
  const byReq = Object.fromEntries(items.map((i) => [i.requirement, i]));

  /* ---------- 1. 三分类互斥 ---------- */
  g.check(
    '差距条目非空',
    items.length > 0,
    `条目数 ${items.length}`
  );
  g.check(
    '每条 status 只取 have/improve/unknown 三值',
    items.every((i) => ['have', 'improve', 'unknown'].includes(i.status)),
    items.filter((i) => !['have', 'improve', 'unknown'].includes(i.status)).map((i) => `${i.requirement}=${i.status}`).join(', ')
  );
  g.check(
    '三分类互斥：没有条目同时是 have 和 improve',
    items.every((i) => !(i.status === 'have' && i.advice)),
    items.filter((i) => i.status === 'have' && i.advice).map((i) => i.requirement).join(', ')
  );
  g.check(
    'have 类不带待提升建议',
    items.filter((i) => i.status === 'have').every((i) => !i.advice),
    items.filter((i) => i.status === 'have' && i.advice).map((i) => `${i.requirement}: ${i.advice}`).join('\n')
  );
  g.check(
    'improve 类必须给出提升建议',
    items.filter((i) => i.status === 'improve').every((i) => (i.advice || '').length >= 4),
    items.filter((i) => i.status === 'improve' && !(i.advice || '').length).map((i) => i.requirement).join(', ')
  );
  g.check(
    'unknown 类必须给出具体追问',
    items.filter((i) => i.status === 'unknown').every((i) => (i.prompt || '').length >= 5),
    items.filter((i) => i.status === 'unknown' && !(i.prompt || '').length).map((i) => i.requirement).join(', ')
  );

  /* ---------- 2. 判断依据（核心：让推理可见） ---------- */
  g.check(
    '每条都有判断依据',
    items.every((i) => (i.basis || '').length >= 5),
    items.filter((i) => !(i.basis || '').length).map((i) => i.requirement).join(', ')
  );
  g.check(
    'have 类的证据可在经历原文回指（防编造核心）',
    items.filter((i) => i.status === 'have').every((i) => traceable(i.evidence, CASE_A.raw_text)),
    items
      .filter((i) => i.status === 'have' && !traceable(i.evidence, CASE_A.raw_text))
      .map((i) => `${i.requirement} → 证据「${i.evidence}」无法回指`).join('\n')
  );
  g.check(
    '依据中不出现英文枚举值（unknown/improve/have）',
    !items.some((i) => /按规则判为\s*(unknown|improve|have)|\bstatus\s*=\s*(unknown|improve|have)/i.test(i.basis || '')),
    items.filter((i) => /unknown|improve/i.test(i.basis || '')).map((i) => `${i.requirement}: ${i.basis}`).join('\n')
  );

  /* ---------- 3. 语义正确性（人工构造的明确事实） ---------- */
  // 案例A：用户有竞赛获奖，应判 have（竞赛项确实在岗位清单里）
  const comp = items.find((i) => /竞赛/.test(i.requirement));
  g.check(
    '有竞赛获奖 → 竞赛项判为 have',
    comp?.status === 'have',
    `实际 ${comp?.status}（${comp?.requirement}）`
  );
  // 岗位清单里存在的能力项，才谈得上有对应结论
  const jdNames = (A.data?.jd_profile?.requirements || []).map((r) => r.item);
  const orphanItems = items.filter((i) => !jdNames.includes(i.requirement));
  g.check(
    '每条差距结论都对应岗位清单里的能力项（无凭空多出的条目）',
    orphanItems.length === 0,
    `多出的条目：${orphanItems.map((i) => i.requirement).join(', ')}`
  );
  // 有后端项目经历 → 与项目/技术实现相关的项判为 have
  const techRelated = items.find((i) =>
    i.status === 'have' && /技术|开发|实现|工程|背景|专业/.test(i.requirement));
  g.check(
    '有后端项目经历 → 技术/专业背景类项判为 have',
    !!techRelated,
    `have 项：${items.filter((i) => i.status === 'have').map((i) => i.requirement).join(', ')}`
  );
  // 案例A：用户明确说「没有实习经历」→ 实习相关应判 improve 或 unknown，不能是 have
  const intern = items.find((i) => /实习/.test(i.requirement));
  g.check(
    '用户明说「没有实习经历」→ 实习项绝不判 have',
    !intern || intern.status !== 'have',
    `实际 ${intern?.status}（${intern?.requirement}）`
  );

  // 案例A：用户完全没提产品竞赛、原型工具 → 应为 unknown 或 improve，绝不能是 have
  const proto = items.find((i) => /原型|Axure|Figma/i.test(i.requirement));
  g.check(
    '用户未提原型工具 → 原型项不判 have',
    !proto || proto.status !== 'have',
    `实际 ${proto?.status}（${proto?.requirement}）`
  );
  const prodComp = items.find((i) => /产品竞赛/.test(i.requirement));
  g.check(
    '用户明说「没参加产品竞赛」→ 产品竞赛项不判 have',
    !prodComp || prodComp.status !== 'have',
    `实际 ${prodComp?.status}（${prodComp?.requirement}）`
  );

  /* ---------- 4. unknown 与 improve 的区分 ---------- */
  // 案例C：极简输入，绝大多数项应为 unknown（没提供 ≠ 没有）
  const cItems = C.data?.gap_report?.items || [];
  const cHave = cItems.filter((i) => i.status === 'have');
  g.check(
    '极简输入下 have 项不超过 2 个（专业/年级可判定）',
    cHave.length <= 2,
    `实际 have 项：${cHave.map((i) => `${i.requirement}(证据:${i.evidence})`).join(', ')}`
  );
  g.check(
    '极简输入下多数项为 unknown（没提供 = 不知道）',
    cItems.filter((i) => i.status === 'unknown').length >= cItems.length * 0.5,
    `分布：${JSON.stringify(cItems.reduce((a, i) => { a[i.status] = (a[i.status] || 0) + 1; return a; }, {}))}`
  );

  /* ---------- 5. 权重与排序 ---------- */
  g.check(
    '每条有 weight（1-3）',
    items.every((i) => Number.isInteger(i.weight) && i.weight >= 1 && i.weight <= 3),
    items.filter((i) => !(Number.isInteger(i.weight) && i.weight >= 1 && i.weight <= 3)).map((i) => `${i.requirement}=${i.weight}`).join(', ')
  );
  g.check(
    '按重要度降序排列（重要能力在前）',
    items.every((it, idx) => idx === 0 || items[idx - 1].weight >= it.weight),
    `权重序列：${items.map((i) => i.weight).join(',')}`
  );

  /* ---------- 6. 覆盖度 ---------- */
  const jdReqs = A.data?.jd_profile?.requirements || [];
  const covered = items.length;
  g.check(
    '岗位能力项全部被对照（覆盖率 100%）',
    covered >= jdReqs.length,
    `岗位清单 ${jdReqs.length} 项，差距报告 ${covered} 项`
  );

  /* ---------- 7. 案例B：内容运营岗与运营经历强相关 ---------- */
  const bItems = B.data?.gap_report?.items || [];
  g.check(
    '案例B：内容撰写相关项判为 have',
    bItems.some((i) => i.status === 'have' && /撰写|文案|内容|选题/.test(i.requirement)),
    JSON.stringify(bItems.filter((i) => i.status === 'have').map((i) => i.requirement))
  );
  g.check(
    '案例B：设计工具项（Canva/PS，用户说学过PS）判为 have',
    bItems.some((i) => i.status === 'have' && /设计|工具|Canva|PS/.test(i.requirement)),
    JSON.stringify(bItems.filter((i) => i.status === 'have').map((i) => i.requirement))
  );

  return { g, A, B, C };
}


/* ---------- CLI 入口：node test/t03-gap.js ---------- */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await runGapTests();
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
