/**
 * 模型重试逻辑单元测试
 */
import { isRetryableError } from '../server/cloud.js';

let pass = 0, fail = 0;
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '\n     ' + detail : ''}`); }
}

console.log('\n═══ 重试判定单元测试 ═══\n');

/* ---------- 可重试：外部瞬时故障 ---------- */
console.log('── 可重试 ──');
const retryable = [
  ['Network error: fetch failed', '网络错误'],
  ['fetch failed', 'fetch 失败'],
  ['ECONNRESET', '连接重置'],
  ['ETIMEDOUT', '连接超时'],
  ['socket hang up', '套接字挂断'],
  ['模型调用超时', '超时'],
  ['502 Bad Gateway', '网关错误'],
  ['503 Service Unavailable', '服务不可用'],
  ['504 Gateway Timeout', '网关超时'],
  ['429 Too Many Requests', '限流'],
  ['rate limit exceeded', '速率限制'],
  ['模型返回为空', '模型空输出'],
  ['模型输出无法解析为 JSON', 'JSON 解析失败'],
];
for (const [msg, label] of retryable) {
  t(`${label} 可重试`, isRetryableError(new Error(msg)) === true, msg);
}

const timeoutErr = new Error('模型调用超时');
timeoutErr.code = 'model_timeout';
t('model_timeout 可重试', isRetryableError(timeoutErr) === true);

const netErr = new Error('boom');
netErr.status = 503;
t('5xx 状态码可重试', isRetryableError(netErr) === true);

/* ---------- 不可重试：客户端错误 ---------- */
console.log('\n── 不可重试 ──');
const notRetryable = [
  ['request_invalid_parameter', '参数错误'],
  ['invalid_api_key', '鉴权失败'],
  ['model_not_found', '模型不存在'],
  ['401 Unauthorized', '未授权'],
  ['400 Bad Request', '请求错误'],
  ['403 Forbidden', '禁止访问'],
];
for (const [msg, label] of notRetryable) {
  t(`${label} 不可重试`, isRetryableError(new Error(msg)) === false, msg);
}

const paramErr = new Error('bad');
paramErr.status = 400;
t('400 状态码不可重试', isRetryableError(paramErr) === false);

const sdkErr = new Error('x');
sdkErr.error = { code: 'request_invalid_parameter' };
t('SDK 参数错误不可重试', isRetryableError(sdkErr) === false);

/* ---------- 边界 ---------- */
console.log('\n── 边界 ──');
t('null 不可重试', isRetryableError(null) === false);
t('undefined 不可重试', isRetryableError(undefined) === false);
t('未知错误不重试（保守策略）', isRetryableError(new Error('某个奇怪的错误')) === false);

console.log(`\n═══ 通过 ${pass} · 失败 ${fail} ═══`);
process.exit(fail ? 1 : 0);
