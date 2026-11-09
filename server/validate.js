/**
 * 结构与证据校验
 *
 * 提示词里的纪律必须在这里再兜一层：模型不听 prompt 时，代码仍要拦住越界输出。
 * 对应 PRD R-12：任何一步的判断依据必须能回指到已有产物中的具体条目。
 */

const STATUS = new Set(['have', 'improve', 'unknown']);

/** 归一化字符串，用于证据回指的宽松比对（忽略空白与标点差异） */
export function normalize(s) {
  return String(s || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：？！""''（）()【】\[\]…—\-·「」《》]/g, '')
    .toLowerCase();
}

/**
 * 从档案里收集可被引用的证据片段。
 *
 * 只收经历条目的原文 —— skills 里的词（如「Java」）是能力标签，
 * 不是经历证据。用户「用过 Java」不等于「有 Java 相关项目经历」，
 * 拿 skill 当证据会让 have 判定过于宽松。
 */
export function collectProfileEvidence(profile) {
  const out = [];
  for (const e of profile?.experiences || []) {
    if (e?.evidence) out.push(String(e.evidence));
    if (e?.title) out.push(String(e.title));
    if (e?.role) out.push(String(e.role));
  }
  return out;
}

/** 从岗位清单里收集可被引用的证据片段 */
export function collectJdEvidence(jd) {
  const out = [];
  for (const r of jd?.requirements || []) {
    if (r?.evidence) out.push(String(r.evidence));
    if (r?.item) out.push(String(r.item));
  }
  for (const r of jd?.ambiguous || []) {
    if (r?.evidence) out.push(String(r.evidence));
  }
  return out;
}

/**
 * 判断一段证据是否能在来源中找到。
 * 采用包含匹配：证据片段较长时，允许它是来源片段的子串。
 */
export function isEvidenceTraceable(evidence, sources) {
  const ev = normalize(evidence);
  if (!ev) return false;
  // 证据太短（<4 字）不足以证明可追溯，视为不可追溯
  if (ev.length < 4) return false;
  for (const s of sources) {
    const src = normalize(s);
    if (!src) continue;
    if (src.includes(ev) || ev.includes(src)) return true;
  }
  return false;
}

/**
 * 元话语检测：证据里出现「依据中已明确说明」这类指向推理过程的话，
 * 就说明模型给的根本不是用户原话，而是它自己写的转述。
 *
 * 实测案例（T5「数据跟踪与迭代优化」）：
 *   模型判 unknown，依据写「…按规则判为信息不足」，
 *   服务端的逻辑冲突检测把 unknown 改判成 have，
 *   并把证据填成字符串「依据中已明确说明」——
 *   这不是用户说的话，却因为它能被回指校验（子串匹配）而混过了检查。
 *
 * 修法：改判 have 时必须给出真实的用户原文片段，找不到就不改判。
 */
const META_DISCOURSE = /(依据中|上文中|如前所述|根据上|根据要求|依据已|原文已|档案中已|模型|推断|分析得出|说明中)/;

export function isMetaDiscourse(text) {
  return META_DISCOURSE.test(String(text || ''));
}

/**
 * 语义相关度检测：证据虽然出现在原文里，但内容与能力项是否相关？
 *
 * 实测案例（T1「大模型 API 调用实践经验」）：
 *   证据「MySQL」确实在用户原文中（"数据库用 MySQL 建的表"），
 *   所以子串匹配放行了它 —— 但 MySQL 与大模型 API 毫无关系。
 *
 * 判据：证据与能力项名称（或该能力项的 JD 证据）之间，
 * 要么有实词重叠，要么证据是一个包含动作的完整行为描述。
 * 孤立的工具名/名词（「MySQL」「计算机」）不算相关证据。
 */
export function isEvidenceRelevant(evidence, requirement, jdEvidence = '') {
  const ev = normalize(evidence);
  if (!ev) return false;

  // 元话语一律不相关
  if (isMetaDiscourse(evidence)) return false;

  const evTokens = tokenize(ev);
  if (evTokens.size === 0) return false;

  // 参照对象：能力项名称 + 该能力项在 JD 里的证据描述
  const refText = `${requirement || ''} ${jdEvidence || ''}`;
  const refTokens = tokenize(normalize(refText));
  if (refTokens.size === 0) return false;

  // 有实词重叠 → 相关
  let hit = 0;
  for (const t of evTokens) {
    if (refTokens.has(t)) hit++;
  }
  if (hit >= 1 && hit / evTokens.size >= 0.3) return true;

  // 证据本身是一个工具/技术名（如「Canva」「MySQL」），
  // 而该工具出现在 JD 对这项能力的描述里 → 相关。
  // 这类证据天然没有动作词、也没有实词重叠（能力名是「视觉设计能力」，
  // 工具名是「Canva」），但它确实是支撑证据。
  const evRaw = String(evidence || '').trim();
  if (evRaw.length <= 12 && !hasActionVerb(evRaw) && refTokens.size > 0) {
    // 证据整体出现在参照文本里 → 说明这个工具就是这项能力要求的工具
    if (normalize(refText).includes(normalize(evRaw))) return true;
  }

  // 无重叠时，只接受「完整行为描述」作为间接支撑：
  // 证据必须足够长（>=12 字）且含动作动词，说明它讲的是一件事而不是一个名词。
  if (ev.length >= 12 && hasActionVerb(evidence)) return true;

  return false;
}

/** 行为动词表：判断证据是不是在描述「做了什么」而不是「是什么」 */
const ACTION_VERBS = /(用|做|负责|写|参与|开发|做过|参加|组织|运营|设计|完成|搭建|处理|执行|策划|维护|整理|发布|投稿|带|学|熟悉|掌握|拿到|获得|分析|复盘|对比|搭建|实现|推动|对接|交付|上手|实践|经历|实习|工作|项目)/;

export function hasActionVerb(text) {
  return ACTION_VERBS.test(String(text || ''));
}

/**
 * 校验并归一化差距报告。
 * 违反规则的条目一律降级为 unknown，并记录进 violations。
 */
export function validateGapReport(rawGap, profile, jd) {
  const profileSources = collectProfileEvidence(profile);
  const jdSources = collectJdEvidence(jd);
  const violations = [];
  const items = [];

  const rawItems = Array.isArray(rawGap?.items) ? rawGap.items : [];

  // 岗位清单的标准名称，用于把模型自造名对齐回来
  const jdItemByKey = new Map();
  for (const r of jd?.requirements || []) {
    jdItemByKey.set(normalize(r.item), r.item);
  }

  for (const it of rawItems) {
    let requirement = String(it?.requirement || '').trim();
    if (!requirement) {
      violations.push({ type: 'missing_requirement', detail: '差距条目缺少 requirement 字段' });
      continue;
    }

    // 对齐到岗位清单的标准名称，保证同名可复现
    const normReq = normalize(requirement);
    if (!jdItemByKey.has(normReq)) {
      const matched = [...jdItemByKey.entries()].find(([k]) =>
        k.includes(normReq) || normReq.includes(k));
      if (matched) {
        violations.push({
          type: 'requirement_renamed',
          requirement,
          detail: `「${requirement}」已对齐为岗位清单标准名「${matched[1]}」`,
        });
        requirement = matched[1];
      }
    }

    let status = STATUS.has(it?.status) ? it.status : null;
    if (!status) {
      violations.push({
        type: 'invalid_status',
        requirement,
        detail: `status 非法（${JSON.stringify(it?.status)}），已降级为 unknown`,
      });
      status = 'unknown';
    }

    const evidence = String(it?.evidence || '').trim();
    const basis = String(it?.basis || '').trim();
    let evidenceText = evidence;
    let downgradedForEvidence = false;

    // 越界引用检测：have 类必须给出可回指的证据
    if (status === 'have') {
      if (!evidenceText) {
        violations.push({ type: 'hallucination', requirement, detail: '标记为已有但无证据，已降级为 unknown' });
        status = 'unknown';
        evidenceText = '';
        // 标记：这条因证据问题被降级，后续规则不得把它改回 have
        downgradedForEvidence = true;
      } else if (isMetaDiscourse(evidenceText)) {
        // 元话语不是用户原话，是模型对推理过程的转述。
        // 必须排在回指检查之前 —— 「依据中已明确说明」这类字符串
        // 有可能因为出现在原文里而通过回指校验，那就查不到它的真实来源了。
        violations.push({
          type: 'meta_discourse_evidence',
          requirement,
          detail: `证据「${evidenceText.slice(0, 40)}」是模型转述而非用户原话，已降级为 unknown`,
        });
        status = 'unknown';
        evidenceText = '';
        downgradedForEvidence = true;
      } else if (!isEvidenceTraceable(evidenceText, profileSources)) {
        violations.push({
          type: 'hallucination',
          requirement,
          detail: `证据「${evidenceText.slice(0, 40)}」无法在经历档案中回指，已降级为 unknown`,
        });
        status = 'unknown';
        evidenceText = '';  // 伪造证据必须清空，不能留在输出里
        downgradedForEvidence = true;
      } else {
        // 语义相关度：证据在原文里 ≠ 证据支撑这条能力项
        const jdEvidenceForItem = (jd?.requirements || [])
          .filter((r) => normalize(r?.item) === normalize(requirement))
          .map((r) => r?.evidence || '')
          .join(' ');
        if (!isEvidenceRelevant(evidenceText, requirement, jdEvidenceForItem)) {
          violations.push({
            type: 'irrelevant_evidence',
            requirement,
            detail: `证据「${evidenceText.slice(0, 40)}」虽在原文但与该能力项无关，已降级为 unknown`,
          });
          status = 'unknown';
          evidenceText = '';
          downgradedForEvidence = true;
        }
      }
    }

    // 禁止判定性表述：不仅要记录，必须真正移除
    const allText = `${evidenceText} ${basis} ${it?.advice || ''} ${it?.prompt || ''}`;
    const forbidden = ['不具备', '不会', '缺乏', '无法胜任', '毫无'];
    let basisClean = basis;
    let adviceClean = String(it?.advice || '').trim();
    let promptClean = String(it?.prompt || '').trim();
    for (const w of forbidden) {
      if (allText.includes(w)) {
        violations.push({
          type: 'forbidden_wording',
          requirement,
          detail: `出现判定性表述「${w}」，已改写为中性表述`,
        });
        basisClean = basisClean.split(w).join('暂无法确认是否具备');
        adviceClean = adviceClean.split(w).join('暂无法确认是否具备');
        promptClean = promptClean.split(w).join('暂无法确认是否具备');
      }
    }

    // 术语中文化：模型偶尔把内部枚举值写进依据里（如「按规则判为 unknown」），
    // 用户不知道这些词是什么意思，必须换成中文表述。
    const TERM_MAP = [
      [/\bunknown\b/g, '信息不足'],
      [/\bimprove\b/g, '待提升'],
      [/\bhave\b/g, '已有'],
      [/\brecheck_item\b/g, '待补充项'],
      [/\bimportance\b/g, '重要性'],
      [/\bevidence\b/g, '依据'],
    ];
    for (const [re, cn] of TERM_MAP) {
      basisClean = basisClean.replace(re, cn);
      adviceClean = adviceClean.replace(re, cn);
      promptClean = promptClean.replace(re, cn);
    }

    const cleanItem = {
      requirement,
      status,
      _downgradedForEvidence: downgradedForEvidence,
      evidence: status === 'have' ? evidenceText : '',
      basis: basisClean || '',
      advice: status === 'improve' ? adviceClean : '',
      prompt: status === 'unknown' ? promptClean : '',
      weight: clampWeight(it?.weight),
    };

    // improve 必须有具体建议
    if (cleanItem.status === 'improve' && !cleanItem.advice) {
      violations.push({ type: 'missing_advice', requirement, detail: '待提升但无具体建议，已降级为 unknown' });
      cleanItem.status = 'unknown';
      cleanItem.prompt = cleanItem.prompt || `请补充你在「${requirement}」方面做过的具体事情`;
    }

    // unknown 必须有具体补充问题
    if (cleanItem.status === 'unknown' && !cleanItem.prompt) {
      cleanItem.prompt = `你在「${requirement}」方面做过什么？哪怕只是课程作业里的一小部分。`;
    }

    items.push(cleanItem);
  }

  // 覆盖度校验：岗位要求每一条都要有对应结论
  const covered = new Set(items.map((i) => normalize(i.requirement)));
  for (const r of jd?.requirements || []) {
    const key = normalize(r?.item);
    if (key && !covered.has(key)) {
      items.push({
        requirement: String(r.item),
        status: 'unknown',
        evidence: '',
        basis: `岗位要求中列出了「${r.item}」，但分析未给出对应判断`,
        advice: '',
        prompt: `你在「${r.item}」方面做过什么？请补充。`,
        weight: clampWeight(r?.importance === 'required' ? 3 : 2),
      });
      violations.push({
        type: 'missing_item',
        requirement: String(r.item),
        detail: '岗位要求未被对照分析，已补为信息不足',
      });
    }
  }

  // 确定性规则：学历与专业背景由服务端直接判定，不交给模型。
  // 用户原文里写没写「计算机专业」「大三在读」是客观事实，模型每次判断可能不一致，
  // 但这类结论必须稳定 —— 否则同一份输入会给出不同的 have/unknown。
  applyDeterministicEducation(items, profile, jd, violations);

  // 工具技能：原文明确提到工具名 → 判已有（客观陈述，不交给模型推理）
  applyDeterministicToolSkills(items, profile, jd, violations);

  // 竞赛获奖：原文写了获奖 → 竞赛经历判已有（客观事实，不交给模型每次推理决定）
  applyDeterministicContest(items, profile, violations);

  // 逻辑冲突：依据承认具备却判 unknown → 改判已有
  applyBasisConsistency(items, violations, profileSources);

  const summary = {
    total: items.length,
    have: items.filter((i) => i.status === 'have').length,
    improve: items.filter((i) => i.status === 'improve').length,
    unknown: items.filter((i) => i.status === 'unknown').length,
  };

  const unmapped = Array.isArray(rawGap?.unmapped_items) ? rawGap.unmapped_items.map(String) : [];

  // 清理内部标记字段（不对外暴露）
  for (const it of items) delete it._downgradedForEvidence;

  // 按重要度降序排列 —— 最重要的能力差距必须排在最前面。
  // 稳定排序：权重相同的保持模型给出的相对顺序，避免每次结果乱跳。
  items.sort((a, b) => (b.weight || 0) - (a.weight || 0));

  return { items, summary, unmapped_items: unmapped, violations };
}

function clampWeight(w) {
  const n = Number(w);
  if (!Number.isFinite(n)) return 2;
  return Math.min(3, Math.max(1, Math.round(n)));
}

/**
 * 学历与专业背景：由服务端依据用户原文直接判定
 *
 * 「计算机专业大三在读」是客观事实，have / unknown 必须稳定。
 * 做法：在原始叙述文本里找专业关键词与年级关键词，找到即 have 并给出原文片段。
 * 专业是否「相关」按大类匹配表判定，不依赖模型每次推理一致。
 */
const MAJOR_CATEGORIES = {
  '计算机': ['计算机', '软件', '人工智能', '网络工程', '信息安全', '数据科学', '物联网'],
  '电子信息': ['电子', '通信', '自动化', '微电子', '光电'],
  '机械': ['机械', '车辆', '模具', '材料成型'],
  '土木': ['土木', '建筑', '工程管理', '给排水'],
  '经济': ['经济', '金融', '会计', '贸易', '财政', '税务'],
  '管理': ['管理', '工商管理', '物流', '市场营销', '电子商务', '人力资源'],
  '中文': ['汉语言', '中文', '新闻', '广告'],
  '外语': ['英语', '翻译', '日语', '德语', '法语'],
  '法学': ['法学', '法律', '知识产权'],
  '教育': ['教育', '师范', '学前教育'],
  '心理': ['心理', '应用心理'],
  '数学': ['数学', '统计', '应用统计'],
  '物理': ['物理', '光电'],
  '化学': ['化学', '化工', '材料'],
  '生物': ['生物', '药学', '医学', '护理', '生物工程'],
  '设计': ['设计', '视觉传达', '工业设计', '环境设计', '服装'],
  '传媒': ['传媒', '广播电视', '播音', '影视', '动画'],
  '哲学': ['哲学', '思政'],
  '历史': ['历史', '考古'],
  '艺术': ['音乐', '美术', '舞蹈', '表演'],
};

function detectMajor(text) {
  for (const [cat, words] of Object.entries(MAJOR_CATEGORIES)) {
    for (const w of words) {
      if (text.includes(w)) return { cat, word: w };
    }
  }
  return null;
}

/** 判断用户专业与 JD 要求的专业是否属于同一大类 */
function majorMatches(userMajorText, jdEvidence) {
  const u = detectMajor(userMajorText);
  if (!u) return null;
  const jdCats = new Set();
  for (const [cat, words] of Object.entries(MAJOR_CATEGORIES)) {
    if (words.some((w) => jdEvidence.includes(w))) jdCats.add(cat);
  }
  if (jdCats.size === 0) return null;  // JD 未列具体专业，不做判定
  return { matched: jdCats.has(u.cat), user: u, jdCats: [...jdCats] };
}

function applyDeterministicEducation(items, profile, jd, violations) {
  const haystack = [
    profile?.major || '',
    profile?.grade || '',
    ...(profile?.experiences || []).map((e) => e?.evidence || ''),
  ].join(' ');

  const MAJOR_RE = /([一-龥]{2,8}(?:专业|学院|系))/;
  const GRADE_RE = /(大一|大二|大三|大四|四年级|研一|研二|研三|研究生|本科在读|硕士|博士)/;

  const majorHit = haystack.match(MAJOR_RE);
  const gradeHit = haystack.match(GRADE_RE);

  for (const it of items) {
    const isMajor = /专业背景/.test(it.requirement);
    const isGrade = /学历|年级/.test(it.requirement);
    if (!isMajor && !isGrade) continue;

    if (isMajor) {
      // 专业相关与否按大类判定，JD 里列了具体专业才判
      const jdEvidence = (jd?.requirements || [])
        .filter((r) => /专业背景/.test(r.item))
        .map((r) => r.evidence || '').join(' ');
      const m = majorMatches(haystack, jdEvidence);
      if (m && m.matched) {
        setHave(it, m.user.word, `用户专业为「${m.user.word}」，与岗位要求的「${jdEvidence.slice(0, 30)}」属同一专业大类`, violations);
        continue;
      }
      if (m && !m.matched) {
        // 专业大类不同 → 明确不是「没有」，而是「信息不足」
        setHave(it, '', '', violations, {
          keep: true,
          status: 'unknown',
          basis: `用户专业为「${m.user.word}」，与岗位列出的专业大类（${m.jdCats.join('、')}）不同；这不等于你不具备该能力，需结合其他经历判断`,
          prompt: '虽然专业不同，但你在其他地方有过相关实践吗？比如课程、竞赛或兼职。',
        });
        continue;
      }
      if (majorHit) {
        setHave(it, majorHit[0], `用户原文明确提到「${majorHit[0]}」`, violations);
      }
      continue;
    }

    if (gradeHit) {
      setHave(it, gradeHit[0], `用户原文明确提到「${gradeHit[0]}」，满足岗位的学历年级门槛`, violations);
    }
  }
}

/* ---------- 竞赛经历确定性判定 ---------- */

/**
 * 竞赛获奖：原文写了获奖 → 「竞赛经历」判 have
 *
 * 背景：V2.0 修复后实测发现，模型对「竞赛经历」项的判定会抖动 ——
 * 同一份输入（用户明说「参加过学校程序设计竞赛，拿了个三等奖」）
 * 有时判 have、有时判 improve（理由是「技术竞赛与产品竞赛不对口」）。
 *
 * 获奖是客观事实，与岗位要求的竞赛类型是否对口是两件事：
 *   · 事实层：用户确实有竞赛获奖经历 → 竞赛经历项判 have（稳定）
 *   · 匹配层：竞赛类型是否对口 → 写在 basis 里说明，由用户自己判断
 *
 * 与学历/专业同样的处理思路：客观事实由服务端兜住，不由模型每次推理决定。
 */
function applyDeterministicContest(items, profile, violations) {
  const text = [
    profile?.major || '',
    ...(profile?.experiences || []).map((e) => `${e?.title || ''} ${e?.evidence || ''}`),
  ].join(' ');

  // 竞赛 + 获奖/名次 的组合
  const CONTEST_AWARD = /(参加|参与|获得|荣获|拿了?|获得过)?[^，。；\s]{0,12}(竞赛|比赛|大赛|挑战杯|竞赛获奖)[^，。；\s]{0,20}(一等奖|二等奖|三等奖|特等奖|优秀奖|获奖|冠军|亚军|季军|一等奖学金)/;
  const AWARD = /(一等奖|二等奖|三等奖|特等奖|优秀奖|冠军|亚军|季军|获奖)/;
  const CONTEST = /(竞赛|比赛|大赛|挑战杯)/;

  const hasContest = CONTEST.test(text);
  const hasAward = AWARD.test(text);
  if (!hasContest || !hasAward) return;

  for (const it of items) {
    if (!/竞赛/.test(it.requirement || '')) continue;
    if (it.status === 'have') continue;
    if (it._downgradedForEvidence) continue;

    // 找出原文里含竞赛获奖的那一句
    const sentence = String(text)
      .split(/[。\n；;]/)
      .map((s) => s.trim())
      .find((s) => CONTEST.test(s) && AWARD.test(s));
    if (!sentence) continue;

    setHave(
      it,
      sentence,
      `你在经历中明确提到「${sentence.slice(0, 40)}」，有竞赛获奖经历；竞赛类型与岗位要求的对口程度可结合具体岗位判断`,
      violations,
      null,
      'deterministic_contest'
    );
  }
}

/* ---------- 工具技能确定性判定 ---------- */

/**
 * 常见设计/开发工具名
 *
 * 用户原文里明确提到工具名（「会用 Canva」「学过基础的 PS」），
 * 对应的能力项就该判 have —— 这是客观陈述，不该由模型每次推理决定。
 */
const TOOL_KEYWORDS = {
  'canva': 'Canva',
  'photoshop': 'Photoshop',
  'ps': 'PS',
  'figma': 'Figma',
  'axure': 'Axure',
  'sketch': 'Sketch',
  '墨刀': '墨刀',
  'illustrator': 'Illustrator',
  'ai': 'Illustrator',
  'premiere': 'Premiere',
  '剪映': '剪映',
  'pr': 'Premiere',
  'xd': 'XD',
  'vscode': 'VS Code',
  'pycharm': 'PyCharm',
  'idea': 'IntelliJ IDEA',
  'webstorm': 'WebStorm',
  'eclipse': 'Eclipse',
  'mysql': 'MySQL',
  'postgresql': 'PostgreSQL',
  'redis': 'Redis',
  'mongodb': 'MongoDB',
  'docker': 'Docker',
  'git': 'Git',
  'excel': 'Excel',
  'sql': 'SQL',
  'python': 'Python',
  'java': 'Java',
  'golang': 'Go',
};

/**
 * 工具技能：原文提到工具名 → 对应能力项判 have
 *
 * 只在能力项名称本身指向该工具时才生效（如「视觉设计能力」对应 Canva/PS）。
 * 避免把「Java」误判到不相关的能力项上。
 */
function applyDeterministicToolSkills(items, profile, jd, violations) {
  // 汇总用户提到的工具
  const userText = [
    profile?.major || '',
    ...(profile?.skills || []),
    ...(profile?.experiences || []).map((e) => `${e?.title || ''} ${e?.evidence || ''}`),
  ].join(' ');

  const mentioned = [];
  for (const [key, label] of Object.entries(TOOL_KEYWORDS)) {
    // PS / AI / PR 这类缩写需要边界，避免匹配到普通单词里
    const isShort = key.length <= 3;
    const re = isShort
      ? new RegExp(`(^|[^A-Za-z])${key}([^A-Za-z]|$)`, 'i')
      : new RegExp(key, 'i');
    if (re.test(userText)) mentioned.push(label);
  }
  if (!mentioned.length) return;

  for (const it of items) {
    if (it.status !== 'unknown' && it.status !== 'improve') continue;
    // 因证据无法回指而被降级的条目，不得改回 have
    if (it._downgradedForEvidence) continue;

    // 找到与该能力项相关的 JD 证据里提到的工具
    const jdEvidence = (jd?.requirements || [])
      .filter((r) => r.item === it.requirement)
      .map((r) => r.evidence || '')
      .join(' ');
    const hay = it.requirement + ' ' + jdEvidence;

    const hit = mentioned.find((label) => {
      const short = label.length <= 3;
      const re = short
        ? new RegExp(`(^|[^A-Za-z])${label}([^A-Za-z]|$)`, 'i')
        : new RegExp(label, 'i');
      return re.test(hay);
    });
    if (!hit) continue;

    // ⚠️ 工具名必须真的指向「这项能力」——
    //    不能只看工具名出现在 JD 证据里，因为证据可能张冠李戴。
    //
    //    实测误判（T1）：JD 的「大模型 API 调用实践经验」这条要求，
    //    证据写的是「熟悉 MySQL 或 Redis 等常用数据库」（模型标错了能力类型），
    //    MySQL 命中了证据里的工具名，把「大模型 API 经验」判成了已有。
    //
    //    判据：工具名要么出现在能力项名称里（如「原型工具使用」对应 Figma），
    //    要么出现在该能力项的 JD 证据里、且该证据与能力项方向相符
    //    （如「视觉设计能力」对应证据里的 Canva/PS）。
    //    两者都不满足 → 工具与这项能力无关，不能据此判 have。
    const itemHasTool = (() => {
      const short = hit.length <= 3;
      const re = short
        ? new RegExp(`(^|[^A-Za-z])${hit}([^A-Za-z]|$)`, 'i')
        : new RegExp(hit, 'i');
      return re.test(String(it.requirement || ''));
    })();

    // 证据与能力项方向是否相符（概括名用领域词表，具体名用词元重叠）
    const domainOk = evidenceMatchesRequirement(jdEvidence, it.requirement);

    if (!itemHasTool && !domainOk) {
      violations.push({
        type: 'tool_skill_mismatch',
        requirement: it.requirement,
        detail: `工具「${hit}」与该能力项无对应关系，未据此判定为已有`,
      });
      continue;
    }

    setHave(
      it,
      hit,
      `你在经历里明确提到用过「${hit}」，对应岗位要求的这项工具能力`,
      violations,
      null,
      'deterministic_tool_skill'
    );
  }
}

/* ---------- 逻辑冲突检测 ---------- */

/**
 * 检测「依据承认具备，但结论判 unknown」的自相矛盾
 *
 * 实测案例（原始设计）：
 *   依据：「用户技能中明确列出 Canva 和基础 PS，与岗位要求的 Canva、Photoshop 等设计工具…」
 *   结论：unknown
 *
 * 依据里已经承认了，结论却说不具备 —— 这是模型的自相矛盾，
 * 服务端必须兜住，否则同一份输入会给出不同的 have/unknown。
 *
 * ⚠️ 实测发现的误判（V1.0 缺陷 D2）：
 *   T5「数据跟踪与迭代优化」依据原文：
 *   「岗位要求熟练使用 Excel 等办公软件并具备基础数据处理能力…；
 *     经历档案中提到整理简历、跟进入职流程，但未说明是否使用 Excel 做过数据统计…，
 *     按规则判为信息不足。」
 *
 *   问题一：ADMIT 命中的是「岗位要求…具备」—— 那是 JD 的要求，不是用户的能力。
 *           一句依据里同时描述了岗位要求与用户实况，光看关键词分不清在说谁。
 *   问题二：DENY 没覆盖「未说明」这种表述（只覆盖了「没有说明」），漏判。
 *   问题三：改判 have 时把证据填成字符串「依据中已明确说明」——
 *           那不是用户说的话，却因为子串匹配而混过了证据回指校验。
 *
 * 修法（三处同时改）：
 *   ① 拆分依据：只拿描述「用户经历」的那部分做判定，描述「岗位要求」的部分排除
 *   ② DENY 补齐「未说明 / 未提到 / 未提及 / 未提供 / 判为」等否定与收尾表述
 *   ③ 改判 have 时必须给出真实的用户原文片段；找不到就不改判
 */
function applyBasisConsistency(items, violations, profileSources = []) {
  // 承认句式（描述用户具备）
  const ADMIT = /(明确列出|明确提到|明确写了|明确包含|已有|已经掌握|具备|做过|使用过|用过|会使用|熟悉|熟练使用|有使用经验|有.{0,6}经验)/;
  // 否认/不确定/收尾句式（优先级更高，命中则不改判）
  const DENY = /(无法判断|不能判断|暂无法确认|无法确认|不能确定|不明确|没有提到|未提及|未说明|没有说明|未提供|没有提供|未体现|没有体现|看不出|不明|无相关|没有任何|判为|信息不足|暂无法确认)/;

  for (const it of items) {
    if (it.status !== 'unknown') continue;
    // 因证据无法回指而被降级的条目，不得改回 have ——
    // 证据校验的优先级高于逻辑一致性校验。
    if (it._downgradedForEvidence) continue;
    const basis = String(it.basis || '');
    if (!basis) continue;

    // ① 只看描述「用户经历」的半句。依据通常是「岗位要求 X…；用户经历中…，
    //    但未说明…」这种结构，ADMIT 命中的往往是前半句的岗位要求。
    //    切分策略：找到最后一个分号/句号，只取描述用户实况的那一段。
    const userPart = splitUserExperiencePart(basis);
    if (DENY.test(basis) || DENY.test(userPart)) continue;
    if (!ADMIT.test(userPart)) continue;

    // ③ 改判 have 必须给出真实的用户原文片段 —— 找不到就不改判。
    //    「依据中已明确说明」这类元话语绝不能当证据。
    const realEvidence = findRealEvidence(userPart, profileSources);
    if (!realEvidence) {
      violations.push({
        type: 'basis_consistency_skipped',
        requirement: it.requirement,
        detail: `判断依据承认已具备，但找不到对应的用户原文片段，维持信息不足`,
      });
      continue;
    }

    // 依据承认具备 → 改判 have，并清掉追问
    it.status = 'have';
    it.evidence = realEvidence;
    it.advice = '';
    it.prompt = '';
    violations.push({
      type: 'basis_consistency',
      requirement: it.requirement,
      detail: `判断依据承认已具备但结论标为信息不足，已改判为已有`,
    });
  }
}

/**
 * 从依据里切出描述「用户经历」的那一段。
 *
 * 依据的典型结构是「岗位要求熟练使用 Excel…；经历档案中提到…但未说明…」，
 * 承认句式往往落在前半段（说的是 JD），否定句式落在后半段（说的是用户实况）。
 * 按分号与句号切分后取最后一段，能有效把两者分开。
 */
function splitUserExperiencePart(basis) {
  const parts = String(basis)
    .split(/[；;。\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return basis;
  // 取最后一段：结论通常落在最后
  return parts[parts.length - 1];
}

/**
 * 在用户原文中找一段能支撑该结论的片段。
 *
 * 不能用整句词元重叠率来判 —— 依据里常有一堆与原文无关的描述词
 * （如「与岗位要求的设计工具匹配」），会把分母稀释掉，
 * 导致真正相关的原文反而匹配不上。
 *
 * 做法：先用承认词定位「用户声称具备的具体东西」，
 * 再去原文里找包含这个东西的片段。
 */
function findRealEvidence(userPart, profileSources) {
  if (!profileSources || profileSources.length === 0) return '';

  // 1) 从依据里抽出被承认的具体事物 —— 承认词后面的名词短语
  const ACQUIRED = /(?:明确列出|明确提到|明确写了|明确包含|已有|已经掌握|具备|做过|使用过|用过|会使用|熟悉|熟练使用)(?:了)?\s*([^，,。；;、的]{2,20})/g;
  const candidates = [];
  let m;
  while ((m = ACQUIRED.exec(userPart)) !== null) {
    const phrase = String(m[1] || '').trim();
    if (phrase.length >= 2) candidates.push(phrase);
  }
  // 去掉「基础」这类修饰词，保留核心名词
  let core = candidates.map((c) => c.replace(/^(基础|一些|一点|相关的|相应的)/, '')).filter(Boolean);
  // 并列名词要拆开：「用过 Canva 和基础 PS」→ 「用过canva」「和基础ps」
  core = core.flatMap((c) => c.split(/和|以及|、|及/).map((x) => x.trim()).filter(Boolean));
  // 去掉残留的前置动词与修饰词
  core = core
    .map((c) => c.replace(/^(用过|使用过|做过|具备|熟悉|熟练使用|会使用|明确列出|明确提到|了)/, ''))
    .map((c) => c.replace(/^(基础|一些|一点|相关的|相应的)/, ''))
    .filter((c) => c.length >= 2);

  // 2) 用这些名词去原文里找对应片段
  for (const key of core) {
    const k = normalize(key);
    if (!k) continue;
    for (const src of profileSources) {
      const text = String(src || '').trim();
      if (!text) continue;
      if (normalize(text).includes(k)) return text;
    }
  }

  // 3) 兜底：若依据里没有抽出具体名词，用词元重叠率找，但要按「命中数」而非比例
  if (core.length === 0) {
    const want = tokenize(normalize(userPart));
    if (want.size === 0) return '';
    let best = '';
    let bestHit = 0;
    for (const src of profileSources) {
      const text = String(src || '').trim();
      if (!text) continue;
      const t = tokenize(normalize(text));
      let hit = 0;
      for (const x of want) if (t.has(x)) hit++;
      if (hit > bestHit) { bestHit = hit; best = text; }
    }
    return bestHit >= 2 ? best : '';
  }
  return '';
}

function setHave(it, evidence, basis, violations, override = null, ruleType = 'deterministic_education') {
  const had = it.status;
  if (override && override.keep) {
    it.status = override.status;
    it.evidence = '';
    it.basis = override.basis;
    it.advice = '';
    it.prompt = override.prompt;
  } else {
    it.status = 'have';
    it.evidence = evidence || it.evidence;
    it.basis = basis || it.basis;
    it.advice = '';
    it.prompt = '';
  }
  if (had !== it.status) {
    violations.push({
      type: ruleType,
      requirement: it.requirement,
      detail: `结论改由原文判定为 ${it.status}（原为 ${had}）`,
    });
  }
}

/**
 * 判断一段依据是否指向差距报告中的真实条目。
 *
 * 比证据回指更严格：要求与某个 requirement 存在明确的词元重叠，
 * 避免「撰写 PRD」这类简化写法蒙混过关，也避免「提升算法能力」这类
 * 完全无关的措辞被放行。
 */
export function isBasisTraceable(basis, gapRequirements) {
  const b = normalize(basis);
  if (!b) return false;
  const bTokens = tokenize(b);
  if (bTokens.size === 0) return false;

  for (const req of gapRequirements) {
    const rTokens = tokenize(normalize(req));
    if (rTokens.size === 0) continue;
    // 取交集比例最高的那个差距项
    let hit = 0;
    for (const t of bTokens) {
      if (rTokens.has(t)) hit++;
    }
    // 依据与差距项至少共享一个实词，且占依据实词的 40% 以上
    if (hit >= 1 && hit / bTokens.size >= 0.4) return true;
  }
  return false;
}

/** 中文按 2-3 字滑窗切词，英文数字按单词切 */
function tokenize(s) {
  const tokens = new Set();
  const latin = s.match(/[a-z0-9]+/gi) || [];
  for (const w of latin) if (w.length >= 2) tokens.add(w.toLowerCase());
  const cn = s.replace(/[^一-龥]/g, '');
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= cn.length; i++) {
      const seg = cn.slice(i, i + n);
      if (!STOPWORDS.has(seg)) tokens.add(seg);
    }
  }
  return tokens;
}

const STOPWORDS = new Set([
  '的', '了', '和', '与', '及', '或', '等', '在', '是', '有', '个', '并', '对', '与',
  '能力', '经验', '相关', '以及', '要求', '进行', '能够', '可以', '需要', '方面',
]);

/**
 * 校验行动计划：四要素齐全、时间不超限、依据指向真实差距条目
 */
export function validateActionPlan(rawPlan, gapReport, weeklyHours) {
  const violations = [];
  const gapItems = gapReport?.items || [];
  const gapRequirements = new Set(gapItems.map((g) => g.requirement));
  const budget = Math.max(2, Math.min(60, Number(weeklyHours) || 10)) * 2;

  const rawTasks = Array.isArray(rawPlan?.tasks) ? rawPlan.tasks : [];
  const tasks = [];

  for (const t of rawTasks) {
    const title = String(t?.title || '').trim();
    const expected_output = String(t?.expected_output || '').trim();
    const completion_criteria = String(t?.completion_criteria || '').trim();
    const basis = String(t?.basis || '').trim();

    if (!title || !expected_output || !completion_criteria || !basis) {
      violations.push({
        type: 'incomplete_task',
        detail: `任务「${title.slice(0, 30) || '未命名'}」四要素不全，已丢弃`,
      });
      continue;
    }

    // 依据必须指向差距报告里的真实条目
    if (gapRequirements.size > 0 && !isBasisTraceable(basis, [...gapRequirements])) {
      violations.push({
        type: 'orphan_task',
        detail: `任务「${title.slice(0, 30)}」的依据「${basis.slice(0, 30)}」不在差距报告中，已丢弃`,
      });
      continue;
    }

    // 低质任务过滤：模型偶尔会退化成「写自查清单」「整理成说明」这类无产出任务。
    // 这些任务占用了用户的时间预算，却不产生任何能写进简历的东西。
    if (isLowValueTask(title, expected_output)) {
      violations.push({
        type: 'low_value_task',
        detail: `任务「${title.slice(0, 30)}」只产出自查/清单类材料，不产生可用成果，已丢弃`,
      });
      continue;
    }

    const priority = ['P0', 'P1', 'P2'].includes(t?.priority) ? t.priority : 'P1';
    const week = Number(t?.week) === 2 ? 2 : 1;
    const estimated_hours = clampHours(t?.estimated_hours);

    tasks.push({
      title,
      detail: String(t?.detail || '').trim(),
      priority,
      week,
      expected_output,
      completion_criteria,
      basis,
      estimated_hours,
    });
  }

  // 时间预算：按 P0→P1→P2 裁剪
  const order = { P0: 0, P1: 1, P2: 2 };
  tasks.sort((a, b) => order[a.priority] - order[b.priority]);
  let total = tasks.reduce((s, t) => s + t.estimated_hours, 0);
  let trimmedCount = 0;
  while (total > budget && tasks.length > 0) {
    const idx = tasks.map((t) => order[t.priority]).lastIndexOf(2);
    const dropIdx = idx >= 0 ? idx : tasks.length - 1;
    const [dropped] = tasks.splice(dropIdx, 1);
    total -= dropped.estimated_hours;
    trimmedCount++;
    violations.push({
      type: 'trimmed',
      detail: `任务「${dropped.title.slice(0, 30)}」超出可投入时间，已按 P0→P2 裁剪`,
    });
  }

  // 单周预算均衡
  //
  // 总时长受控还不够 —— 用户第一周要干的活超出他能投入的时间，
  // 计划就落不了地。这里保证：
  //   1) 单周时长 ≤ 该周预算（总预算的一半）
  //   2) 每周任务数 ≤ 5（保证可完成，不产生压迫感）
  //
  // 优先「挪到另一周」，挪不过去才裁剪（保留信息量更大的任务）。
  const weekBudget = budget / 2;
  const MAX_TASKS_PER_WEEK = 5;

  for (let pass = 0; pass < 3; pass++) {
    let changed = false;

    for (const w of [1, 2]) {
      const inWeek = tasks.filter((t) => t.week === w);
      if (!inWeek.length) continue;
      const other = w === 1 ? 2 : 1;

      // 规则 1：单周时长超预算 → 优先把最不重要的挪到另一周
      let weekHours = inWeek.reduce((s, t) => s + t.estimated_hours, 0);
      while (weekHours > weekBudget && inWeek.length > 1) {
        // 找该周优先级最低、时长最长的任务
        let moveIdx = -1;
        for (let i = inWeek.length - 1; i >= 0; i--) {
          if (order[inWeek[i].priority] === 2) { moveIdx = i; break; }
        }
        if (moveIdx < 0) {
          for (let i = inWeek.length - 1; i >= 0; i--) {
            if (order[inWeek[i].priority] === 1) { moveIdx = i; break; }
          }
        }
        if (moveIdx < 0) break;

        const [moved] = inWeek.splice(moveIdx, 1);
        const target = tasks.filter((t) => t.week === other);
        const otherHours = target.reduce((s, t) => s + t.estimated_hours, 0);
        // 只有挪过去不会让另一周超预算时才挪
        if (otherHours + moved.estimated_hours > weekBudget) break;

        moved.week = other;
        weekHours -= moved.estimated_hours;
        changed = true;
        violations.push({
          type: 'week_rebalanced',
          detail: `任务「${moved.title.slice(0, 30)}」第 ${w} 周超出可投入时间，已移到第 ${other} 周`,
        });
      }

      // 规则 2：每周任务数过多 → 多余的挪到另一周
      const overCount = inWeek.length - MAX_TASKS_PER_WEEK;
      if (overCount > 0) {
        const target = tasks.filter((t) => t.week === other);
        let moved = 0;
        for (let i = inWeek.length - 1; i >= 0 && moved < overCount; i--) {
          if (order[inWeek[i].priority] === 2) {
            inWeek[i].week = other;
            moved++;
            changed = true;
          }
        }
        if (moved > 0) {
          violations.push({
            type: 'week_rebalanced',
            detail: `第 ${w} 周任务数超过 ${MAX_TASKS_PER_WEEK} 条，已匀出 ${moved} 条到第 ${other} 周`,
          });
        }
      }
    }

    if (!changed) break;
  }

  // 均衡后仍超单周预算（挪不动的情况）→ 裁剪掉超出的部分
  for (const w of [1, 2]) {
    let weekTasks = tasks.filter((t) => t.week === w);
    let weekHours = weekTasks.reduce((s, t) => s + t.estimated_hours, 0);
    while (weekHours > weekBudget && weekTasks.length > 1) {
      // 裁掉该周优先级最低、时长最长的
      let dropIdx = -1;
      for (let i = weekTasks.length - 1; i >= 0; i--) {
        if (order[weekTasks[i].priority] === 2) { dropIdx = i; break; }
      }
      if (dropIdx < 0) dropIdx = weekTasks.length - 1;
      const [dropped] = weekTasks.splice(dropIdx, 1);
      const gi = tasks.indexOf(dropped);
      if (gi >= 0) tasks.splice(gi, 1);
      weekHours -= dropped.estimated_hours;
      total -= dropped.estimated_hours;
      trimmedCount++;
      violations.push({
        type: 'trimmed',
        detail: `任务「${dropped.title.slice(0, 30)}」第 ${w} 周超出可投入时间，已裁剪`,
      });
    }
  }

  // 重新按优先级排序，并把周次归位（第一周的任务在前）
  tasks.sort((a, b) => order[a.priority] - order[b.priority]);
  total = tasks.reduce((s, t) => s + t.estimated_hours, 0);

  const uncovered = Array.isArray(rawPlan?.uncovered) ? rawPlan.uncovered.map(String) : [];

  return {
    tasks,
    total_hours: total,
    estimated_hours: total,
    trimmed_count: trimmedCount + (Number(rawPlan?.trimmed_count) || 0),
    trimmed_note: trimmedCount > 0
      ? `已按你的可投入时间裁剪 ${trimmedCount} 个任务`
      : String(rawPlan?.trimmed_note || ''),
    uncovered,
    violations,
  };
}

function clampHours(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(4, Math.round(n * 10) / 10);
}

/**
 * 低质任务判定
 *
 * 模型偶尔会退化成「写自查清单」「整理一份说明」这类任务 ——
 * 它们占用了用户的时间预算，却不产生任何能写进简历、能拿去面试的东西。
 *
 * 判定规则（刻意保守，宁可放过也不误杀）：
 *   1. 标题里出现「自查/检查表/盘点」等词 —— 这类本身就是元任务
 *   2. 标题是「整理/汇总/回填」类动作，且产出物是「说明/清单/笔记」类
 *
 * 例外：产出物里带具体交付物（案例、文档、原型、稿、数据）的一律放过 ——
 * 「把 3 个关键动作改写成 STAR 案例」是有价值的，不该被误杀。
 */
export function isLowValueTask(title, expectedOutput) {
  const t = String(title || '');
  const o = String(expectedOutput || '');
  const combined = t + ' ' + o;

  // 规则 0：产出物里有具体可交付的东西 → 放过
  const hasDeliverable =
    /案例|文档|原型|稿|作品|简历|作品集|话术|讲稿|数据|表格|清单页|说明书|方案|报告/.test(combined);
  if (hasDeliverable && !/自查|检查表|盘点表/.test(t)) return false;

  // 规则 1：元任务关键词
  if (/自查|检查表|盘点|复盘表|回顾表|盘点表/.test(t)) return true;

  // 规则 2：整理类动作 + 非交付型产出
  const isOrganize = /^(整理|汇总|归纳|梳理成|回填|补写|写出).*(说明|笔记|清单|列表)?$/.test(t) ||
    /整理成一份|汇总成一份|归纳成/.test(t);
  const isMetaOutput = /说明|笔记|清单|列表|自述|回顾/.test(o);
  if (isOrganize && isMetaOutput) return true;

  return false;
}

/** 归一化经历档案 */
export function validateProfile(raw) {
  const p = raw || {};
  return {
    major: String(p.major || '').trim(),
    grade: String(p.grade || '').trim(),
    skills: Array.isArray(p.skills) ? p.skills.map((s) => String(s).trim()).filter(Boolean) : [],
    experiences: (Array.isArray(p.experiences) ? p.experiences : []).map((e) => ({
      title: String(e?.title || '').trim(),
      role: String(e?.role || '').trim(),
      evidence: String(e?.evidence || '').trim(),
      implied_ability: String(e?.implied_ability || '').trim(),
    })).filter((e) => e.title || e.role || e.evidence),
    interests: Array.isArray(p.interests) ? p.interests.map((s) => String(s).trim()).filter(Boolean) : [],
    missing_fields: (Array.isArray(p.missing_fields) ? p.missing_fields : []).map((m) => ({
      field: String(m?.field || '').trim(),
      prompt: String(m?.prompt || '').trim(),
    })).filter((m) => m.field),
  };
}

/**
 * 能力类型 → 规范中文名（服务端查表，保证同输入同输出）
 * 顺序即优先级：先精确匹配，再包含匹配
 */
const ABILITY_CANON = {
  '需求调研': '用户需求调研',
  '用户研究': '用户研究',
  '功能设计': '功能设计与迭代',
  'PRD撰写': '产品需求文档（PRD）撰写',
  '跨团队协作': '跨团队推动落地',
  '数据分析': '数据跟踪与迭代优化',
  '逻辑思考': '逻辑思考能力',
  '表达沟通': '结构化表达能力',
  '原型工具': '原型工具使用',
  '大模型API': '大模型 API 调用实践经验',
  '专业背景': '相关专业背景',
  '学历门槛': '学历与年级门槛',
  '竞赛经历': '竞赛经历',
  '校园活动': '校园活动组织经历',
  '自媒体运营': '自媒体运营经验',
  '文案能力': '文案能力',
  '选题策划': '选题策划能力',
  '增长运营': '增长与用户运营',
  '项目管理': '项目推进能力',
  '设计能力': '视觉设计能力',
  '视频剪辑': '视频内容制作能力',
  '英语能力': '英语能力',
  '新媒体运营': '新媒体运营经验',
};

/**
 * 归一化岗位能力清单
 *
 * 关键：能力项名称必须稳定可复现（AC-50）。
 * 模型对同一条要求的措辞每次都不同（「需求调研」/「AI 产品需求调研与功能设计」），
 * 因此以模型选定的 ability_type 为准，由服务端查表合成 item —— 名称由代码决定，不由模型决定。
 */
/**
 * 分类归一化
 *
 * 学历/专业类要求的分类必须由服务端决定 ——
 * 模型有时把「相关专业背景」标成 plus_skill、
 * 有时把「学历与年级门槛」标成 must_skill，
 * 导致 JD 的四类能力分类在多次调用间摇摆。
 */
function normalizeCategory(item, modelCategory, validCat) {
  const s = String(item || '');
  // 学历 / 年级 / 专业 / 背景类 → 固定 major_req
  if (/学历|年级|学位|专业|背景|科系|院校/.test(s)) return 'major_req';
  return validCat.has(modelCategory) ? modelCategory : 'duty';
}

/**
 * 重要性归一化
 *
 * 学历/年级门槛是硬性要求（required）——
 * 不满足就是进不了面试，模型有时会误标成加分项。
 */
function normalizeImportance(item, modelImportance) {
  const s = String(item || '');
  if (/学历|年级|学位/.test(s)) return 'required';
  return modelImportance === 'plus' ? 'plus' : 'required';
}

export function validateJdProfile(raw, jdText = '') {
  const j = raw || {};
  const validCat = new Set(['duty', 'must_skill', 'plus_skill', 'major_req']);

  const requirements = (Array.isArray(j.requirements) ? j.requirements : [])
    .map((r) => {
      const abilityType = String(r?.ability_type || '').trim();
      const rawItem = String(r?.item || '').trim();
      const rawEvidence = String(r?.evidence || '').trim();
      // ability_type 缺失时，从 item 文本反查规范名 —— 模型偶尔会漏掉该字段，
      // 直接用 item 兜底会导致同一能力在不同次调用中名称不一致。
      let canon = canonFromType(abilityType) || canonFromItem(rawItem);

      // ⚠️ 防名实分离：模型可能给错 ability_type 或 item，
      //    把「熟悉 MySQL」这条要求标成了「大模型 API 调用实践经验」，
      //    证据却还挂着 MySQL 那句 —— 名实分离。
      //
      //    证据是 JD 原文，比模型给的名字可靠。所以证据撑不住这个规范名时：
      //    ① 先用证据反查规范名（多数情况能查到真名）
      //    ② 查不到就直接用证据原文当 item —— 宁可名字不规范，
      //       也不能让一条真实要求挂在一个不相干的能力名下面。
      let item = canon;
      // ability_type 只在 item 保持为规范名时才可信；
      // 一旦 item 改用别的名字，原 type 就不再对应，清空避免下游误判
      let finalType = canon ? abilityType : '';
      if (canon && !canonMatchesEvidence(canon, rawEvidence)) {
        const canonFromEvidence = canonFromItem(rawEvidence);
        item = canonFromEvidence || (rawEvidence || rawItem);
        finalType = canonFromEvidence ? abilityType : '';
      }
      if (!item) item = rawItem;
      return {
        item,
        ability_type: finalType,
        // 分类归一化：学历/专业类由服务端决定，不采信模型 ——
        // 模型有时把「相关专业背景」标成 plus_skill、
        // 有时把「学历与年级门槛」标成 must_skill，导致四类分类不稳定。
        category: normalizeCategory(item, r?.category, validCat),
        importance: normalizeImportance(item, r?.importance),
        evidence: String(r?.evidence || '').trim(),
      };
    })
    .filter((r) => r.item);

  // 同能力类型去重：合并证据
  const merged = new Map();
  for (const r of requirements) {
    const key = r.item;
    const exist = merged.get(key);
    if (exist) {
      if (r.evidence && !exist.evidence.includes(r.evidence)) {
        exist.evidence = `${exist.evidence}；${r.evidence}`;
      }
      continue;
    }
    merged.set(key, { ...r });
  }

  const ambiguousRaw = (Array.isArray(j.ambiguous) ? j.ambiguous : [])
    .map((r) => ({
      item: String(r?.item || '').trim(),
      evidence: String(r?.evidence || '').trim(),
    }))
    .filter((r) => r.item);

  // 确定性规则：学历/年级类硬门槛统一归并为「学历与年级门槛」一项。
  // 模型可能这次列为独立项、下次并进专业背景或放进 ambiguous，导致条目漂移，这里由代码兜住。
  const EDU = /本科|硕士|博士|大专|及以上|在读|在校|年级|学历|学位/;
  const merged2 = [];
  let eduItem = null;
  const absorbEdu = (evidence) => {
    if (!eduItem) {
      eduItem = {
        item: ABILITY_CANON['学历门槛'],
        ability_type: '学历门槛',
        category: 'major_req',
        importance: 'required',
        evidence: evidence || '',
      };
    } else if (evidence && !eduItem.evidence.includes(evidence)) {
      eduItem.evidence = `${eduItem.evidence}；${evidence}`;
    }
  };

  for (const r of [...merged.values()]) {
    // 只按能力类型判定是否学历项 —— 不能用证据文本里的偶然词，
    // 否则「计算机、信息管理、心理学等相关专业优先」这条会被证据里的「在读」误吞。
    const isEduType = r.ability_type === '学历门槛' || r.item === ABILITY_CANON['学历门槛'];
    const eduEvidenceOnly = !r.ability_type && EDU.test(r.evidence) && !/专业/.test(r.evidence);
    if (eduEvidenceOnly && !isEduType) {
      absorbEdu(r.evidence);
      continue;
    }
    merged2.push(r);
  }

  // ambiguous 里的学历条件同样吸收进来（专业相关的除外）
  const ambiguous = [];
  let majorEvidence = '';
  for (const a of ambiguousRaw) {
    const isMajor = /专业/.test(a.item) || /专业/.test(a.evidence);
    if (!isMajor && EDU.test(a.evidence)) {
      absorbEdu(a.evidence);
      continue;
    }
    if (isMajor) {
      // JD 明确写了专业相关要求，却因措辞模糊被模型放进 ambiguous ——
      // 这类不该丢，服务端把它还原成「相关专业背景」一项，保证条目集合稳定。
      majorEvidence = majorEvidence || a.evidence;
      continue;
    }
    ambiguous.push(a);
  }
  if (eduItem) merged2.push(eduItem);
  if (majorEvidence && !merged2.some((r) => r.item === ABILITY_CANON['专业背景'])) {
    merged2.push({
      item: ABILITY_CANON['专业背景'],
      ability_type: '专业背景',
      category: 'major_req',
      importance: 'plus',
      evidence: majorEvidence,
    });
  }

  // 兜底：JD 原文明确写了专业相关要求，但模型完全没输出这一项 → 从原文兜住
  const jdMentionsMajor = /专业|科系|背景/.test(jdText);
  if (jdMentionsMajor && !merged2.some((r) => r.item === ABILITY_CANON['专业背景'])) {
    const m = jdText.match(/[^。；;\n]{0,30}(?:相关专业|相关(?:专业|背景)|专业优先|专业要求)[^。；;\n]{0,30}/);
    merged2.push({
      item: ABILITY_CANON['专业背景'],
      ability_type: '专业背景',
      category: 'major_req',
      importance: 'plus',
      evidence: (m ? m[0] : '').trim() || 'JD 中提及专业要求',
    });
  }

  // 兜底：JD 原文写了「结构化表达」但模型只输出了同句里的前半项（如「逻辑思考」），
  // 这类复合要求必须补全，否则条目集合会随模型波动。
  if (/结构化表达|表达能力|沟通表达/.test(jdText)
      && !merged2.some((r) => r.item === ABILITY_CANON['表达沟通'])) {
    const m = jdText.match(/[^。；;\n]{0,30}(?:结构化表达|表达能力|沟通表达)[^。；;\n]{0,30}/);
    merged2.push({
      item: ABILITY_CANON['表达沟通'],
      ability_type: '表达沟通',
      category: 'must_skill',
      importance: 'required',
      evidence: (m ? m[0] : '').trim() || 'JD 中提及表达能力要求',
    });
  }

  // 兜底：JD 原文有学历/年级门槛但模型完全没提 → 从原文兜住
  if (/本科及以上|硕士及以上|及以上在读|在读|学历/.test(jdText)
      && !merged2.some((r) => r.item === ABILITY_CANON['学历门槛'])) {
    const m = jdText.match(/[^。；;\n]{0,30}(?:本科及以上|硕士及以上|及以上在读|在读|学历[^。；;\n]{0,10})[^。；;\n]{0,20}/);
    merged2.push({
      item: ABILITY_CANON['学历门槛'],
      ability_type: '学历门槛',
      category: 'major_req',
      importance: 'required',
      evidence: (m ? m[0] : '').trim() || 'JD 中提及学历要求',
    });
  }

  return {
    role_name: String(j.role_name || '').trim(),
    requirements: merged2,
    ambiguous,
    job_summary: String(j.job_summary || '').trim(),
  };
}

/** 从 ability_type 查规范名 */
function canonFromType(type) {
  const t = String(type || '').trim();
  if (!t) return '';
  if (ABILITY_CANON[t]) return ABILITY_CANON[t];
  const norm = t.replace(/[\s]/g, '').toLowerCase();
  for (const [k, v] of Object.entries(ABILITY_CANON)) {
    const kn = k.replace(/[\s]/g, '').toLowerCase();
    if (norm === kn || norm.includes(kn) || kn.includes(norm)) return v;
  }
  return '';
}

/**
 * 从模型给的 item 文本反查规范名。
 * 按规范名长度倒序匹配，优先匹配更具体的（如「新媒体运营经验」先于「文案能力」）。
 */
function canonFromItem(item) {
  const s = String(item || '').trim();
  if (!s) return '';
  const entries = Object.entries(ABILITY_CANON).sort((a, b) => b[1].length - a[1].length);
  for (const [k, v] of entries) {
    if (s.includes(k) || s.includes(v)) return v;
  }
  return '';
}

/**
 * 规范名与证据是否对应 —— 防「名实分离」。
 *
 * ⚠️ 实测缺陷（V1.0 → V2.0 修复过程中发现）：
 *   模型解析 JD 时给了一条真实要求「熟悉 MySQL 或 Redis 等常用数据库」，
 *   但 ability_type 填成了「大模型API」，
 *   于是 item 被规范化成「大模型 API 调用实践经验」，
 *   而 evidence 仍然是「熟悉 MySQL 或 Redis 等常用数据库」——
 *   名实分离。
 *
 *   后果：这条要求变成了「大模型 API 经验」，
 *   工具技能规则看到 MySQL 就判 have，
 *   用户看到的是「大模型 API 调用经验 = 已有，证据 MySQL」。
 *
 * 判据：evidence 必须与规范名有实词重叠，或自身就是岗位原文里的一项独立要求。
 * 不满足则拒绝改名 —— 宁可保留模型原样的 item（哪怕命名不规范），
 * 也不能让证据挂在不相干的能力项下。
 */
function canonMatchesEvidence(canon, evidence) {
  const ev = String(evidence || '').trim();
  if (!ev) return true;           // 无证据时无法判别，放行（后续会被证据校验拦）

  // ⚠️ 概括性能力名 vs 具体技术名 ——
  //   「视觉设计能力」是概括名，证据写「熟练使用 Canva、Photoshop 等设计工具优先」，
  //   两者本来就没有词元重叠，但它们确实是对应的。
  //   对这类概括名，不能用词元重叠来判「名实是否分离」。
  const ABSTRACT_CANON = /(视觉设计|逻辑思考|结构化表达|文案能力|选题策划|沟通协调|学习能力|抗压|亲和力|团队协作)/;
  if (ABSTRACT_CANON.test(canon)) {
    // 概括名只看方向是否相符：证据里出现了该领域的关键词即放行
    const domain = canonDomain(canon);
    if (domain && domain.test(ev)) return true;
    // 无法判断领域 → 放行，交由后续的证据校验兜底
    return true;
  }

  const canonTokens = tokenize(normalize(canon));
  const evTokens = tokenize(normalize(ev));
  if (canonTokens.size === 0) return true;

  let hit = 0;
  for (const t of evTokens) {
    if (canonTokens.has(t)) hit++;
  }
  // 证据与规范名有实词重叠 → 对应
  if (hit >= 1) return true;

  // 证据自身是一条完整的岗位要求（如「熟悉 MySQL 或 Redis 等常用数据库」），
  // 且不含任何规范化关键词 —— 说明模型给错了 type，保留原文 item 更安全。
  return false;
}

/**
 * 判断「该能力项的 JD 证据」与「能力项名称」是否方向相符。
 *
 * 用途：工具技能规则里，确认「JD 证据里提到的这个工具」确实是这项能力要的。
 *   · 概括名（「视觉设计能力」）→ 用领域词表判断（证据里有 Canva/PS/设计…）
 *   · 具体名（「大模型 API 调用实践经验」）→ 要求词元重叠
 *
 * 实测反例（T1）：能力项是「大模型 API 调用实践经验」，
 *   证据却是「熟悉 MySQL 或 Redis 等常用数据库」——
 *   两者毫无关系，MySQL 不该被用来判这项能力为已有。
 */
function evidenceMatchesRequirement(jdEvidence, requirement) {
  const ev = String(jdEvidence || '').trim();
  const req = String(requirement || '').trim();
  if (!ev || !req) return false;

  // 概括名 → 领域词表
  const domain = canonDomain(req);
  if (domain) return domain.test(ev);

  // 具体名 → 词元重叠
  const reqTokens = tokenize(normalize(req));
  const evTokens = tokenize(normalize(ev));
  if (reqTokens.size === 0) return false;
  let hit = 0;
  for (const t of evTokens) {
    if (reqTokens.has(t)) hit++;
  }
  return hit >= 1;
}

/**
 * 概括能力名对应的领域关键词表。
 * 用于判断「视觉设计能力」这类概括名与证据方向是否相符。
 */
function canonDomain(canon) {
  const DOMAINS = {
    '视觉设计能力': /(设计|视觉|PS|Photoshop|Canva|Figma|图|排版|配色|海报|封面|banner|详情页)/i,
    '逻辑思考能力': /(逻辑|思维|分析|推理|算法|问题|排查|思考)/i,
    '结构化表达能力': /(表达|沟通|讲|述|汇报|撰写|写作|条理|逻辑)/i,
    '文案能力': /(文案|撰|文字|稿|内容|撰写)/i,
    '选题策划能力': /(选题|策划|规划|主题|方向)/i,
  };
  for (const [k, re] of Object.entries(DOMAINS)) {
    if (canon.includes(k)) return re;
  }
  return null;
}
