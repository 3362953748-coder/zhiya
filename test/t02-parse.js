/**
 * 测试 02 · AI 解析测试
 *
 * 验证项：能否准确提取信息
 * 覆盖：专业年级提取、技能提取、经历提取与原文回指、
 *      JD 四类能力拆解、原文证据回指、追问项质量、不越界提取
 */
import { pathToFileURL } from 'node:url';
import { group, analyze, cachedAnalyze, traceable } from './framework.js';
import { CASE_A, CASE_B } from './fixtures.js';

export async function runParseTests() {
  const g = group('02 AI 解析测试');

  const A = await cachedAnalyze('A', CASE_A);
  const B = await cachedAnalyze('B', CASE_B);

  g.check('案例A解析成功', A.status === 200, `实际 ${A.status}`);
  g.check('案例B解析成功', B.status === 200, `实际 ${B.status}`);

  const p = A.data?.profile || {};
  const jp = A.data?.jd_profile || {};

  /* ---------- 1. 个人背景提取 ---------- */
  g.check(
    '专业提取正确（计算机）',
    /计算机/i.test(p.major || ''),
    `major=${p.major}`
  );
  g.check(
    '年级提取正确（大三）',
    /大三/.test(p.grade || ''),
    `grade=${p.grade}`
  );
  g.check(
    '技能列表非空',
    Array.isArray(p.skills) && p.skills.length > 0,
    `skills=${JSON.stringify(p.skills)}`
  );
  g.check(
    '技能包含原文提到的 Java',
    (p.skills || []).some((s) => /java/i.test(s)),
    `skills=${JSON.stringify(p.skills)}`
  );
  g.check(
    '技能包含原文提到的 MySQL',
    (p.skills || []).some((s) => /mysql/i.test(s)),
    `skills=${JSON.stringify(p.skills)}`
  );
  g.check(
    '经历条目非空',
    Array.isArray(p.experiences) && p.experiences.length > 0,
    `experiences=${p.experiences?.length}`
  );
  g.check(
    '经历证据可在原文回指',
    (p.experiences || []).every((e) => traceable(e.evidence, CASE_A.raw_text)),
    (p.experiences || [])
      .filter((e) => !traceable(e.evidence, CASE_A.raw_text))
      .map((e) => `无法回指: ${e.evidence}`).join('\n')
  );
  g.check(
    '经历包含课程项目',
    (p.experiences || []).some((e) => /二手|课程|项目/.test(`${e.title}${e.evidence}`)),
    JSON.stringify(p.experiences?.map((e) => e.title))
  );
  g.check(
    '经历包含竞赛',
    (p.experiences || []).some((e) => /竞赛|获奖|三等奖/.test(`${e.title}${e.evidence}`)),
    JSON.stringify(p.experiences?.map((e) => e.title))
  );

  /* ---------- 2. 不越界提取（关键：不编造） ---------- */
  const notInSource = (p.skills || []).filter((s) => !traceable(s, CASE_A.raw_text));
  g.check(
    '未编造原文没有的技能',
    notInSource.length === 0,
    `原文没有但被提取的技能：${notInSource.join(', ')}`
  );
  g.check(
    '原文明确说「没有实习经历」→ 经历里不应出现实习',
    !(p.experiences || []).some((e) => /实习/.test(`${e.title}${e.evidence}`)),
    JSON.stringify(p.experiences?.map((e) => e.title))
  );

  /* ---------- 3. 追问项质量 ---------- */
  g.check(
    '生成补充提问（missing_fields 非空）',
    Array.isArray(p.missing_fields) && p.missing_fields.length > 0,
    `missing_fields=${JSON.stringify(p.missing_fields)}`
  );
  g.check(
    '每个追问都带具体 prompt',
    (p.missing_fields || []).every((m) => (m.prompt || '').length >= 5),
    JSON.stringify(p.missing_fields)
  );
  g.check(
    '追问不是泛泛的「请补充更多信息」',
    !(p.missing_fields || []).some((m) => /补充更多信息|请详细说明/.test(m.prompt || '')),
    JSON.stringify(p.missing_fields?.map((m) => m.prompt))
  );

  /* ---------- 4. JD 拆解 ---------- */
  g.check(
    '岗位名称提取成功',
    (jp.role_name || '').length > 0,
    `role_name=${jp.role_name}`
  );
  g.check(
    '岗位能力清单非空',
    (jp.requirements?.length || 0) >= 5,
    `条目数 ${jp.requirements?.length}`
  );
  g.check(
    '每条能力项都有原文证据',
    (jp.requirements || []).every((r) => (r.evidence || '').length >= 4),
    (jp.requirements || []).filter((r) => (r.evidence || '').length < 4).map((r) => r.item).join(', ')
  );
  g.check(
    '能力项证据可在 JD 原文回指',
    (jp.requirements || []).every((r) => traceable(r.evidence, CASE_A.jd_text)),
    (jp.requirements || [])
      .filter((r) => !traceable(r.evidence, CASE_A.jd_text))
      .map((r) => `「${r.item}」→ ${r.evidence}`).join('\n')
  );
  g.check(
    '四类能力分类齐全（duty/must_skill/plus_skill/major_req）',
    ['duty', 'must_skill', 'plus_skill', 'major_req'].every((c) =>
      (jp.requirements || []).some((r) => r.category === c)
    ),
    `实际分类：${[...new Set((jp.requirements || []).map((r) => r.category))].join(', ')}`
  );
  g.check(
    '必备与加分项有区分',
    (jp.requirements || []).some((r) => r.importance === 'required') &&
      (jp.requirements || []).some((r) => r.importance === 'plus'),
    `importance 分布：${JSON.stringify((jp.requirements || []).map((r) => r.importance))}`
  );
  g.check(
    '识别出「原型工具」加分项（JD 原文有 Axure/Figma）',
    (jp.requirements || []).some((r) => /原型|Axure|Figma/i.test(`${r.item}${r.evidence}`)),
    JSON.stringify((jp.requirements || []).map((r) => r.item))
  );
  g.check(
    '识别出「大模型 API」加分项（JD 原文有）',
    (jp.requirements || []).some((r) => /大模型|API/i.test(`${r.item}${r.evidence}`)),
    JSON.stringify((jp.requirements || []).map((r) => r.item))
  );
  g.check(
    '岗位一句话总结存在',
    (jp.job_summary || '').length >= 8,
    `job_summary=${jp.job_summary}`
  );

  /* ---------- 5. 案例 B 的解析准确性 ---------- */
  const pb = B.data?.profile || {};
  g.check(
    '案例B专业提取正确（汉语言文学）',
    /汉语言|中文|文学/.test(pb.major || ''),
    `major=${pb.major}`
  );
  g.check(
    '案例B识别出公众号运营经历',
    (pb.experiences || []).some((e) => /公众号|运营|推文/.test(`${e.title}${e.evidence}`)),
    JSON.stringify(pb.experiences?.map((e) => e.title))
  );
  g.check(
    '案例B识别出小红书账号经历',
    (pb.experiences || []).some((e) => /小红书/.test(`${e.title}${e.evidence}`)),
    JSON.stringify(pb.experiences?.map((e) => e.title))
  );
  g.check(
    '案例B经历证据均可回指',
    (pb.experiences || []).every((e) => traceable(e.evidence, CASE_B.raw_text)),
    (pb.experiences || [])
      .filter((e) => !traceable(e.evidence, CASE_B.raw_text))
      .map((e) => `无法回指: ${e.evidence}`).join('\n')
  );

  return { g, A, B };
}


/* ---------- CLI 入口：node test/t02-parse.js ---------- */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await runParseTests();
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
