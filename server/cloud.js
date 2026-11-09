/**
 * 云服务 LLM 客户端封装
 * 统一处理：SSE 累积、JSON 清洗、Schema 校验、超时、错误分类。
 */
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk';

let cloud = null;

export function initCloud({ endpoint, publishableKey }) {
  if (!endpoint || !publishableKey) {
    throw new Error('缺少云服务配置：endpoint / publishableKey');
  }
  cloud = createWorkBuddyCloud({ endpoint, publishableKey });
  return cloud;
}

export function getCloud() {
  if (!cloud) throw new Error('云服务尚未初始化');
  return cloud;
}

/** 去掉模型可能裹上的 markdown 代码块围栏 */
export function cleanJsonText(text) {
  if (!text) return '';
  let t = text.trim();
  const fence = t.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  // 处理 "前缀文字 + {json} + 后缀" 的情况
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first > 0 || (first === 0 && last < t.length - 1)) {
    if (first !== -1 && last > first) t = t.slice(first, last + 1);
  }
  return t;
}

/** 从模型输出中提取首个可解析的 JSON 对象 */
export function parseLooseJson(text) {
  const cleaned = cleanJsonText(text);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // 退一步：在所有可能的 JSON 片段中尝试
    const candidates = [];
    const re = /\{[\s\S]*?\}/g;
    let m;
    while ((m = re.exec(cleaned))) candidates.push(m[0]);
    for (let i = candidates.length - 1; i >= 0; i--) {
      try { return JSON.parse(candidates[i]); } catch (_) { /* 继续尝试下一个 */ }
    }
    throw new Error('模型输出无法解析为 JSON');
  }
}

/**
 * 调用大模型并收集完整文本。
 * @param {object} opts
 * @param {string} opts.model
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.jsonMode]
 * @param {AbortSignal} [opts.signal]
 */
export async function callModel({
  model,
  messages,
  timeoutMs = 60000,
  jsonMode = false,
  temperature = 0.3,
  signal,
}) {
  const c = getCloud();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onOuterAbort);

  let content = '';
  let reasoning = '';
  try {
    const stream = await c.llm.chat.completions.create({
      model,
      messages,
      stream: true,
      temperature,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      signal: controller.signal,
    });
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta;
      if (delta?.content) content += delta.content;
      if (delta?.reasoning_content) reasoning += delta.reasoning_content;
    }
  } catch (err) {
    if (controller.signal.aborted) {
      const e = new Error('模型调用超时');
      e.code = 'model_timeout';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
  return { content, reasoning };
}

/**
 * 全局重试状态（供上层读取并告知用户）
 *
 * 背景：重试会让整体耗时变长（最坏情况接近 3 倍）。
 * 用户看到「正在分析」会以为卡死了 —— 实际上是在重试。
 * 把状态透出去，前端就能显示「网络不稳，正在重试…」。
 */
export const retryState = {
  attempts: 0,        // 本次请求内的重试次数
  lastError: '',      // 最近一次失败原因
  get active() { return this.attempts > 0; },
  reset() { this.attempts = 0; this.lastError = ''; },
  note(err) {
    this.attempts++;
    this.lastError = String(err?.message || err);
  },
};

/**
 * 调用模型并要求返回 JSON 对象
 *
 * 注意：部分思考型模型（如 auto 路由到的模型）会把 JSON 生成在 reasoning 阶段，
 * content 为空。这里做兜底：content 为空时从 reasoning 尾部提取 JSON。
 */
export async function callModelForJson(opts) {
  // 重试包在整个「调用 + 解析」之外 ——
  // 「模型返回为空」「无法解析为 JSON」这类输出异常也值得重试一次。
  let lastErr = null;
  const maxRetries = opts.maxRetries ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { content, reasoning } = await callModel({ ...opts, jsonMode: true });
      const primary = content?.trim();
      if (primary) {
        try {
          return parseLooseJson(primary);
        } catch (e) {
          // 落到 reasoning 兜底
          if (!reasoning) throw e;
        }
      }
      if (reasoning) {
        // reasoning 里 JSON 往往在末尾，从后往前找最后一个完整对象
        const tail = reasoning.slice(-6000);
        try {
          return parseLooseJson(tail);
        } catch (e) {
          throw new Error('模型输出无法解析为 JSON');
        }
      }
      throw new Error('模型返回为空');
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries || !isRetryableError(err)) throw err;
      retryState.note(err);
      const delay = 800 * Math.pow(2, attempt);
      console.warn(`[模型重试] 第 ${attempt + 1} 次失败（${err.message}），${delay}ms 后重试`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/* ---------- 重试：网络抖动不该让整次分析崩掉 ---------- */

/**
 * 判断这个错误值不值得重试。
 *
 * 可重试：网络中断、连接重置、超时、5xx、模型输出异常 —— 都是外部瞬时故障。
 * 不可重试：参数错误、鉴权失败、模型不存在 —— 重试只会浪费时间。
 */
export function isRetryableError(err) {
  if (!err) return false;
  if (err.code === 'model_timeout') return true;

  const msg = String(err.message || err).toLowerCase();
  // 模型输出异常也值得重试 —— 偶发的空输出/格式错，重试一次通常就好
  if (msg.includes('模型返回为空') || msg.includes('无法解析为 json')) return true;

  const retryablePatterns = [
    'network error',
    'fetch failed',
    'econnreset',
    'econnrefused',
    'etimedout',
    'socket hang up',
    'aborted',
    'timeout',
    'network',
    '502',
    '503',
    '504',
    '429',
    'rate limit',
    'too many requests',
    // 中文错误文案
    '超时',
    '网络',
    '连接失败',
    '限流',
    '稍后重试',
  ];
  if (retryablePatterns.some((p) => msg.includes(p))) return true;

  // 明确的客户端错误不重试
  const status = err.error?.code || err.status || err.statusCode;
  if (typeof status === 'number') {
    if (status >= 400 && status < 500 && status !== 429) return false;
    if (status >= 500) return true;
  }
  return false;
}

/**
 * 带指数退避的模型调用（供直接调用 callModel 的场景使用）
 */
export async function callModelWithRetry(opts, { maxRetries = 2, baseDelayMs = 800 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callModel(opts);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries || !isRetryableError(err)) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `[模型重试] 第 ${attempt + 1} 次失败（${err.message}），${delay}ms 后重试`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
