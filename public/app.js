/**
 * 知涯 ZHIYA · MVP 前端逻辑
 * 所有分析结果来自 POST /api/analysis，不再有写死的示例文案。
 */

/* ---------- 后端地址自适应 ----------
 * 页面可能从三种地方打开：
 *   1) 后端同源        http://127.0.0.1:5178/          → 用相对路径即可
 *   2) 静态预览面板    http://127.0.0.1:<其他端口>/     → 相对路径会打到错误的服务器
 *   3) 直接双击 html  file://                          → 相对路径完全不可用
 * 因此这里探测候选后端地址，探测到就用绝对地址，探测不到再退回相对路径并给出明确指引。
 *
 * 注意：每个候选都必须带超时。预览服务器对未知路径可能既不返回 404 也不返回 200
 * （直接挂起），没有超时的话探测会卡在第一个候选上，永远走不到真正可用的地址。
 */
const API_CANDIDATES = [
  '',                                    // 同源优先
  'http://127.0.0.1:5178',
  'http://localhost:5178',
];
let API_BASE = '';
let API_READY = false;

const PROBE_TIMEOUT_MS = 1500;

/** 带超时的 fetch —— 防止候选地址挂起导致探测卡死 */
async function fetchWithTimeout(url, opts = {}, timeoutMs = PROBE_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 探测后端可用性。
 * @returns {string|null} 可用的 base 地址；返回 '' 表示「同源可用」——
 *   空字符串是有效结果，判断成败必须用 `=== null`，不能用 `!base`。
 *   同源是首选场景（从 http://127.0.0.1:5178 打开），这里最容易踩坑。
 */
async function detectApiBase() {
  API_READY = false;
  // file:// 打开时相对路径会解析成 file:///...，浏览器直接拒绝，跳过同源候选
  const proto = (typeof location !== 'undefined' && location.protocol) || 'http:';
  const isFileProtocol = proto === 'file:';
  const candidates = isFileProtocol ? API_CANDIDATES.slice(1) : API_CANDIDATES;
  for (const base of candidates) {
    try {
      const res = await fetchWithTimeout(`${base}/api/health`, { method: 'GET' });
      if (!res.ok) continue;
      // 必须是我们的 health 结构 —— 预览服务器可能返回 200 + HTML 或别的 JSON
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) { continue; }
      if (data && data.ok === true) {
        API_BASE = base;
        API_READY = true;
        return base;
      }
    } catch (_) {
      // 该候选不可用（超时 / 网络错误 / 非 JSON），试下一个
    }
  }
  return null;
}

const apiUrl = (path) => `${API_BASE}${path}`;

/* ---------- 健壮的响应解析 ----------
 * 后端返回 404 时，Express 会给一段纯文本 "Not Found"，
 * 直接 res.json() 会抛 "Unexpected token 'N'"，把技术噪音甩给用户。
 * 这里先读 text 再判断能不能解析成 JSON。
 */
async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }
  if (data === null && text) {
    // 响应不是 JSON —— 多半是打到了错误的服务器（如静态预览面板）
    const snippet = text.trim().slice(0, 60);
    const err = new Error(`服务器返回了非 JSON 内容：${snippet}`);
    err.code = 'non_json_response';
    err.status = res.status;
    throw err;
  }
  return { ok: res.ok, status: res.status, data: data || {} };
}

/** 把异常翻译成人话，并区分场景 */
function explainError(err, fallbackMsg) {
  if (err?.code === 'non_json_response') {
    return {
      title: '连接到了错误的服务器',
      msg: '当前页面不是从知涯后端打开的，知涯找不到 AI 接口。请用后端地址打开页面：',
      hint: 'http://127.0.0.1:5178',
      code: err.status,
    };
  }
  if (err?.name === 'TypeError' && /fetch|network/i.test(err.message || '')) {
    return {
      title: '连不上知涯后端',
      msg: '后端可能没启动。在项目目录执行下面这行命令启动它：',
      hint: 'bash start.sh',
      code: '',
    };
  }
  return { title: '这一步没成功', msg: fallbackMsg, hint: '', code: err?.code || '' };
}

const state = {
  rawText: '',
  followups: [],
  jdText: '',
  weeklyHours: 10,
  result: null,        // 最近一次接口返回
  baseResultId: null,  // F6 重算的基准
  selectedDirection: null,
  excludedTasks: new Set(),
  askShown: false,
  demoMode: false,     // 演示模式：跳过模型调用，用预置快照
  /* 内测采集 */
  participant: '',     // 匿名编号，如 cq-07
  track: '',           // 求职方向：test/dev/pm/backend/other
  fb: {},              // 问卷答案
};

const $ = (id) => document.getElementById(id);

/* ---------- 内测埋点 ----------
 * 只上报匿名编号 + 节点名，不含任何身份信息。
 * 上报失败绝不打扰用户（静默忽略）。
 */
function telemetry(step, meta) {
  if (!state.participant) return;
  try {
    fetch(`${apiUrl('/api/telemetry')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participant: state.participant,
        step,
        track: state.track,
        meta: meta || {},
      }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) { /* 埋点失败不影响主流程 */ }
}

/* ---------- 屏幕切换 ---------- */
const NAMES = {
  s1: '01 首页', s2: '02 背景录入', s3: '03 追问', s4: '04 岗位方向',
  s5: '05 能力差距分析', s6: '06 两周行动计划', s7: '07 确认调整', s8: '08 AI 处理中',
  s9: '09 使用反馈',
};
const dots = $('dots');
Object.keys(NAMES).forEach((k) => {
  const d = document.createElement('div');
  d.className = 'dot';
  d.textContent = String(Object.keys(NAMES).indexOf(k) + 1).padStart(2, '0');
  d.onclick = () => go(k);
  dots.appendChild(d);
});

function go(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
  $(id).classList.add('on');
  document.querySelectorAll('.dot').forEach((d, i) => {
    d.classList.toggle('on', Object.keys(NAMES)[i] === id);
  });
  $('sbName').textContent = '知涯 ZHIYA · ' + NAMES[id];

  // 漏斗埋点：进入该屏即视为到达该节点
  const step = SCREEN_STEP[id];
  if (step) telemetry(step);
}

/* ---------- 漏斗埋点：屏幕进入即算到达 ---------- */
const SCREEN_STEP = {
  s1: 'visit',
  s2: 'input_start',
  s4: 'jd_done',
  s5: 'view_gap',
  s6: 'view_plan',
  s9: 'feedback',
};

/* ---------- 通用事件 ---------- */
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) { go(g.getAttribute('data-go')); return; }
  const t = e.target.closest('[data-toggle]');
  if (t) { $('ask').classList.toggle('on'); }
});

/* ---------- 02 背景录入 ---------- */
const rawTa = $('rawText');
rawTa.addEventListener('input', () => {
  state.rawText = rawTa.value;
  const n = state.rawText.trim().length;
  const ok = n >= 10;
  $('btnParse').classList.toggle('dis', !ok);
  $('btnParse').disabled = !ok;   // 真正的禁用：阻止点击与键盘触发
  $('rawCount').textContent = `${n} 字`;
});

$('btnParse').onclick = () => {
  if (state.rawText.trim().length < 10) return;
  telemetry('input_done');
  startAnalysis();
};

$('jdSample').onclick = () => {
  $('jdText').value = SAMPLE_JD;
  onJdInput();
};

const SAMPLE_JD = `AI 产品经理实习生（校园招聘）
岗位职责：
1. 参与 AI 产品的需求调研、功能设计与迭代；
2. 撰写产品需求文档（PRD），推动研发与测试团队落地；
3. 跟踪数据表现，输出迭代优化方案。
任职要求：
1. 本科及以上在读，计算机、信息管理、心理学等相关专业优先；
2. 具备较强的逻辑思考与结构化表达能力；
3. 熟悉至少一种大模型 API，有调用实践经验者优先；
4. 有产品竞赛、校园活动组织或自媒体运营经验者优先；
5. 熟练使用 Axure/Figma 等原型工具加分。`;

function onJdInput() {
  const v = $('jdText').value;
  state.jdText = v;
  $('jdCount').textContent = `${v.length} 字`;
  const ok = v.trim().length >= 20;
  $('btnToGap').classList.toggle('dis', !ok);
  $('btnToGap').disabled = !ok;
  $('footNote').textContent = ok ? 'JD 已就绪，可以开始解析' : '粘贴 JD 后开始解析';
}
$('jdText').addEventListener('input', onJdInput);

/* ---------- 04 → 触发分析 ---------- */
/* 04 页「继续」：还没分析过就发起分析；已分析过就直接进入 05 差距分析 */
$('btnToGap').onclick = () => {
  telemetry('jd_done');
  if (state.result && state.result.gap_report) {
    go('s5');
    return;
  }
  telemetry('analysis_start');
  startAnalysis();
};
$('btnAnother').onclick = () => { startAnalysis({ keepDirection: false }); };
$('navRegen').onclick = () => { startAnalysis(); };

/* 05 页「继续生成行动计划」：进入 06 页 */
$('btnToPlan').onclick = () => {
  if (!state.result || !state.result.action_plan) {
    showError({
      title: '还没有生成行动计划',
      msg: '请先完成能力差距分析。',
      hint: '',
      code: '',
    });
    return;
  }
  go('s6');
};

/* ---------- 08 加载态 ---------- */
const STEP_LABELS = [
  ['profile', '解析你的经历档案'],
  ['jd_profile', '拆解岗位能力要求'],
  ['gap_report', '逐条对照能力差距'],
  ['action_plan', '生成两周行动计划'],
];

function showLoading(msg, sub) {
  $('s8body').innerHTML = `
    <div class="loading">
      <div class="spin"></div>
      <div class="ltext">${msg}</div>
      <div class="lsub">${sub}</div>
      <div class="steps" id="loadSteps">
        ${STEP_LABELS.map((s, i) => `
          <div class="step" data-step="${s[0]}">
            <span class="dot"></span><span>${s[1]}</span>
          </div>`).join('')}
      </div>
    </div>`;
  $('s8foot').innerHTML = '<div class="fnote">通常需要 20–40 秒，请不要关闭</div>';
  $('back8').onclick = () => go('s2');
  $('nav8r').textContent = '';
  go('s8');
}

function markStep(step, done) {
  const el = document.querySelector(`[data-step="${step}"]`);
  if (!el) return;
  el.classList.toggle('on', !done);
  el.classList.toggle('done', done);
}

/* ---------- 主流程 ---------- */
async function startAnalysis(opts = {}) {
  const raw = state.rawText.trim();
  const jd = state.jdText.trim();

  if (raw.length < 10) {
    go('s2');
    return;
  }
  if (jd.length < 20) {
    go('s4');
    $('footNote').textContent = '先把目标岗位的 JD 贴进来，知涯才知道企业要什么';
    return;
  }

  showLoading('正在对照你的经历和这个岗位…', '四步分析在同一个接口里串行执行，网络不稳时会自动重试');
  markStep('profile', false);

  // 每次请求前确认后端可达（页面可能被从任意端口打开）
  if (!API_READY) {
    const base = await detectApiBase();
    // base 为 '' 表示同源可用，是有效结果；只有 null 才算探测失败
    if (base === null) {
      // 单文件版：内置快照存在时直接用内置结果，不打断用户
      if (typeof BUILTIN_SNAPSHOT !== 'undefined' && BUILTIN_SNAPSHOT) {
        applyResult(BUILTIN_SNAPSHOT, '离线模式 · 后端未连接，当前展示内置的真实分析结果');
        return;
      }
      showError({
        title: '连不上知涯后端',
        msg: '后端没有响应。可以点下方「用预置结果演示」继续展示完整流程。',
        hint: 'bash start.sh',
        code: '',
      });
      return;
    }
  }

  try {
    const res = await fetch(apiUrl('/api/analysis'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw_text: raw,
        followups: state.followups,
        jd_text: jd,
        weekly_hours: state.weeklyHours,
        // 演示模式：直接返回预置快照，跳过模型调用
        demo: state.demoMode ? true : undefined,
        // 内测采集：匿名编号与方向，用于算漏斗与效果指标
        participant: state.participant || undefined,
        track: state.track || undefined,
      }),
    });
    const { ok, data } = await parseResponse(res);

    if (!ok) {
      showError({
        title: '这一步没成功',
        msg: data.message || '解析失败，请重试。',
        hint: '',
        code: data.error || '',
      });
      return;
    }

    applyResult(data);
  } catch (err) {
    showError(explainError(err, '解析失败，请重试。'));
  }
}

/** 演示模式提示条：让观众清楚知道这是预置结果，而不是现场跑的 */
function showDemoBanner() {
  const b = document.getElementById('demoBanner');
  if (b) return;
  const banner = document.createElement('div');
  banner.id = 'demoBanner';
  banner.className = 'demoBanner';
  banner.textContent = '演示模式 · 以下为预置分析结果（真实模型产出，非现场生成）';
  const s4 = document.getElementById('s4');
  const pad = s4.querySelector('.pad');
  if (pad) pad.insertBefore(banner, pad.firstChild);
}

/**
 * 渲染一份分析结果到各页面。
 * 正常路径与离线降级路径共用，保证行为一致。
 */
function applyResult(data, bannerText) {
  state.result = data;
  state.baseResultId = data.result_id || 'builtin';

  renderJd(data.jd_profile);
  renderDirections(data.directions);
  renderGap(data.gap_report, data.jd_profile);
  renderPlan(data.action_plan);

  go('s4');
  const isDemo = data.meta?.is_demo;
  const retries = data.meta?.retries || 0;
  const secs = data.meta?.elapsed_ms ? Math.round(data.meta.elapsed_ms / 1000) : '—';
  $('footNote').textContent = isDemo
    ? '预置结果（真实模型产出）'
    : retries > 0
      ? `已解析 · ${secs} 秒（网络不稳，自动重试 ${retries} 次）`
      : `已解析 · ${secs} 秒`;
  if (bannerText) showDemoBanner(bannerText);
  else if (isDemo) showDemoBanner();

  // 内测：分析完成节点上报（非演示模式才计，演示结果不是用户跑出来的）
  if (!isDemo) telemetry('analysis_done', {
    elapsed_ms: data.meta?.elapsed_ms || 0,
    model: data.meta?.model || 'unknown',
  });

  // 加内测参与者时，结果页底部给一个「去反馈」入口
  if (state.participant) addFeedbackEntry();
}

/**
 * 在结果页（s6 行动计划）加入「去反馈」入口。
 * 内测模式才显示 —— 没有参与者编号的用户不该被问反馈。
 *
 * 入口放在导航栏（固定可见，滚动到底也在那），而不是滚动区末尾：
 * 滚动区内容长时末尾按钮在视口外，真人和自动化都点不到。
 */
function addFeedbackEntry() {
  if ($('navFb')) {
    $('navFb').style.display = '';
    return;
  }
  const nav = $('s6').querySelector('.nav');
  if (!nav) return;

  const link = document.createElement('div');
  link.className = 'nav-r fbNav';
  link.id = 'navFb';
  link.style.marginLeft = '14px';
  link.textContent = '反馈';
  link.onclick = () => go('s9');
  nav.appendChild(link);
}

/**
 * 错误展示：说人话，并给出可执行的下一步
 * @param {object|string} info { title, msg, hint, code } 或纯文案
 */
function showError(info) {
  const e = typeof info === 'string' ? { title: '这一步没成功', msg: info, hint: '', code: '' } : info;
  const isConnIssue = /连接|后端/.test(e.title);

  $('s8body').innerHTML = `
    <div style="margin-top:60px">
      <div class="errbox">
        <div class="et">${esc(e.title)}</div>
        <div class="em">${esc(e.msg)}</div>
        ${e.hint ? `
          <div class="cmdfix">
            <div class="cmdfix-l">${isConnIssue ? '启动命令' : '正确地址'}</div>
            <code>${esc(e.hint)}</code>
          </div>` : ''}
        ${e.code ? `<div class="ecode">${esc(e.code)}</div>` : ''}
        <div class="btn3" id="btnRetry">重新试一次</div>
      </div>
      <div class="honest" style="margin-top:16px">你输入的内容还在，<b>不会丢</b>。</div>
    </div>`;
  $('s8foot').innerHTML = '';
  $('btnRetry').onclick = () => {
    // 重试前重新探测一次后端，覆盖「后端刚启动」的情况
    API_READY = false;
    startAnalysis();
  };
  go('s8');
}

/* ---------- 渲染：JD 能力清单 ---------- */
const CAT_LABEL = {
  duty: '工作职责', must_skill: '必备技能', plus_skill: '加分项', major_req: '专业要求',
};

function renderJd(jd) {
  if (!jd) { $('jdList').innerHTML = ''; $('jdSec').style.display = 'none'; return; }
  const reqs = jd.requirements || [];
  $('jdSec').style.display = '';
  $('jdCount2').textContent = `共 ${reqs.length} 项`;
  $('jdList').innerHTML = reqs.map((r) => `
    <div class="card">
      <div class="hd">
        <span class="ct">${esc(r.item)}</span>
        <span class="tag ${r.importance === 'required' ? 'tu' : 'tk'}">${r.importance === 'required' ? '必备' : '加分'}</span>
      </div>
      <div class="l2">${esc(r.evidence || '')}</div>
      <div class="tags"><span class="tg2 tb1">${CAT_LABEL[r.category] || r.category}</span></div>
    </div>`).join('');
}

/* ---------- 渲染：方向卡 ---------- */
const LEVEL_TAG = { '匹配度较高': 'th', '可尝试': 'tu', '可探索': 'tk' };

function renderDirections(list) {
  const box = $('dirList');
  if (!list || !list.length) {
    box.innerHTML = `<div class="card"><div class="l2">这次没能给出可靠的方向建议，建议在下方补充更具体的经历后重试。</div></div>`;
    $('dirCount').textContent = '0 个';
    return;
  }
  $('dirCount').textContent = `共 ${list.length} 个`;
  box.innerHTML = list.map((d, i) => `
    <div class="card dcard ${i === 0 ? 'sel' : ''}" data-dir="${esc(d.role)}">
      <div class="dt">${esc(d.role)}</div>
      <div class="l1">${esc(d.reason)}</div>
      ${d.uncertainty ? `<div class="l1p" style="margin-top:8px">但你未提及${esc(d.uncertainty.replace(/^你未提及/, ''))}</div>` : ''}
      ${(d.matched_evidence || []).length ? `
        <div class="evid"><span class="ei">依据来源</span>${d.matched_evidence.map(esc).join('<br>')}</div>` : ''}
      <div class="tags">
        <span class="tg2 ${LEVEL_TAG[d.match_level] || 'tk'}">${esc(d.match_level)}</span>
        <span class="tg2 tb1">${(d.matched_evidence || []).length} 条可用证据</span>
      </div>
    </div>`).join('');

  box.querySelectorAll('.dcard').forEach((c) => {
    c.onclick = () => {
      box.querySelectorAll('.dcard').forEach((x) => x.classList.remove('sel'));
      c.classList.add('sel');
      state.selectedDirection = c.getAttribute('data-dir');
    };
  });
  state.selectedDirection = list[0]?.role || null;
}

/* ---------- 渲染：差距报告 ---------- */
const STATUS_LABEL = { have: '已有', improve: '待提升', unknown: '信息不足' };

function renderGap(gap, jd) {
  const box = $('gapList');
  const items = gap?.items || [];
  if (!items.length) {
    box.innerHTML = '<div class="card"><div class="l2">这次没对照出差距项，请重试。</div></div>';
    $('gapCount').textContent = '0 项';
    return;
  }
  const s = gap.summary || {};
  $('gapCount').textContent = `共 ${s.total || items.length} 项`;
  $('gapRole').textContent = jd?.role_name || state.selectedDirection || '—';
  $('gapFamily').textContent = s.have ? `已有 ${s.have}` : s.unknown ? `待补充 ${s.unknown}` : '—';
  $('gapNote').textContent =
    `已对照 ${s.total || items.length} 项 · 已有 ${s.have || 0} · 待提升 ${s.improve || 0} · 待补充 ${s.unknown || 0}`;

  box.innerHTML = items.map((it, i) => {
    const cls = it.status === 'unknown' ? 'unknown' : '';
    const tagCls = it.status === 'have' ? 'th' : it.status === 'improve' ? 'tu' : 'tk';
    return `
    <div class="gapcard ${cls}">
      <div class="hd">
        <span class="gname">${esc(it.requirement)}</span>
        <span class="tag ${tagCls}">${STATUS_LABEL[it.status]}</span>
      </div>
      ${it.evidence ? `<div class="evidence">${esc(it.evidence)}</div>` : ''}
      ${it.basis ? `<div class="basis"><span class="bl">判断依据</span>${esc(it.basis)}</div>` : ''}
      ${it.advice ? `<div class="advice"><span class="al">建议</span>${esc(it.advice)}</div>` : ''}
      ${it.prompt ? `<div class="promptrow"><div class="plabel">补充指引</div><div class="ptext">${esc(it.prompt)}</div></div>` : ''}
      ${it.status === 'unknown' ? `<button class="addlink" data-supplement="${i}">点击补充这段经历 ›</button>` : ''}
    </div>`;
  }).join('');

  box.querySelectorAll('[data-supplement]').forEach((b) => {
    b.onclick = () => {
      const idx = Number(b.getAttribute('data-supplement'));
      const it = items[idx];
      state.followups = state.followups.filter((f) => f.question !== it.prompt);
      state.followups.push({ question: it.prompt, answer: '' });
      $('rawText').value = state.rawText;
      $('ask').classList.add('on');
      go('s2');
    };
  });
}

/* ---------- 渲染：行动计划 ---------- */
function renderPlan(plan) {
  const box = $('planList');
  const tasks = plan?.tasks || [];
  if (!tasks.length) {
    box.innerHTML = '<div class="card"><div class="l2">这次没生成任务，请重试。</div></div>';
    $('planSummary').textContent = '共 0 个任务';
    return;
  }
  const total = plan.total_hours || tasks.reduce((s, t) => s + (t.estimated_hours || 0), 0);
  $('planSummary').textContent = `共 ${tasks.length} 个任务 · 每周可投入 ${state.weeklyHours} 小时`;

  const w1 = tasks.filter((t) => t.week === 1);
  const w2 = tasks.filter((t) => t.week === 2);
  const render = (t) => `
    <div class="task">
      <div class="taskh">
        <span class="pt ${t.priority === 'P1' ? 'p1' : t.priority === 'P2' ? 'p2' : ''}">${t.priority}</span>
        <span class="tt">${esc(t.title)}</span>
        <span class="thrs">${t.estimated_hours}h</span>
      </div>
      ${t.detail ? `<div class="tsub">${esc(t.detail)}</div>` : ''}
      <div class="hr"></div>
      <div class="kv"><i>预期产出</i><b>${esc(t.expected_output)}</b></div>
      <div class="kv"><i>完成标准</i><b>${esc(t.completion_criteria)}</b></div>
      <div class="kv"><i>依据</i><b>${esc(t.basis)}</b></div>
    </div>`;

  box.innerHTML =
    (w1.length ? `<div class="week">第 1 周 · 起步</div>${w1.map(render).join('')}` : '') +
    (w2.length ? `<div class="week">第 2 周 · 成果固化</div>${w2.map(render).join('')}` : '');

  const warn = [];
  if (plan.trimmed_count > 0) warn.push(`已按你的时间裁剪 ${plan.trimmed_count} 个任务`);
  if ((plan.uncovered || []).length) warn.push(`${plan.uncovered.length} 项需要你补充具体目标`);
  $('planWarn').innerHTML = warn.length
    ? `<div class="honest" style="margin-top:6px">${warn.map(esc).join('<br>')}</div>` : '';
  $('planFoot').textContent = `已生成 ${tasks.length} 个任务 · 预计 ${total} 小时`;
}

/* ---------- 07 确认调整 ---------- */
$('hours').addEventListener('input', (e) => {
  state.weeklyHours = Number(e.target.value);
  $('hoursVal').textContent = `${state.weeklyHours} 小时/周`;
  const tasks = state.result?.action_plan?.tasks || [];
  const total = tasks.reduce((s, t) => s + (t.estimated_hours || 0), 0);
  const cap = state.weeklyHours * 2;
  const pct = Math.min(100, Math.round((total / cap) * 100));
  $('sumBar').style.width = `${pct}%`;
  $('hoursHint').textContent = total > cap
    ? `当前计划 ${total} 小时，超出可投入 ${cap} 小时，重排时会自动裁剪`
    : state.weeklyHours >= 16 ? '时间较多，可以再增加任务' : '时间刚好，按这个节奏走就行';
  $('sumTitle').textContent = `${tasks.length} 个任务 · 预计 ${total} 小时`;
  $('sumSub').textContent = `两周可投入 ${cap} 小时`;
});

$('navRegen2').onclick = () => { regenerate(['weekly_hours']); };

function renderTaskList() {
  const tasks = state.result?.action_plan?.tasks || [];
  const box = $('taskList');
  box.innerHTML = tasks.map((t, i) => `
    <div class="kvrow">
      <div class="box ${state.excludedTasks.has(i) ? 'e' : ''}" data-idx="${i}">${state.excludedTasks.has(i) ? '' : '✓'}</div>
      <span style="${state.excludedTasks.has(i) ? 'text-decoration:line-through;color:var(--t4)' : ''}">${esc(t.title)}</span>
    </div>`).join('');
  box.querySelectorAll('[data-idx]').forEach((b) => {
    b.onclick = () => {
      const i = Number(b.getAttribute('data-idx'));
      if (state.excludedTasks.has(i)) state.excludedTasks.delete(i);
      else state.excludedTasks.add(i);
      renderTaskList();
    };
  });
}

$('btnPlanDone').onclick = () => {
  renderTaskList();
  const tasks = state.result?.action_plan?.tasks || [];
  const total = tasks.reduce((s, t) => s + (t.estimated_hours || 0), 0);
  $('sumTitle').textContent = `${tasks.length} 个任务 · 预计 ${total} 小时`;
  $('sumSub').textContent = `两周可投入 ${state.weeklyHours * 2} 小时`;
  go('s7');
};

$('btnStart').onclick = () => {
  const excluded = [...state.excludedTasks];
  if (excluded.length) {
    regenerate(['weekly_hours'], excluded);
    return;
  }
  go('s1');
};

/* ---------- F6 重算 ---------- */
async function regenerate(changedFields, excludedIds = []) {
  if (!state.baseResultId) { startAnalysis(); return; }
  showLoading('正在重新生成…', '只重跑受影响的步骤，其余结果保留');
  try {
    const res = await fetch(apiUrl('/api/analysis/regenerate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_result_id: state.baseResultId,
        changed_fields: changedFields,
        weekly_hours: state.weeklyHours,
        raw_text: state.rawText,
        jd_text: state.jdText,
        excluded_items: excludedIds,
      }),
    });
    const { ok, data } = await parseResponse(res);
    if (!ok || data.fallback_available) {
      showError({
        title: '重新生成失败',
        msg: data.message || '重新生成失败，可继续使用原结果。',
        hint: '',
        code: data.error || '',
      });
      return;
    }
    state.result = data;
    state.baseResultId = data.result_id;
    state.excludedTasks = new Set();

    renderGap(data.gap_report, data.jd_profile);
    renderPlan(data.action_plan);
    showDiff(data);
  } catch (err) {
    showError(explainError(err, '网络异常，原结果仍可继续使用。'));
  }
}

function showDiff(data) {
  const diff = data.diff || { items: [], changed_count: 0 };
  const scope = data.recomputed_scope || [];
  const scopeText = { profile: '经历解析', jd_profile: 'JD 解析', gap_report: '能力差距', action_plan: '行动计划' };

  $('s8body').innerHTML = `
    <div style="margin-top:24px">
      <div style="font-size:18px;font-weight:500;color:var(--t1);margin-bottom:6px">这次重算了什么</div>
      <div style="font-size:12px;color:var(--t3);margin-bottom:16px">
        ${scope.map((s) => scopeText[s] || s).join(' → ') || '无'}　·　${diff.changed_count} 处结论变化
      </div>
      <div class="card" style="padding:6px 16px">
        ${diff.items.length ? diff.items.map((d) => `
          <div class="diffrow">
            <span class="dchip ${d.changed ? 'dchg' : 'dsame'}">${d.changed ? '已变化' : '未变化'}</span>
            <span class="dkey">
              <b>${esc(d.key)}</b>
              ${d.changed ? `
                <span class="dside"><s>${esc(fmt(d.before))}</s></span>
                <span class="dside darrow">↓</span>
                <span class="dside">${esc(fmt(d.after))}</span>` : ''}
            </span>
          </div>`).join('') : '<div style="padding:14px 0;font-size:13px;color:var(--t3)">这次修改没有改变任何结论——通常说明你补的信息没有触及差距判断的依据。</div>'}
      </div>
      <div class="honest" style="margin-top:16px"><b>结论没变不一定是坏事。</b><br>知涯不会为了让页面「看起来更新了」而强行改变判断。</div>
    </div>`;
  $('s8foot').innerHTML = '<div class="btn" id="btnAccept">采用新结果</div>';
  $('btnAccept').onclick = () => { go('s6'); };
  $('back8').onclick = () => go('s6');
  $('nav8r').textContent = '';
  go('s8');
}

function fmt(v) {
  if (v === null || v === undefined) return '（无）';
  if (typeof v === 'object') {
    if (v.status) return `状态 ${v.status}`;
    return JSON.stringify(v);
  }
  return String(v);
}

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- 演示模式 ----------
 * 面试现场的安全绳：断网或模型超时时，一键切换到预置结果继续演示。
 * 预置结果是真实模型跑出来的快照，不是手写假数据。
 */
const DEMO_RAW = `我是计算机专业大三学生。
上学期做了一个校园二手交易平台的课程项目，我负责后端接口和数据库设计，用 Java 写的，一共做了 8 个接口。
我还参加过学校程序设计竞赛拿了个三等奖，题目是动态规划。
平时喜欢刷 LeetCode，目前做完了 200 多道题。
没有实习经历，也没参加过产品相关的活动。`;

const DEMO_JD = `AI 产品经理实习生（校园招聘）
岗位职责：
1. 参与 AI 产品的需求调研、功能设计与迭代；
2. 撰写产品需求文档（PRD），推动研发与测试团队落地；
3. 跟踪数据表现，输出迭代优化方案。
任职要求：
1. 本科及以上在读，计算机、信息管理、心理学等相关专业优先；
2. 具备较强的逻辑思考与结构化表达能力；
3. 熟悉至少一种大模型 API，有调用实践经验者优先；
4. 有产品竞赛、校园活动组织或自媒体运营经验者优先；
5. 熟练使用 Axure/Figma 等原型工具加分。`;

function toggleDemoMode() {
  state.demoMode = !state.demoMode;
  const btn = $('btnDemoToggle');
  btn.classList.toggle('on', state.demoMode);
  btn.textContent = state.demoMode ? '演示模式已开 · 点击关闭' : '用预置结果演示';
  $('demoNote').style.display = state.demoMode ? '' : 'none';
  if (state.demoMode) {
    fillDemoInputs();
  }
}

function fillDemoInputs() {
  state.rawText = DEMO_RAW;
  state.jdText = DEMO_JD;
  $('rawText').value = DEMO_RAW;
  $('jdText').value = DEMO_JD;
  onJdInput();
  const btn = $('btnParse');
  if (btn) btn.classList.remove('dis');
}

$('btnDemoToggle').onclick = () => toggleDemoMode();
$('btnDemoFill').onclick = () => {
  fillDemoInputs();
  go('s2');
};

/* ---------- 内测：参与者信息 ---------- */
(function initBeta() {
  const pidInput = $('betaPid');
  const trackBox = $('betaTracks');
  if (!pidInput || !trackBox) return;

  // 编号存在 localStorage 里，同一个人换设备也能续上（只存匿名编号）
  try {
    const saved = localStorage.getItem('zhiya.beta.pid');
    if (saved) {
      pidInput.value = saved;
      state.participant = saved;
    }
    const savedTrack = localStorage.getItem('zhiya.beta.track');
    if (savedTrack) {
      state.track = savedTrack;
      trackBox.querySelectorAll('.betaTrack').forEach((b) => {
        b.classList.toggle('on', b.getAttribute('data-track') === savedTrack);
      });
    }
  } catch (_) { /* localStorage 不可用时忽略 */ }

  pidInput.addEventListener('input', () => {
    const v = pidInput.value.trim();
    state.participant = v;
    try {
      if (v) localStorage.setItem('zhiya.beta.pid', v);
      else localStorage.removeItem('zhiya.beta.pid');
    } catch (_) { /* ignore */ }
    // 填了编号才算进入漏斗（没填的用户不计入统计）
    if (v) telemetry('visit', { track: state.track });
  });

  trackBox.querySelectorAll('.betaTrack').forEach((b) => {
    b.onclick = () => {
      const t = b.getAttribute('data-track');
      state.track = state.track === t ? '' : t;
      trackBox.querySelectorAll('.betaTrack').forEach((x) => {
        x.classList.toggle('on', x.getAttribute('data-track') === state.track);
      });
      try {
        if (state.track) localStorage.setItem('zhiya.beta.track', state.track);
        else localStorage.removeItem('zhiya.beta.track');
      } catch (_) { /* ignore */ }
      telemetry('visit', { track: state.track });
    };
  });
})();

/* ---------- 内测：反馈问卷 ---------- */
(function initFeedback() {
  const rateBox = $('fbRate');
  if (!rateBox) return;

  rateBox.querySelectorAll('.fbR').forEach((b) => {
    b.onclick = () => {
      rateBox.querySelectorAll('.fbR').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      state.fb.overall = Number(b.getAttribute('data-v'));
      refreshFbBtn();
    };
  });

  // 单选组
  const effortBox = $('fbEffort');
  effortBox.querySelectorAll('.fbC2').forEach((b) => {
    b.onclick = () => {
      effortBox.querySelectorAll('.fbC2').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      state.fb.effort_minutes = Number(b.getAttribute('data-v'));
      refreshFbBtn();
    };
  });

  const recBox = $('fbRec');
  recBox.querySelectorAll('.fbC2').forEach((b) => {
    b.onclick = () => {
      recBox.querySelectorAll('.fbC2').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      state.fb.would_recommend = b.getAttribute('data-v');
      refreshFbBtn();
    };
  });

  // 多选组
  const bindChecks = (boxId, key) => {
    const box = $(boxId);
    box.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.onchange = () => {
        state.fb[key] = [...box.querySelectorAll('input:checked')].map((x) => x.value);
        refreshFbBtn();
      };
    });
  };
  bindChecks('fbUseful', 'useful_parts');
  bindChecks('fbPain', 'pain_points');

  $('fbQuote').addEventListener('input', (e) => {
    state.fb.quote = e.target.value.trim();
    refreshFbBtn();
  });

  function refreshFbBtn() {
    const enough = state.fb.overall > 0;
    $('btnFb').disabled = !enough;
    $('btnFb').classList.toggle('dis', !enough);
  }

  $('btnFb').onclick = async () => {
    const btn = $('btnFb');
    btn.disabled = true;
    btn.classList.add('dis');
    btn.textContent = '提交中…';
    try {
      const res = await fetch(apiUrl('/api/feedback'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant: state.participant,
          track: state.track,
          feedback: state.fb,
        }),
      });
      const { ok } = await parseResponse(res);
      if (ok) {
        telemetry('feedback');
        btn.textContent = '已提交，谢谢你！';
        setTimeout(() => { go('s6'); }, 900);
      } else {
        btn.textContent = '提交失败，重试';
        btn.disabled = false;
        btn.classList.remove('dis');
      }
    } catch (e) {
      btn.textContent = '提交失败，重试';
      btn.disabled = false;
      btn.classList.remove('dis');
    }
  };

  refreshFbBtn();
})();

/* ---------- 初始化 ---------- */
onJdInput();
$('hours').dispatchEvent(new Event('input'));
go('s1');

/* 启动即探测后端，把连接状态直接摆在首页，
   避免用户填完一堆内容才发现接口不通。 */
(async function init() {
  const base = await detectApiBase();
  const hint = $('connHint');
  // 注意：base 为空字符串代表「同源可用」，是有效结果，不能用 if (base) 判断
  const connected = base !== null;
  if (connected) {
    const where = base ? base.replace(/^https?:\/\//, '') : '同源';
    hint.innerHTML = `<span style="color:var(--have-t)">●</span> 已连接知涯后端（${where}）`;
    hint.classList.remove('bad');
  } else {
    hint.innerHTML = '<span style="color:var(--err)">●</span> 未连接到知涯后端 —— 请用 http://127.0.0.1:5178 打开本页，或先执行 bash start.sh';
    hint.classList.add('bad');
  }
})();
