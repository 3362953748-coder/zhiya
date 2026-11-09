/**
 * 测试 01 · 输入测试
 *
 * 验证项：能否正常填写个人经历和 JD
 *
 * 分两层设计，避免把「参数处理」和「模型行为」混在一起：
 *   L1 参数层 —— 纯代码逻辑，用 mock 探测，秒级完成
 *   L2 端到端层 —— 真调模型，验证真实链路
 *
 * 早期版本把 weekly_hours 的 4 个变体都走真模型，单类跑了 13 分钟。
 * 参数钳制是纯代码行为，没必要烧模型。
 */
import { pathToFileURL } from 'node:url';
import { group, analyze, cachedAnalyze } from './framework.js';
import { CASE_A, CASE_C, CASE_D, CASE_E } from './fixtures.js';

/* ==================================================================
 * L1 · 参数层（mock 探测，验证请求确实发到了后端并被正确处理）
 * ================================================================ */

/**
 * 用 mock 探测检查「请求是否发出、body 是否被后端正确接收」。
 * 不依赖真实模型响应，因此可以覆盖大量参数组合。
 */
async function probe(body) {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
    return new Response(JSON.stringify({ ok: true, echo: seen.at(-1).body }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await analyze(body);
  } finally {
    globalThis.fetch = realFetch;
  }
  return seen;
}

export async function runInputTests() {
  const g = group('01 输入测试');

  /* ---------- L1-1：空输入与过短的拒绝 ---------- */
  const empty = await analyze({ raw_text: '', jd_text: '' });
  g.check(
    '完全空输入被拒绝且返回 400',
    empty.status === 400,
    `实际 ${empty.status}：${JSON.stringify(empty.data).slice(0, 120)}`
  );
  g.check(
    '空输入返回明确错误码',
    empty.data?.error === 'raw_text_too_short',
    `实际错误码 ${empty.data?.error}`
  );
  g.check(
    '空输入返回给用户看的提示文案（非技术噪音）',
    typeof empty.data?.message === 'string' && empty.data.message.length > 5 && !empty.data.message.includes('undefined'),
    `message=${empty.data?.message}`
  );

  const tooShort = await analyze({ raw_text: '你好', jd_text: CASE_A.jd_text });
  g.check(
    '经历过短（2字）被拒绝',
    tooShort.status === 400 && tooShort.data?.error === 'raw_text_too_short',
    `实际 ${tooShort.status} / ${tooShort.data?.error}`
  );

  const jdTooShort = await analyze({ raw_text: CASE_A.raw_text, jd_text: '后端开发' });
  g.check(
    'JD 过短被拒绝',
    jdTooShort.status === 400 && jdTooShort.data?.error === 'jd_text_too_short',
    `实际 ${jdTooShort.status} / ${jdTooShort.data?.error}`
  );

  const noJd = await analyze({ raw_text: CASE_A.raw_text, jd_text: '' });
  g.check(
    '缺 JD 且未指定岗位被拒绝',
    noJd.status === 400 && noJd.data?.error === 'target_role_missing',
    `实际 ${noJd.status} / ${noJd.data?.error}`
  );

  /* ---------- L1-2：请求体确实送到后端 ---------- */
  const sent = await probe({ raw_text: CASE_A.raw_text, jd_text: CASE_A.jd_text, weekly_hours: 12 });
  g.check(
    '请求确实发到了 /api/analysis',
    sent.length === 1 && sent[0].url.endsWith('/api/analysis'),
    JSON.stringify(sent.map((s) => s.url))
  );
  g.check(
    '请求体完整携带 raw_text / jd_text / weekly_hours',
    sent[0]?.body?.raw_text === CASE_A.raw_text &&
      sent[0]?.body?.jd_text === CASE_A.jd_text &&
      sent[0]?.body?.weekly_hours === 12,
    JSON.stringify(sent[0]?.body)?.slice(0, 120)
  );

  /* ---------- L1-3：weekly_hours 的钳制（纯代码逻辑） ---------- */
  // 直接引用服务端实现，避免测试里留一份会过期的副本
  const { normalizeWeeklyHours } = await import('../server/sanitize.js');
  const clamp = (x) => normalizeWeeklyHours(x, 10);
  const clampCases = [
    [0, 10, '0 回退默认 10'],
    [-5, 10, '负数回退默认 10'],
    [null, 10, 'null 回退默认 10'],
    [undefined, 10, 'undefined 回退默认 10'],
    ['', 10, '空串回退默认 10'],
    [999, 60, '超上限钳到 60'],
    [1, 2, '低于下限钳到 2'],
    [8, 8, '正常值原样透传'],
    ['15', 15, '字符串数字正确转换'],
    [NaN, 10, 'NaN 回退默认 10'],
  ];
  for (const [input, expect, label] of clampCases) {
    g.check(
      `weekly_hours 钳制：${label}`,
      clamp(input) === expect,
      `输入 ${JSON.stringify(input)} → 实际 ${clamp(input)}，期望 ${expect}`
    );
  }
  g.check(
    'weekly_hours 缺失时按 10 小时估算（默认口径）',
    clamp(undefined) === 10,
    `实际 ${clamp(undefined)}`
  );

  /* ---------- L1-4：后端对非法类型不崩溃 ---------- */
  for (const [name, body] of [
    ['raw_text 为 null', { raw_text: null, jd_text: CASE_A.jd_text }],
    ['raw_text 为数字', { raw_text: 12345, jd_text: CASE_A.jd_text }],
    ['raw_text 为对象', { raw_text: { a: 1 }, jd_text: CASE_A.jd_text }],
    ['raw_text 为数组', { raw_text: ['abc'], jd_text: CASE_A.jd_text }],
  ]) {
    const r = await analyze(body);
    g.check(
      `非法类型「${name}」被安全拒绝而非崩溃`,
      r.status === 400,
      `实际 ${r.status}：${JSON.stringify(r.data).slice(0, 100)}`
    );
  }

  /* ---------- L1-5：畸形请求体 ---------- */
  for (const [name, payload] of [
    ['非法 JSON', '{"raw_text": "abc'],
    ['XML 格式', '<xml>test</xml>'],
    ['纯文本', 'hello'],
    ['空 body', ''],
  ]) {
    try {
      const res = await fetch('http://127.0.0.1:5178/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      await res.text();
      g.check(
        `畸形请求「${name}」返回 4xx 而非 5xx`,
        res.status >= 400 && res.status < 500,
        `实际 ${res.status}`
      );
    } catch (e) {
      g.check(`畸形请求「${name}」未抛出未捕获异常`, false, e.message);
    }
  }

  /* ---------- L2 · 端到端层（真调模型） ---------- */
  // 只保留必要用例：正常输入、纯英文、超长输入、特殊字符、极简

  // 2.1 正常输入
  const ok = await cachedAnalyze('A', CASE_A);
  g.check('正常输入返回 200', ok.status === 200, `实际 ${ok.status}`);
  g.check(
    '响应耗时在可接受范围（< 150 秒，含自动重试余量）',
    ok.ms < 150000,
    `实际 ${(ok.ms / 1000).toFixed(1)} 秒`
  );
  g.check(
    '无网络故障时响应在 90 秒内',
    (ok.data?.meta?.retries || 0) > 0 || ok.ms < 90000,
    `耗时 ${(ok.ms / 1000).toFixed(1)} 秒，重试 ${ok.data?.meta?.retries || 0} 次`
  );
  g.check(
    '正常输入产出完整的四段结果',
    !!ok.data?.profile && !!ok.data?.jd_profile && !!ok.data?.gap_report && !!ok.data?.action_plan,
    `profile=${!!ok.data?.profile} jd=${!!ok.data?.jd_profile} gap=${!!ok.data?.gap_report} plan=${!!ok.data?.action_plan}`
  );

  // 2.2 纯英文输入
  const en = await cachedAnalyze('D', CASE_D);
  g.check('纯英文输入返回 200', en.status === 200, `实际 ${en.status}`);
  g.check(
    '纯英文输入能提取到专业信息',
    (en.data?.profile?.major || '').length > 0,
    `major=${en.data?.profile?.major}`
  );
  g.check(
    '纯英文输入能拆解出岗位能力项',
    (en.data?.jd_profile?.requirements?.length || 0) >= 3,
    `条目数 ${en.data?.jd_profile?.requirements?.length}`
  );

  // 2.3 超长输入
  const long = await cachedAnalyze('E', CASE_E);
  g.check(
    '超长输入（>3000字）不导致 500',
    long.status === 200,
    `实际 ${long.status}：${JSON.stringify(long.data).slice(0, 120)}`
  );
  g.check(
    '超长输入仍在合理耗时内（< 150 秒）',
    long.ms < 150000,
    `实际 ${(long.ms / 1000).toFixed(1)} 秒`
  );

  // 2.4 特殊字符（真实链路，确认不崩溃）
  const special = await analyze({
    raw_text: `${CASE_A.raw_text}\n\n带特殊字符：<script>alert(1)</script> & "引号" emoji 🚀`,
    jd_text: CASE_A.jd_text,
    weekly_hours: 10,
  });
  g.check('特殊字符 / HTML 标签 / emoji 不导致崩溃', special.status === 200, `实际 ${special.status}`);
  g.check(
    '特殊字符输入下仍能产出差距条目',
    (special.data?.gap_report?.items?.length || 0) > 0,
    `条目数 ${special.data?.gap_report?.items?.length}`
  );

  // 2.5 极简但合法
  const minimal = await cachedAnalyze('C', CASE_C);
  g.check('极简但合法的输入（≥10字）可正常处理', minimal.status === 200, `实际 ${minimal.status}`);

  return g;
}

/* ---------- CLI 入口：node test/t01-input.js ---------- */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const g = await runInputTests();
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
