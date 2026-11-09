/**
 * 前端健壮性测试：验证 API 地址探测与错误分类
 * 运行：node test/frontend-robust.test.js
 */
import assert from 'node:assert';
import fs from 'node:fs';

let pass = 0, fail = 0;
const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

async function runAll() {
  for (const { name, fn } of cases) {
    try { await fn(); pass++; console.log(`  ✅ ${name}`); }
    catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
  }
}

// 模拟浏览器环境
global.document = { getElementById: () => null, querySelectorAll: () => [] };
global.location = { protocol: 'http:', href: 'http://127.0.0.1:5178/' };

const src = fs.readFileSync('public/app.js', 'utf8');
const start = src.indexOf('const API_CANDIDATES');
const end = src.indexOf('const state = {');
const apiBlock = src.slice(start, end);

// 加载成真实模块（临时文件），这样 mock 才对模块内生效
const tmpMod = '.workbuddy-test-api.mjs';
fs.writeFileSync(tmpMod, apiBlock
  .replace('const API_CANDIDATES', 'export const API_CANDIDATES')
  .concat('\nexport { detectApiBase, parseResponse, explainError, apiUrl };\n'));
const mod = await import(`../${tmpMod}`);

console.log('\n═══ 前端健壮性测试 ═══\n');

/* ---------- 响应解析 ---------- */
console.log('── 响应解析 ──');

test('合法 JSON 能被解析', async () => {
  const fakeRes = { ok: true, status: 200, text: async () => '{"a":1}' };
  const r = await mod.parseResponse(fakeRes);
  assert.deepStrictEqual(r.data, { a: 1 });
  assert.strictEqual(r.ok, true);
});

test('非 JSON 响应抛出可识别错误', async () => {
  const fakeRes = { ok: false, status: 404, text: async () => 'Not Found' };
  await assert.rejects(
    () => mod.parseResponse(fakeRes),
    (e) => {
      assert.strictEqual(e.code, 'non_json_response');
      assert.ok(e.message.includes('Not Found'));
      return true;
    }
  );
});

test('HTML 错误页也能识别', async () => {
  const fakeRes = { ok: false, status: 500, text: async () => '<!DOCTYPE html><html>...' };
  await assert.rejects(() => mod.parseResponse(fakeRes), (e) => e.code === 'non_json_response');
});

test('空响应体不报错，返回空对象', async () => {
  const fakeRes = { ok: true, status: 200, text: async () => '' };
  const r = await mod.parseResponse(fakeRes);
  assert.deepStrictEqual(r.data, {});
});

/* ---------- 错误分类 ---------- */
console.log('\n── 错误分类 ──');

test('非 JSON 响应 → 提示地址错误并给出正确地址', () => {
  const info = mod.explainError({ code: 'non_json_response', status: 404, message: 'x' }, 'fallback');
  assert.ok(info.title.includes('错误的服务器'));
  assert.ok(info.hint.includes('5178'));
});

test('网络连接失败 → 提示启动命令', () => {
  const info = mod.explainError({ name: 'TypeError', message: 'Failed to fetch' }, 'fallback');
  assert.ok(info.title.includes('后端'));
  assert.ok(info.hint.includes('start.sh'));
});

test('其他异常 → 用兜底文案', () => {
  const info = mod.explainError({ message: 'x' }, '解析失败，请重试。');
  assert.strictEqual(info.msg, '解析失败，请重试。');
});

test('错误信息不含原始技术噪音', () => {
  const info = mod.explainError({ code: 'non_json_response', message: 'Unexpected token N' }, 'x');
  assert.ok(!info.msg.includes('Unexpected token'));
});

/* ---------- 后端地址探测（真实后端） ---------- */
console.log('\n── 后端地址探测 ──');

test('候选地址包含同源与 localhost:5178', () => {
  assert.ok(Array.isArray(mod.API_CANDIDATES));
  assert.strictEqual(mod.API_CANDIDATES[0], '', '第一候选应为同源相对路径');
  assert.ok(mod.API_CANDIDATES.some((c) => c.includes('5178')));
});

test('真实后端可达时探测成功', async () => {
  const base = await mod.detectApiBase();
  assert.ok(base !== null, '后端在跑时应探测成功');
});

test('同源不通时自动降级到 5178（跨端口场景）', async () => {
  // 模拟「页面在预览面板打开」：同源不可用，但 5178 可用
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('5178')) {
      return realFetch('http://127.0.0.1:5178/api/health');
    }
    throw new TypeError('Failed to fetch');
  };
  try {
    const base = await mod.detectApiBase();
    assert.strictEqual(base, 'http://127.0.0.1:5178');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('全部不通时返回 null（后端没启动）', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try {
    const base = await mod.detectApiBase();
    assert.strictEqual(base, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('健康检查返回 ok:false 时不算可用', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: false }) });
  try {
    const base = await mod.detectApiBase();
    assert.strictEqual(base, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('file:// 协议下跳过同源候选', async () => {
  const realFetch = globalThis.fetch;
  const realLoc = globalThis.location;
  globalThis.location = { protocol: 'file:', href: 'file:///C:/test.html' };
  const tried = [];
  globalThis.fetch = async (url) => {
    tried.push(String(url));
    if (String(url).includes('5178')) {
      return realFetch('http://127.0.0.1:5178/api/health');
    }
    throw new TypeError('Failed to fetch');
  };
  try {
    const base = await mod.detectApiBase();
    assert.strictEqual(base, 'http://127.0.0.1:5178');
    assert.ok(!tried.some((u) => u.startsWith('/api/health')),
      'file:// 下不应发起同源相对请求');
  } finally {
    globalThis.fetch = realFetch;
    globalThis.location = realLoc;
  }
});

/* ---------- 后端 CORS ---------- */
console.log('\n── 后端 CORS 头 ──');

test('健康接口带 Origin 时返回 CORS 头（跨端口可读）', async () => {
  const res = await fetch('http://127.0.0.1:5178/api/health', {
    headers: { Origin: 'http://127.0.0.1:59272' },
  });
  assert.strictEqual(res.headers.get('access-control-allow-origin'), 'http://127.0.0.1:59272');
});

test('预检请求返回 204', async () => {
  const pre = await fetch('http://127.0.0.1:5178/api/analysis', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:59272',
      'Access-Control-Request-Method': 'POST',
    },
  });
  assert.strictEqual(pre.status, 204);
});

test('预检回显来源并允许 POST', async () => {
  const pre = await fetch('http://127.0.0.1:5178/api/analysis', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:59272',
      'Access-Control-Request-Method': 'POST',
    },
  });
  assert.strictEqual(pre.headers.get('access-control-allow-origin'), 'http://127.0.0.1:59272');
  assert.ok((pre.headers.get('access-control-allow-methods') || '').includes('POST'));
});

test('跨端口 POST 能拿到 JSON 响应', async () => {
  const res = await fetch('http://127.0.0.1:5178/api/analysis', {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:59272', 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_text: '短', jd_text: 'x' }),
  });
  const data = await res.json();
  assert.strictEqual(data.error, 'raw_text_too_short', '应返回业务错误 JSON');
});

await runAll();
fs.unlinkSync(tmpMod);
console.log(`\n═══ 通过 ${pass} · 失败 ${fail} ═══`);
process.exit(fail ? 1 : 0);
