/**
 * 校验逻辑单元测试（不调用模型，纯函数验证）
 * 运行：node test/validate.test.js
 */
import assert from 'node:assert';
import {
  validateGapReport, validateActionPlan, validateProfile, validateJdProfile,
  isEvidenceTraceable, isBasisTraceable, collectProfileEvidence,
} from '../server/validate.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

const profile = {
  major: '计算机专业',
  grade: '大三',
  skills: ['Java', 'LeetCode'],
  experiences: [
    {
      title: '校园二手交易平台',
      role: '负责后端接口和数据库设计',
      evidence: '我负责后端接口和数据库设计，用 Java 写的，一共做了 8 个接口。',
      implied_ability: '后端接口开发',
    },
  ],
  interests: [],
  missing_fields: [],
};

const jd = {
  role_name: 'AI 产品经理实习生',
  requirements: [
    { item: '产品需求文档（PRD）撰写', category: 'duty', importance: 'required', evidence: '撰写产品需求文档（PRD）' },
    { item: '大模型 API 调用实践经验', category: 'plus_skill', importance: 'plus', evidence: '熟悉至少一种大模型 API' },
    { item: 'Axure/Figma 原型工具', category: 'plus_skill', importance: 'plus', evidence: '熟练使用 Axure/Figma 加分' },
  ],
  ambiguous: [],
  job_summary: '',
};

console.log('\n── 证据回指 ──');

test('原文片段可回指', () => {
  assert.ok(isEvidenceTraceable('我负责后端接口和数据库设计', [profile.experiences[0].evidence]));
});

test('编造的证据不可回指', () => {
  assert.ok(!isEvidenceTraceable('负责 Spring Boot 微服务架构与 Kafka 消息队列', [profile.experiences[0].evidence]));
});

test('过短证据不视为可追溯', () => {
  assert.ok(!isEvidenceTraceable('后端', [profile.experiences[0].evidence]));
});

test('skills 不算经历证据', () => {
  // 用户「用过 Java」不等于「有 Java 项目经历」，skills 不能进证据池
  const sources = collectProfileEvidence(profile);
  assert.ok(!sources.some((s) => s.includes('LeetCode')), 'skills 不应进入证据池');
  assert.ok(sources.some((s) => s.includes('后端接口')), '经历原文应在证据池');
});

console.log('\n── 差距报告校验 ──');

test('合法 have 条目被保留', () => {
  const g = validateGapReport({
    items: [
      {
        requirement: '产品需求文档（PRD）撰写',
        status: 'have',
        evidence: '我负责后端接口和数据库设计',
        basis: '经历中提到写过文档',
      },
    ],
  }, profile, jd);
  const item = g.items.find((i) => i.requirement === '产品需求文档（PRD）撰写');
  assert.strictEqual(item.status, 'have');
  assert.ok(item.evidence);
});

test('编造证据的 have 被降级为 unknown 且证据清空', () => {
  const g = validateGapReport({
    items: [{
      requirement: '产品需求文档（PRD）撰写',
      status: 'have',
      evidence: '负责 Kafka 消息队列与微服务治理',
      basis: '据称有架构经验',
    }],
  }, profile, jd);
  const item = g.items.find((i) => i.requirement === '产品需求文档（PRD）撰写');
  assert.strictEqual(item.status, 'unknown', '应降级为 unknown');
  assert.strictEqual(item.evidence, '', '伪造证据必须清空');
  assert.ok(g.violations.some((v) => v.type === 'hallucination'), '应记录越界引用');
});

test('非法 status 降级为 unknown', () => {
  const g = validateGapReport({
    items: [{ requirement: '产品需求文档（PRD）撰写', status: 'not_good', basis: 'x' }],
  }, profile, jd);
  const item = g.items.find((i) => i.requirement === '产品需求文档（PRD）撰写');
  assert.strictEqual(item.status, 'unknown');
  assert.ok(g.violations.some((v) => v.type === 'invalid_status'));
});

test('判定性表述被记录', () => {
  const g = validateGapReport({
    items: [{
      requirement: '大模型 API 调用实践经验',
      status: 'improve',
      basis: '你不具备这项能力',
      advice: '去学一下',
    }],
  }, profile, jd);
  assert.ok(g.violations.some((v) => v.type === 'forbidden_wording'));
});

test('内部枚举值被中文化（用户看不懂 unknown）', () => {
  const g = validateGapReport({
    items: [{
      requirement: '产品需求文档（PRD）撰写',
      status: 'unknown',
      basis: '经历档案里未提及，按规则判为 unknown',
      prompt: '请补充你写过的文档',
    }],
  }, profile, jd);
  const item = g.items.find((i) => i.requirement === '产品需求文档（PRD）撰写');
  assert.ok(!item.basis.includes('unknown'), `依据仍含英文枚举值：${item.basis}`);
  assert.ok(item.basis.includes('信息不足'), item.basis);
});

test('三分类枚举值不出现在用户可见文本', () => {
  const g = validateGapReport({
    items: [
      { requirement: '产品需求文档（PRD）撰写', status: 'unknown', basis: 'status=unknown', prompt: '补充' },
      { requirement: 'Axure/Figma 原型工具', status: 'improve', basis: '标记为 improve', advice: '学 Figma' },
    ],
  }, profile, jd);
  const all = g.items.map((i) => `${i.basis}${i.advice}${i.prompt}`).join('');
  assert.ok(!/\b(unknown|improve|have)\b/.test(all), `仍含枚举值：${all}`);
});

test('improve 缺建议被降级为 unknown', () => {
  const g = validateGapReport({
    items: [{ requirement: 'Axure/Figma 原型工具', status: 'improve', basis: '未提及' }],
  }, profile, jd);
  const item = g.items.find((i) => i.requirement === 'Axure/Figma 原型工具');
  assert.strictEqual(item.status, 'unknown');
  assert.ok(item.prompt.length > 0, '降级后应有补充问题');
});

test('unknown 缺 prompt 时自动补问', () => {
  const g = validateGapReport({
    items: [{ requirement: 'Axure/Figma 原型工具', status: 'unknown', basis: '未提及' }],
  }, profile, jd);
  const item = g.items.find((i) => i.requirement === 'Axure/Figma 原型工具');
  assert.ok(item.prompt.length > 0);
});

test('岗位要求未被对照时自动补为 unknown', () => {
  const g = validateGapReport({ items: [] }, profile, jd);
  assert.strictEqual(g.items.length, 3, '三条岗位要求都要有结论');
  assert.ok(g.items.every((i) => i.status === 'unknown'));
  assert.ok(g.violations.some((v) => v.type === 'missing_item'));
});

test('三分类互斥：每条只有一个状态', () => {
  const g = validateGapReport({
    items: [
      { requirement: '产品需求文档（PRD）撰写', status: 'have', evidence: '我负责后端接口和数据库设计', basis: 'b' },
      { requirement: 'Axure/Figma 原型工具', status: 'improve', basis: '未提及', advice: '学会 Figma 基础操作' },
      { requirement: '大模型 API 调用实践经验', status: 'unknown', basis: '未提及' },
    ],
  }, profile, jd);
  assert.strictEqual(g.summary.have, 1);
  assert.strictEqual(g.summary.improve, 1);
  assert.strictEqual(g.summary.unknown, 1);
  assert.strictEqual(g.summary.total, 3);
});

console.log('\n── 任务依据溯源 ──');

test('basis 与差距项有明显词元重叠时通过', () => {
  assert.ok(isBasisTraceable('产品需求文档（PRD）撰写', ['产品需求文档（PRD）撰写']));
});

test('完全无关的 basis 被拒绝', () => {
  assert.ok(!isBasisTraceable('提升算法能力', ['产品需求文档（PRD）撰写', 'Axure/Figma 原型工具']));
});

test('略作缩写但仍有关键词时通过', () => {
  assert.ok(isBasisTraceable('PRD 撰写', ['产品需求文档（PRD）撰写']));
});

console.log('\n── 行动计划校验 ──');

const gap = validateGapReport({
  items: [
    { requirement: '产品需求文档（PRD）撰写', status: 'improve', basis: '未提及', advice: '写一份 PRD' },
    { requirement: 'Axure/Figma 原型工具', status: 'improve', basis: '未提及', advice: '学会 Figma' },
  ],
}, profile, jd);

test('四要素不全的任务被丢弃', () => {
  const p = validateActionPlan({
    tasks: [{ title: '写 PRD', expected_output: '一份文档', basis: '产品需求文档（PRD）撰写' }],
  }, gap, 10);
  assert.strictEqual(p.tasks.length, 0);
  assert.ok(p.violations.some((v) => v.type === 'incomplete_task'));
});

test('依据无对应的任务被丢弃', () => {
  const p = validateActionPlan({
    tasks: [{
      title: '刷题', expected_output: '错题本', completion_criteria: '10 题',
      basis: '提升算法能力', estimated_hours: 2,
    }],
  }, gap, 10);
  assert.strictEqual(p.tasks.length, 0);
  assert.ok(p.violations.some((v) => v.type === 'orphan_task'));
});

test('超预算时按 P0→P2 裁剪', () => {
  const p = validateActionPlan({
    tasks: [
      { title: 'A', expected_output: 'x', completion_criteria: 'y', basis: '产品需求文档（PRD）撰写', priority: 'P0', estimated_hours: 4 },
      { title: 'B', expected_output: 'x', completion_criteria: 'y', basis: '产品需求文档（PRD）撰写', priority: 'P1', estimated_hours: 4 },
      { title: 'C', expected_output: 'x', completion_criteria: 'y', basis: '产品需求文档（PRD）撰写', priority: 'P2', estimated_hours: 4 },
      { title: 'D', expected_output: 'x', completion_criteria: 'y', basis: '产品需求文档（PRD）撰写', priority: 'P2', estimated_hours: 4 },
    ],
  }, gap, 5);  // 预算 10 小时
  assert.ok(p.total_hours <= 10, `总时长 ${p.total_hours} 应 ≤ 10`);
  assert.ok(p.trimmed_count > 0);
  assert.ok(p.tasks.every((t) => t.priority !== 'P2' || p.tasks.length <= 2));
});

test('优先级仅 P0/P1/P2', () => {
  const p = validateActionPlan({
    tasks: [{ title: 'A', expected_output: 'x', completion_criteria: 'y', basis: '产品需求文档（PRD）撰写', priority: 'P9', estimated_hours: 2 }],
  }, gap, 10);
  assert.strictEqual(p.tasks[0].priority, 'P1');
});

test('单条任务耗时上限 4 小时', () => {
  const p = validateActionPlan({
    tasks: [{ title: 'A', expected_output: 'x', completion_criteria: 'y', basis: '产品需求文档（PRD）撰写', estimated_hours: 20 }],
  }, gap, 40);
  assert.strictEqual(p.tasks[0].estimated_hours, 4);
});

test('week 只能是 1 或 2', () => {
  const p = validateActionPlan({
    tasks: [{ title: 'A', expected_output: 'x', completion_criteria: 'y', basis: '产品需求文档（PRD）撰写', week: 7, estimated_hours: 2 }],
  }, gap, 10);
  assert.strictEqual(p.tasks[0].week, 1);
});

console.log('\n── 归一化 ──');

test('profile 过滤空经历', () => {
  const p = validateProfile({ experiences: [{ title: '', role: '', evidence: '' }, { title: 'X' }] });
  assert.strictEqual(p.experiences.length, 1);
});

test('jd importance 只保留 required/plus', () => {
  const j = validateJdProfile({
    requirements: [{ item: 'A', importance: 'weird', category: 'unknown_cat' }, { item: 'B', importance: 'plus' }],
  });
  assert.strictEqual(j.requirements[0].importance, 'required');
  assert.strictEqual(j.requirements[0].category, 'duty');
  assert.strictEqual(j.requirements[1].importance, 'plus');
});

/* ---------- 工具技能确定性判定 ---------- */
console.log('\n── 工具技能确定性判定 ──');
{
  const toolsProfile = {
    major: '汉语言文学',
    grade: '大二',
    skills: ['Canva', 'PS'],
    experiences: [{ title: '小红书运营', evidence: '会用 Canva 做一些封面图，学过一点基础的 PS', role: '运营' }],
  };
  const toolsJd = {
    requirements: [{
      item: '视觉设计能力',
      category: 'must_skill',
      importance: 'required',
      evidence: '熟练使用 Canva、Photoshop 等设计工具优先',
    }],
  };
  const g = validateGapReport({
    items: [{
      requirement: '视觉设计能力',
      status: 'unknown',
      evidence: '',
      basis: '用户技能中明确列出 Canva 和基础 PS，与岗位要求的 Canva、Photoshop 等设计工具相关，但缺少作品证明。',
      prompt: '你做过什么设计？',
      weight: 2,
    }],
  }, toolsProfile, toolsJd);
  const item = g.items.find((i) => i.requirement === '视觉设计能力');
  test('原文提到 Canva/PS → 判为 have', () => {
    assert.strictEqual(item?.status, 'have', `实际 ${item?.status}`);
  });
  test('工具技能判定后不残留追问', () => {
    assert.strictEqual(item?.prompt, '', `实际 "${item?.prompt}"`);
  });
  test('工具技能判定有原文证据', () => {
    assert.ok((item?.evidence || '').length > 0, `实际 "${item?.evidence}"`);
  });
}

/* ---------- 逻辑冲突检测 ---------- */
console.log('\n── 逻辑冲突检测 ──');
{
  const p0 = { major: '计算机', grade: '大三', skills: [], experiences: [] };
  const jd0 = { requirements: [] };

  // 依据承认具备，结论 unknown → 改判 have
  // 注：档案里必须有真实原文，改判时才能给出真实证据（V1.0 缺陷 D2 修复后新增约束）
  const pWithExp = {
    major: '视觉传达设计', grade: '大三', skills: ['Canva'],
    experiences: [{
      title: '社团海报设计',
      role: '负责海报排版与配色',
      evidence: '我在社团的招新海报里负责排版和配色，用过 Canva 和 Photoshop 完成设计。',
    }],
  };
  const g1 = validateGapReport({
    items: [{
      requirement: '视觉设计能力',
      status: 'unknown',
      basis: '用户在经历中明确提到用过 Canva 和基础 PS，与岗位要求的设计工具匹配。',
      prompt: '你做过什么？',
      weight: 2,
    }],
  }, pWithExp, jd0);
  test('依据承认具备 + 结论 unknown → 改判 have', () => {
    assert.strictEqual(g1.items[0].status, 'have', `实际 ${g1.items[0].status}`);
  });
  test('逻辑冲突改判有记录', () => {
    assert.ok(g1.violations.some((v) => v.type === 'basis_consistency'),
      JSON.stringify(g1.violations.map((v) => v.type)));
  });
  test('逻辑冲突改判的证据是用户原文而非元话语', () => {
    assert.ok(g1.items[0].evidence && g1.items[0].evidence.includes('Canva'),
      `证据不是用户原文：${g1.items[0].evidence}`);
    assert.ok(!/依据中|根据上|如前所述/.test(g1.items[0].evidence),
      `证据是元话语：${g1.items[0].evidence}`);
  });

  // V1.0 缺陷 D2 实测案例：依据前半句说的是岗位要求，后半句说的是用户未说明
  // 旧实现会因 ADMIT 命中「熟练使用」而误改判 have，并填入假证据「依据中已明确说明」
  const pT5 = {
    major: '人力资源管理', grade: '大四', skills: ['Excel'],
    experiences: [{
      title: '招聘助理实习',
      role: '协助招聘流程',
      evidence: '上学期我在一家50人的小公司实习过两个月，做的是招聘助理，帮着发招聘帖、约面试、整理简历、跟进入职流程。',
    }],
  };
  const gT5 = validateGapReport({
    items: [{
      requirement: '数据跟踪与迭代优化',
      status: 'unknown',
      basis: '岗位要求熟练使用 Excel 等办公软件并具备基础数据处理能力，用于员工信息档案与人事数据统计；经历档案中提到整理简历、跟进入职流程，但未说明是否使用 Excel 做过数据统计或档案维护，也没有可回指的证据片段，按规则判为信息不足。',
      prompt: '用过 Excel 做统计吗？',
      weight: 2,
    }],
  }, pT5, jd0);
  test('D2回归：依据前半句是岗位要求时不得误改判 have', () => {
    assert.strictEqual(gT5.items[0].status, 'unknown',
      `实际 ${gT5.items[0].status}，依据=${gT5.items[0].basis}`);
  });
  test('D2回归：不得产出假证据「依据中已明确说明」', () => {
    assert.ok(!/依据中已明确说明/.test(JSON.stringify(gT5.items)),
      '产出了元话语假证据');
  });

  // 依据说不确定 → 保持 unknown
  const g2 = validateGapReport({
    items: [{
      requirement: '跨团队推动落地',
      status: 'unknown',
      basis: '经历档案中没有任何关于配合其他团队、推动项目落地的描述，无法判断是否具备。',
      prompt: '有协作经历吗？',
      weight: 2,
    }],
  }, p0, jd0);
  test('依据说「无法判断」→ 保持 unknown', () => {
    assert.strictEqual(g2.items[0].status, 'unknown', `实际 ${g2.items[0].status}`);
  });
  test('逻辑冲突检测未误改', () => {
    assert.ok(!g2.violations.some((v) => v.type === 'basis_consistency'), '不应触发改判');
  });

  // 依据说「未提及」→ 保持 unknown
  const g3 = validateGapReport({
    items: [{
      requirement: '原型工具使用',
      status: 'unknown',
      basis: '用户未提及使用过原型工具，无法确认。',
      prompt: '用过吗？',
      weight: 2,
    }],
  }, p0, jd0);
  test('依据说「未提及」→ 保持 unknown', () => {
    assert.strictEqual(g3.items[0].status, 'unknown', `实际 ${g3.items[0].status}`);
  });
}

/* ---------- JD 分类归一化 ---------- */
console.log('\n── JD 分类归一化 ──');
{
  // 模型把「相关专业背景」标成 plus_skill、「学历与年级门槛」标成 must_skill
  const jd = validateJdProfile({
    requirements: [
      { item: '用户需求调研', ability_type: '需求调研', category: 'duty', importance: 'required', evidence: '参与需求调研' },
      { item: '相关专业背景', ability_type: '专业背景', category: 'plus_skill', importance: 'plus', evidence: '计算机等相关专业优先' },
      { item: '学历与年级门槛', ability_type: '学历门槛', category: 'must_skill', importance: 'plus', evidence: '本科及以上在读' },
      { item: '大模型 API 调用实践经验', ability_type: '大模型API', category: 'plus_skill', importance: 'plus', evidence: '熟悉大模型 API' },
    ],
    ambiguous: [],
    job_summary: '测试用',
  });
  const byItem = Object.fromEntries(jd.requirements.map((r) => [r.item, r]));
  test('专业背景 → major_req（不采信模型的 plus_skill）', () => {
    assert.strictEqual(byItem['相关专业背景']?.category, 'major_req',
      `实际 ${byItem['相关专业背景']?.category}`);
  });
  test('学历门槛 → major_req（不采信模型的 must_skill）', () => {
    assert.strictEqual(byItem['学历与年级门槛']?.category, 'major_req',
      `实际 ${byItem['学历与年级门槛']?.category}`);
  });
  test('学历门槛 → required（硬门槛，不因模型标 plus 而改变）', () => {
    assert.strictEqual(byItem['学历与年级门槛']?.importance, 'required',
      `实际 ${byItem['学历与年级门槛']?.importance}`);
  });
  test('专业背景的 importance 保持模型判断（JD 写「优先」→ plus）', () => {
    assert.strictEqual(byItem['相关专业背景']?.importance, 'plus',
      `实际 ${byItem['相关专业背景']?.importance}`);
  });
  test('非学历专业类分类不受影响', () => {
    assert.strictEqual(byItem['用户需求调研']?.category, 'duty', `实际 ${byItem['用户需求调研']?.category}`);
    assert.strictEqual(byItem['大模型 API 调用实践经验']?.category, 'plus_skill',
      `实际 ${byItem['大模型 API 调用实践经验']?.category}`);
  });
}

/* ---------- D2 语义相关度校验 ---------- */
console.log('\n── D2 语义相关度校验 ──');
{
  const pT1 = {
    major: '计算机科学与技术', grade: '大三', skills: ['Java'],
    experiences: [{
      title: '校园二手交易平台课程项目',
      role: '负责后端接口和数据库设计',
      evidence: '上学期做了一个校园二手交易平台的课程项目，我负责后端接口和数据库设计，用 Java 写的，一共做了 8 个接口，数据库用 MySQL 建的表。',
    }],
  };

  // 实测缺陷案例：MySQL 确实在原文里，但与「大模型 API 调用经验」无关
  const gBad = validateGapReport({
    items: [{
      requirement: '大模型 API 调用实践经验',
      status: 'have',
      evidence: 'MySQL',
      basis: '用户提到使用 MySQL。',
      weight: 2,
    }],
  }, pT1, { requirements: [{ item: '大模型 API 调用实践经验', evidence: '熟悉至少一种大模型 API' }] });
  test('D2回归：证据在原文但与能力项无关 → 降级 unknown', () => {
    assert.strictEqual(gBad.items[0].status, 'unknown', `实际 ${gBad.items[0].status}`);
  });
  test('D2回归：无关证据被记录为 irrelevant_evidence', () => {
    assert.ok(gBad.violations.some((v) => v.type === 'irrelevant_evidence'),
      JSON.stringify(gBad.violations.map((v) => v.type)));
  });
  test('D2回归：降级后假证据被清空', () => {
    assert.strictEqual(gBad.items[0].evidence, '', `残留 ${gBad.items[0].evidence}`);
  });

  // 对照组：证据真的支撑该能力项 → 保持 have
  const gGood = validateGapReport({
    items: [{
      requirement: '大模型 API 调用实践经验',
      status: 'have',
      evidence: '上学期做了一个校园二手交易平台的课程项目，我负责后端接口和数据库设计，用 Java 写的，一共做了 8 个接口，数据库用 MySQL 建的表。',
      basis: '用户有完整的后端接口开发项目经历。',
      weight: 2,
    }],
  }, pT1, { requirements: [{ item: '大模型 API 调用实践经验', evidence: '熟悉至少一种大模型 API' }] });
  test('D2对照组：证据支撑能力项 → 保持 have', () => {
    assert.strictEqual(gGood.items[0].status, 'have', `实际 ${gGood.items[0].status}`);
  });

  // 元话语证据一律拒绝
  const gMeta = validateGapReport({
    items: [{
      requirement: '逻辑思考能力',
      status: 'have',
      evidence: '依据中已明确说明',
      basis: '依据中已明确说明用户具备逻辑思考能力。',
      weight: 2,
    }],
  }, pT1, { requirements: [] });
  test('D2回归：元话语证据被拒绝', () => {
    assert.strictEqual(gMeta.items[0].status, 'unknown', `实际 ${gMeta.items[0].status}`);
  });
  test('D2回归：元话语被记录为 meta_discourse_evidence', () => {
    assert.ok(gMeta.violations.some((v) => v.type === 'meta_discourse_evidence'),
      JSON.stringify(gMeta.violations.map((v) => v.type)));
  });

  // 学历/专业类确定性规则不受语义校验影响（不能误伤）
  const gEdu = validateGapReport({
    items: [{
      requirement: '相关专业背景',
      status: 'unknown',
      basis: '用户专业为计算机科学与技术。',
      weight: 1,
    }],
  }, pT1, { requirements: [{ item: '相关专业背景', evidence: '计算机相关专业优先' }] });
  test('D2对照：学历专业类确定性判定不受语义校验误伤', () => {
    assert.strictEqual(gEdu.items[0].status, 'have', `实际 ${gEdu.items[0].status}`);
  });
}

/* ---------- JD 名实分离防护 ---------- */
console.log('\n── JD 名实分离防护 ──');
{
  // 实测案例：模型把「熟悉 MySQL」这条要求标成了「大模型API」能力类型，
  // item 被规范化成「大模型 API 调用实践经验」，evidence 却还挂着 MySQL 那句。
  const jdBad = validateJdProfile({
    requirements: [{
      ability_type: '大模型API',
      item: '大模型 API 调用实践经验',
      category: 'must_skill',
      importance: 'required',
      evidence: '熟悉 MySQL 或 Redis 等常用数据库',
    }],
  }, '熟悉 MySQL 或 Redis 等常用数据库');
  test('名实分离：证据撑不住规范名时拒绝改名', () => {
    const item = jdBad.requirements[0]?.item || '';
    assert.ok(!/大模型/.test(item),
      `item 被错误改名为「${item}」，evidence 仍是 MySQL 那句`);
  });

  // 对照组：证据确实支撑规范名 → 正常改名
  const jdGood = validateJdProfile({
    requirements: [{
      ability_type: '大模型API',
      item: '大模型 API 调用实践经验',
      category: 'must_skill',
      importance: 'required',
      evidence: '熟悉至少一种大模型 API，有调用实践经验者优先',
    }],
  }, '熟悉至少一种大模型 API');
  test('名实分离对照组：证据支撑规范名 → 正常改名', () => {
    assert.strictEqual(jdGood.requirements[0]?.item, '大模型 API 调用实践经验',
      `实际 ${jdGood.requirements[0]?.item}`);
  });

  // 工具技能规则：工具名必须出现在能力项名称里，不能只在证据里
  const pMysql = {
    major: '计算机科学与技术', grade: '大三', skills: ['Java', 'MySQL'],
    experiences: [{
      title: '课程项目',
      role: '后端开发',
      evidence: '我负责后端接口和数据库设计，用 Java 写的，数据库用 MySQL 建的表。',
    }],
  };
  const gTool = validateGapReport({
    items: [{
      requirement: '大模型 API 调用实践经验',
      status: 'unknown',
      basis: '未提及大模型 API 调用。',
      weight: 2,
    }],
  }, pMysql, {
    requirements: [{
      item: '大模型 API 调用实践经验',
      evidence: '熟悉 MySQL 或 Redis 等常用数据库',
    }],
  });
  test('工具技能：MySQL 只在证据里出现时不得判 have', () => {
    assert.strictEqual(gTool.items[0].status, 'unknown',
      `实际 ${gTool.items[0].status}，证据=${gTool.items[0].evidence}`);
  });
  test('工具技能：记录 tool_skill_mismatch 违规', () => {
    assert.ok(gTool.violations.some((v) => v.type === 'tool_skill_mismatch'),
      JSON.stringify(gTool.violations.map((v) => v.type)));
  });
}

/* ---------- 竞赛获奖确定性判定 ---------- */
console.log('\n── 竞赛获奖确定性判定 ──');
{
  // V2.0 实测：模型对竞赛项判定会抖动（have / improve 随机），
  // 获奖是客观事实，应由服务端兜住
  const pContest = {
    major: '计算机', grade: '大三', skills: [],
    experiences: [{
      title: '学校程序设计竞赛',
      role: '参赛者',
      evidence: '我还参加过学校程序设计竞赛，拿了个三等奖。',
    }],
  };
  const gContest = validateGapReport({
    items: [{
      requirement: '竞赛经历',
      status: 'improve',
      basis: '用户参加的是程序设计竞赛，与岗位要求的产品竞赛类型不完全对口，属于沾边但深度不足。',
      advice: '参加一次产品类竞赛',
      weight: 1,
    }],
  }, pContest, { requirements: [{ item: '竞赛经历', evidence: '有产品竞赛经历者优先' }] });
  test('竞赛获奖：客观获奖事实应改判 have', () => {
    assert.strictEqual(gContest.items[0].status, 'have',
      `实际 ${gContest.items[0].status}`);
  });
  test('竞赛获奖：证据是用户原文', () => {
    assert.ok(/竞赛/.test(gContest.items[0].evidence || ''),
      `证据不是原文：${gContest.items[0].evidence}`);
  });
  test('竞赛获奖：记录 deterministic_contest 违规', () => {
    assert.ok(gContest.violations.some((v) => v.type === 'deterministic_contest'),
      JSON.stringify(gContest.violations.map((v) => v.type)));
  });

  // 对照组：无获奖记录就不该改判
  const gNoAward = validateGapReport({
    items: [{
      requirement: '竞赛经历',
      status: 'unknown',
      basis: '未提及参加竞赛。',
      weight: 1,
    }],
  }, {
    major: '计算机', grade: '大三', skills: [],
    experiences: [{ title: '课程项目', role: '开发', evidence: '我做了一个课程项目。' }],
  }, { requirements: [{ item: '竞赛经历', evidence: '有产品竞赛经历者优先' }] });
  test('竞赛获奖：无获奖记录时不得改判', () => {
    assert.strictEqual(gNoAward.items[0].status, 'unknown',
      `实际 ${gNoAward.items[0].status}`);
  });
}

/* ---------- 概括能力名不被误伤 ---------- */
console.log('\n── 概括能力名不被误伤 ──');
{
  // 案例B：JD 写「熟练使用 Canva、Photoshop 等设计工具优先」，
  // 规范名是概括性的「视觉设计能力」—— 两者本无词元重叠，不能判成名实分离
  const jdDesign = validateJdProfile({
    requirements: [{
      ability_type: '设计能力',
      item: '视觉设计能力',
      category: 'plus_skill',
      importance: 'plus',
      evidence: '熟练使用 Canva、Photoshop 等设计工具优先',
    }],
  }, '熟练使用 Canva、Photoshop 等设计工具优先');
  test('概括能力名：视觉设计能力保留规范名', () => {
    assert.strictEqual(jdDesign.requirements[0]?.item, '视觉设计能力',
      `实际 ${jdDesign.requirements[0]?.item}`);
  });
  test('概括能力名：证据不被改写成 JD 原文', () => {
    assert.ok(/canva/i.test(jdDesign.requirements[0]?.evidence || ''),
      `证据被改写：${jdDesign.requirements[0]?.evidence}`);
  });

  // 语义校验：工具名证据对概括能力项也应算相关
  const pDesign = {
    major: '汉语言文学', grade: '大二', skills: ['Canva'],
    experiences: [{
      title: '公众号运营',
      role: '负责选题与写稿',
      evidence: '会用 Canva 做一些封面图，学过一点基础的 PS。',
    }],
  };
  const gDesign = validateGapReport({
    items: [{
      requirement: '视觉设计能力',
      status: 'have',
      evidence: 'Canva',
      basis: '用户明确提到会用 Canva 做封面图。',
      weight: 1,
    }],
  }, pDesign, {
    requirements: [{ item: '视觉设计能力', evidence: '熟练使用 Canva、Photoshop 等设计工具优先' }],
  });
  test('概括能力名：工具名证据不被判为无关', () => {
    assert.strictEqual(gDesign.items[0].status, 'have',
      `实际 ${gDesign.items[0].status}，违规=${JSON.stringify(gDesign.violations.map(v => v.type))}`);
  });

  // 工具技能规则：概括能力项 + 方向相符的工具 → 应改判 have
  const gDesignTool = validateGapReport({
    items: [{
      requirement: '视觉设计能力',
      status: 'improve',
      basis: '用户提到学过一点基础的 PS，但只做封面图，深度不足。',
      advice: '多练习设计',
      weight: 1,
    }],
  }, pDesign, {
    requirements: [{ item: '视觉设计能力', evidence: '熟练使用 Canva、Photoshop 等设计工具优先' }],
  });
  test('工具技能：视觉设计能力 + Canva/PS 应改判 have', () => {
    assert.strictEqual(gDesignTool.items[0].status, 'have',
      `实际 ${gDesignTool.items[0].status}，证据=${gDesignTool.items[0].evidence}`);
  });
}

console.log(`\n═══ 通过 ${passed} · 失败 ${failed} ═══`);
process.exit(failed ? 1 : 0);

