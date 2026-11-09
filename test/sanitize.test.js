/**
 * 输入清洗模块单元测试
 * 不调模型，秒级完成
 */
import { normalizeTextInput, normalizeWeeklyHours, stripDangerousMarkup } from '../server/sanitize.js';

let pass = 0, fail = 0;
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '\n     ' + detail : ''}`); }
}

console.log('\n═══ 输入清洗单元测试 ═══\n');

/* ---------- weekly_hours ---------- */
console.log('── weekly_hours 归一化 ──');
const whCases = [
  [undefined, 10, '未传 → 默认 10'],
  [0, 10, '0 → 默认 10'],
  [-5, 10, '负数 → 默认 10（不是 2！）'],
  [-0.5, 10, '小数负数 → 默认 10'],
  [null, 10, 'null → 默认 10'],
  [NaN, 10, 'NaN → 默认 10'],
  ['', 10, '空串 → 默认 10'],
  [1, 2, '1 → 钳到下限 2'],
  [2, 2, '2 → 原样'],
  [10, 10, '10 → 原样'],
  [60, 60, '60 → 原样'],
  [61, 60, '61 → 钳到上限 60'],
  [999, 60, '999 → 钳到 60'],
  ['15', 15, '字符串 "15" → 15'],
  ['8.4', 8, '小数 8.4 → 四舍五入 8'],
];
for (const [input, expect, label] of whCases) {
  const got = normalizeWeeklyHours(input);
  t(label, got === expect, `输入 ${JSON.stringify(input)} → 实际 ${got}，期望 ${expect}`);
}

/* ---------- 类型校验 ---------- */
console.log('\n── 类型校验 ──');
const bad = [
  [{ a: 1 }, 'raw_text_invalid_type', '对象'],
  [['abc'], 'raw_text_invalid_type', '数组'],
  [12345, 'raw_text_invalid_type', '数字'],
  [true, 'raw_text_invalid_type', '布尔'],
];
for (const [input, code, label] of bad) {
  const r = normalizeTextInput(input, { field: 'raw_text', minLen: 10 });
  t(`${label}被拒绝`, r.ok === false && r.error === code, `实际 ${JSON.stringify(r).slice(0, 90)}`);
}
t('对象不会被 String() 硬转成 [object Object]',
  normalizeTextInput({ a: 1 }, { field: 'raw_text', minLen: 10 }).ok === false);
t('null 被拒绝', normalizeTextInput(null, { field: 'raw_text', minLen: 10 }).ok === false);
t('undefined 被拒绝', normalizeTextInput(undefined, { field: 'raw_text', minLen: 10 }).ok === false);

/* ---------- 长度校验 ---------- */
console.log('\n── 长度校验 ──');
t('过短被拒绝', normalizeTextInput('短', { field: 'raw_text', minLen: 10 }).ok === false);
t('恰好 10 字通过', normalizeTextInput('一二三四五六七八九十', { field: 'raw_text', minLen: 10 }).ok === true);
t('9 字被拒绝', normalizeTextInput('一二三四五六七八九', { field: 'raw_text', minLen: 10 }).ok === false);

/* ---------- 危险标记清洗 ---------- */
console.log('\n── 危险标记清洗 ──');
const danger = [
  ['<script>alert(1)</script>', 'script 块'],
  ['<script src="evil.js"></script>', '带 src 的 script'],
  ['<style>body{display:none}</style>', 'style 块'],
  ['<iframe src="x"></iframe>', 'iframe'],
  ['<img src=x onerror=alert(1)>', '事件处理器'],
  ['<!-- 注释 -->', 'HTML 注释'],
  ['javascript:alert(1)', 'javascript 协议'],
  ['<div class="x">内容</div>', '普通标签'],
];
for (const [input, label] of danger) {
  const { text, cleaned } = stripDangerousMarkup(input);
  const hasTag = /<\s*\/?\s*(script|style|iframe|div|img|object|embed)\b/i.test(text);
  t(`${label}被剥离`, !hasTag, `残留：${text.slice(0, 60)}`);
}
t('script 标签名不残留', !/script/i.test(stripDangerousMarkup('<script>x</script>').text));
t('onerror 事件不残留', !/onerror/i.test(stripDangerousMarkup('<img onerror=alert(1)>').text));
t('javascript: 不残留', !/javascript:/i.test(stripDangerousMarkup('javascript:alert(1)').text));
t('正常文本不被破坏',
  stripDangerousMarkup('我是计算机专业大三学生，做过后端项目').text === '我是计算机专业大三学生，做过后端项目');
t('清洗标记 cleaned=true',
  stripDangerousMarkup('<script>x</script>').cleaned === true);
t('无危险内容 cleaned=false',
  stripDangerousMarkup('普通的一段经历描述').cleaned === false);

/* ---------- 清洗后仍要满足最小长度 ---------- */
console.log('\n── 清洗后长度 ──');
const mostlyTag = normalizeTextInput('<script>alert(1)</script><script>alert(2)</script>', { field: 'raw_text', minLen: 10 });
t('清洗后内容不足最小长度 → 拒绝', mostlyTag.ok === false, `实际 ${JSON.stringify(mostlyTag).slice(0, 90)}`);

/* ---------- 超长截断 ---------- */
console.log('\n── 超长输入 ──');
const long = normalizeTextInput('x'.repeat(10000), { field: 'raw_text', minLen: 10, maxLen: 8000 });
t('超长输入被截断到上限', long.ok === true && long.value.length === 8000, `实际 ${long.value?.length}`);

console.log(`\n═══ 通过 ${pass} · 失败 ${fail} ═══`);
process.exit(fail ? 1 : 0);
