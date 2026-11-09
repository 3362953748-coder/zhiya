/**
 * 知涯 ZHIYA · 产品测试主运行器
 *
 * 按七类测试项目执行，输出统一报告。
 * 运行：node test/run-all.js
 */
import { report } from './framework.js';
import { runInputTests } from './t01-input.js';
import { runParseTests } from './t02-parse.js';
import { runGapTests } from './t03-gap.js';
import { runPlanTests } from './t04-plan.js';
import { runTruthTests } from './t05-truth.js';
import { runErrorTests } from './t06-error.js';
import { runUxTests } from './t07-ux.mjs';

const t0 = Date.now();
const groups = [];

console.log('\n' + '═'.repeat(64));
console.log('  知涯 ZHIYA · MVP 产品测试');
console.log('  七类测试：输入 / 解析 / 差距 / 计划 / 真实性 / 异常 / 体验');
console.log('═'.repeat(64));

/* ---------- 01 输入测试 ---------- */
const r1 = await runInputTests();
groups.push(r1);

/* ---------- 02 AI 解析测试 ---------- */
const r2 = await runParseTests();
groups.push(r2.g);

/* ---------- 03 差距分析测试 ---------- */
const r3 = await runGapTests();
groups.push(r3.g);

/* ---------- 04 计划生成测试 ---------- */
const r4 = await runPlanTests();
groups.push(r4.g);

/* ---------- 05 真实性测试 ---------- */
const r5 = await runTruthTests();
groups.push(r5.g);

/* ---------- 06 异常测试 ---------- */
const r6 = await runErrorTests();
groups.push(r6);

/* ---------- 07 用户体验测试 ---------- */
const r7 = await runUxTests();
groups.push(r7);

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const result = report(groups, { model: 'deepseek-v4.1-flash', elapsed: `${elapsed} 秒` });

/* ---------- 保存 JSON 结果供后续分析 ---------- */
const { writeFileSync, mkdirSync } = await import('node:fs');
const dir = new URL('../test-results/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(
  new URL('latest.json', dir),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      elapsed_seconds: Number(elapsed),
      summary: { pass: result.pass, fail: result.fail, total: result.total },
      groups: groups.map((g) => ({
        title: g.title,
        passed: g.passed,
        failed: g.failed,
        total: g.total,
        cases: g.cases,
      })),
    },
    null,
    2
  ),
  'utf-8'
);
console.log(`\n结果已保存：test-results/latest.json`);

process.exit(result.fail ? 1 : 0);
