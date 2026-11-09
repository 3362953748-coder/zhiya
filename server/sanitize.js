/**
 * 输入清洗与校验
 *
 * 两道防线：
 *   1. 类型校验 —— 非字符串输入必须拒绝，不能靠 String() 硬转
 *      （String({a:1}) → "[object Object]"，长度 15 > 10，会绕过长度检查）
 *   2. 内容清洗 —— 发给模型前剥离 HTML/JS 标记
 *      （云端 WAF 会拦截 <script>，导致整个分析 500 失败；
 *        用户粘贴的技术经历里完全可能出现这类字符）
 */

/** 判断是否为「像样的文本」——排除对象/数组的字符串化产物 */
export function isPlainText(v) {
  return typeof v === 'string';
}

/**
 * 归一化文本输入：拒绝非法类型，剥离危险标记
 * @returns {{ ok: true, value: string, cleaned: boolean } | { ok: false, error: string, message: string }}
 */
export function normalizeTextInput(raw, { field, minLen, maxLen = 8000 }) {
  if (raw === undefined || raw === null) {
    return { ok: false, error: `${field}_missing`, message: '这一项还没填。' };
  }
  if (!isPlainText(raw)) {
    return {
      ok: false,
      error: `${field}_invalid_type`,
      message: '输入格式不对，请用文字描述。',
    };
  }

  let value = raw.trim();
  if (!value) {
    return { ok: false, error: `${field}_too_short`, message: '再多说一点，我才能帮你分析。' };
  }
  if (value.length < minLen) {
    return {
      ok: false,
      error: `${field}_too_short`,
      message: `再多写一点，至少 ${minLen} 字。`,
    };
  }

  const { text, cleaned } = stripDangerousMarkup(value);
  if (text.length < minLen) {
    return {
      ok: false,
      error: `${field}_too_short`,
      message: '有效内容太少了，再补充一些。',
    };
  }
  if (text.length > maxLen) {
    return { ok: true, value: text.slice(0, maxLen), cleaned };
  }
  return { ok: true, value: text, cleaned };
}

/**
 * 剥离 HTML / JS 标记与控制字符
 *
 * 保留用户文本的语义（标签名会变成可读文字），
 * 但去掉可能触发 WAF 或在渲染时形成注入的结构。
 */
export function stripDangerousMarkup(input) {
  const src = String(input || '');
  let text = src;
  let cleaned = false;

  // 1) 去掉成对的脚本/样式块及其内容
  text = text.replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ');
  if (text !== src) cleaned = true;

  // 2) 去掉自闭合与残余的单边标签
  const before = text;
  text = text.replace(/<\s*\/?\s*[a-zA-Z][a-zA-Z0-9-]*(\s+[^<>]*)?\/?>/g, ' ');
  if (text !== before) cleaned = true;

  // 3) 去掉注释
  const b2 = text;
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  if (text !== b2) cleaned = true;

  // 4) 去掉事件处理器与 javascript: 伪协议
  const b3 = text;
  text = text.replace(/\bon\w+\s*=\s*(["']).*?\1/gi, ' ');
  text = text.replace(/javascript\s*:/gi, '');
  if (text !== b3) cleaned = true;

  // 5) 去掉控制字符（保留换行与制表）
  const b4 = text;
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (text !== b4) cleaned = true;

  // 6) 归一化空白
  text = text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return { text, cleaned: cleaned || text !== src };
}

/**
 * 归一化 weekly_hours
 *
 * 关键：负数要回退到默认 10，而不是被 Math.max(2, ...) 钳到 2。
 * 「每周 2 小时」会生成一份用户根本完不成的计划。
 */
export function normalizeWeeklyHours(v, fallback = 10, min = 2, max = 60) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
