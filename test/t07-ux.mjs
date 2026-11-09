/**
 * 测试 07 · 用户体验测试
 *
 * 验证项：页面是否清晰、操作是否流畅
 *
 * 方法：用真实浏览器模拟用户走完整流程，
 * 采集可客观判定的体验指标 —— 加载反馈、错误引导、
 * 信息层级、点击热区、响应时间、滚动溢出、无障碍基础项。
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5178';

export async function runUxTests() {
  const log = console.log;
  log('\n── 07 用户体验测试 ──');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 500, height: 900 } });
  const page = await ctx.newPage();

  const jsErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push(m.text()); });
  page.on('pageerror', (e) => jsErrors.push('pageerror: ' + e.message));

  const cases = [];
  const check = (name, ok, detail = '') => {
    cases.push({ name, ok: !!ok, detail: ok ? '' : String(detail) });
    log(ok ? `  ✅ ${name}` : `  ❌ ${name}${!ok && detail ? '\n     ' + detail : ''}`);
  };

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check(`首页加载耗时 < 3 秒（实际 ${((Date.now() - t0) / 1000).toFixed(2)}s）`,
    Date.now() - t0 < 3000, `${Date.now() - t0}ms`);

  /* ---------- 1. 首页信息层级 ---------- */
  const conn = (await page.textContent('#connHint')).trim();
  check('首页明确显示后端连接状态', conn.includes('已连接') || conn.includes('未连接'), conn);

  const h1 = await page.textContent('#s1 .hero').catch(() => '');
  check('首页有主标题', (h1 || '').trim().length > 0, `标题=${h1}`);
  const brand = await page.textContent('#s1 .hero + .sub').catch(() => '');
  check('首页有一句话说明产品定位', (brand || '').trim().length >= 8, `说明=${brand}`);

  const ctaCount = await page.locator('#s1 .btn, #s1 button').count();
  check('首页有明确行动入口（CTA）', ctaCount > 0, `按钮数 ${ctaCount}`);

  const btnText = await page.locator('#s1 .btn, #s1 button').first().textContent().catch(() => '');
  check('CTA 文案是动词短语（引导明确）', (btnText || '').trim().length >= 4 && /开始|进入|探索|看看/.test(btnText || ''), `文案="${btnText}"`);

  // 键盘可达性：必须在流程开始前测，焦点位置才有意义
  await page.keyboard.press('Tab');
  const focusTag = await page.evaluate(() => document.activeElement?.tagName);
  check('Tab 键首个焦点是可交互元素', ['INPUT', 'TEXTAREA', 'BUTTON', 'A'].includes(focusTag), `焦点=${focusTag}`);
  const focusIsCta = await page.evaluate(() =>
    document.activeElement?.textContent?.trim() === '开始探索我的方向');
  check('Tab 首焦点落在主行动按钮上（键盘用户可进入流程）', focusIsCta, '焦点不在 CTA 上');
  await page.evaluate(() => document.activeElement?.blur());

  /* ---------- 2. 输入页交互反馈 ---------- */
  await page.click('[data-go="s2"]');
  await page.waitForTimeout(250);
  check('进入背景录入页', await page.isVisible('#rawText'));

  const btnBefore = await page.getAttribute('#btnParse', 'class');
  check('未输入时「继续」按钮置灰（防无效提交）', (btnBefore || '').includes('dis'), btnBefore);

  await page.fill('#rawText', '我是计算机专业大三学生，做过校园二手交易平台的课程项目，负责后端接口和数据库设计，用 Java 写的，一共 8 个接口。');
  await page.waitForTimeout(300);
  const btnAfter = await page.getAttribute('#btnParse', 'class');
  check('输入足够内容后按钮可点（状态正确切换）', !(btnAfter || '').includes('dis'), btnAfter);

  const counter = await page.textContent('#rawCount').catch(() => '');
  check('背景录入页有字数统计', (counter || '').trim().length > 0, `计数元素="${counter}"`);

  /* ---------- 3. JD 页：示例引导 ---------- */
  await page.click('[data-go="s4"]');
  await page.waitForTimeout(250);
  check('进入 JD 输入页', await page.isVisible('#jdText'));
  check('提供「贴一段示例」引导（降低上手门槛）', await page.isVisible('#jdSample'));

  await page.click('#jdSample');
  await page.waitForTimeout(300);
  const jdVal = await page.inputValue('#jdText');
  check('点击示例后 JD 自动填充', jdVal.length > 20, `JD 长度 ${jdVal.length}`);

  /* ---------- 4. 分析中的加载反馈 ---------- */
  const tAnalyze = Date.now();
  await page.click('#btnToGap');
  await page.waitForTimeout(250);

  const loadingVisible = await page.isVisible('#s8.on').catch(() => false);
  const loadingText = loadingVisible ? (await page.textContent('#s8body')).trim() : '';
  check('分析过程有加载态反馈', loadingVisible && loadingText.length > 0, `加载文案="${loadingText.slice(0, 60)}"`);
  check('加载态有步骤说明（让等待有意义）', /分析|解析|对照|步骤|串行/.test(loadingText), loadingText.slice(0, 80));

  await page.waitForSelector('#dirList .dcard', { timeout: 120000 });
  const analyzeMs = Date.now() - tAnalyze;
  check(`分析完成并进入结果页（${(analyzeMs / 1000).toFixed(1)}s）`, analyzeMs < 120000, `${analyzeMs}ms`);
  check('结果页无 JS 报错', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

  /* ---------- 5. 岗位方向页信息清晰度 ---------- */
  const dirCards = await page.locator('#dirList .dcard').count();
  check('方向卡渲染（≥1 个）', dirCards >= 1, `数量 ${dirCards}`);

  // 方向卡的结构完整性（不靠关键词 —— 理由文案本身有自由度）
  const firstDir = await page.locator('#dirList .dcard').first();
  const dirStruct = await firstDir.evaluate((el) => ({
    role: el.querySelector('.dt')?.textContent?.trim() || '',
    reason: el.querySelector('.l1')?.textContent?.trim() || '',
    uncertainty: el.querySelector('.l1p')?.textContent?.trim() || '',
    evidence: el.querySelector('.evid')?.textContent?.trim() || '',
    level: el.querySelector('.tags .tg2')?.textContent?.trim() || '',
  }));
  check('方向卡有岗位名称', dirStruct.role.length > 0, JSON.stringify(dirStruct));
  check('方向卡有推荐理由（非空且有实质内容）',
    dirStruct.reason.length >= 15, `理由="${dirStruct.reason.slice(0, 60)}"`);
  check('方向卡标注不确定性（诚实原则）',
    dirStruct.uncertainty.length > 0, `不确定性="${dirStruct.uncertainty}"`);
  check('方向卡标注匹配度等级',
    /匹配度较高|可尝试|可探索/.test(dirStruct.level), `等级="${dirStruct.level}"`);
  check('方向卡列出依据来源（推理可见）',
    dirStruct.evidence.length > 0, `依据="${dirStruct.evidence.slice(0, 60)}"`);

  const jdCards = await page.locator('#jdList .card, #jdList .carditem, #jdList > *').count();
  check('JD 能力清单可见', jdCards > 0, `元素数 ${jdCards}`);

  /* ---------- 6. 差距页信息层级 ---------- */
  await page.click('#btnToGap');
  await page.waitForTimeout(400);
  check('进入差距分析页', await page.isVisible('#s5.on'));

  const gapCards = await page.locator('#gapList .gapcard').count();
  check('差距条目渲染', gapCards > 0, `条目数 ${gapCards}`);

  const gapText = await page.textContent('#gapList');
  check('每条都有判断依据（推理可见）', gapText.includes('判断依据'), gapText.slice(0, 150));
  check('信息不足项用虚线卡区分（视觉可辨）',
    (await page.locator('#gapList .gapcard.unknown').count()) > 0 ||
    (await page.locator('#gapList .gapcard.improve').count()) > 0,
    '未找到 unknown/improve 状态卡');

  const unknownCards = await page.locator('#gapList .gapcard.unknown').count();
  if (unknownCards > 0) {
    const uc = await page.locator('#gapList .gapcard.unknown').first();
    const style = await uc.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { border: cs.borderStyle, dashed: cs.borderTopStyle === 'dashed' };
    });
    check('信息不足卡是虚线边框（视觉区分明确）', style.dashed || /dashed/.test(style.border), JSON.stringify(style));
  }

  check('信息不足项附带追问引导（可行动）',
    !unknownCards || /补充|做过|了解|请/.test(await page.textContent('#gapList')),
    '未找到追问文案');

  /* ---------- 7. 计划页可执行性呈现 ---------- */
  await page.click('#btnToPlan');
  await page.waitForTimeout(400);
  check('进入行动计划页', await page.isVisible('#s6.on'));

  const taskCards = await page.locator('#planList .task').count();
  check('任务卡渲染', taskCards > 0, `任务数 ${taskCards}`);

  const planText = await page.textContent('#planList');
  check('任务展示预期产出', /产出|交付|完成|产物/.test(planText), planText.slice(0, 120));
  check('任务展示完成标准', /标准|达到|验收|判定/.test(planText), planText.slice(0, 120));
  check('任务展示时长', /\d+\s*(小时|h|hrs)/.test(planText), planText.slice(0, 120));
  check('按周分组展示', /第\s*1\s*周|第\s*2\s*周|第一周|第二周/.test(planText), planText.slice(0, 120));

  /* ---------- 8. 点击热区（移动端可用性） ---------- */
  const smallTargets = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('button, .btn, .btn3, [role="button"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (getComputedStyle(el).display === 'none') return;
      if (r.height < 32 || r.width < 32) {
        bad.push(`${el.id || el.className || el.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    });
    return bad;
  });
  check('所有可点击元素热区 ≥ 32px（移动端友好）',
    smallTargets.length === 0, `过小元素：${smallTargets.join(', ')}`);

  /* ---------- 9. 横向溢出（布局问题） ---------- */
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    return { scrollW: de.scrollWidth, clientW: de.clientWidth };
  });
  check('无横向滚动溢出（布局正常）',
    overflow.scrollW <= overflow.clientW + 2, `scrollWidth=${overflow.scrollW}, clientWidth=${overflow.clientW}`);

  /* ---------- 10. 文字截断检查 ---------- */
  const clipped = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('#s4, #s5, #s6, #dirList, #gapList, #planList').forEach((root) => {
      root.querySelectorAll('*').forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 4 && getComputedStyle(el).overflow !== 'visible') {
          const t = (el.textContent || '').trim().slice(0, 25);
          if (t) bad.push(`${t} (${el.scrollWidth}>${el.clientWidth})`);
        }
      });
    });
    return [...new Set(bad)].slice(0, 8);
  });
  check('结果区无文字被截断', clipped.length === 0, clipped.join(' | '));

  /* ---------- 11. 关键信息对比度（可读性基础） ---------- */
  const lowContrast = await page.evaluate(() => {
    function lum(rgb) {
      const [r, g, b] = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function parse(c) {
      const m = c.match(/\d+(\.\d+)?/g);
      return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
    }
    const bad = [];
    document.querySelectorAll('#s4 *, #s5 *, #s6 *').forEach((el) => {
      if (!el.textContent || !el.textContent.trim()) return;
      if (el.children.length > 0) return;
      const cs = getComputedStyle(el);
      let bg = 'rgb(255,255,255)';
      let p = el;
      while (p && p !== document.body) {
        const c = getComputedStyle(p).backgroundColor;
        if (c && !/rgba?\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
        p = p.parentElement;
      }
      const l1 = lum(parse(cs.color));
      const l2 = lum(parse(bg));
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (ratio < 3) {
        bad.push(`${el.className || el.tagName}: ${cs.color} on ${bg} (${ratio.toFixed(2)}:1) "${el.textContent.trim().slice(0, 15)}"`);
      }
    });
    return [...new Set(bad)].slice(0, 6);
  });
  check('正文文字对比度 ≥ 3:1（可读性）',
    lowContrast.length === 0, lowContrast.join('\n     '));

  /* ---------- 12. 无障碍基础 ---------- */
  const a11y = await page.evaluate(() => {
    const issues = [];
    document.querySelectorAll('button').forEach((b) => {
      const hasText = (b.textContent || '').trim().length > 0;
      const hasLabel = b.getAttribute('aria-label') || b.getAttribute('title');
      if (!hasText && !hasLabel) issues.push(`按钮无文本: ${b.id || b.className}`);
    });
    document.querySelectorAll('textarea, input').forEach((i) => {
      const hasLabel = i.getAttribute('aria-label') || i.placeholder ||
        (i.id && document.querySelector(`label[for="${i.id}"]`));
      if (!hasLabel) issues.push(`输入框无标签: ${i.id || i.className}`);
    });
    return issues;
  });
  check('交互元素有可访问名称（读屏可用）', a11y.length === 0, a11y.join('\n     '));

  /* ---------- 13. 键盘可达性（见上方「首页」段落） ---------- */

  /* ---------- 14. 断线后的错误引导 ----------
   * 只拦 /api/** （不拦 HTML/CSS/JS），这样页面能正常加载，
   * 但页面里的连接探测会失败 —— 这才是「后端挂了但页面开着」的真实场景。
   */
  const ctx2 = await browser.newContext({ viewport: { width: 500, height: 900 } });
  await ctx2.route('**/api/**', (r) => r.abort('connectionrefused'));
  const p2 = await ctx2.newPage();
  await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(2500);
  const conn2 = (await p2.textContent('#connHint').catch(() => '')).trim();
  check('断网时首页明确提示未连接', conn2.includes('未连接'), conn2);
  check('断网提示给出下一步指引', /5178|start\.sh|打开/.test(conn2), conn2);

  await ctx2.close();

  /* ---------- 15. 全程无 JS 报错 ---------- */
  check('全流程无 JS 运行时错误', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

  await browser.close();

  const pass = cases.filter((c) => c.ok).length;
  const fail = cases.length - pass;
  return {
    title: '07 用户体验测试',
    cases,
    passed: pass,
    failed: fail,
    total: cases.length,
  };
}
