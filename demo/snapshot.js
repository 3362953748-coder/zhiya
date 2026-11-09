/**
 * 生成演示用的预置结果（真实模型跑一次，存成 JSON）
 * 运行：node demo/snapshot.js
 *
 * 用途：面试现场断网 / 模型超时时，用这份快照演示完整 UI 流程。
 * 这份快照是真实模型输出，不是手写的假数据。
 */
import { writeFileSync } from 'node:fs';
import { initCloud } from '../server/cloud.js';
import { runPipeline, runDirections, STEPS } from '../server/pipeline.js';

initCloud({
  endpoint: process.env.WB_CLOUD_ENDPOINT,
  publishableKey: process.env.WB_CLOUD_PUBLISHABLE_KEY,
});

// 演示案例：计算机大三 → AI 产品经理实习生
// 特意选一个能同时展现「已有」「信息不足」「不编造」的组合
const raw_text = `我是计算机专业大三学生。
上学期做了一个校园二手交易平台的课程项目，我负责后端接口和数据库设计，用 Java 写的，一共做了 8 个接口。
我还参加过学校程序设计竞赛拿了个三等奖，题目是动态规划。
平时喜欢刷 LeetCode，目前做完了 200 多道题。
没有实习经历，也没参加过产品相关的活动。`;

const jd_text = `AI 产品经理实习生（校园招聘）
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

console.log('▶ 用真实模型生成演示快照…');
const t0 = Date.now();
const state = { raw_text, followups: [], jd_text, target_role: '', weekly_hours: 10 };

await runPipeline(state, { scope: [STEPS.PROFILE, STEPS.JD, STEPS.GAP, STEPS.PLAN] });
state.directions = await runDirections(state, state.model);

const snapshot = {
  generated_at: new Date().toISOString(),
  model: state.model,
  input: { raw_text, jd_text, weekly_hours: 10 },
  result: {
    result_id: 'demo-snapshot',
    profile: state.profile,
    jd_profile: state.jd_profile,
    directions: state.directions,
    gap_report: state.gap_report,
    action_plan: state.action_plan,
    violations: state.violations || [],
  },
};

writeFileSync('demo/snapshot.json', JSON.stringify(snapshot, null, 2), 'utf-8');
console.log(`✔ 快照已保存 demo/snapshot.json（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
console.log(`  能力项 ${state.gap_report.items.length} 条 · 任务 ${state.action_plan.tasks.length} 个 · 总时长 ${state.action_plan.total_hours}h`);
