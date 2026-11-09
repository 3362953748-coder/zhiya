/**
 * 真实浏览器验证：模拟三种打开场景，看后端探测是否真的工作
 * 运行：npx playwright test 不需要，用 node 直接跑：node test/browser.test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT_API = 5178;
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

/* 造一个「静态预览服务器」：只提供 html/js/css，未知路径返回 404 纯文本 */
function makeStaticServer(port, mode) {
  const server = createServer((req, res) => {
    const url = req.url.split('?')[0];
    const file = url === '/' ? '/index.html' : url;
    try {
      const content = readFileSync(`public${file}`);
      res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
      res.end(content);
    } catch (_) {
      if (mode === 'hang') {
        // 模拟「预览服务器对未知路径挂起不响应」—— 最难排查的情况
        return; // 故意不响应
      }
      if (mode === 'spa') {
        // 模拟 SPA fallback：任何路径都返回 200 + index.html
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(readFileSync('public/index.html'));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const browser = await chromium.launch();

async function probeScenario(label, url, expectConnected) {
  const context = await browser.newContext();
  const page = await context.newPage();

  const requests = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/health')) requests.push(r.url());
  });
  const failures = [];
  page.on('requestfailed', (r) => {
    if (r.url().includes('/api/health')) {
      failures.push(`${r.url()} → ${r.failure()?.errorText}`);
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // 等连接状态条更新
  await page.waitForTimeout(3000);

  const connText = await page.textContent('#connHint').catch(() => '(未找到状态条)');
  const connected = connText.includes('已连接');

  record(
    `${label} → ${expectConnected ? '应连接成功' : '应显示未连接'}`,
    connected === expectConnected,
    `实际文案：${connText.replace(/\s+/g, ' ').trim().slice(0, 60)}`
  );

  if (requests.length) {
    console.log(`     探测请求：${requests.map((r) => r.replace(/^https?:\/\//, '')).join(', ')}`);
  }
  if (failures.length) {
    console.log(`     失败请求：${failures.join(' | ')}`);
  }

  await context.close();
}

console.log('\n═══ 真实浏览器验证 ═══\n');

/* 场景 1：后端同源 */
console.log('── 场景 1：从后端地址打开（推荐用法）──');
await probeScenario('后端同源', `http://127.0.0.1:${PORT_API}/`, true);

/* 场景 2：静态预览服务器（404 Not Found） */
console.log('\n── 场景 2：从静态预览面板打开（404 Not Found）──');
{
  const s = await makeStaticServer(59901, '404');
  await probeScenario('预览服务器-404', 'http://127.0.0.1:59901/', true);
  s.close();
}

/* 场景 3：静态预览服务器（SPA fallback 返回 200+HTML） */
console.log('\n── 场景 3：从 SPA fallback 预览面板打开（200 + HTML）──');
{
  const s = await makeStaticServer(59902, 'spa');
  await probeScenario('预览服务器-SPA', 'http://127.0.0.1:59902/', true);
  s.close();
}

/* 场景 4：预览服务器挂起不响应（最恶劣情况） */
console.log('\n── 场景 4：预览服务器挂起不响应（超时场景）──');
{
  const s = await makeStaticServer(59903, 'hang');
  const t0 = Date.now();
  await probeScenario('预览服务器-挂起', 'http://127.0.0.1:59903/', true);
  console.log(`     探测耗时 ${Date.now() - t0}ms（应远小于 15s，说明超时机制生效）`);
  s.close();
}

await browser.close();

const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log(`\n═══ 通过 ${pass} · 失败 ${fail} ═══`);
process.exit(fail ? 1 : 0);
