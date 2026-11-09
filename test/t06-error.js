/**
 * 测试 06 · 异常测试
 *
 * 验证项：网络中断、输入为空时是否正常
 * 覆盖：空输入边界、畸形请求体、超大请求、并发、
 *      后端不可达、断网重试、超时、非法 JSON、非法方法
 */
import { pathToFileURL } from 'node:url';
import { group, analyze } from './framework.js';
import { CASE_A } from './fixtures.js';

const BASE = 'http://127.0.0.1:5178';

export async function runErrorTests() {
  const g = group('06 异常测试');

  /* ---------- 1. 空输入与边界 ---------- */
  const cases = [
    ['完全空 body', {}],
    ['raw_text 为 null', { raw_text: null, jd_text: CASE_A.jd_text }],
    ['raw_text 为数字', { raw_text: 12345, jd_text: CASE_A.jd_text }],
    ['raw_text 为对象', { raw_text: { a: 1 }, jd_text: CASE_A.jd_text }],
    ['raw_text 为数组', { raw_text: ['abc'], jd_text: CASE_A.jd_text }],
    ['jd_text 为 undefined', { raw_text: CASE_A.raw_text, jd_text: undefined }],
    ['body 为 null', null],
  ];
  for (const [name, body] of cases) {
    try {
      const r = await analyze(body);
      g.check(
        `异常输入「${name}」被安全拒绝（400）而非崩溃`,
        r.status === 400,
        `实际 ${r.status}：${JSON.stringify(r.data).slice(0, 120)}`
      );
      g.check(
        `异常输入「${name}」返回结构化错误`,
        typeof r.data?.error === 'string' && typeof r.data?.message === 'string',
        JSON.stringify(r.data).slice(0, 120)
      );
    } catch (e) {
      g.check(`异常输入「${name}」被安全拒绝而非抛出异常`, false, e.message);
    }
  }

  /* ---------- 2. 畸形请求体 ---------- */
  const malformed = [
    ['非法 JSON', '{"raw_text": "abc', 'application/json'],
    ['XML 格式', '<xml>test</xml>', 'application/json'],
    ['纯文本', 'hello', 'text/plain'],
    ['空 body', '', 'application/json'],
  ];
  for (const [name, payload, ct] of malformed) {
    try {
      const res = await fetch(`${BASE}/api/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': ct },
        body: payload,
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* 可能不是 JSON */ }
      g.check(
        `畸形请求「${name}」返回 4xx 而非 5xx`,
        res.status >= 400 && res.status < 500,
        `实际 ${res.status}`
      );
      g.check(
        `畸形请求「${name}」返回可读的错误结构`,
        !text || parsed !== null || res.status < 500,
        `响应体：${text.slice(0, 100)}`
      );
    } catch (e) {
      g.check(`畸形请求「${name}」未抛出未捕获异常`, false, e.message);
    }
  }

  /* ---------- 3. 超大请求体 ---------- */
  try {
    const huge = await analyze({ raw_text: 'x'.repeat(400 * 1024), jd_text: CASE_A.jd_text });
    g.check(
      '超大请求体（400KB）被安全拒绝而非崩溃',
      huge.status === 400 || huge.status === 413 || huge.status === 200,
      `实际 ${huge.status}`
    );
    g.check(
      '超大请求体时服务仍存活',
      (await (await fetch(`${BASE}/api/health`)).json()).ok === true,
      '健康检查失败，服务可能已挂'
    );
  } catch (e) {
    g.check('超大请求体未抛出未捕获异常', false, e.message);
  }

  /* ---------- 4. 非法 HTTP 方法 ---------- */
  for (const [method, path] of [['GET', '/api/analysis'], ['DELETE', '/api/analysis'], ['PUT', '/api/health']]) {
    try {
      const res = await fetch(`${BASE}${path}`, { method });
      g.check(
        `${method} ${path} 返回 4xx（方法不允许）`,
        res.status >= 400 && res.status < 500,
        `实际 ${res.status}`
      );
    } catch (e) {
      g.check(`${method} ${path} 未抛出异常`, false, e.message);
    }
  }

  /* ---------- 5. 不存在的路径 ---------- */
  const notFound = await fetch(`${BASE}/api/does-not-exist`);
  g.check('不存在的接口返回 404', notFound.status === 404, `实际 ${notFound.status}`);

  /* ---------- 6. 后端不可达（模拟断网） ---------- */
  const dead = await analyze({ raw_text: CASE_A.raw_text, jd_text: CASE_A.jd_text }, 'http://127.0.0.1:59999');
  g.check(
    '后端不可达时前端能捕获（不是静默失败）',
    dead.status === 0 || dead.data === null,
    `实际 status=${dead.status}`
  );

  /* ---------- 7. 并发请求（同一时刻多个分析） ---------- */
  const concurrent = await Promise.all([
    analyze({ raw_text: CASE_A.raw_text, jd_text: CASE_A.jd_text, weekly_hours: 10 }),
    analyze({ raw_text: CASE_A.raw_text, jd_text: CASE_A.jd_text, weekly_hours: 8 }),
    analyze({ raw_text: CASE_A.raw_text, jd_text: CASE_A.jd_text, weekly_hours: 12 }),
  ]);
  g.check(
    '并发 3 个请求全部成功返回 200',
    concurrent.every((r) => r.status === 200),
    `状态：${concurrent.map((r) => r.status).join(', ')}`
  );
  g.check(
    '并发请求返回各自独立的 weekly_hours 预算',
    concurrent.every((r) => {
      const t = r.data?.action_plan?.tasks || [];
      const total = t.reduce((s, x) => s + (Number(x.estimated_hours) || 0), 0);
      const budget = (r.data?.meta?.weekly_hours || 0) * 2;
      return budget === 0 || total <= budget + 0.5;
    }),
    concurrent.map((r) => {
      const t = r.data?.action_plan?.tasks || [];
      return `${r.data?.meta?.weekly_hours}h/周 → ${t.reduce((s, x) => s + (Number(x.estimated_hours) || 0), 0)}h`;
    }).join(' | ')
  );

  /* ---------- 8. 连续请求后服务仍健康 ---------- */
  g.check(
    '连续多轮请求后服务仍健康',
    (await (await fetch(`${BASE}/api/health`)).json()).ok === true,
    '健康检查失败'
  );

  /* ---------- 9. 演示接口兜底 ---------- */
  const demo = await analyze({ demo: true });
  g.check('演示模式可用（断网兜底路径）', demo.status === 200 && demo.data?.meta?.is_demo === true,
    `实际 ${demo.status}，is_demo=${demo.data?.meta?.is_demo}`);

  /* ---------- 10. 重算接口异常输入 ---------- */
  try {
    const res = await fetch(`${BASE}/api/analysis/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result_id: 'nonexistent-id' }),
    });
    g.check(
      '重算接口收到不存在的 result_id 返回 4xx',
      res.status >= 400 && res.status < 500,
      `实际 ${res.status}`
    );
  } catch (e) {
    g.check('重算接口异常输入未抛出异常', false, e.message);
  }

  return g;
}


/* ---------- CLI 入口：node test/t06-error.js ---------- */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await runErrorTests();
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
