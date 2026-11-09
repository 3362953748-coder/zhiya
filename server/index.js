/**
 * 知涯 ZHIYA MVP 后端
 * POST /api/analysis      四步串行分析（单接口）
 * POST /api/analysis/replan  仅重排计划
 */
import express from 'express';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initCloud, retryState } from './cloud.js';
import { normalizeTextInput, normalizeWeeklyHours } from './sanitize.js';
import {
  runPipeline, runDirections, deriveScope, diffResults, STEPS,
} from './pipeline.js';

const app = express();
app.use(express.json({ limit: '256kb' }));

/* ---------- 统一 JSON 错误处理 ----------
 * Express 默认会把 body 解析错误渲染成 HTML 错误页，
 * 前端拿到后无法 JSON.parse，只能显示一句「解析失败」。
 * 这里接管所有错误，一律返回结构化 JSON。
 */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const isBodyError = err?.type === 'entity.parse.failed' || err instanceof SyntaxError;
  const isTooLarge = err?.type === 'entity.too.large';
  const status = isTooLarge ? 413 : 400;
  const code = isTooLarge ? 'payload_too_large' : isBodyError ? 'invalid_json' : 'request_error';
  const message = isTooLarge
    ? '内容太长了，精简一下再试。'
    : isBodyError
      ? '请求格式不对，请检查后重试。'
      : '请求处理失败，请重试。';
  res.status(status).json({ error: code, message, detail: String(err?.message || err) });
});

/* ---------- CORS：允许从任意本地端口访问（开发期预览面板会换端口） ---------- */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------- 配置 ---------- */
const ENDPOINT = process.env.WB_CLOUD_ENDPOINT;
const PUBLISHABLE_KEY = process.env.WB_CLOUD_PUBLISHABLE_KEY;

if (!ENDPOINT || !PUBLISHABLE_KEY) {
  console.error('[配置缺失] 请设置环境变量：');
  console.error('  WB_CLOUD_ENDPOINT');
  console.error('  WB_CLOUD_PUBLISHABLE_KEY');
  process.exit(1);
}
initCloud({ endpoint: ENDPOINT, publishableKey: PUBLISHABLE_KEY });

/* ---------- 演示模式快照 ----------
 * 面试现场断网 / 模型超时时的兜底：直接返回预置快照（真实模型产出，非手写）。
 * 必须在路由注册之前加载完成。
 */
let demoSnapshot = null;
try {
  const raw = readFileSync(new URL('../demo/snapshot.json', import.meta.url), 'utf-8');
  demoSnapshot = JSON.parse(raw);
  console.log(`[演示模式] 快照已就绪（${demoSnapshot.result.gap_report.items.length} 项能力）`);
} catch (_) {
  console.warn('[演示模式] 未找到 demo/snapshot.json，演示兜底不可用');
}

function demoPayload() {
  return {
    ...demoSnapshot.result,
    meta: {
      action: 'demo',
      scope: ['profile', 'jd_profile', 'gap_report', 'action_plan'],
      elapsed_ms: 0,
      model: demoSnapshot.model,
      is_demo: true,
    },
  };
}

/* ---------- 结果存储（内存，MVP 够用） ---------- */
const store = new Map();
const MAX_STORE = 200;

function saveResult(state) {
  const id = crypto.randomUUID();
  store.set(id, state);
  if (store.size > MAX_STORE) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
  return id;
}

/* ---------- 工具 ---------- */
function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') out[k] = obj[k];
  }
  return out;
}

function publicState(state) {
  return {
    profile: state.profile || null,
    jd_profile: state.jd_profile || null,
    directions: state.directions || [],
    gap_report: state.gap_report || null,
    action_plan: state.action_plan || null,
    violations: state.violations || [],
  };
}

/* ---------- 主接口 ---------- */
app.post('/api/analysis', async (req, res) => {
  const started = Date.now();
  retryState.reset();
  try {
    const body = req.body || {};

    // 演示模式：跳过模型调用，直接返回预置快照（面试兜底）
    if (body.demo === true) {
      if (!demoSnapshot) {
        return res.status(503).json({
          error: 'demo_not_available',
          message: '演示快照未就绪，请先运行 node demo/snapshot.js',
        });
      }
      return res.json(demoPayload());
    }

    // 边界校验：对应 PRD 的按钮置灰规则
    // 用 normalizeTextInput 做类型校验 + 内容清洗：
    //   - 非字符串（对象/数组）直接拒绝，不能靠 String() 硬转绕过长度检查
    //   - 剥离 HTML/JS 标记，避免云端 WAF 拦截导致整次分析 500
    const rawResult = normalizeTextInput(body.raw_text, { field: 'raw_text', minLen: 10 });
    if (!rawResult.ok) {
      return res.status(400).json({ error: rawResult.error, message: rawResult.message });
    }
    const rawText = rawResult.value;

    const targetRole = typeof body.target_role === 'string' ? body.target_role.trim() : '';

    let jdText = '';
    if (body.jd_text !== undefined && body.jd_text !== null && body.jd_text !== '') {
      const jdResult = normalizeTextInput(body.jd_text, { field: 'jd_text', minLen: 20 });
      if (!jdResult.ok) {
        return res.status(400).json({ error: jdResult.error, message: jdResult.message });
      }
      jdText = jdResult.value;
    }
    if (!jdText && !targetRole) {
      return res.status(400).json({
        error: 'target_role_missing',
        message: '把目标岗位的 JD 贴进来，知涯才知道企业要什么。',
      });
    }

    const action = String(body.action || 'analyze');
    const state = {
      raw_text: rawText,
      followups: Array.isArray(body.followups) ? body.followups.slice(0, 2) : [],
      jd_text: jdText,
      target_role: targetRole,
      weekly_hours: normalizeWeeklyHours(body.weekly_hours, 10),
      model: body.model || undefined,
    };

    // 单条重算：只重算某条差距
    if (action === 'recheck' && body.recheck_item) {
      state.recheck_item = String(body.recheck_item);
    }

    let scope;
    if (action === 'recheck' || action === 'replan') {
      scope = action === 'recheck' ? [STEPS.GAP] : [STEPS.PLAN];
    } else {
      scope = [STEPS.PROFILE, STEPS.JD, STEPS.GAP, STEPS.PLAN];
    }

    await runPipeline(state, { scope });

    // 方向候选（依赖 profile + jd）
    if (state.profile && state.jd_profile) {
      state.directions = await runDirections(state, state.model);
    }

    const resultId = saveResult(state);

    res.json({
      result_id: resultId,
      ...publicState(state),
      meta: {
        action,
        scope,
        elapsed_ms: Date.now() - started,
        model: state.model || 'auto',
        retries: retryState.attempts,
      },
    });
  } catch (err) {
    console.error('[analysis 失败]', err?.message);
    const isTimeout = err?.code === 'model_timeout';
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? 'model_timeout' : 'analysis_failed',
      message: isTimeout
        ? '解析超时了，再试一次。你的输入已经保留。'
        : '解析失败，请重试。你的输入已经保留。',
      detail: String(err?.message || err),
    });
  }
});

/* ---------- F6 重算 ---------- */
app.post('/api/analysis/regenerate', async (req, res) => {
  const started = Date.now();
  try {
    const body = req.body || {};
    const baseResultId = String(body.base_result_id || '');
    const base = store.get(baseResultId);
    if (!base) {
      return res.status(404).json({
        error: 'base_result_not_found',
        message: '找不到上一次的结果，请重新提交。',
      });
    }

    const changedFields = Array.isArray(body.changed_fields)
      ? body.changed_fields.map(String)
      : [];

    // 未变更字段沿用旧值
    const next = { ...base };
    if (body.raw_text !== undefined) {
      const r = normalizeTextInput(body.raw_text, { field: 'raw_text', minLen: 10 });
      next.raw_text = r.ok ? r.value : String(body.raw_text);
    }
    if (body.followups !== undefined) next.followups = body.followups;
    if (body.jd_text !== undefined) {
      const r = normalizeTextInput(body.jd_text, { field: 'jd_text', minLen: 20 });
      next.jd_text = r.ok ? r.value : String(body.jd_text);
    }
    if (body.target_role !== undefined) next.target_role = String(body.target_role);
    if (body.weekly_hours !== undefined) {
      next.weekly_hours = normalizeWeeklyHours(body.weekly_hours, 10);
    }
    if (body.selected_items !== undefined) next.selected_items = body.selected_items;
    if (body.excluded_items !== undefined) next.excluded_items = body.excluded_items;

    const before = {
      gap_report: next.gap_report,
      action_plan: next.action_plan,
    };

    // 依赖图决定重跑范围（R-14）
    const scope = deriveScope(changedFields);
    const finalScope = scope.length ? scope : [STEPS.GAP, STEPS.PLAN];

    let fallbackAvailable = true;
    try {
      await runPipeline(next, { scope: finalScope, regen: true });
      if (next.profile && next.jd_profile) {
        next.directions = await runDirections(next, next.model);
      }
    } catch (err) {
      console.error('[regenerate 失败]', err?.message);
      // 保留旧结果，标记可回退
      return res.status(200).json({
        result_id: baseResultId,
        fallback_available: true,
        error: 'regenerate_failed',
        message: '重新生成失败，可继续使用原结果。',
        recomputed_scope: [],
        diff: { items: [], changed_count: 0 },
        ...publicState(base),
        meta: { elapsed_ms: Date.now() - started },
      });
    }

    const diff = diffResults(before, next);
    const resultId = saveResult(next);

    res.json({
      result_id: resultId,
      recomputed_scope: finalScope,
      diff,
      fallback_available: false,
      ...publicState(next),
      meta: { elapsed_ms: Date.now() - started, model: next.model || 'auto' },
    });
  } catch (err) {
    console.error('[regenerate 异常]', err?.message);
    res.status(500).json({
      error: 'regenerate_failed',
      message: '重新生成失败，可继续使用原结果。',
      detail: String(err?.message || err),
    });
  }
});

/* ---------- 辅助接口 ---------- */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, store_size: store.size, model: process.env.ZHIYA_MODEL || 'deepseek-v4.1-flash' });
});

app.get('/api/result/:id', (req, res) => {
  const s = store.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json({ result_id: req.params.id, ...publicState(s) });
});

/* ---------- 演示模式接口 ----------
 * 用法：POST /api/analysis  body 带 demo: true，或 GET /api/demo
 */
app.get('/api/demo', (req, res) => {
  if (!demoSnapshot) return res.status(404).json({ error: 'demo_not_available' });
  res.json(demoPayload());
});

// 静态资源：开发期禁缓存，避免改了前端还在跑旧代码
app.use(express.static('public', {
  etag: false,
  lastModified: false,
  cacheControl: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  },
}));

const PORT = Number(process.env.PORT) || 5178;
app.listen(PORT, () => {
  console.log(`知涯 MVP 后端已启动： http://127.0.0.1:${PORT}`);
  console.log(`模型：${process.env.ZHIYA_MODEL || 'deepseek-v4.1-flash'}`);
});
