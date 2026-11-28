/* ===========================================================================
   PMP 助手 · core.js 与 data.js 的单元测试
   运行（项目根目录）：node --test apps/pmp-assistant/
   =========================================================================== */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert');

const DATA = require('../data.js');
const CORE = require('../core.js');
const evm = CORE.evm;
const risk = CORE.risk;
const cards = CORE.cards;

/* 同一个式子换个写法，浮点结果会差在最后几位，所以用相对误差比较 */
function close(actual, expected, label) {
  assert.ok(actual !== null && actual !== undefined, (label || '') + '：结果不应为空');
  assert.ok(Number.isFinite(actual), (label || '') + '：结果应是有限数，实际 ' + actual);
  const tol = 1e-9 * Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tol, (label || '') + '：期望 ' + expected + '，实际 ' + actual);
}

function byId(id) {
  return DATA.CARDS.find((c) => c.id === id);
}

function findCard(keyword) {
  return DATA.CARDS.find((c) => c.front.indexOf(keyword) >= 0 || c.back.join(' ').indexOf(keyword) >= 0);
}

function allRisks() {
  const out = [];
  DATA.PROJECT_TYPES.forEach((t) => DATA.FOCUS_AREAS.forEach((f) => out.push(...DATA.RISK_LIBRARY[t.id][f.id])));
  return out;
}

/* 官方大纲（中文版）各任务的驱动因素原文，只用来检查“要点没有逐字照抄” */
const OFFICIAL_DRIVERS = {
  '制定共同愿景': ['帮助确保与关键利益相关方达成愿景共识', '推动共同愿景', '保持愿景的时效性', '对情形进行详细分析，发现产生愿景误解的根本原因'],
  '管理冲突': ['识别冲突来源', '分析冲突发生的背景', '执行商定的冲突解决策略', '将冲突管理原则告知团队和外部利益相关方', '营造遵守共同基本原则的环境', '管理和纠正违反基本规则的行为'],
  '领导项目团队': ['在团队层面明确预期', '赋能团队', '解决问题', '代表团队发声', '支持团队的多样化经验、技能和观点', '确定恰当的领导风格', '在团队内建立明确的角色和职责'],
  '争取利益相关方参与': ['识别利益相关方', '分析利益相关方', '分析并根据利益相关方的需求定制沟通内容', '执行争取利益相关方参与计划', '提升利益相关方的需求、预期和项目目标之间的一致性', '赢得信任，并影响利益相关方，以实现项目目标'],
  '协调利益相关方的期望': ['将利益相关方归类', '明确利益相关方的期望', '促进讨论以就预期达成一致', '组织并利用指导机会'],
  '管理利益相关方期望': ['识别内部和外部客户的期望', '持续确保成果与内部及外部客户的期望保持一致', '监督内部及外部客户的满意度/期望，并根据需要做出响应'],
  '帮助确保知识转移': ['明确对项目至关重要的知识', '汇总知识', '营造知识转移的环境'],
  '规划和管理沟通': ['制定沟通策略', '提升透明度并推动协作', '建立反馈循环', '了解报告需求', '创建符合发起人和利益相关方期望的报告', '支持报告与治理流程'],
  '制定综合项目管理计划并规划交付': ['评估项目目标、复杂性和重要性', '推荐项目管理方法（即：预测型、适应型/敏捷型或混合型管理方法）', '确定关键信息需求（例如，可持续性）', '推荐项目执行策略', '制定综合项目管理计划', '估算工作人力投入和资源需求', '评估整体项目计划，了解依赖关系、差距和持续业务价值', '维护综合项目管理计划', '收集并分析数据，以做出明智的项目决定'],
  '制定并管理项目范围': ['定义范围', '就项目范围与利益相关方达成一致', '分解范围'],
  '帮助确保基于价值的交付': ['与关键利益相关方一起明确价值要素', '根据价值和利益相关方反馈确定工作的优先级', '评估可循序渐进地交付价值的机会', '研究整个项目实施过程中的业务价值', '核实是否已建立可跟踪收益的衡量系统', '评估可以展现价值的交付方案选项'],
  '规划和管理资源': ['根据需求定义和规划资源', '管理和优化资源需求和可用性'],
  '规划和管理采购': ['规划采购', '执行采购管理计划', '选择首选合同类型', '评估供应商绩效', '核实采购协议目标的达成情况', '参与协议谈判', '确定谈判策略', '管理供应商和合同', '规划和管理采购策略', '制定交付解决方案'],
  '规划和管理财务': ['分析项目的财务需求', '量化风险和应急情况财务分配', '规划整个项目生命周期的支出跟踪方案', '规划财务报告', '预判未来的财务挑战', '监督财务差异并配合治理流程开展工作', '管理财务储备'],
  '规划和优化产品/可交付物的质量': ['收集项目可交付物的质量要求', '规划质量流程和工具', '执行质量管理计划', '帮助确保监管合规', '管理质量成本（CoQ）和可持续性', '进行持续的质量审查', '实施持续改进'],
  '规划和管理进度计划': ['根据所选开发方法制定进度计划', '与其他项目和运营活动协调', '估算项目任务（里程碑、依赖关系、故事点）', '利用基础数据和历史数据', '创建项目进度计划', '确定项目进度计划的基准', '执行进度管理计划', '分析进度计划差异'],
  '评估项目状态': ['制定度量指标，分析和协调一致方案', '识别并制定所需的工作', '帮助确保工作得到创建、审查、更新及记录', '帮助确保工作的访问性', '评估当前进展', '衡量、分析并更新项目度量指标', '沟通项目状态', '持续评估工作管理的有效性'],
  '管理项目收尾': ['获得项目利益相关方对项目完成的批准', '为成功结束项目或阶段确定相关团队', '确认已为过渡（例如过渡至运营团队或下一个阶段）做好准备', '完成各项活动，以结束项目或阶段（例如最终的经验教训、回顾会议、采购、财务、资源）'],
  '定义并建立项目治理': ['通过使用组织过程资产（OPA），描述并建立组织架构、规则、程序、报告、道德及政策', '定义成功度量指标', '概述治理升级路径和临界值'],
  '规划和管理项目的合规性': ['确认项目合规要求（例如保护措施、健康和安全、可持续性、监管合规）', '对合规类别进行分类', '确定在合规方面面临的潜在威胁', '采用相关方法为合规提供支持', '分析不合规的后果', '确定必要的方法和行动来满足合规需求', '衡量项目的合规程度'],
  '管理和控制变更': ['执行变更控制流程', '沟通提议变更的状态', '在项目中实施已批准的变更', '更新项目文档以反映变更'],
  '消除障碍并管理问题': ['评估障碍的影响', '对障碍进行优先级排序并突出显示这些障碍', '确定并应用干预策略，以消除或最大限度地减少障碍', '持续进行重新评估，以帮助确保团队面临的各种障碍正在得到解决', '识别风险何时会演变为问题', '与相关利益相关方就解决问题的方法开展协作'],
  '规划和管理风险': ['识别风险', '分析风险', '监督和控制风险', '制定风险管理计划', '维护风险登记册（例如，IT安全性较差）', '执行风险管理计划（例如，针对安全风险的风险应对措施以及管理可持续性风险）', '沟通风险对项目影响的状态'],
  '持续改进': ['利用经验教训', '帮助确保持续改进流程得到更新', '更新组织过程资产（OPA）'],
  '为组织变更提供支持': ['评估组织文化', '评估组织变更对项目的影响，并确定必要的行动'],
  '评估外部业务环境的变化': ['调查外部业务环境（例如法规、技术、地理区域政治、市场）的变化', '评估外部商业环境变化对项目范围/待办事项列表的影响，并确定其优先级', '持续审视外部业务环境，关注其对项目范围/待办事项列表的影响']
};

/* 去掉标点和空白后的“纯文字”，用来判断是否逐字相同 */
function plain(text) {
  return String(text).replace(/[\s\p{P}\p{S}]/gu, '');
}

function assertNotCopied(text, drivers, where) {
  const t = plain(text);
  drivers.forEach((d) => {
    const p = plain(d);
    assert.notEqual(t, p, where + '逐字照抄了大纲原文：' + d);
    if (p.length >= 8) {
      assert.ok(t.indexOf(p) < 0, where + '整句嵌入了大纲原文“' + d + '”：' + text);
    }
  });
}

function walkStrings(value, fn) {
  if (typeof value === 'string') fn(value);
  else if (Array.isArray(value)) value.forEach((v) => walkStrings(v, fn));
  else if (value && typeof value === 'object') Object.keys(value).forEach((k) => walkStrings(value[k], fn));
}

/* ==========================================================================
   一、数据完整性
   ========================================================================== */
describe('数据完整性 · 考试大纲', () => {
  const ECO = DATA.ECO;

  test('领域占比之和为 100，且三个领域的占比分别是 33 / 41 / 26', () => {
    assert.deepEqual(ECO.domains.map((d) => d.name), ['人员', '过程', '业务环境']);
    assert.deepEqual(ECO.domains.map((d) => d.percent), [33, 41, 26]);
    assert.equal(ECO.domains.reduce((s, d) => s + d.percent, 0), 100, '领域占比之和应为 100');
  });

  test('任务数为 8 + 10 + 8 = 26', () => {
    assert.deepEqual(ECO.domains.map((d) => d.tasks.length), [8, 10, 8]);
    assert.equal(ECO.domains.reduce((s, d) => s + d.tasks.length, 0), 26);
  });

  test('26 项任务的标题与规格逐字一致', () => {
    const expected = [
      ['制定共同愿景', '管理冲突', '领导项目团队', '争取利益相关方参与', '协调利益相关方的期望', '管理利益相关方期望', '帮助确保知识转移', '规划和管理沟通'],
      ['制定综合项目管理计划并规划交付', '制定并管理项目范围', '帮助确保基于价值的交付', '规划和管理资源', '规划和管理采购', '规划和管理财务', '规划和优化产品/可交付物的质量', '规划和管理进度计划', '评估项目状态', '管理项目收尾'],
      ['定义并建立项目治理', '规划和管理项目的合规性', '管理和控制变更', '消除障碍并管理问题', '规划和管理风险', '持续改进', '为组织变更提供支持', '评估外部业务环境的变化']
    ];
    ECO.domains.forEach((d, i) => {
      assert.deepEqual(d.tasks.map((t) => t.title), expected[i], d.name + '的任务标题');
    });
  });

  test('每项任务有 1–2 条非空要点，且没有逐字照抄官方大纲', () => {
    ECO.domains.forEach((d) => {
      d.tasks.forEach((t) => {
        assert.ok(Array.isArray(t.points), t.title + '：要点应是数组');
        assert.ok(t.points.length >= 1 && t.points.length <= 2, t.title + '：要点应为 1–2 条');
        const drivers = OFFICIAL_DRIVERS[t.title];
        assert.ok(drivers, '测试里缺少“' + t.title + '”的官方原文对照');
        t.points.forEach((p) => {
          assert.ok(typeof p === 'string' && p.trim().length > 0, t.title + '：要点不能为空');
          assertNotCopied(p, drivers, t.title + '：');
        });
      });
    });
  });

  test('考试形式的数字与规格一致', () => {
    assert.equal(ECO.exam.questions, 180);
    assert.equal(ECO.exam.scored, 170);
    assert.equal(ECO.exam.pretest, 10);
    assert.equal(ECO.exam.minutes, 240);
    assert.equal(ECO.exam.breaks, 2);
    assert.equal(ECO.exam.breakMinutes, 10);
    assert.equal(ECO.exam.predictiveShare, '约 40%');
    assert.equal(ECO.exam.agileHybridShare, '约 60%');
    assert.deepEqual(ECO.exam.questionTypes, ['单项选择', '多项选择', '基于图形的问题', '案例或场景题']);
    assert.deepEqual(ECO.exam.cbtOnlyTypes, ['增强匹配', '点选题', '匹配题', '下拉列表题']);
    assert.ok(ECO.exam.difference.indexOf('批判性思维能力') >= 0);
  });

  test('报考资格的四条路径、培训时长与生效日期与规格一致', () => {
    const paths = ECO.eligibility.paths;
    assert.equal(paths.length, 4);
    assert.deepEqual(paths.map((p) => p.months), [60, 48, 36, 24]);
    assert.deepEqual(paths.map((p) => p.years), [5, 4, 3, 2]);
    assert.deepEqual(paths.map((p) => p.education), [
      '高中或中专学历',
      '大专、副学士或高级技术/职业课程',
      '学士及以上',
      '经 PMI 全球学位认证中心（GAC）认证的学位'
    ]);
    assert.equal(ECO.eligibility.trainingHours, 35);
    const rules = ECO.eligibility.rules.map((r) => r.text).join(' ');
    assert.ok(rules.indexOf('过去 10 年内') >= 0);
    assert.ok(rules.indexOf('不重叠') >= 0);
    assert.ok(rules.indexOf('按月数计算') >= 0);
    assert.ok(rules.indexOf('2026 年 12 月 1 日') >= 0);
    assert.ok(rules.indexOf('现场讲师指导') >= 0);
    assert.ok(rules.indexOf('CAPM®') >= 0, '应写明 CAPM® 持证人可免除培训要求');
    assert.ok(rules.indexOf('可免除 35 小时商业培训要求') >= 0);
    assert.ok(rules.indexOf('仅以笔试（PBT）形式') >= 0, '应写明中国大陆仅以笔试（PBT）形式考试');
    assert.ok(rules.indexOf('ATA 考试服务机构') >= 0);
  });

  test('续证与补考的数字与规格一致', () => {
    assert.equal(ECO.renewal.cycleYears, 3);
    assert.equal(ECO.renewal.pdu, 60);
    assert.equal(ECO.retake.attempts, 3);
    assert.equal(ECO.retake.windowYears, 1);
    assert.equal(ECO.retake.waitYears, 1);
    /* 官方原文（第 23 页）：有效期内未通过、未考满三次的，须重新申请认证，但不受等待期限制 */
    assert.ok(typeof ECO.retake.reapplyText === 'string' && ECO.retake.reapplyText.length > 10);
    assert.ok(ECO.retake.reapplyText.indexOf('未考满 3 次') >= 0);
    assert.ok(ECO.retake.reapplyText.indexOf('重新申请认证') >= 0);
    assert.ok(ECO.retake.reapplyText.indexOf('不受等待期') >= 0);
  });
});

describe('数据完整性 · 考点卡', () => {
  const CARDS = DATA.CARDS;

  test('总数在 60–80 张之间，id 与正面问题都不重复', () => {
    assert.ok(CARDS.length >= 60 && CARDS.length <= 80, '考点卡数量应为 60–80，实际 ' + CARDS.length);
    assert.equal(new Set(CARDS.map((c) => c.id)).size, CARDS.length, 'id 不应重复');
    assert.equal(new Set(CARDS.map((c) => c.front)).size, CARDS.length, '正面问题不应重复');
  });

  test('每张卡都有合法的依据、领域、难度，背面为 3–6 行非空文本', () => {
    CARDS.forEach((c) => {
      const tag = c.id + '：';
      assert.ok(cards.BASES.indexOf(c.basis) >= 0, tag + '依据“' + c.basis + '”不合法');
      assert.ok(cards.DOMAINS.indexOf(c.domain) >= 0, tag + '领域“' + c.domain + '”不合法');
      assert.ok(cards.LEVELS.indexOf(c.level) >= 0, tag + '难度“' + c.level + '”不合法');
      assert.ok(typeof c.front === 'string' && c.front.trim().length > 0, tag + '正面为空');
      assert.ok(Array.isArray(c.back) && c.back.length >= 3 && c.back.length <= 6, tag + '背面应为 3–6 行');
      c.back.forEach((line) => assert.ok(typeof line === 'string' && line.trim().length > 0, tag + '背面有空行'));
    });
  });

  test('四种依据标签都有卡片，且依据与领域相互匹配', () => {
    const allowed = {
      '考试大纲（2026 年 7 月更新）': ['考试政策', '人员', '过程', '业务环境'],
      'PMBOK 第 8 版': ['第八版框架'],
      'PMBOK 第 6 版基础概念': ['人员', '过程', '业务环境', '基础计算与合同'],
      '敏捷通用实践': ['敏捷与混合']
    };
    assert.deepEqual(cards.BASES, Object.keys(allowed), '依据标签的取值与规格一致');
    cards.BASES.forEach((basis) => {
      assert.ok(CARDS.some((c) => c.basis === basis), '依据“' + basis + '”下一张卡都没有');
    });
    CARDS.forEach((c) => {
      assert.ok(allowed[c.basis].indexOf(c.domain) >= 0, c.id + '：依据“' + c.basis + '”不应出现在领域“' + c.domain + '”');
    });
  });

  test('第六版概念都标注为“PMBOK 第 6 版基础概念”，并说明了它在第八版里的位置', () => {
    ['五大过程组是哪五个', '三大基准是什么', 'WBS 应该分解到什么程度', '十大知识领域是哪十个'].forEach((k) => {
      const card = findCard(k);
      assert.ok(card, '缺少卡片：' + k);
      assert.equal(card.basis, 'PMBOK 第 6 版基础概念', card.id + ' 应标注为第六版基础概念');
    });
    CARDS.filter((c) => c.basis === 'PMBOK 第 6 版基础概念').forEach((c) => {
      assert.ok(typeof c.note === 'string' && c.note.length >= 10, c.id + '：缺少第八版位置说明');
      assert.ok(c.note.indexOf('第八版') >= 0, c.id + '：位置说明要提到第八版');
    });
    const groups = byId('p6-process-01');
    assert.ok(groups.note.indexOf('关注领域') >= 0, '五大过程组卡片要说明过程组在第八版以关注领域的形式保留');
    assert.ok(groups.note.indexOf('监督与控制') >= 0);
  });

  test('风险应对策略卡片包含上报，威胁与机会各五种', () => {
    const threat = byId('p6-env-01');
    const opp = byId('p6-env-02');
    assert.ok(threat && opp);
    ['上报', '规避', '转移', '减轻', '接受'].forEach((s) => {
      assert.ok(threat.back.some((l) => l.indexOf(s + '：') === 0), '威胁策略卡缺少“' + s + '”');
    });
    ['上报', '开拓', '分享', '提高', '接受'].forEach((s) => {
      assert.ok(opp.back.some((l) => l.indexOf(s + '：') === 0), '机会策略卡缺少“' + s + '”');
    });
  });

  test('第一版的 15 个考点都有对应的卡片', () => {
    const keywords = [
      '五大过程组是哪五个', '三大基准是什么', 'WBS 应该分解到什么程度',
      '威胁的五种应对策略', '机会的五种应对策略', '应急储备和管理储备',
      '挣值的三个基本值是什么', 'CV、SV、CPI、SPI 怎么算', 'EAC、ETC、VAC、TCPI 的公式',
      '固定总价合同（FFP）', '成本补偿合同有哪三种', '工料合同（T&M）',
      '干系人太多管不过来', '冲突解决的五种方法', '项目经理的权力有哪几种来源'
    ];
    keywords.forEach((k) => assert.ok(findCard(k), '缺少第一版就有的考点：' + k));
    assert.equal(keywords.length, 15);
  });

  test('第八版卡片只使用规格列出的事实，并带有免责说明', () => {
    const p8 = CARDS.filter((c) => c.basis === 'PMBOK 第 8 版');
    assert.ok(p8.length >= 6);
    const text = p8.map((c) => c.front + ' ' + c.back.join(' ')).join(' ');
    /* 规格里出现过的数字：版次、年份、月份、原则数、绩效域数、关注领域数、过程数及其分布、第七版的两个数 */
    const allowedNumbers = ['2025', '11', '12', '19', '40', '10', '8', '7', '6', '5', '1'];
    (text.match(/\d+/g) || []).forEach((n) => {
      assert.ok(allowedNumbers.indexOf(n) >= 0, '第八版卡片出现了规格之外的数字：' + n);
    });
    const facts = [
      '2025 年 11 月发布', '原则 → 绩效域 → 关注领域 → 过程',
      'Adopt a Holistic View', 'Focus on Value', 'Embed Quality', 'Be an Accountable Leader', 'Integrate Sustainability', 'Build an Empowered Culture',
      '采用整体观', '聚焦价值', '内嵌质量', '做负责任的领导者', '融入可持续性', '建设赋能文化',
      '治理（Governance）', '干系人（Stakeholders）', '资源（Resources）', '范围（Scope）', '进度（Schedule）', '财务（Finance）', '风险（Risk）',
      '启动、规划、执行、监督与控制、收尾',
      '40 个过程', '规划领域 19 个', '6 项原则', '7 个绩效域', '5 个关注领域',
      '人工智能', '可持续性（ESG）', 'PMO', '财务绩效域',
      '开发方法与生命周期', '项目工作', '交付', '测量', '不确定性', '第七版的 12 项'
    ];
    facts.forEach((f) => assert.ok(text.indexOf(f) >= 0, '第八版卡片缺少规格事实：' + f));
    p8.forEach((c) => {
      assert.ok(c.note.indexOf('以上为公开资料对第八版结构的概述，细节以教材为准。') >= 0, c.id + '：缺少第八版免责说明');
    });
    assert.ok(byId('p8-02').note.indexOf('中文名称为意译，以官方中文版为准') >= 0, '原则卡片要注明中文名称为意译');
  });

  test('考试形式、报考资格、续证与补考的事实各做成了卡片，数字与规格一致', () => {
    const policy = CARDS.filter((c) => c.domain === '考试政策');
    assert.equal(policy.length, 13);
    assert.ok(policy.every((c) => c.basis === '考试大纲（2026 年 7 月更新）'));
    const text = policy.map((c) => c.back.join(' ')).join(' ');
    ['180', '170', '10 道', '240 分钟', '10 分钟', '33%', '41%', '26%', '40%', '60%',
      '60 个月', '48 个月', '36 个月', '24 个月', '10 年', '35 小时', '2026 年 12 月 1 日',
      '3 年', '60 个 PDU', '3 次', '等待一年',
      /* 新补的三条官方事实 */
      'CAPM®', '仅以笔试（PBT）形式', 'ATA 考试服务机构', '不受等待期'].forEach((f) => {
      assert.ok(text.indexOf(f) >= 0, '考试政策卡片缺少：' + f);
    });
  });

  test('大纲类卡片的答案没有逐字照抄官方大纲', () => {
    const drivers = [];
    Object.keys(OFFICIAL_DRIVERS).forEach((k) => drivers.push(...OFFICIAL_DRIVERS[k]));
    CARDS.filter((c) => c.basis === '考试大纲（2026 年 7 月更新）').forEach((c) => {
      c.back.forEach((line) => assertNotCopied(line, drivers, c.id + '：'));
    });
  });

  test('敏捷卡片只涉及 Scrum 与通用敏捷实践中没有争议的内容', () => {
    const agile = CARDS.filter((c) => c.domain === '敏捷与混合');
    assert.ok(agile.length >= 8);
    assert.ok(agile.every((c) => c.basis === '敏捷通用实践'), '敏捷与混合领域的卡片依据都应是敏捷通用实践');
    const text = agile.map((c) => c.front + ' ' + c.back.join(' ')).join(' ');
    ['产品负责人', 'Scrum Master', '开发人员', '冲刺规划', '每日 Scrum', '冲刺评审', '冲刺回顾',
      '产品待办列表', '冲刺待办列表', '增量', '在制品限制', '迭代'].forEach((k) => {
      assert.ok(text.indexOf(k) >= 0, '敏捷卡片缺少：' + k);
    });
    /* Scrum 指南里的时间盒 */
    assert.ok(text.indexOf('不超过一个月') >= 0);
    assert.ok(text.indexOf('15 分钟') >= 0);
    assert.ok(text.indexOf('8 小时') >= 0);
    assert.ok(text.indexOf('4 小时') >= 0);
    assert.ok(text.indexOf('3 小时') >= 0);
  });

  test('全部内容零 emoji，没有空话和占位文案', () => {
    const strings = [];
    walkStrings(DATA, (s) => strings.push(s));
    assert.ok(strings.length > 500);
    strings.forEach((s) => assert.ok(!CORE.hasEmoji(s), '出现了 emoji：' + s.slice(0, 24)));
    ['加强管理', '提高意识', '高度重视', '示例文本', '张三', '某公司', 'Lorem', 'TODO', '占位'].forEach((w) => {
      strings.forEach((s) => assert.ok(s.indexOf(w) < 0, '出现了空话或占位词“' + w + '”：' + s.slice(0, 24)));
    });
  });
});

describe('数据完整性 · 风险库', () => {
  test('4 种项目类型 × 5 个关注领域，共 20 个组合，每个组合都有 4–6 条风险', () => {
    assert.equal(DATA.PROJECT_TYPES.length, 4);
    assert.deepEqual(DATA.PROJECT_TYPES.map((t) => t.name), ['软件 / IT', 'RPA 与自动化', '工程与基建', '咨询与实施']);
    assert.equal(DATA.FOCUS_AREAS.length, 5);
    assert.deepEqual(DATA.FOCUS_AREAS.map((f) => f.name), ['启动', '规划', '执行', '监控', '收尾']);
    let combos = 0;
    DATA.PROJECT_TYPES.forEach((type) => {
      DATA.FOCUS_AREAS.forEach((focus) => {
        const list = DATA.RISK_LIBRARY[type.id][focus.id];
        combos += 1;
        assert.ok(Array.isArray(list), '缺少组合：' + type.name + ' · ' + focus.name);
        assert.ok(list.length >= 4 && list.length <= 6, type.name + ' · ' + focus.name + ' 应有 4–6 条风险，实际 ' + list.length);
      });
    });
    assert.equal(combos, 20);
  });

  test('每条风险都有预警信号和应对措施，概率、影响在 1–5 之间，策略与类型匹配', () => {
    const ids = new Set();
    allRisks().forEach((r) => {
      const tag = r.id + '：';
      assert.ok(r.title && r.title.trim().length >= 8, tag + '标题过短');
      assert.ok(r.signal && r.signal.trim().length >= 10, tag + '缺少预警信号');
      assert.ok(r.response && r.response.trim().length >= 15, tag + '缺少应对措施');
      assert.ok(Number.isInteger(r.p) && r.p >= 1 && r.p <= 5, tag + '概率 P 应为 1–5 的整数');
      assert.ok(Number.isInteger(r.i) && r.i >= 1 && r.i <= 5, tag + '影响 I 应为 1–5 的整数');
      assert.ok(r.kind === 'threat' || r.kind === 'opportunity', tag + '类型不合法');
      assert.ok(risk.STRATEGIES[r.kind].indexOf(r.strategy) >= 0, tag + '策略“' + r.strategy + '”与类型不匹配');
      assert.ok(!ids.has(r.id), tag + 'id 重复');
      ids.add(r.id);
      ['加强管理', '提高意识', '高度重视', '狠抓'].forEach((w) => {
        assert.ok((r.title + r.signal + r.response).indexOf(w) < 0, tag + '出现了空话“' + w + '”');
      });
    });
  });

  test('规格点名的新增风险都在库里', () => {
    const titles = (type) => DATA.FOCUS_AREAS.map((f) => DATA.RISK_LIBRARY[type][f.id]).reduce((a, b) => a.concat(b), []).map((r) => r.title).join(' ');
    const rpa = titles('rpa');
    assert.ok(rpa.indexOf('界面改版') >= 0, 'RPA：缺少“目标系统界面改版导致选择器失效”');
    assert.ok(rpa.indexOf('修改了流程') >= 0, 'RPA：缺少“业务在开发期改流程”');
    assert.ok(rpa.indexOf('安全策略锁定') >= 0, 'RPA：缺少“机器人账号被安全策略锁定”');
    const consult = titles('consult');
    assert.ok(consult.indexOf('范围蔓延') >= 0, '咨询：缺少“范围蔓延”');
    assert.ok(consult.indexOf('一把手不支持') >= 0, '咨询：缺少“客户一把手不支持”');
    assert.ok(consult.indexOf('中间汇报被全盘否定') >= 0, '咨询：缺少“中间汇报被全盘否定”');
  });

  test('风险库以第一版为基础：第一版的 57 条风险每一条都有对应', () => {
    const legacy = {
      software: {
        init: ['业务目标没有量化', '关键干系人没有识别出来', '排期和预算在立项时'],
        plan: ['技术选型', '没有缓冲', '第三方接口', '技能'],
        exec: ['不走变更流程', '理解有偏差', '技术债', '一个人熟悉'],
        monitor: ['进度偏差发现太晚', '缺陷数量超出预期', '安全漏洞'],
        close: ['验收标准到收尾阶段', '运维接手准备不足', '复盘流于形式']
      },
      rpa: {
        init: ['选错了要自动化的流程', '无人化', '系统权限和 IT 支持'],
        plan: ['界面改版', '影子流程', '异常场景', '许可成本'],
        exec: ['频繁运行失败', '误写生产数据', '修改了流程', '安全策略锁定'],
        monitor: ['无人知晓', '自动化率达不到验收线', '高峰期处理速度'],
        close: ['运维交接不完整', '不会处理例外场景', '收益说不清']
      },
      infra: {
        init: ['用地、许可', '投资估算依据不足'],
        plan: ['地质、气候', '材料价格波动'],
        exec: ['安全事故', '分包商能力不足', '关键线路上的延误'],
        monitor: ['隐蔽工程', '投资偏差失控'],
        close: ['竣工资料不全', '缺陷责任期']
      },
      consult: {
        init: ['范围蔓延', '一把手不支持', '客户数据拿不到'],
        plan: ['排不进客户日程', '行业与业务知识'],
        exec: ['预设结论冲突', '被全盘否定', '参与度低'],
        monitor: ['交付物质量不稳定', '周期拉长'],
        close: ['不会落地', '没有沉淀']
      }
    };
    let total = 0;
    Object.keys(legacy).forEach((type) => {
      Object.keys(legacy[type]).forEach((focus) => {
        const list = DATA.RISK_LIBRARY[type][focus];
        legacy[type][focus].forEach((k) => {
          total += 1;
          assert.ok(list.some((r) => r.title.indexOf(k) >= 0), '第一版风险在新库里没有对应：' + type + '/' + focus + ' “' + k + '”');
        });
      });
    });
    assert.equal(total, 57, '第一版实际是 57 条风险');
  });

  test('风险库里既有威胁也有机会，四档风险值都出现过', () => {
    const all = allRisks();
    const kinds = new Set(all.map((r) => r.kind));
    assert.ok(kinds.has('threat') && kinds.has('opportunity'));
    const m = risk.matrix(all);
    assert.ok(m.tiers.red > 0 && m.tiers.orange > 0 && m.tiers.yellow > 0 && m.tiers.green > 0);
    assert.equal(m.tiers.red + m.tiers.orange + m.tiers.yellow + m.tiers.green, all.length);
  });
});

describe('数据完整性 · 汇总校验与页面文案', () => {
  test('CORE.validate 找不到任何问题', () => {
    const result = CORE.validate(DATA);
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  });

  test('校验器能发现问题：少一条风险、错一个占比、错一个依据都会被报出来', () => {
    const broken = JSON.parse(JSON.stringify(DATA));
    broken.RISK_LIBRARY.rpa.close.pop();
    broken.ECO.domains[0].percent = 32;
    broken.CARDS[0].basis = '道听途说';
    const result = CORE.validate(broken);
    assert.equal(result.ok, false);
    const text = result.errors.join('\n');
    assert.ok(text.indexOf('风险库') >= 0, '应报出风险库条数不足');
    assert.ok(text.indexOf('100') >= 0, '应报出占比之和不是 100');
    assert.ok(text.indexOf('依据') >= 0, '应报出依据不合法');
  });

  test('免责声明、商标说明、风险库说明按规格写', () => {
    const t = DATA.TEXTS;
    assert.equal(
      t.disclaimer,
      '本工具是非官方的学习辅助资料，依据 PMI 公开的《PMP 认证考试内容大纲》（2026 年 7 月更新）和《PMBOK 指南》第八版整理，并注明了每条内容的出处。考试政策、报考条件和续证要求以 PMI 及中国国际人才交流基金会发布的最新信息为准。'
    );
    assert.ok(t.trademark.indexOf('PMP®') >= 0 && t.trademark.indexOf('PMBOK®') >= 0);
    assert.ok(t.trademark.indexOf('Project Management Institute, Inc. 的商标') >= 0);
    assert.ok(t.sources[0].desc.indexOf('2026 年 8 月 11 日') >= 0, '依据说明应写明英文版大纲的修订日期');
    assert.equal(t.riskBasis, '风险条目依据项目管理的一般实践和常见项目风险模式整理，供排查参考，使用时请结合具体项目调整。');
    assert.equal(t.evmNote, '挣值术语与公式是预测型方法的基础内容；考试以情境题为主，请结合大纲中“规划和管理财务”“评估项目状态”等任务理解使用。');
  });

  test('挣值预设的数字与规格一致（没有凑整）', () => {
    const presets = DATA.EVM.presets;
    const a = presets.find((p) => p.id === 'behind-over');
    const b = presets.find((p) => p.id === 'ahead-under');
    assert.deepEqual([a.pv, a.ev, a.ac, a.bac], [420000, 357000, 401500, 1200000]);
    assert.deepEqual([b.pv, b.ev, b.ac, b.bac], [420000, 463000, 398000, 1200000]);
    assert.equal(a.name, '成本超支且进度落后');
    assert.equal(b.name, '节支且超前');
    presets.forEach((p) => {
      /* “不要凑整”：每个预设里至少有两个数不是一万的整数倍 */
      const unround = [p.pv, p.ev, p.ac, p.bac].filter((n) => n % 10000 !== 0).length;
      assert.ok(unround >= 2, p.name + '：预设数字不应全是整数万');
    });
  });
});

/* ==========================================================================
   二、挣值计算
   ========================================================================== */
describe('挣值 · 三组预设的每个指标', () => {
  /* 期望值由预设数字直接算出 */
  const EXPECT = {
    'behind-over': { cv: -44500, sv: -63000, cpi: 0.8891656288916563, spi: 0.85, tcpi: 1.0557294927989982,
      eac: { typical: 1349579.831932773, atypical: 1244500, both: 1516888.0375679682 } },
    'ahead-under': { cv: 65000, sv: 43000, cpi: 1.1633165829145728, spi: 1.1023809523809525, tcpi: 0.9189526184538653,
      eac: { typical: 1031533.4773218143, atypical: 1135000, both: 972695.5949787516 } },
    'ahead-over': { cv: -39000, sv: 44000, cpi: 0.9292196007259528, spi: 1.0940170940170941, tcpi: 1.0600924499229585,
      eac: { typical: 1291406.25, atypical: 1239000, both: 1227777.587890625 } }
  };

  DATA.EVM.presets.forEach((preset) => {
    describe(preset.name, () => {
      const exp = EXPECT[preset.id];
      const label = preset.name + '：';

      test('CV、SV、CPI、SPI、TCPI', () => {
        const r = evm.compute(preset, { eac: 'typical' });
        close(r.byKey.cv.value, exp.cv, label + 'CV');
        close(r.byKey.sv.value, exp.sv, label + 'SV');
        close(r.byKey.cpi.value, exp.cpi, label + 'CPI');
        close(r.byKey.spi.value, exp.spi, label + 'SPI');
        close(r.byKey.tcpi.value, exp.tcpi, label + 'TCPI');
      });

      ['typical', 'atypical', 'both'].forEach((method) => {
        test('EAC（' + method + '）及其派生的 ETC、VAC', () => {
          const r = evm.compute(preset, { eac: method });
          const eac = exp.eac[method];
          close(r.byKey.eac.value, eac, label + 'EAC ' + method);
          close(r.byKey.etc.value, eac - preset.ac, label + 'ETC ' + method);
          close(r.byKey.vac.value, preset.bac - eac, label + 'VAC ' + method);
          /* 换个写法自检 */
          close(r.byKey.etc.value + preset.ac, r.byKey.eac.value, label + 'ETC + AC = EAC');
          close(r.byKey.vac.value + r.byKey.eac.value, preset.bac, label + 'VAC + EAC = BAC');
        });
      });

      test('八个指标都有数值、有解读，没有 NaN / Infinity', () => {
        ['typical', 'atypical', 'both'].forEach((method) => {
          const r = evm.compute(preset, { eac: method });
          assert.deepEqual(r.metrics.map((m) => m.key), ['cv', 'sv', 'cpi', 'spi', 'eac', 'etc', 'vac', 'tcpi']);
          r.metrics.forEach((m) => {
            assert.ok(Number.isFinite(m.value), label + m.abbr + ' 应是有限数');
            assert.equal(m.reason, null, label + m.abbr + ' 不应有“无法计算”的原因');
            assert.ok(typeof m.text === 'string' && m.text.length > 0, label + m.abbr + ' 缺少解读');
            assert.ok(!/NaN|Infinity/.test(m.text), label + m.abbr + ' 的解读里不应出现 NaN / Infinity');
          });
          assert.ok(!/NaN|Infinity/.test(r.summary.title + r.summary.text));
        });
      });
    });
  });

  test('三种 EAC 算法用公式独立验算', () => {
    DATA.EVM.presets.forEach((p) => {
      const cpi = p.ev / p.ac;
      const spi = p.ev / p.pv;
      close(evm.compute(p, { eac: 'typical' }).byKey.eac.value, p.bac / cpi, 'BAC ÷ CPI');
      close(evm.compute(p, { eac: 'atypical' }).byKey.eac.value, p.ac + (p.bac - p.ev), 'AC + (BAC − EV)');
      close(evm.compute(p, { eac: 'both' }).byKey.eac.value, p.ac + (p.bac - p.ev) / (cpi * spi), 'AC + (BAC − EV) ÷ (CPI × SPI)');
    });
  });

  test('成本、进度都不理想时：同时影响的算法最高，非典型最低；ETC 与 VAC 随算法变化', () => {
    const p = { pv: 420000, ev: 357000, ac: 401500, bac: 1200000 };
    const t = evm.compute(p, { eac: 'typical' });
    const a = evm.compute(p, { eac: 'atypical' });
    const b = evm.compute(p, { eac: 'both' });
    assert.equal(t.byKey.eac.formula, 'BAC ÷ CPI');
    assert.equal(a.byKey.eac.formula, 'AC + (BAC − EV)');
    assert.equal(b.byKey.eac.formula, 'AC + (BAC − EV) ÷ (CPI × SPI)');
    assert.ok(b.byKey.eac.value > t.byKey.eac.value);
    assert.ok(t.byKey.eac.value > a.byKey.eac.value);
    close(a.byKey.etc.value, 843000, 'ETC 非典型');
    close(a.byKey.vac.value, -44500, 'VAC 非典型');
    close(b.byKey.etc.value, 1115388.0375679682, 'ETC 同时影响');
    close(b.byKey.vac.value, -316888.0375679682, 'VAC 同时影响');
  });

  test('EAC 的名称与公式随算法切换', () => {
    const p = { pv: 420000, ev: 357000, ac: 401500, bac: 1200000 };
    assert.deepEqual(evm.METHODS.map((m) => m.name), ['偏差典型', '偏差非典型', '进度与成本同时影响']);
    evm.METHODS.forEach((m) => {
      const r = evm.compute(p, { eac: m.id });
      assert.equal(r.byKey.eac.name, '完工估算（' + m.name + '）');
      assert.equal(r.byKey.eac.formula, m.formula);
      assert.equal(r.method.id, m.id);
    });
    /* 没指定或指定了不认识的算法时，用第一种 */
    assert.equal(evm.compute(p).method.id, 'typical');
    assert.equal(evm.compute(p, { eac: 'nope' }).method.id, 'typical');
  });

  test('解读按数值判断：超支、落后、节支、超前', () => {
    const a = evm.compute({ pv: 420000, ev: 357000, ac: 401500, bac: 1200000 }, { eac: 'typical' });
    assert.equal(a.byKey.cv.tone, 'bad');
    assert.equal(a.byKey.cv.text, '超支 44,500 元');
    assert.equal(a.byKey.sv.tone, 'bad');
    assert.equal(a.byKey.sv.text, '进度落后 63,000 元的工作量');
    assert.equal(a.byKey.cpi.tone, 'bad');
    assert.equal(a.byKey.cpi.text, '超支：每花 1 元，只产出 0.89 元的价值');
    assert.equal(a.byKey.spi.tone, 'bad');
    assert.equal(a.byKey.spi.text, '落后：计划每完成 1 元的工作，实际只完成 0.85 元');
    assert.equal(a.byKey.tcpi.tone, 'bad');
    assert.equal(a.byKey.tcpi.text, '剩余工作每花 1 元必须产出 1.06 元价值，效率要高于原计划才能按预算完成');
    assert.equal(a.byKey.eac.tone, 'bad');
    assert.equal(a.byKey.eac.text, '完成全部工作的预计总成本为 1,349,580 元，比完工预算多 149,580 元');
    assert.equal(a.byKey.etc.text, '从现在到项目结束，预计还要投入 948,080 元');
    assert.equal(a.byKey.vac.tone, 'bad');
    assert.equal(a.byKey.vac.text, '将超预算 149,580 元');
    assert.equal(a.summary.tone, 'danger');
    assert.equal(a.summary.title, '超支 44,500 元，进度落后 63,000 元的工作量。');
    assert.equal(a.summary.text, '按“偏差典型”的假设，完成全部工作的预计总成本为 1,349,580 元，比完工预算多 149,580 元。');

    const b = evm.compute({ pv: 420000, ev: 463000, ac: 398000, bac: 1200000 }, { eac: 'typical' });
    assert.equal(b.byKey.cv.tone, 'good');
    assert.equal(b.byKey.cv.text, '节支 65,000 元');
    assert.equal(b.byKey.sv.text, '进度超前 43,000 元的工作量');
    assert.equal(b.byKey.cpi.text, '节支：每花 1 元，产出 1.16 元的价值');
    assert.equal(b.byKey.spi.text, '超前：计划每完成 1 元的工作，实际完成 1.10 元');
    assert.equal(b.byKey.tcpi.tone, 'good');
    assert.equal(b.byKey.tcpi.text, '剩余工作每花 1 元只需产出 0.92 元价值，效率低于原计划也能按预算完成');
    assert.equal(b.byKey.vac.text, '预计低于预算 168,467 元');
    assert.equal(b.summary.tone, 'success');
    assert.equal(b.summary.title, '节支 65,000 元，进度超前 43,000 元的工作量。');

    const c = evm.compute({ pv: 468000, ev: 512000, ac: 551000, bac: 1200000 }, { eac: 'typical' });
    assert.equal(c.summary.tone, 'warning', '只有一项偏差不好时结论用警告');
    assert.equal(c.summary.title, '超支 39,000 元，进度超前 44,000 元的工作量。');
    assert.equal(c.summary.text, '按“偏差典型”的假设，完成全部工作的预计总成本为 1,291,406 元，比完工预算多 91,406 元。');
  });

  test('成本与进度都正好等于计划', () => {
    const r = evm.compute({ pv: 500000, ev: 500000, ac: 500000, bac: 900000 }, { eac: 'typical' });
    assert.deepEqual([r.byKey.cv.value, r.byKey.sv.value], [0, 0]);
    assert.equal(r.byKey.cv.tone, 'neutral');
    assert.equal(r.byKey.cv.text, '成本与预算一致');
    assert.equal(r.byKey.sv.text, '进度与计划一致');
    assert.equal(r.byKey.cpi.value, 1);
    assert.equal(r.byKey.cpi.text, '成本绩效与计划一致');
    assert.equal(r.byKey.spi.value, 1);
    assert.equal(r.byKey.spi.text, '进度与计划一致');
    close(r.byKey.eac.value, 900000, 'EAC');
    assert.equal(r.byKey.eac.tone, 'neutral');
    assert.equal(r.byKey.etc.value, 400000);
    assert.equal(r.byKey.vac.value, 0);
    assert.equal(r.byKey.vac.text, '预计正好按预算完成');
    assert.equal(r.byKey.tcpi.value, 1);
    assert.equal(r.byKey.tcpi.text, '保持原计划的效率，正好可以按预算完成');
    assert.equal(r.summary.tone, 'info');
    assert.equal(r.summary.title, '成本与预算一致，进度与计划一致。');
  });

  test('EV 为 0 但已经花了钱：CPI 等于 0，按当前效率推算的 EAC 不可计算', () => {
    const r = evm.compute({ pv: 300000, ev: 0, ac: 120000, bac: 900000 }, { eac: 'typical' });
    assert.equal(r.byKey.cpi.value, 0);
    assert.equal(r.byKey.cpi.tone, 'bad');
    assert.equal(r.byKey.cpi.text, '已经花了钱，但还没有产出任何价值（EV 为 0）');
    assert.equal(r.byKey.spi.value, 0);
    assert.equal(r.byKey.spi.tone, 'bad');
    assert.equal(r.byKey.eac.value, null);
    assert.ok(r.byKey.eac.reason.indexOf('偏差非典型') >= 0, '要提示可以改用另一种算法');
    assert.equal(r.byKey.etc.value, null);
    assert.equal(r.byKey.vac.value, null);
  });
});

describe('挣值 · 边界情况', () => {
  const BASE = { pv: 420000, ev: 357000, ac: 401500, bac: 1200000 };

  /* 不可计算的指标：值为 null（界面显示“—”），并给出原因 */
  function assertNa(metric, label) {
    assert.equal(metric.value, null, label + '：不可计算的指标应为 null');
    assert.ok(typeof metric.reason === 'string' && metric.reason.length >= 6, label + '：缺少原因说明');
    assert.equal(metric.tone, 'na');
    assert.equal(metric.text, metric.reason);
    assert.equal(evm.fmtMoney(metric.value), '—');
    assert.equal(evm.fmtIndex(metric.value), '—');
  }

  function assertClean(result, label) {
    result.metrics.forEach((m) => {
      assert.ok(m.value === null || Number.isFinite(m.value), label + '：' + m.abbr + ' 出现了 NaN / Infinity');
      assert.ok(!/NaN|Infinity/.test(m.text), label + '：' + m.abbr + ' 的解读里出现了 NaN / Infinity');
    });
    assert.ok(!/NaN|Infinity/.test(result.summary.title + result.summary.text));
  }

  test('AC = 0：CPI 不可计算，依赖 CPI 的 EAC 以及 ETC、VAC 也不可计算', () => {
    const v = Object.assign({}, BASE, { ac: 0 });
    const t = evm.compute(v, { eac: 'typical' });
    assertNa(t.byKey.cpi, 'CPI');
    assert.ok(t.byKey.cpi.reason.indexOf('实际成本（AC）为 0') === 0);
    assertNa(t.byKey.eac, 'EAC 偏差典型');
    assertNa(t.byKey.etc, 'ETC');
    assertNa(t.byKey.vac, 'VAC');
    assertNa(evm.compute(v, { eac: 'both' }).byKey.eac, 'EAC 同时影响');
    /* 不依赖 CPI 的算法仍然可算 */
    const a = evm.compute(v, { eac: 'atypical' });
    close(a.byKey.eac.value, 843000, 'EAC 偏差非典型');
    close(a.byKey.etc.value, 843000, 'ETC');
    close(a.byKey.vac.value, 357000, 'VAC');
    /* CV、SV、SPI、TCPI 不受影响 */
    close(t.byKey.cv.value, 357000, 'CV');
    close(t.byKey.sv.value, -63000, 'SV');
    close(t.byKey.spi.value, 0.85, 'SPI');
    close(t.byKey.tcpi.value, 843000 / 1200000, 'TCPI');
    evm.METHODS.forEach((m) => assertNa(evm.compute(v, { eac: m.id }).byKey.cpi, 'CPI ' + m.id));
    assertClean(t, 'AC=0');
  });

  test('PV = 0：SPI 不可计算，依赖 SPI 的 EAC 也不可计算', () => {
    const v = Object.assign({}, BASE, { pv: 0 });
    const r = evm.compute(v, { eac: 'both' });
    assertNa(r.byKey.spi, 'SPI');
    assert.ok(r.byKey.spi.reason.indexOf('计划价值（PV）为 0') === 0);
    assertNa(r.byKey.eac, 'EAC 同时影响');
    assertNa(r.byKey.etc, 'ETC');
    assertNa(r.byKey.vac, 'VAC');
    evm.METHODS.forEach((m) => assertNa(evm.compute(v, { eac: m.id }).byKey.spi, 'SPI ' + m.id));
    /* 不依赖 SPI 的算法仍然可算 */
    close(evm.compute(v, { eac: 'typical' }).byKey.eac.value, 1349579.831932773, 'EAC 偏差典型');
    close(evm.compute(v, { eac: 'atypical' }).byKey.eac.value, 1244500, 'EAC 偏差非典型');
    assertClean(r, 'PV=0');
  });

  test('BAC = AC：TCPI 不可计算', () => {
    const v = Object.assign({}, BASE, { ac: 1200000 });
    evm.METHODS.forEach((m) => {
      const r = evm.compute(v, { eac: m.id });
      assertNa(r.byKey.tcpi, 'TCPI ' + m.id);
      assertClean(r, 'BAC=AC');
    });
    assert.ok(evm.compute(v, { eac: 'atypical' }).byKey.tcpi.reason.indexOf('没有剩余资金') >= 0);
  });

  test('BAC − AC 只差一个极小的数：按 0 处理，不会给出离谱的 TCPI', () => {
    const r = evm.compute(Object.assign({}, BASE, { ac: 1199999.9999999 }), { eac: 'atypical' });
    assertNa(r.byKey.tcpi, 'TCPI');
  });

  test('AC > BAC：剩余资金为负，TCPI 不可计算', () => {
    const r = evm.compute(Object.assign({}, BASE, { ac: 1300000 }), { eac: 'atypical' });
    assertNa(r.byKey.tcpi, 'TCPI');
    assert.ok(r.byKey.tcpi.reason.indexOf('剩余资金为负') >= 0);
  });

  test('EV ≥ BAC：TCPI 没有意义', () => {
    [1200000, 1260000].forEach((ev) => {
      const v = Object.assign({}, BASE, { ev });
      evm.METHODS.forEach((m) => {
        const r = evm.compute(v, { eac: m.id });
        assertNa(r.byKey.tcpi, 'TCPI EV=' + ev + ' ' + m.id);
        assert.ok(r.byKey.tcpi.reason.indexOf('没有意义') >= 0);
        assertClean(r, 'EV>=BAC');
      });
    });
    const equal = evm.compute(Object.assign({}, BASE, { ev: 1200000 }), { eac: 'atypical' });
    assert.equal(equal.byKey.eac.value, 401500);
    assert.equal(equal.byKey.etc.value, 0);
    assert.equal(equal.byKey.etc.tone, 'neutral');
    const over = evm.compute(Object.assign({}, BASE, { ev: 1260000 }), { eac: 'atypical' });
    close(over.byKey.eac.value, 341500, 'EAC');
    close(over.byKey.etc.value, -60000, 'ETC');
    assert.equal(over.byKey.etc.tone, 'warn');
    assert.ok(over.byKey.tcpi.reason.indexOf('范围基准') >= 0);
  });

  test('只有 PV、EV、AC 三个数：与完工预算有关的四个指标都不可计算，并说明原因', () => {
    const r = evm.compute({ pv: 420000, ev: 357000, ac: 401500 }, { eac: 'typical' });
    close(r.byKey.cv.value, -44500, 'CV');
    close(r.byKey.sv.value, -63000, 'SV');
    close(r.byKey.cpi.value, 357000 / 401500, 'CPI');
    close(r.byKey.spi.value, 0.85, 'SPI');
    ['eac', 'etc', 'vac', 'tcpi'].forEach((k) => {
      assertNa(r.byKey[k], k.toUpperCase());
      assert.ok(r.byKey[k].reason.indexOf('完工预算（BAC）') >= 0, k + '：原因要提到缺少完工预算');
    });
    assert.equal(r.summary.tone, 'danger');
    assert.ok(r.summary.text.indexOf('完工估算暂时无法计算') === 0);
  });

  test('只填了一部分：缺的指标显示“—”并点名缺的是哪一项', () => {
    const onlyPv = evm.compute({ pv: 420000 }, { eac: 'typical' });
    onlyPv.metrics.forEach((m) => assertNa(m, m.abbr));
    assert.ok(onlyPv.byKey.sv.reason.indexOf('挣值（EV）') >= 0);
    assert.ok(onlyPv.byKey.cv.reason.indexOf('挣值（EV）和实际成本（AC）') >= 0);
    const onlyEvAc = evm.compute({ ev: 357000, ac: 401500 }, {});
    close(onlyEvAc.byKey.cv.value, -44500, 'CV');
    close(onlyEvAc.byKey.cpi.value, 357000 / 401500, 'CPI');
    assertNa(onlyEvAc.byKey.sv, 'SV');
    assertNa(onlyEvAc.byKey.spi, 'SPI');
  });

  test('什么都没填：所有指标都不可计算，结论提示输入', () => {
    const r = evm.compute({}, {});
    r.metrics.forEach((m) => assertNa(m, m.abbr));
    assert.equal(r.summary.tone, 'info');
    assert.equal(r.summary.title, '输入四个数值后开始计算');
    const n = evm.compute(null, null);
    n.metrics.forEach((m) => assertNa(m, m.abbr));
    assert.equal(n.summary.title, '输入四个数值后开始计算');
  });

  test('四个数都是 0（完工预算除外）：不会出现除以 0', () => {
    const r = evm.compute({ pv: 0, ev: 0, ac: 0, bac: 200000 }, { eac: 'both' });
    assertNa(r.byKey.cpi, 'CPI');
    assertNa(r.byKey.spi, 'SPI');
    assertNa(r.byKey.eac, 'EAC');
    assertNa(r.byKey.etc, 'ETC');
    assertNa(r.byKey.vac, 'VAC');
    assert.equal(r.byKey.cv.value, 0);
    assert.equal(r.byKey.sv.value, 0);
    assert.equal(r.byKey.tcpi.value, 1);
    evm.METHODS.forEach((m) => assertClean(evm.compute({ pv: 0, ev: 0, ac: 0, bac: 200000 }, { eac: m.id }), '全 0'));
    const a = evm.compute({ pv: 0, ev: 0, ac: 0, bac: 200000 }, { eac: 'atypical' });
    assert.equal(a.byKey.eac.value, 200000);
    assert.equal(a.byKey.etc.value, 200000);
    assert.equal(a.byKey.vac.value, 0);
  });

  test('非法数值（负数、NaN、Infinity、字符串）一律当作没填', () => {
    const v = { pv: -1, ev: NaN, ac: Infinity, bac: '1200000' };
    const r = evm.compute(v, { eac: 'atypical' });
    r.metrics.forEach((m) => assertNa(m, m.abbr));
    assert.equal(r.inputs.pv, null);
    assert.equal(r.inputs.ev, null);
    assert.equal(r.inputs.ac, null);
    assert.equal(r.inputs.bac, null);
  });

  test('随机输入两千组：任何情况下都不会出现 NaN / Infinity', () => {
    let seed = 20260701;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = () => {
      const r = rand();
      if (r < 0.15) return 0;
      if (r < 0.2) return 0.000001;
      if (r < 0.25) return 9999999999999.9;
      if (r < 0.3) return null;
      return Math.round(rand() * 1500000 * 100) / 100;
    };
    let naCount = 0;
    for (let n = 0; n < 2000; n++) {
      const v = { pv: pick(), ev: pick(), ac: pick(), bac: pick() };
      evm.METHODS.forEach((m) => {
        const r = evm.compute(v, { eac: m.id });
        assertClean(r, '第 ' + n + ' 组 ' + JSON.stringify(v));
        r.metrics.forEach((x) => { if (x.value === null) naCount += 1; });
        const scale = evm.chartScale(r.chart);
        assert.ok(Number.isFinite(scale.max) && Number.isFinite(scale.top));
      });
    }
    assert.ok(naCount > 0, '随机输入里应该出现过不可计算的情况');
  });
});

describe('挣值 · 输入解析与校验', () => {
  test('正常的数字、千分位、小数、全角', () => {
    assert.deepEqual(evm.parse('pv', '420000'), {
      key: 'pv', abbr: 'PV', name: '计划价值', raw: '420000', ok: true, empty: false, value: 420000, reason: null, message: ''
    });
    assert.equal(evm.parse('ac', '401,500').value, 401500);
    assert.equal(evm.parse('ac', '1,200,000.5').value, 1200000.5);
    assert.equal(evm.parse('pv', ' 357000 ').value, 357000);
    assert.equal(evm.parse('pv', '.5').value, 0.5);
    assert.equal(evm.parse('pv', '12.').value, 12);
    assert.equal(evm.parse('pv', '420000.00').value, 420000);
    assert.equal(evm.parse('bac', '1200000').value, 1200000);
    assert.equal(evm.parse('pv', 420000).value, 420000, '数字类型也可以');
    assert.equal(evm.parse('pv', '４２００００').value, 420000, '全角数字');
    assert.equal(evm.parse('pv', '４２０，０００').value, 420000, '全角逗号');
    assert.equal(evm.parse('pv', '１２．５').value, 12.5, '全角小数点');
    assert.equal(evm.parse('pv', '+500').value, 500);
    assert.equal(evm.parse('pv', '-0').value, 0);
    assert.equal(evm.parse('pv', '-0.000').value, 0);
    assert.equal(evm.parse('pv', '0').value, 0);
  });

  test('空着：不算错，但记下原因，等用户碰过这个输入框再提示', () => {
    ['', '   ', null, undefined].forEach((raw) => {
      const f = evm.parse('ev', raw);
      assert.equal(f.ok, false);
      assert.equal(f.empty, true);
      assert.equal(f.value, null);
      assert.equal(f.reason, 'empty');
      assert.equal(f.message, '请填写挣值（EV），例如 357,000。');
    });
  });

  test('不是数字的输入：说清是哪个值、错在哪、该填什么样', () => {
    const bad = ['abc', '12 34', '1,5', '12,34', '1e5', '1.2.3', '.', '-', '+', '420_000', '$500', '元', 'NaN', 'Infinity', '１２ ３４'];
    bad.forEach((raw) => {
      const f = evm.parse('ac', raw);
      assert.equal(f.ok, false, '“' + raw + '”不应被接受');
      assert.equal(f.value, null);
      assert.equal(f.reason, 'nan', '“' + raw + '”');
      assert.equal(f.empty, false);
      assert.ok(f.message.indexOf(JSON.stringify(raw).slice(1, -1)) >= 0 || f.message.indexOf(raw.trim()) >= 0, '错误信息要引用原始输入：' + raw);
      assert.ok(f.message.indexOf('实际成本（AC）') >= 0, '错误信息要点名字段');
      assert.ok(f.message.indexOf('401,500') >= 0, '错误信息要给出示例');
    });
  });

  test('负数：说明不能为负，并给出正确示例', () => {
    const f = evm.parse('ac', '-500');
    assert.equal(f.ok, false);
    assert.equal(f.reason, 'negative');
    assert.equal(f.message, '实际成本（AC）不能是负数，请填写 0 或正数，例如 401,500。');
    assert.equal(evm.parse('pv', '-1,200').reason, 'negative');
    assert.equal(evm.parse('bac', '-0.5').reason, 'negative');
  });

  test('完工预算必须大于 0：按规格的原话提示', () => {
    ['0', '0.00', '000', '-0'].forEach((raw) => {
      const f = evm.parse('bac', raw);
      assert.equal(f.ok, false, 'BAC = ' + raw + ' 不应被接受');
      assert.equal(f.reason, 'bac_zero');
      assert.equal(f.message, '完工预算需要大于 0，例如 200000。');
    });
    assert.equal(evm.parse('bac', '0.01').ok, true);
    /* 其它三项允许为 0 */
    assert.equal(evm.parse('pv', '0').ok, true);
    assert.equal(evm.parse('ev', '0').ok, true);
    assert.equal(evm.parse('ac', '0').ok, true);
  });

  test('过大的数：提示确认单位', () => {
    const f = evm.parse('bac', '10000000000001');
    assert.equal(f.ok, false);
    assert.equal(f.reason, 'too_large');
    assert.equal(f.message, '完工预算（BAC）超出了可处理的范围（最大 10,000,000,000,000）。请确认单位是“元”。');
    assert.equal(evm.parse('bac', '10000000000000').ok, true, '正好等于上限可以接受');
    const huge = evm.parse('pv', '9'.repeat(400));
    assert.equal(huge.ok, false);
    assert.equal(huge.reason, 'nan');
    assert.ok(huge.message.indexOf('位数太多') >= 0);
  });

  test('validateEvm：没碰过的空输入框不报错，碰过的才报', () => {
    const empty = evm.validate({}, {});
    assert.equal(empty.errors, 0);
    assert.equal(empty.complete, false);
    assert.equal(empty.filled, 0);
    assert.deepEqual(empty.values, { pv: null, ev: null, ac: null, bac: null });
    assert.ok(empty.fields.every((f) => f.showError === false));

    const touched = evm.validate({}, { pv: true, bac: true });
    assert.equal(touched.errors, 2);
    assert.deepEqual(touched.fields.filter((f) => f.showError).map((f) => f.key), ['pv', 'bac']);

    const partial = evm.validate({ pv: '420000', ev: '357000', ac: '401500' }, { ev: true, ac: true });
    assert.equal(partial.errors, 0, 'BAC 空着且没碰过，不报错');
    assert.equal(partial.filled, 3);
    assert.equal(partial.complete, false);
    assert.equal(partial.values.bac, null);

    const invalid = evm.validate({ pv: 'abc', bac: '0', ac: '-1' }, {});
    assert.equal(invalid.errors, 3, '填了但不对的，不管碰没碰过都要报');
    assert.ok(invalid.fields.every((f) => f.empty ? f.showError === false : f.showError === true));
    assert.deepEqual(invalid.fields.map((f) => f.reason), ['nan', 'empty', 'negative', 'bac_zero']);
  });

  test('格式化：金额千分位取整，指数两位小数，空值显示“—”', () => {
    assert.equal(evm.fmtMoney(0), '0');
    assert.equal(evm.fmtMoney(-44500), '-44,500');
    assert.equal(evm.fmtMoney(1349579.831932773), '1,349,580');
    assert.equal(evm.fmtMoney(1031533.4773218143), '1,031,533');
    assert.equal(evm.fmtMoney(0.5), '1');
    assert.equal(evm.fmtMoney(999), '999');
    assert.equal(evm.fmtMoney(1000), '1,000');
    assert.equal(evm.fmtMoney(10000000000000), '10,000,000,000,000');
    [null, undefined, NaN, Infinity, -Infinity, 'x'].forEach((v) => assert.equal(evm.fmtMoney(v), '—'));
    assert.ok(!/Infinity|NaN/.test(evm.fmtMoney(1e300)), '极大的数也不会显示成 Infinity');
    assert.equal(evm.fmtIndex(0.8891656288916563), '0.89');
    assert.equal(evm.fmtIndex(1), '1.00');
    assert.equal(evm.fmtIndex(1.1633165829145728), '1.16');
    assert.equal(evm.fmtIndex(10), '10.00');
    [null, undefined, NaN, Infinity].forEach((v) => assert.equal(evm.fmtIndex(v), '—'));
  });

  test('柱状图的纵轴范围：以三根柱子的最大值为准，完工预算只在范围内时画线', () => {
    const a = evm.compute({ pv: 420000, ev: 357000, ac: 401500, bac: 1200000 }, {});
    let s = evm.chartScale(a.chart);
    assert.equal(s.max, 420000);
    close(s.top, 504000, '顶部留白');
    assert.equal(s.bacVisible, false, '完工预算超出坐标范围时不画线');
    assert.deepEqual(a.chart.bars.map((b) => b.key), ['pv', 'ev', 'ac']);
    const b = evm.compute({ pv: 420000, ev: 357000, ac: 401500, bac: 450000 }, {});
    s = evm.chartScale(b.chart);
    assert.equal(s.bacVisible, true);
    s = evm.chartScale(evm.compute({}, {}).chart);
    assert.equal(s.max, 0);
    assert.equal(s.bacVisible, false);
    assert.equal(evm.presets(DATA).length, 3);
  });
});

/* ==========================================================================
   三、风险值与 5×5 矩阵
   ========================================================================== */
describe('风险值与 5×5 矩阵', () => {
  test('风险值 = P × I；四档分界与规格一致：≥15 红、10–12 橙、5–8 黄、1–4 绿', () => {
    const seen = { red: new Set(), orange: new Set(), yellow: new Set(), green: new Set() };
    for (let p = 1; p <= 5; p++) {
      for (let i = 1; i <= 5; i++) {
        const score = p * i;
        assert.equal(risk.score({ p, i }), score);
        const tier = risk.tier(score);
        const want = score >= 15 ? 'red' : score >= 10 ? 'orange' : score >= 5 ? 'yellow' : 'green';
        assert.ok(tier, 'P=' + p + ' I=' + i + ' 的风险值 ' + score + ' 必须有归属档位');
        assert.equal(tier.id, want, 'P=' + p + ' I=' + i);
        seen[want].add(score);
      }
    }
    assert.deepEqual([...seen.red].sort((a, b) => a - b), [15, 16, 20, 25]);
    assert.deepEqual([...seen.orange].sort((a, b) => a - b), [10, 12]);
    assert.deepEqual([...seen.yellow].sort((a, b) => a - b), [5, 6, 8, 9]);
    assert.deepEqual([...seen.green].sort((a, b) => a - b), [1, 2, 3, 4]);
    /* 规格写的是“5–8 黄”，但 3 × 3 = 9 没有被覆盖；这里按“达到 10 才进橙档”把 9 归入黄档 */
    assert.equal(risk.tier(9).id, 'yellow');
    assert.deepEqual(risk.TIERS.map((t) => t.rule), ['优先处理，制定应对计划并指定责任人', '制定应对措施', '纳入观察清单', '接受并定期复查']);
  });

  test('5 × 5 取不到的值（如 7、11、13）以及非整数，没有档位', () => {
    [0, 7, 11, 13, 14, 17, 18, 19, 21, 22, 23, 24, 26, -1, 1.5, NaN, null, undefined, '9'].forEach((s) => {
      assert.equal(risk.tier(s), null, '风险值 ' + s);
    });
  });

  test('概率、影响超出 1–5 或缺失时，拉回合法范围再计算', () => {
    assert.equal(risk.score({ p: 9, i: 2 }), 10);
    assert.equal(risk.score({ p: 0, i: 5 }), 5);
    assert.equal(risk.score({ p: 'x', i: null }), 9);
    assert.equal(risk.score({ p: 2.6, i: 2 }), 6);
  });

  test('按风险值降序排列；风险值相同时概率高的在前，再按原有先后', () => {
    const list = [
      { id: 'a', p: 2, i: 3 }, { id: 'b', p: 5, i: 5 }, { id: 'c', p: 3, i: 3 },
      { id: 'd', p: 4, i: 3 }, { id: 'e', p: 3, i: 4 }, { id: 'f', p: 3, i: 2 }, { id: 'g', p: 3, i: 2 }
    ];
    assert.deepEqual(risk.sort(list).map((r) => r.id), ['b', 'd', 'e', 'c', 'f', 'g', 'a']);
    assert.deepEqual(list.map((r) => r.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g'], '不改动原数组');
    assert.deepEqual(risk.sort([]), []);
  });

  test('威胁与机会各有五种应对策略，上报是共有的', () => {
    assert.deepEqual(risk.STRATEGIES.threat, ['上报', '规避', '转移', '减轻', '接受']);
    assert.deepEqual(risk.STRATEGIES.opportunity, ['上报', '开拓', '分享', '提高', '接受']);
    assert.equal(risk.STRATEGIES.threat.length, 5);
    assert.equal(risk.STRATEGIES.opportunity.length, 5);
  });

  test('切换威胁 / 机会后，策略换成含义对应的那一个，且始终合法', () => {
    const pairs = [['上报', '上报'], ['规避', '开拓'], ['转移', '分享'], ['减轻', '提高'], ['接受', '接受']];
    pairs.forEach(([t, o]) => {
      const asOpp = risk.switchKind({ id: 'x', title: 't', p: 3, i: 3, strategy: t }, 'opportunity');
      assert.equal(asOpp.kind, 'opportunity');
      assert.equal(asOpp.strategy, o);
      const back = risk.switchKind(asOpp, 'threat');
      assert.equal(back.kind, 'threat');
      assert.equal(back.strategy, t);
    });
    /* 切换不改动原对象 */
    const original = { id: 'y', title: 't', p: 4, i: 2, kind: 'threat', strategy: '减轻' };
    const changed = risk.switchKind(original, 'opportunity');
    assert.equal(original.kind, 'threat');
    assert.equal(original.strategy, '减轻');
    assert.equal(changed.kind, 'opportunity');
    assert.equal(changed.strategy, '提高');
    assert.equal(changed.p, 4);
    /* 切到相同类型：原样返回 */
    assert.equal(risk.switchKind(original, 'threat').strategy, '减轻');
    /* 对任何合法输入，切换后的策略都在新类型的选项里 */
    risk.STRATEGIES.threat.forEach((s) => {
      assert.ok(risk.STRATEGIES.opportunity.indexOf(risk.switchKind({ title: 't', strategy: s }, 'opportunity').strategy) >= 0);
    });
    assert.equal(risk.switchKind({}, 'opportunity'), null, '没有标题的风险不成立');
  });

  test('风险对象的整理：去空白、限制长度、补默认值，标题为空则丢弃', () => {
    assert.equal(risk.normalize(null), null);
    assert.equal(risk.normalize({}), null);
    assert.equal(risk.normalize({ title: '   ' }), null);
    const r = risk.normalize({ title: '  接口延期  ', p: 99, i: 0, strategy: '不存在', signal: ' x ' });
    assert.equal(r.title, '接口延期');
    assert.equal(r.p, 5);
    assert.equal(r.i, 1);
    assert.equal(r.kind, 'threat');
    assert.equal(r.strategy, '减轻');
    assert.equal(r.signal, 'x');
    assert.equal(r.response, '');
    assert.equal(r.custom, false);
    assert.equal(r.id, '');
    const long = risk.normalize({ title: '长'.repeat(200) });
    assert.equal(long.title.length, 80);
    const opp = risk.normalize({ title: '机会', kind: 'opportunity', strategy: '规避' }, 'c-1');
    assert.equal(opp.strategy, '提高', '不适用的策略换成该类型的默认值');
    assert.equal(opp.id, 'c-1');
    assert.deepEqual(risk.normalizeList([{ title: 'a' }, null, { title: '' }, { title: 'b' }]).map((x) => x.title), ['a', 'b']);
  });

  test('5×5 矩阵统计：每格的条数、四档合计、威胁与机会的数量', () => {
    const list = [
      { id: 'r1', p: 4, i: 4, kind: 'threat' },
      { id: 'r2', p: 3, i: 5, kind: 'threat' },
      { id: 'r3', p: 2, i: 2, kind: 'threat' },
      { id: 'r4', p: 4, i: 4, kind: 'opportunity' },
      { id: 'r5', p: 3, i: 3, kind: 'threat' },
      { id: 'r6', p: 2, i: 5, kind: 'opportunity' },
      { id: 'r7', p: 1, i: 1, kind: 'threat' }
    ];
    const m = risk.matrix(list);
    assert.equal(m.cells.length, 25);
    assert.equal(m.total, 7);
    assert.equal(m.cells.reduce((s, c) => s + c.count, 0), 7);
    const cell = (p, i) => m.cells[(p - 1) * 5 + (i - 1)];
    assert.deepEqual(cell(4, 4), { p: 4, i: 4, score: 16, tier: 'red', count: 2, ids: ['r1', 'r4'] });
    assert.deepEqual(cell(3, 5).ids, ['r2']);
    assert.equal(cell(3, 5).tier, 'red');
    assert.equal(cell(3, 3).tier, 'yellow');
    assert.deepEqual(cell(3, 3).ids, ['r5']);
    assert.equal(cell(2, 5).tier, 'orange');
    assert.equal(cell(2, 2).tier, 'green');
    assert.equal(cell(5, 5).count, 0);
    assert.deepEqual(m.tiers, { red: 3, orange: 1, yellow: 1, green: 2 });
    assert.deepEqual(m.kinds, { threat: 5, opportunity: 2 });
    assert.equal(risk.matrix([]).total, 0);
    assert.equal(risk.matrix(null).total, 0);
  });

  test('增删改：更新、删除、新增或替换都不改动原数组', () => {
    const list = [{ id: 'a', title: '甲', p: 3, i: 3 }, { id: 'b', title: '乙', p: 2, i: 2 }];
    const updated = risk.update(list, 'a', { p: 5 });
    assert.equal(updated[0].p, 5);
    assert.equal(list[0].p, 3, '原数组不变');
    assert.equal(updated[1], list[1], '没改的条目保持原对象');
    assert.deepEqual(risk.update(list, '不存在', { p: 5 }), list);
    assert.deepEqual(risk.remove(list, 'a').map((r) => r.id), ['b']);
    assert.equal(list.length, 2);
    assert.deepEqual(risk.remove(list, '不存在'), list);
    const added = risk.upsert(list, { title: '丙', p: 1, i: 5, custom: true });
    assert.equal(added.length, 3);
    assert.equal(added[2].title, '丙');
    assert.equal(added[2].custom, true);
    const replaced = risk.upsert(list, { id: 'b', title: '乙（改）', p: 4, i: 4 });
    assert.equal(replaced.length, 2);
    assert.equal(replaced[1].title, '乙（改）');
    assert.equal(replaced[1].p, 4);
    assert.equal(risk.upsert(list, { title: '' }), list, '没有标题的风险不会被加入');
  });

  test('默认清单是副本：改动不会污染风险库', () => {
    const first = risk.defaults(DATA.RISK_LIBRARY, 'software', 'plan');
    assert.equal(first.length, DATA.RISK_LIBRARY.software.plan.length);
    assert.deepEqual(risk.defaults(DATA.RISK_LIBRARY, '不存在', 'plan'), []);
    assert.deepEqual(risk.defaults(DATA.RISK_LIBRARY, 'software', '不存在'), []);
    first[0].p = 1;
    first.pop();
    assert.equal(DATA.RISK_LIBRARY.software.plan[0].p !== 1, true);
    assert.equal(DATA.RISK_LIBRARY.software.plan.length, first.length + 1);
  });

  test('CSV：UTF-8 带 BOM、逗号引号换行都转义、按风险值降序', () => {
    const list = [
      { id: 'r1', kind: 'threat', title: '接口延期,需要协调', signal: '对方说"下周给"', p: 4, i: 4, strategy: '减轻', response: '准备降级方案\n并每周跟进' },
      { id: 'r2', kind: 'opportunity', title: '复用组件', signal: '已有成熟组件', p: 3, i: 3, strategy: '提高', response: '确认接口稳定性' },
      { id: 'r3', kind: 'threat', title: '更高', signal: 's', p: 5, i: 5, strategy: '上报', response: 'r' }
    ];
    const csv = risk.csv(list, { type: '软件 / IT', focus: '规划' });
    assert.equal(csv.charCodeAt(0), 0xFEFF, '开头是 BOM');
    const lines = csv.slice(1).split('\r\n');
    assert.equal(lines[0], '序号,项目类型,关注领域,风险类型,风险标题,预警信号,概率P,影响I,风险值,等级,应对策略,应对措施');
    assert.equal(lines[1], '1,软件 / IT,规划,威胁,更高,s,5,5,25,红,上报,r');
    assert.equal(lines[2], '2,软件 / IT,规划,威胁,"接口延期,需要协调","对方说""下周给""",4,4,16,红,减轻,"准备降级方案\n并每周跟进"');
    assert.equal(lines[3], '3,软件 / IT,规划,机会,复用组件,已有成熟组件,3,3,9,黄,提高,确认接口稳定性');
    assert.equal(lines.length, 5, '表头加三行，末尾一个空串');
    assert.ok(csv.endsWith('\r\n'));
    assert.ok(csv.indexOf('\uFEFF', 1) < 0, 'BOM 只出现在开头');
    const empty = risk.csv([], {});
    assert.equal(empty, '\uFEFF' + '序号,项目类型,关注领域,风险类型,风险标题,预警信号,概率P,影响I,风险值,等级,应对策略,应对措施\r\n');
  });

  test('Markdown：表格行列数正确，竖线和换行都转义', () => {
    const list = [{ id: 'x', kind: 'threat', title: 'A|B', signal: '信号', p: 1, i: 5, strategy: '接受', response: '第一行\n第二行' }];
    const md = risk.markdown(list, { type: '软件 / IT', focus: '规划' });
    const lines = md.split('\n');
    assert.equal(lines[0], '# 风险登记册：软件 / IT · 规划');
    assert.equal(lines[2], '共 1 条，按风险值（概率 P × 影响 I）从高到低排列。');
    assert.equal(lines[4].split(' | ').length, 10);
    assert.equal(lines[5], '|---|---|---|---|---|---|---|---|---|---|');
    const row = lines[6];
    assert.ok(row.indexOf('A\\|B') >= 0, '竖线要转义');
    assert.ok(row.indexOf('第一行<br>第二行') >= 0, '换行要转成 <br>');
    assert.equal(row.split(' | ').length, 10);
    assert.ok(row.indexOf('| 威胁 |') >= 0);
    assert.ok(row.indexOf('| 黄 |') >= 0);
    assert.equal(risk.markdown([], {}).split('\n')[0], '# 风险登记册');
  });

  test('自定义风险的表单校验', () => {
    assert.deepEqual(risk.validateForm({ title: '标题', signal: '信号', response: '措施' }), {});
    const errors = risk.validateForm({ title: '  ', signal: '', response: '' });
    assert.deepEqual(Object.keys(errors), ['title', 'signal', 'response']);
    assert.ok(errors.title.indexOf('风险标题') >= 0);
    assert.ok(errors.signal.indexOf('预警信号') >= 0);
    assert.ok(errors.response.indexOf('应对措施') >= 0);
    assert.deepEqual(Object.keys(risk.validateForm({})), ['title', 'signal', 'response']);
    const tooLong = risk.validateForm({ title: '长'.repeat(81), signal: 's', response: 'r' });
    assert.ok(tooLong.title.indexOf('80') >= 0);
  });
});

/* ==========================================================================
   四、速记卡的队列与掌握度统计
   ========================================================================== */
describe('速记卡 · 队列', () => {
  const deck = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));

  test('新建队列：按给定顺序，从第一张开始', () => {
    const s = cards.createSession(deck);
    assert.deepEqual(s.ids, ['a', 'b', 'c', 'd', 'e', 'f']);
    assert.equal(s.pos, 0);
    assert.equal(s.total, 6);
    assert.equal(cards.current(s), 'a');
    assert.equal(s.finished, false);
    assert.equal(cards.current(cards.createSession([])), null, '没有卡片时队列直接结束');
    assert.equal(cards.createSession([]).finished, true);
    assert.equal(cards.current(null), null);
  });

  test('标“还不会”的卡会插回本轮队列，隔几张后再次出现', () => {
    let s = cards.createSession(deck);
    s = cards.rate(s, 'a', 'again');
    assert.deepEqual(s.ids, ['a', 'b', 'c', 'd', 'a', 'e', 'f'], 'a 排在 3 张别的卡之后');
    assert.equal(cards.current(s), 'b');
    assert.equal(s.misses.a, 1);
    s = cards.rate(s, 'b', 'known');
    s = cards.rate(s, 'c', 'known');
    s = cards.rate(s, 'd', 'known');
    assert.equal(cards.current(s), 'a', 'a 再次出现，而且是在队列结束之前');
    assert.equal(s.pos, 4);
    assert.equal(s.ids.length, 7);
    s = cards.rate(s, 'a', 'known');
    assert.equal(s.ids.indexOf('a', s.pos), -1, '掌握之后前方不再有它');
    assert.equal(cards.current(s), 'e');
    s = cards.rate(s, 'e', 'known');
    s = cards.rate(s, 'f', 'known');
    assert.equal(s.finished, true);
    assert.equal(cards.current(s), null);
    assert.equal(s.rated, 7, '一共评了 7 次');
  });

  test('连续标“还不会”，再次出现的间隔会拉长', () => {
    const big = 'abcdefghij'.split('').map((id) => ({ id }));
    let s = cards.createSession(big);
    s = cards.rate(s, 'a', 'again');
    assert.deepEqual(s.ids, ['a', 'b', 'c', 'd', 'a', 'e', 'f', 'g', 'h', 'i', 'j']);
    s = cards.rate(s, 'b', 'known');
    s = cards.rate(s, 'c', 'known');
    s = cards.rate(s, 'd', 'known');
    assert.equal(cards.current(s), 'a');
    s = cards.rate(s, 'a', 'again');
    assert.equal(s.misses.a, 2);
    assert.equal(s.ids[s.ids.length - 1], 'a', '第二次隔 6 张，后面不够，就排到最后');
    assert.equal(s.ids.filter((x) => x === 'a').length, 3);
  });

  test('队列很短时，“还不会”的卡只能紧接着再出现，不会死循环', () => {
    let s = cards.createSession([{ id: 'a' }, { id: 'b' }]);
    s = cards.rate(s, 'a', 'again');
    assert.deepEqual(s.ids, ['a', 'b', 'a']);
    assert.equal(cards.current(s), 'b');
    s = cards.rate(s, 'b', 'known');
    assert.equal(cards.current(s), 'a');
    s = cards.rate(s, 'a', 'known');
    assert.equal(s.finished, true);
    let one = cards.createSession([{ id: 'x' }]);
    one = cards.rate(one, 'x', 'again');
    assert.deepEqual(one.ids, ['x', 'x']);
    assert.equal(cards.current(one), 'x');
    one = cards.rate(one, 'x', 'known');
    assert.equal(one.finished, true);
  });

  test('回到前面把卡标成“掌握了”：它排在后面的那次出现会被取消', () => {
    let s = cards.createSession(deck);
    s = cards.rate(s, 'a', 'again');
    assert.deepEqual(s.ids, ['a', 'b', 'c', 'd', 'a', 'e', 'f']);
    s = cards.move(s, -1);
    assert.equal(cards.current(s), 'a');
    s = cards.rate(s, 'a', 'known');
    assert.deepEqual(s.ids, ['a', 'b', 'c', 'd', 'e', 'f']);
    assert.equal(cards.current(s), 'b');
  });

  test('上一张 / 下一张不会越界；队列结束后还能退回去看', () => {
    let s = cards.createSession(deck);
    cards.move(s, -1);
    assert.equal(s.pos, 0);
    cards.move(s, 99);
    assert.equal(s.pos, 5);
    assert.equal(cards.current(s), 'f');
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach((id) => { s = cards.rate(s, id, 'known'); });
    assert.equal(s.finished, true);
    s = cards.move(s, -1);
    assert.equal(s.finished, false);
    assert.equal(cards.current(s), 'f');
    assert.equal(cards.move(null, 1), null);
    assert.equal(cards.move(cards.createSession([]), 1).finished, true, '空队列移动后仍是结束状态');
  });

  test('只能给当前这张卡评分；评分值不合法时什么都不改', () => {
    let s = cards.createSession(deck);
    const before = JSON.stringify(s);
    assert.equal(cards.rate(s, 'c', 'known'), s);
    assert.equal(JSON.stringify(s), before);
    cards.rate(s, 'a', 'maybe');
    assert.equal(JSON.stringify(s), before);
    assert.equal(cards.rate(null, 'a', 'known'), null);
    s = cards.rate(s, 'a', 'known');
    assert.notEqual(JSON.stringify(s), before);
  });

  test('可以指定间隔大小', () => {
    let s = cards.createSession('abcde'.split('').map((id) => ({ id })));
    s = cards.rate(s, 'a', 'again', { gap: 1 });
    assert.deepEqual(s.ids, ['a', 'b', 'a', 'c', 'd', 'e']);
    s = cards.rate(s, 'b', 'known');
    assert.equal(cards.current(s), 'a');
  });
});

describe('速记卡 · 筛选、打乱与掌握度统计', () => {
  test('按领域、难度、状态、关键词筛选，可以组合', () => {
    assert.equal(cards.filter(DATA.CARDS, {}).length, DATA.CARDS.length);
    const agile = cards.filter(DATA.CARDS, { domain: '敏捷与混合' });
    assert.ok(agile.length > 0 && agile.every((c) => c.domain === '敏捷与混合'));
    assert.equal(cards.filter(DATA.CARDS, { domain: '全部' }).length, DATA.CARDS.length);
    const applied = cards.filter(DATA.CARDS, { level: '应用' });
    assert.ok(applied.length > 0 && applied.every((c) => c.level === '应用'));
    assert.equal(cards.filter(DATA.CARDS, { level: '全部' }).length, DATA.CARDS.length);

    const progress = { 'ag-01': { s: 'known' }, 'ag-02': { s: 'again' } };
    assert.deepEqual(cards.filter(DATA.CARDS, { domain: '敏捷与混合', status: 'known' }, progress).map((c) => c.id), ['ag-01']);
    assert.deepEqual(cards.filter(DATA.CARDS, { domain: '敏捷与混合', status: 'again' }, progress).map((c) => c.id), ['ag-02']);
    assert.equal(cards.filter(DATA.CARDS, { domain: '敏捷与混合', status: 'unseen' }, progress).length, agile.length - 2);
    assert.equal(cards.filter(DATA.CARDS, { status: 'all' }, progress).length, DATA.CARDS.length);

    const combo = cards.filter(DATA.CARDS, { domain: '基础计算与合同', level: '应用' });
    assert.ok(combo.length > 0 && combo.every((c) => c.domain === '基础计算与合同' && c.level === '应用'));
    assert.equal(cards.filter(DATA.CARDS, { domain: '不存在的领域' }).length, 0);
  });

  test('搜索：不区分大小写，空格分开的多个词都要出现', () => {
    const found = cards.filter(DATA.CARDS, { q: '上报' });
    assert.ok(found.some((c) => c.id === 'p6-env-01') && found.some((c) => c.id === 'p6-env-02'));
    assert.ok(cards.filter(DATA.CARDS, { q: 'SCRUM' }).length > 0);
    assert.deepEqual(
      cards.filter(DATA.CARDS, { q: 'scrum master' }).map((c) => c.id),
      cards.filter(DATA.CARDS, { q: 'Scrum Master' }).map((c) => c.id)
    );
    assert.ok(cards.filter(DATA.CARDS, { q: '  ' }).length === DATA.CARDS.length);
    assert.equal(cards.filter(DATA.CARDS, { q: '没有这个词xyz' }).length, 0);
    const both = cards.filter(DATA.CARDS, { q: '风险 上报' });
    assert.ok(both.length >= 2);
    both.forEach((c) => assert.ok(cards.match(cards.haystack(c), ['风险', '上报']), c.id));
    /* 搜索范围包括正面、背面、领域、依据、难度和版本说明 */
    assert.ok(cards.filter(DATA.CARDS, { q: 'PMBOK 第 6 版' }).length > 0);
    assert.ok(cards.filter(DATA.CARDS, { q: '关注领域' }).some((c) => c.id === 'p8-04'));
    assert.ok(cards.filter(DATA.CARDS, { q: '应用' }).length > 0);
  });

  test('打乱顺序：只是换个顺序，不增不减、不改动原数组，随机源固定时结果可复现', () => {
    const input = DATA.CARDS.map((c) => c.id);
    let seed = 42;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const first = cards.shuffle(input, rng);
    seed = 42;
    const second = cards.shuffle(input, rng);
    assert.deepEqual(first, second);
    assert.notDeepEqual(first, input);
    assert.deepEqual(first.slice().sort(), input.slice().sort());
    assert.deepEqual(input, DATA.CARDS.map((c) => c.id));
    [() => 1, () => -1, () => NaN, () => 0.999999].forEach((bad) => {
      assert.deepEqual(cards.shuffle(['a', 'b', 'c'], bad).slice().sort(), ['a', 'b', 'c']);
    });
    assert.deepEqual(cards.shuffle([]), []);
    /* 打乱后进入队列，队列里的卡片还是原来那几张 */
    const session = cards.createSession(DATA.CARDS.slice(0, 5), { shuffle: true, rng });
    assert.deepEqual(session.ids.slice().sort(), DATA.CARDS.slice(0, 5).map((c) => c.id).sort());
  });

  test('评分写入进度：掌握与还不会的次数分别累计，以最后一次为准', () => {
    let p = {};
    const before = p;
    p = cards.recordRating(p, 'a', 'again', 1000);
    assert.deepEqual(p, { a: { s: 'again', t: 1000, k: 0, a: 1 } });
    assert.deepEqual(before, {}, '不改动传入的进度对象');
    p = cards.recordRating(p, 'a', 'again', 1001);
    assert.deepEqual(p.a, { s: 'again', t: 1001, k: 0, a: 2 });
    p = cards.recordRating(p, 'a', 'known', 1002);
    assert.deepEqual(p.a, { s: 'known', t: 1002, k: 1, a: 2 });
    p = cards.recordRating(p, 'b', 'known', 1003);
    assert.deepEqual(p.b, { s: 'known', t: 1003, k: 1, a: 0 });
    assert.equal(cards.status(p, 'a'), 'known');
    assert.equal(cards.status(p, 'zzz'), 'unseen');
    assert.equal(cards.status(null, 'a'), 'unseen');
    assert.equal(cards.status({}, 'a'), 'unseen');
    /* 传入题库时，顺带清掉已经不存在的卡片 */
    let q = { old: { s: 'known' }, a: { s: 'again' } };
    q = cards.recordRating(q, 'a', 'known', 2000, [{ id: 'a' }]);
    assert.deepEqual(Object.keys(q), ['a']);
    assert.equal(q.a.s, 'known');
    assert.equal(q.a.k, 1);
    /* 评分值不合法：只做整理，不记这次评分 */
    assert.deepEqual(cards.recordRating({ a: { s: 'again' } }, 'a', 'maybe', 1, []), {});
  });

  test('从本机读回的进度会先整理：丢掉已不存在的卡片和非法状态，数字拉回合法范围', () => {
    const deck = [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }];
    const cleaned = cards.normalizeProgress({
      g1: { s: 'known', t: 5, k: 2, a: 1 },
      g2: { s: 'again' },
      g3: { s: 'known', t: 'abc', k: -3, a: 1.6 },
      stale: { s: 'known' },
      bad: { s: 'nope' },
      junk: 'x',
      nul: null
    }, deck);
    assert.deepEqual(Object.keys(cleaned).sort(), ['g1', 'g2', 'g3']);
    assert.deepEqual(cleaned.g1, { s: 'known', t: 5, k: 2, a: 1 });
    assert.deepEqual(cleaned.g2, { s: 'again', t: 0, k: 0, a: 0 });
    assert.deepEqual(cleaned.g3, { s: 'known', t: 0, k: 0, a: 2 });
    assert.deepEqual(cards.normalizeProgress(null, deck), {});
    assert.deepEqual(cards.normalizeProgress('bad', deck), {});
    assert.deepEqual(cards.normalizeProgress({ g1: { s: 'known' } }, []), {});
  });

  test('掌握度统计：总数、已掌握、还不会、未学，以及按领域、难度、依据的分组', () => {
    const deck = [
      { id: '1', domain: '人员', level: '了解', basis: 'A' },
      { id: '2', domain: '人员', level: '理解', basis: 'A' },
      { id: '3', domain: '人员', level: '应用', basis: 'B' },
      { id: '4', domain: '过程', level: '了解', basis: 'B' },
      { id: '5', domain: '过程', level: '了解', basis: 'B' }
    ];
    const none = cards.stats(deck, {});
    assert.deepEqual([none.total, none.known, none.again, none.unseen, none.learned, none.percent], [5, 0, 0, 5, 0, 0]);
    const p = { 1: { s: 'known' }, 2: { s: 'again' }, 3: { s: 'known' }, 4: { s: 'known' } };
    const s = cards.stats(deck, p);
    assert.deepEqual([s.total, s.known, s.again, s.unseen, s.learned, s.percent], [5, 3, 1, 1, 4, 60]);
    const people = s.byDomain.find((g) => g.key === '人员');
    assert.deepEqual(people, { key: '人员', total: 3, known: 2, again: 1, unseen: 0, percent: 67 });
    assert.deepEqual(s.byDomain.map((g) => g.key), ['人员', '过程'], '按固定顺序排列');
    assert.deepEqual(s.byLevel.map((g) => [g.key, g.total, g.known]), [['了解', 3, 2], ['理解', 1, 0], ['应用', 1, 1]]);
    assert.equal(s.byBasis.find((g) => g.key === 'B').total, 3);
    assert.deepEqual(cards.stats([], {}).byDomain, []);
    assert.equal(cards.stats(null, null).total, 0);
  });

  test('用真实题库统计：各领域张数之和等于总数，某个领域全部掌握后完成度为 100', () => {
    const empty = cards.stats(DATA.CARDS, {});
    assert.equal(empty.known, 0);
    assert.equal(empty.unseen, DATA.CARDS.length);
    assert.equal(empty.byDomain.reduce((n, g) => n + g.total, 0), DATA.CARDS.length);
    assert.equal(empty.byBasis.reduce((n, g) => n + g.total, 0), DATA.CARDS.length);
    assert.equal(empty.byLevel.reduce((n, g) => n + g.total, 0), DATA.CARDS.length);
    assert.equal(empty.byDomain.length, 7);
    assert.deepEqual(empty.byDomain.map((g) => g.key), cards.DOMAINS);
    const progress = {};
    DATA.CARDS.filter((c) => c.domain === '第八版框架').forEach((c) => { progress[c.id] = { s: 'known' }; });
    const s = cards.stats(DATA.CARDS, progress);
    const g = s.byDomain.find((x) => x.key === '第八版框架');
    assert.equal(g.percent, 100);
    assert.equal(g.known, g.total);
    assert.equal(s.known, g.total);
    assert.equal(s.percent, Math.round(g.total / DATA.CARDS.length * 100));
    /* 进度里混进已经下架的卡片，不影响统计 */
    progress['已下架的卡'] = { s: 'known' };
    assert.equal(cards.stats(DATA.CARDS, progress).known, g.total);
  });

  test('标“还不会”之后再标“掌握了”，统计随之更新', () => {
    let p = cards.recordRating({}, 'p8-01', 'again', 1);
    let s = cards.stats(DATA.CARDS, p);
    assert.equal(s.again, 1);
    assert.equal(cards.filter(DATA.CARDS, { status: 'again' }, p).map((c) => c.id).join(), 'p8-01');
    p = cards.recordRating(p, 'p8-01', 'known', 2);
    s = cards.stats(DATA.CARDS, p);
    assert.equal(s.again, 0);
    assert.equal(s.known, 1);
    assert.deepEqual(cards.filter(DATA.CARDS, { status: 'known' }, p).map((c) => c.id), ['p8-01']);
  });
});

/* ==========================================================================
   五、大纲检索
   ========================================================================== */
describe('大纲检索', () => {
  test('空关键词返回全部 26 项任务', () => {
    ['', '   ', null, undefined].forEach((q) => {
      const r = CORE.eco.search(DATA, q);
      assert.equal(r.matched, 26);
      assert.equal(r.total, 26);
      assert.equal(r.domains.length, 3);
      assert.deepEqual(r.domains.map((d) => d.tasks.length), [8, 10, 8]);
    });
  });

  test('按任务标题和要点检索，只返回命中的任务', () => {
    const r = CORE.eco.search(DATA, '风险');
    assert.ok(r.matched > 0 && r.matched < 26);
    assert.ok(r.domains.some((d) => d.name === '业务环境' && d.tasks.some((t) => t.title === '规划和管理风险')));
    r.domains.forEach((d) => d.tasks.forEach((t) => {
      const text = [d.name, t.title].concat(t.points).join(' ');
      assert.ok(cards.match(text, r.terms), t.title);
    }));
    assert.equal(r.total, 26);
  });

  test('没有命中时返回空结果，而不是全部', () => {
    const r = CORE.eco.search(DATA, '没有这个词xyz');
    assert.equal(r.matched, 0);
    assert.deepEqual(r.domains, []);
    assert.equal(r.total, 26);
  });

  test('不区分大小写；空格分开的多个词都要出现', () => {
    const a = CORE.eco.search(DATA, 'OPA');
    const b = CORE.eco.search(DATA, 'opa');
    assert.equal(a.matched, b.matched);
    assert.ok(a.matched >= 2);
    assert.equal(a.domains.length, 1, '组织过程资产只出现在业务环境的任务里');
    const both = CORE.eco.search(DATA, '风险 登记');
    assert.ok(both.matched >= 1);
    both.domains.forEach((d) => d.tasks.forEach((t) => {
      assert.ok(cards.match([t.title].concat(t.points).join(' '), ['风险', '登记']), t.title);
    }));
    assert.ok(both.matched < CORE.eco.search(DATA, '风险').matched);
    assert.equal(CORE.eco.search(DATA, '风险 不存在的词').matched, 0);
  });

  test('搜索匹配工具：多词、大小写、空词', () => {
    assert.deepEqual(cards.terms('  Scrum   Master '), ['scrum', 'master']);
    assert.deepEqual(cards.terms(''), []);
    assert.deepEqual(cards.terms(null), []);
    assert.equal(cards.match('Scrum Master 负责排除障碍', ['scrum']), true);
    assert.equal(cards.match('Scrum Master 负责排除障碍', ['scrum', 'master']), true);
    assert.equal(cards.match('Scrum Master 负责排除障碍', ['scrum', 'product']), false);
    assert.equal(cards.match('任意文本', []), true);
    assert.equal(cards.match('任意文本', ['']), true);
  });
});

/* ==========================================================================
   六、模块加载方式
   ========================================================================== */
describe('模块加载', () => {
  test('Node 里 core.js 不带数据也能加载：需要数据的函数显式传参即可', () => {
    const broken = CORE.validate({});
    assert.equal(broken.ok, false);
    assert.ok(Array.isArray(broken.errors) && broken.errors.length > 0);
    assert.ok(CORE.validate(null).ok === false);
    assert.equal(CORE.evm.presets(DATA).length, 3);
    assert.equal(CORE.evm.presets({}).length, 0);
    assert.equal(CORE.evm.presets().length, 0);
    assert.equal(CORE.eco.search({}, '风险').total, 0);
    assert.equal(CORE.eco.search(null, '').total, 0);
    assert.deepEqual(risk.defaults({}, 'software', 'plan'), []);
  });

  test('在浏览器之外加载不会向全局变量写东西', () => {
    assert.equal(global.APP_DATA, undefined);
    assert.equal(global.APP_CORE, undefined);
  });

  test('对外接口齐全', () => {
    ['evm', 'risk', 'cards', 'eco', 'validate'].forEach((k) => {
      assert.ok(CORE[k] !== undefined && CORE[k] !== null, 'APP_CORE 缺少 ' + k);
    });
    assert.equal(typeof CORE.validate, 'function');
    assert.equal(typeof evm.compute, 'function');
    assert.equal(typeof evm.parse, 'function');
    assert.equal(typeof evm.validate, 'function');
    assert.equal(typeof risk.csv, 'function');
    assert.equal(typeof risk.markdown, 'function');
    assert.equal(typeof risk.matrix, 'function');
    assert.equal(typeof cards.rate, 'function');
    assert.equal(typeof cards.filter, 'function');
    assert.equal(typeof cards.stats, 'function');
    assert.equal(typeof CORE.eco.search, 'function');
    ['ECO', 'EVM', 'RISK_LIBRARY', 'CARDS', 'PROJECT_TYPES', 'FOCUS_AREAS', 'TEXTS'].forEach((k) => {
      assert.ok(DATA[k] !== undefined, 'APP_DATA 缺少 ' + k);
    });
  });
});
