# GitHub 开源作品集搭建指南（知涯实践版）

> 这份文档来自知涯项目的一次真实实践：把本地 MVP 开源成招聘可用的作品集仓库。
> 全程约 40 分钟，含 4 个在真实操作中踩到的坑。

---

## 一、开始之前：仓库要放什么

**不要把「一个能跑的代码仓库」当成作品集。** 招聘方看仓库的时间平均不到 2 分钟，
真正决定印象的是三样东西：

| 层次 | 作用 | 知涯的做法 |
| --- | --- | --- |
| **门面** | 让对方 30 秒看懂这是什么 | README 首屏大图 + 一句话定位 + 四维事实表 |
| **证据** | 让对方相信你说的 | 截图取自真实运行（不是设计稿）+ 可下载的测试报告 |
| **查证** | 让对方能自己核对 | 10 次结构化提交，每条写清「为什么这么设计」 |

三件缺一不可。只有代码，面试官问不出东西；只有截图，对方无法验证。

---

## 二、仓库元信息：不要留默认值

GitHub 仓库列表页只有 **description 一行** 和 **topics 标签** 是自由填写的，
默认留空等于浪费了一个转化位。

```bash
# description：一句话说清「是什么 + 凭什么可信」
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.github.com/user/repos" \
  -d '{
    "name": "zhiya",
    "description": "知涯 ZHIYA · 面向大学生的 AI 职业探索与求职成长伙伴 | 用服务端强校验约束 AI 幻觉，149 项单元测试 + 225 项产品测试全通过",
    "homepage": "https://your-portfolio-url",
    "private": false,
    "has_issues": true,
    "auto_init": false,
    "default_branch": "main",
    "topics": ["ai","llm","product-management","guardrails","ai-safety"]
  }'
```

**description 的写法**：前半段说是什么，后半段放**可验证的硬数字**。
「149 项单元测试 + 225 项产品测试全通过」比「质量可靠」有用一百倍。

**topics 单独设置**（建仓时传的 topics 字段不生效，必须再 PUT 一次）：

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/OWNER/REPO/topics" \
  -d '{"names":["ai","llm","nodejs","express"]}'
```

---

## 三、密钥审计：公开前必做

**推之前先扫，推之后再扫一次。** 知涯在这次审计里抓到两个真问题。

```bash
# 1) 扫全目录（含未跟踪文件）
grep -rn "wbpk_\|ghp_\|gho_\|sk-\|apiKey\s*=\s*['\"]" . --exclude-dir=node_modules --exclude-dir=.git

# 2) 建 .gitignore
cat > .gitignore << 'EOF'
node_modules/
.env
.env.local
.env.*.local
test-results/
*.log
.DS_Store
EOF

# 3) 建 .env.example 模板（保留键名，不留值）
cat > .env.example << 'EOF'
# 云服务公钥，从平台控制台获取
WB_CLOUD_PUBLISHABLE_KEY=wbpk_在此填入你的公钥
WB_CLOUD_ENDPOINT=https://your-app.app.workbuddy.host
ZHIYA_MODEL=deepseek-v4.1-flash
PORT=5178
EOF
```

**启动脚本里的硬编码密钥是最容易漏的。** 它不在 `.env` 里、不在业务代码里，
藏在 `start.sh` 和 `启动后端.bat` 里——但照样会被推上去。

改法：脚本从 `.env.local` 读，读不到就给出明确指引：

```bash
if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
else
  echo "❌ 未找到 .env.local，请复制 .env.example 并填入密钥"
  exit 1
fi
```

### 推完之后必须做终检

本地扫过了不代表推上去就干净——`.gitignore` 规则写错一个字符就可能漏。

```bash
rm -rf /tmp/verify && git clone --quiet https://github.com/OWNER/REPO.git /tmp/verify
cd /tmp/verify
grep -rn "wbpk_\|ghp_\|gho_" . --exclude-dir=.git && echo "❌ 泄露！" || echo "✅ 零密钥"
ls .env.local 2>/dev/null && echo "❌ .env.local 被传" || echo "✅ .env.local 未传"
```

---

## 四、提交历史：写决策，不写流水账

**一条 commit = 一个可讲的故事。** 面试官翻 commit history 时想看到的是
「你怎么想的」，不是「你改了哪些文件」。

知涯的 10 次提交是这样组织的：

```
d489197  chore: 工程脚手架与密钥配置外置
fa4f08d  feat(server): 四步串行 AI 管线与服务端强校验
18f3c90  feat(frontend): 8 屏可交互原型与离线单文件版
4c60991  test: 149 项单元测试 + 225 项产品测试 + 浏览器回归
a066397  docs: README 改为作品集视角
67083fd  fix(security): CORS 白名单 + 零依赖 .env 加载器
1c7cb8c  docs: 加入离线单文件版 demo-offline.html
1060719  docs: 修正 README 中三处失效引用
13c3e24  feat(demo): 演示快照升级为 V2.0 修复后真实产出 + 补首屏截图
31de8ff  docs: README 加首屏截图与仓库内文档下载入口
```

每条 commit 正文都回答同一个问题：**「为什么这么设计，而不是另一种做法？」**

反例：
```
fix: 改了几个 bug
```

正例：
```
feat(demo): 演示快照升级为 V2.0 修复后真实产出 + 补首屏截图

## 为什么要改快照

原快照是 V1.0 时期的产出，被测者输入下：
- 差距屏底部显示「待提升 0」——正是 D1 缺陷（三分类退化）的现场证据
- 计划屏任务是「翻出课程项目资料，回忆是否有参与」——D5 说的翻资料型元任务

面试现场演示用的就是这份数据，用旧快照等于自曝缺陷。
```

---

## 五、README：三屏之内说清价值

### 结构顺序（按招聘方注意力排）

1. **标题区** —— 一句话定位 + 品牌理念 + 首屏大图 + 关键链接
2. **这个项目在证明什么** —— 四维事实表，全是硬数字
3. **三分钟看到产品** —— 三屏并排截图 + 一段真实数据解读
4. **怎么跑起来** —— 两条路径（离线零依赖 / 本地真跑模型）
5. **完整文档索引** —— 仓库内可直接下载的放前面，外部的放后面
6. 之后才是架构、技术细节

### 截图必须是真实产出

**用设计稿截图 = 自曝没有实现。** 知涯的截图直接来自修复后的真实模型输出，
并配一段解读说明「为什么这条判为待提升」：

> 截图取自 2026-11-09 修复后的真实模型产出，不是设计稿。
> 中屏的「功能设计与迭代」被判为**待提升**——用户参与过课程项目的接口与数据库设计，
> 但项目规模小、未体现需求分析与迭代优化的完整流程，
> 所以判「沾边但不够」而非「已有」或「信息不足」。

### 死链检查（必做）

README 里每一个链接和图片路径都要真实存在：

```bash
python3 - << 'EOF'
import re, os
s = open('README.md', encoding='utf-8').read()
refs = re.findall(r'!?(?:\]\(|src=")([^)"\s]+)', s)
bad = [r for r in set(refs)
       if not r.startswith(('http','#','mailto')) and not os.path.exists(r.split('#')[0])]
print('死链:', bad or '无')
print('本机路径残留:', re.findall(r'[A-Za-z]:\\Users\\[^\\s"\'）)]*', s) or '无')
EOF
```

### 别在 README 里暴露本机路径

`C:\Users\33629\Desktop\xxx.html` 这种路径，招聘方看到的是别人的用户名，
属于明显疏漏。所有路径必须是仓库内相对路径。

---

## 六、坑位清单（本次真实踩到的）

### 坑 1：离线演示的「预置结果」按钮只填输入框

前端有「用预置结果演示」按钮，但**它只填输入框，不填结果**——
结果必须走完整流程才会渲染。所以做自动截图时，点了按钮切屏，截出来的是空屏。

**解法**：直接调页面内部的 `applyResult(snapshot)` 渲染。

```js
await page.evaluate((snap) => {
  applyResult(snap.result, '离线截图 · 预置的真实模型产出');
}, SNAPSHOT);
```

### 坑 2：屏号靠猜会全错

8 屏的编号和内容没有一一对应的直觉关系。知涯实际映射：

```
s2=背景录入  s3=追问  s4=岗位方向  s5=能力差距  s6=行动计划  s7=确认行动
```

**解法**：解析 HTML 拿到每屏的可见文字，别猜。

```bash
python3 -c "
import re
s=open('public/index.html',encoding='utf-8').read()
for p in re.split(r'(?=<div class=\"screen)', s):
    m=re.search(r'id=\"(s\d)\"', p)
    if not m: continue
    t=re.sub(r'<[^>]+>',' ',re.sub(r'<script.*?</script>','',p,flags=re.S))
    print(m.group(1), re.sub(r'\s+',' ',t).strip()[:40])
"
```

### 坑 3：截图脚本要注入快照数据，不是靠点击

纯靠模拟点击走流程，模型调用要 25 秒且不稳定。
正确做法是注入预置快照再按屏号跳转，**秒级完成且结果可控**。

### 坑 4：中文文件名在线上会 404

静态托管对中文文件名的 URL 编码处理不一致。
**所有要上传的文件一律用英文名**，包括 docx 和图片。

### 坑 5：`doc_replace_text` 坐标会漂移

用 editor_sdk 编辑 Word 时，`begin`/`end` 是 UTF-16 坐标，
**替换后坐标会漂移**。多次替换要**从大到小**做，或每次重新 `doc_find` 定位。

---

## 七、推送清单（照着勾）

```
□ 仓库名可用（GET /repos/OWNER/NAME 返回 404）
□ description 已填（含硬数字）
□ topics 已设置（需单独 PUT）
□ homepage 已填
□ .gitignore 覆盖 .env.local / node_modules / 测试产物
□ .env.example 模板已建（只有键名）
□ 启动脚本无硬编码密钥
□ 全目录密钥扫描 = 0
□ git remote 已配置
□ 推送成功
□ 重新 clone 做终检（密钥 / .env.local / node_modules）
□ README 本地链接 0 死链
□ README 无本机路径残留
□ README 图片路径真实存在
□ 截图取自真实运行（非设计稿）
□ 演示快照是修复后的版本（不含已知缺陷的痕迹）
□ 文档下载入口在仓库内可直接取用
□ 作品集落地页的仓库按钮指向真实地址
```

---

## 八、一句话总结

**仓库的价值不在代码，在「可验证性」。**

代码谁都能写，但「我能发现 7 类缺陷并定位到代码行」「我修完并复验出了前后对比」
「我在准备开源时做了密钥审计并发现两个问题」——这三件事是应届生几乎拿不出的证据。

而这些证据，**全都在 commit history、README 截图和 docs/ 目录里**。
