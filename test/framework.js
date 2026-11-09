/**
 * 测试断言框架
 *
 * 七类测试共用。设计要点：
 * 1. 断言必须可判定 —— 不能写「结果合理」这种无法自动判定的条件
 * 2. 失败要给出可诊断的 detail，不能只说 false
 * 3. 分组清晰，便于最后汇总成报告
 */

/** 创建一个测试分组 */
export function group(title) {
  console.log(`\n── ${title} ──`);
  return new Group(title);
}

class Group {
  constructor(title) {
    this.title = title;
    this.cases = [];
  }

  /**
   * 记录一条断言
   * @param {string} name 判定条件
   * @param {boolean} ok 是否通过
   * @param {string} detail 失败时的诊断信息
   */
  check(name, ok, detail = '') {
    this.cases.push({ name, ok: !!ok, detail: ok ? '' : String(detail) });
    if (ok) {
      console.log(`  ✅ ${name}`);
    } else {
      console.log(`  ❌ ${name}`);
      if (detail) console.log(`     ${String(detail).split('\n').join('\n     ')}`);
    }
    return !!ok;
  }

  get passed() { return this.cases.filter((c) => c.ok).length; }
  get failed() { return this.cases.filter((c) => !c.ok).length; }
  get total() { return this.cases.length; }
}

/** 汇总并输出报告，返回退出码 */
export function report(groups, meta = {}) {
  const all = groups.flatMap((g) => g.cases.map((c) => ({ ...c, group: g.title })));
  const pass = all.filter((c) => c.ok).length;
  const fail = all.length - pass;

  console.log('\n' + '═'.repeat(64));
  console.log('  知涯 ZHIYA · 产品测试报告');
  console.log('═'.repeat(64));
  if (meta.model) console.log(`  模型：${meta.model}`);
  if (meta.elapsed) console.log(`  耗时：${meta.elapsed}`);
  console.log('─'.repeat(64));
  for (const g of groups) {
    const mark = g.failed === 0 ? '✓' : '✗';
    console.log(`  ${mark} ${g.title.padEnd(28, '　')} ${g.passed}/${g.total}`);
  }
  console.log('─'.repeat(64));
  console.log(`  合计：${pass} 通过 · ${fail} 失败 · 共 ${all.length} 项`);
  console.log('═'.repeat(64));

  if (fail > 0) {
    console.log('\n失败明细：');
    for (const c of all.filter((x) => !x.ok)) {
      console.log(`  ✗ [${c.group}] ${c.name}`);
      if (c.detail) console.log(`      ${c.detail.split('\n').join('\n      ')}`);
    }
  }

  return { pass, fail, total: all.length, groups, cases: all };
}

/**
 * POST /api/analysis，返回 { status, data, ms, error }
 *
 * status = 0 表示请求根本没发出去（网络不可达 / 服务未启动）。
 * 这一类情况必须以返回值表达，不能抛异常 ——
 * 异常测试要验证的正是「后端挂掉时系统怎么表现」，
 * 如果测试框架自己先崩了，就测不到真实行为了。
 */
export async function analyze(body, base = 'http://127.0.0.1:5178') {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body === undefined ? {} : body),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { _raw: text }; }
    return { status: res.status, data, ms: Date.now() - t0, error: null };
  } catch (err) {
    return {
      status: 0,
      data: null,
      ms: Date.now() - t0,
      error: String(err?.message || err),
    };
  }
}

/**
 * 分析结果缓存
 *
 * 同一份输入的完整分析要跑四步模型（约 30 秒）。
 * 多个测试类别都基于案例 A/B/C/F，重复调用纯属浪费。
 * 这里按「输入指纹」缓存，同一进程内只跑一次。
 *
 * 用法：await cachedAnalyze('A', { raw_text, jd_text, weekly_hours })
 */
const _cache = new Map();

export async function cachedAnalyze(key, body, base = 'http://127.0.0.1:5178') {
  const fp = `${key}|${JSON.stringify(body)}`;
  if (_cache.has(fp)) return _cache.get(fp);
  const p = analyze(body, base);
  _cache.set(fp, p);
  try {
    return await p;
  } catch (e) {
    _cache.delete(fp);
    throw e;
  }
}

export function clearAnalysisCache() {
  _cache.clear();
}

/** 读取用户原文里的所有中文/英文词，用于回指校验 */
export function words(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#.]+/u)
    .filter((w) => w.length >= 2);
}

/** 判断一段证据是否能在原文中找到回指 */
export function traceable(evidence, source) {
  const e = String(evidence || '').trim();
  if (!e) return false;
  const src = String(source || '').toLowerCase();
  const low = e.toLowerCase();
  if (src.includes(low)) return true;
  // 分段匹配：证据里的连续中文片段
  const chunks = e.split(/[，,。；;、（）()「」“”\s]+/).filter((c) => c.length >= 3);
  if (!chunks.length) return false;
  const hit = chunks.filter((c) => src.includes(c.toLowerCase()));
  return hit.length / chunks.length >= 0.6;
}
