// 把 SVG 架构图渲染成高清 PNG（2x）
// 用法：node svg2png.mjs <svg 路径...>
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法: node svg2png.mjs <svg...>');
  process.exit(1);
}

const browser = await chromium.launch();

for (const f of files) {
  const abs = path.resolve(f);
  const svg = fs.readFileSync(abs, 'utf8');
  const m = svg.match(/width="(\d+)"\s+height="(\d+)"/);
  const w = m ? parseInt(m[1]) : 1400;
  const h = m ? parseInt(m[2]) : 1000;

  const page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
  });
  await page.setContent(
    `<html><body style="margin:0;padding:0;background:#F6F1E9">${svg}</body></html>`,
    { waitUntil: 'networkidle' }
  );
  await page.waitForTimeout(500);
  const out = abs.replace(/\.svg$/i, '.png');
  await page.screenshot({ path: out, fullPage: false });
  await page.close();
  console.log('  ✅', path.basename(out), `${w}x${h} @2x → ${Math.round(fs.statSync(out).size / 1024)}KB`);
}

await browser.close();
