/**
 * 框架自检：验证断言框架本身能正确判对 / 判错
 *
 * 目的：跑正式测试前先确认「红是红、绿是绿」。
 * 如果框架本身有 bug，后面的失败项就无法归因。
 */
import { group, report, analyze, traceable } from './framework.js';

let pass = 0, fail = 0;
const rawLog = console.log;
function t(name, fn) {
  try { fn(); pass++; rawLog(`  ✅ ${name}`); }
  catch (e) { fail++; rawLog(`  ❌ ${name}\n     ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }

console.log('\n═══ 框架自检 ═══\n');

/* ---------- 1. group / check 的判定逻辑 ---------- */
console.log = rawLog;
const g = group('自检组');
g.check('true 应判通过', true);
g.check('第二条应判通过', true);
g.check('第三条应判通过', true);

const g2 = group('自检组 2');
g2.check('这个断言应当失败（用于验证失败计数）', false, '故意失败');
g2.check('这条应通过', true);
g2.check('这条也应通过', true);

// 计数断言放在所有 check 之后，且不计入 group 自身
t('自检组总数为 3', () => { assert(g.total === 3, `实际 ${g.total}`); });
t('自检组通过数为 3', () => { assert(g.passed === 3, `实际 ${g.passed}`); });
t('自检组失败数为 0', () => { assert(g.failed === 0, `实际 ${g.failed}`); });
t('自检组2 总数为 3', () => { assert(g2.total === 3, `实际 ${g2.total}`); });
t('自检组2 失败数为 1', () => { assert(g2.failed === 1, `实际 ${g2.failed}`); });
t('自检组2 通过数为 2', () => { assert(g2.passed === 2, `实际 ${g2.passed}`); });
t('失败项记录了 detail', () => { assert(g2.cases[0].detail === '故意失败', `实际 "${g2.cases[0].detail}"`); });
t('失败项 ok 为 false', () => { assert(g2.cases[0].ok === false); });

/* ---------- 2. report 的汇总正确性 ---------- */
const r = report([g, g2]);
t('report 汇总总数正确', () => { assert(r.total === 6, `实际 ${r.total}`); });
t('report 汇总通过数正确', () => { assert(r.pass === 5, `实际 ${r.pass}`); });
t('report 汇总失败数正确', () => { assert(r.fail === 1, `实际 ${r.fail}`); });
t('report 保留分组结构', () => { assert(r.groups.length === 2 && r.groups[0].title === '自检组'); });

/* ---------- 3. traceable 回指判定 ---------- */
const SRC = '我是计算机专业大三学生，做过校园二手交易平台的课程项目，负责后端接口和数据库设计，用 Java 写的。';
t('完全包含的证据判为可追溯', () => { assert(traceable('校园二手交易平台的课程项目', SRC)); });
t('完全包含的短证据判为可追溯', () => { assert(traceable('数据库设计', SRC)); });
t('原文没有的内容判为不可追溯', () => { assert(!traceable('字节跳动实习', SRC)); });
t('英文证据可追溯', () => { assert(traceable('Java', SRC)); });
t('空证据不可追溯', () => { assert(!traceable('', SRC)); });
t('空原文时证据不可追溯', () => { assert(!traceable('Java', '')); });
t('部分匹配（多数片段命中）判为可追溯', () => {
  assert(traceable('校园二手交易平台，负责后端接口', SRC));
});

/* ---------- 4. analyze 的返回值结构 ---------- */
const dead = await analyze({ raw_text: 'x' }, 'http://127.0.0.1:59999');
t('后端不可达时 status 为 0', () => { assert(dead.status === 0, `实际 ${dead.status}`); });
t('后端不可达时不抛异常', () => { assert(dead.data === null || typeof dead.data === 'object'); });

/* ---------- 5. 真实后端可达 ---------- */
const health = await fetch('http://127.0.0.1:5178/api/health');
const hj = await health.json();
t('健康接口返回 ok:true', () => { assert(hj.ok === true, JSON.stringify(hj)); });
t('健康接口返回模型名', () => { assert(typeof hj.model === 'string' && hj.model.length > 0, JSON.stringify(hj)); });

console.log = rawLog;
rawLog(`\n═══ 通过 ${pass} · 失败 ${fail} ═══`);
process.exit(fail ? 1 : 0);
