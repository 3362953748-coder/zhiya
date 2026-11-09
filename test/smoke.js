/**
 * 冒烟测试：直接跑四步，验证核心链路
 */
import { initCloud } from '../server/cloud.js';
import { runPipeline, runDirections, STEPS } from '../server/pipeline.js';

initCloud({
  endpoint: process.env.WB_CLOUD_ENDPOINT,
  publishableKey: process.env.WB_CLOUD_PUBLISHABLE_KEY,
});

const RAW_TEXT = `我是计算机专业大三学生。
上学期做了一个校园二手交易平台的课程项目，我负责后端接口和数据库设计，用 Java 写的，一共做了 8 个接口。
我还参加过学校程序设计竞赛拿了个三等奖，题目是动态规划。
平时喜欢刷 LeetCode，目前做完了 200 多道题。
没有实习经历。`;

const JD_TEXT = `AI 产品经理实习生（校园招聘）
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

const state = {
  raw_text: RAW_TEXT,
  followups: [],
  jd_text: JD_TEXT,
  target_role: '',
  weekly_hours: 10,
};

console.log('▶ 开始四步串行…');
const t0 = Date.now();
await runPipeline(state, { scope: [STEPS.PROFILE, STEPS.JD, STEPS.GAP, STEPS.PLAN] });
console.log(`✔ 四步完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

console.log('\n===== ① profile =====');
console.log(JSON.stringify(state.profile, null, 2));

console.log('\n===== ② jd_profile =====');
console.log(JSON.stringify(state.jd_profile, null, 2));

console.log('\n===== ③ gap_report =====');
console.log(JSON.stringify(state.gap_report, null, 2));

console.log('\n===== ④ action_plan =====');
console.log(JSON.stringify(state.action_plan, null, 2));

console.log('\n===== directions =====');
state.directions = await runDirections(state, state.model);
console.log(JSON.stringify(state.directions, null, 2));
