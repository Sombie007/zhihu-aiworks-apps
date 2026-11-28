/* ============================================================================
   程序员避坑指南 · 单元测试（Node 内置 node:test + node:assert）
   运行：在项目根目录执行  node --test apps/coder-pitfalls/
   ========================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const DATA = require('../data.js');
const CORE = require('../core.js');
const core = CORE.create(DATA);

const ENTRIES = DATA.entries;
const BY_ID = Object.fromEntries(ENTRIES.map((entry) => [entry.id, entry]));

const CATEGORY_ORDER = ['java', 'spring', 'redis', 'mysql', 'ai', 'engineering', 'career'];
const DIFFICULTIES = ['入门', '进阶', '资深'];

/* 第一版的 57 条，按原来的分类和顺序列出，保证一条都没丢、分类没串 */
const V1_IDS = {
  java: [
    'java-null-for-gc', 'java-overload-vs-override', 'java-hashmap-concurrent', 'java-string-concat-loop',
    'java-boxed-equals', 'java-interface-vs-abstract', 'java-swallow-exception', 'java-shallow-copy',
    'java-stream-misuse', 'java-executors-thread-pool'
  ],
  spring: [
    'spring-new-dependencies', 'spring-circular-dependency', 'spring-tx-self-invocation', 'spring-autoconfigure-blind',
    'spring-premature-microservices', 'spring-non-web-app', 'spring-slow-startup', 'spring-mp-primary-key',
    'spring-remote-call-timeout', 'spring-event-sync'
  ],
  redis: [
    'redis-avalanche', 'redis-penetration-breakdown', 'redis-cache-aside', 'redis-single-thread',
    'redis-persistence', 'redis-distributed-lock', 'redis-big-key', 'redis-eviction-policy'
  ],
  mysql: [
    'mysql-index-btree', 'mysql-leftmost-prefix', 'mysql-index-invalid', 'mysql-isolation-level',
    'mysql-deep-pagination', 'mysql-mvcc', 'mysql-slow-query', 'mysql-online-ddl'
  ],
  ai: [
    'ai-ai-code-review', 'ai-non-dev-build-product', 'ai-replacement-anxiety', 'ai-vibe-coding-scope',
    'ai-rpa-vs-agent', 'ai-keep-learning-java', 'ai-llm-cost', 'ai-algorithm-basics'
  ],
  career: [
    'career-degree-gap', 'career-interview-structure', 'career-depth-first', 'career-architect-thinking',
    'career-useful-comments', 'career-ds-in-practice', 'career-workflow-engine', 'career-approval-flow',
    'career-automation-tooling', 'career-redirect-301-302', 'career-learning-spring', 'career-ai-vs-coder',
    'career-debug-mindset'
  ]
};

/* 规格里列出的 12 条新增条目（按标题判断） */
const NEW_TITLES = [
  '接口不做幂等',
  '定时任务在多实例上重复跑',
  '一次性加载全量数据',
  '上线没有回滚方案',
  '配置硬编码',
  '文件读写不指定字符集',
  '时间与时区处理不当',
  '日志里找不到一次请求',
  '事务范围过大',
  'RPA 选择器一改就失效',
  '只测正常流程',
  '需求没弄清就开写'
];
const NEW_IDS = [
  'eng-idempotency', 'eng-schedule-multi-instance', 'eng-load-all-data', 'eng-no-rollback-plan',
  'eng-hardcoded-config', 'eng-charset', 'eng-timezone', 'eng-request-trace', 'spring-tx-too-long',
  'eng-rpa-selector', 'eng-happy-path-testing', 'career-clarify-requirements'
];

const C = '\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff';
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/u;
/* 正文里的中文语境一律用全角标点；代码和纯英文片段除外 */
const PROSE_PUNCT_RULES = [
  [new RegExp('[' + C + '],|,[' + C + ']'), '半角逗号'],
  [new RegExp('[' + C + '];|;[' + C + ']'), '半角分号'],
  [new RegExp('[' + C + ']:\\s?[' + C + ']'), '半角冒号'],
  [new RegExp('[' + C + ']\\.(?![a-zA-Z0-9])'), '半角句号'],
  [new RegExp('\\([^()]*[' + C + '][^()]*\\)'), '半角括号包中文'],
  [/"/, '英文双引号'],
  [/\?/, '半角问号']
];
const FORBIDDEN_CLAIMS = [
  ['真实项目', '无法核实的来源表述'],
  ['一线经验', '无法核实的来源表述'],
  ['血泪', '无法核实的来源表述'],
  ['亲测', '无法核实的来源表述'],
  ['踩坑经验', '无法核实的来源表述'],
  ['某公司', '占位文案'],
  ['张三', '占位文案'],
  ['示例文本', '占位文案'],
  ['Lorem', '占位文案'],
  ['TODO', '未完成的内容']
];

function linesOf(code) {
  return String(code).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
}

function proseOf(entry) {
  return {
    title: entry.title,
    scenario: entry.scenario,
    symptom: entry.symptom,
    cause: entry.cause,
    principle: entry.principle,
    ...Object.fromEntries(entry.fix.map((item, i) => ['fix[' + i + ']', item])),
    ...Object.fromEntries(entry.tags.map((tag, i) => ['tags[' + i + ']', tag]))
  };
}

function countSentences(text) {
  return (String(text).match(/[。！？]/g) || []).length;
}

/* 一台自定义的小数据集，用来给推荐打分做确定性验证 */
const SYNTH = CORE.create({
  categories: [{ id: 'x', label: 'X', short: 'X' }, { id: 'y', label: 'Y', short: 'Y' }],
  entries: [
    { id: 'a', title: '甲', category: 'x', difficulty: '入门', tags: ['缓存', '一致性'], related: [] },
    { id: 'b', title: '乙', category: 'x', difficulty: '入门', tags: ['缓存', '一致性'], related: [] },
    { id: 'c', title: '丙', category: 'x', difficulty: '入门', tags: ['缓存'], related: ['a'] },
    { id: 'd', title: '丁', category: 'x', difficulty: '入门', tags: ['索引'], related: [] },
    { id: 'e', title: '戊', category: 'y', difficulty: '入门', tags: ['索引'], related: [] }
  ]
});

/* ==========================================================================
   一、数据完整性
   ========================================================================== */

test('条目总数不少于 65 条', () => {
  assert.ok(Array.isArray(ENTRIES), 'entries 必须是数组');
  assert.ok(ENTRIES.length >= 65, '当前只有 ' + ENTRIES.length + ' 条');
});

test('第一版的 57 条全部保留，分类不变，加上 12 条新增正好是全部条目', () => {
  const v1 = Object.values(V1_IDS).flat();
  assert.equal(v1.length, 57, '第一版应当是 57 条');
  assert.equal(new Set(v1).size, 57, '第一版 id 不能重复');

  for (const [category, ids] of Object.entries(V1_IDS)) {
    for (const id of ids) {
      assert.ok(BY_ID[id], '第一版条目丢失：' + id);
      assert.equal(BY_ID[id].category, category, id + ' 的分类应当保持为 ' + category);
    }
  }

  const expected = new Set([...v1, ...NEW_IDS]);
  assert.equal(expected.size, 69);
  assert.deepEqual(
    new Set(ENTRIES.map((entry) => entry.id)),
    expected,
    '条目集合应当正好是“第一版 57 条 + 新增 12 条”'
  );
});

test('每条的必填字段都非空，取值符合规定', () => {
  for (const entry of ENTRIES) {
    const where = entry.id || '(缺少 id)';
    assert.match(String(entry.id), /^[a-z0-9]+(-[a-z0-9]+)*$/, where + '：id 应为短横线分隔的英文');
    assert.ok(typeof entry.title === 'string' && entry.title.trim(), where + '：title 为空');
    assert.ok(entry.title.length <= 30, where + '：标题过长');
    assert.ok(!/注意|问题$/.test(entry.title), where + '：标题应写“做法”，不写“注意 XX”');
    assert.ok(!/[？?]|^为什么/.test(entry.title), where + '：标题不应写成问句');

    assert.ok(CATEGORY_ORDER.includes(entry.category), where + '：category 不在枚举值里：' + entry.category);
    assert.ok(DIFFICULTIES.includes(entry.difficulty), where + '：difficulty 不在枚举值里：' + entry.difficulty);

    for (const field of ['scenario', 'symptom', 'cause', 'principle']) {
      assert.ok(typeof entry[field] === 'string' && entry[field].trim(), where + '：' + field + ' 为空');
    }

    assert.ok(Array.isArray(entry.tags) && entry.tags.length >= 1, where + '：tags 至少一个');
    assert.equal(new Set(entry.tags).size, entry.tags.length, where + '：tags 有重复');
    entry.tags.forEach((tag) => assert.ok(typeof tag === 'string' && tag.trim(), where + '：tag 为空'));

    assert.ok(Array.isArray(entry.fix) && entry.fix.length >= 2, where + '：fix 至少两条');
    entry.fix.forEach((item) => {
      assert.ok(typeof item === 'string' && item.trim(), where + '：fix 里有空项');
      assert.ok(item.endsWith('。'), where + '：fix 每条应当是完整的一句话：' + item);
      assert.equal(countSentences(item), 1, where + '：fix 每条只能有一句：' + item);
    });

    assert.ok(Array.isArray(entry.related), where + '：related 必须是数组');
    assert.ok(entry.related.length <= 3, where + '：related 最多 3 个');
    assert.equal(new Set(entry.related).size, entry.related.length, where + '：related 有重复');
  }
});

test('id 唯一，标题唯一', () => {
  const ids = ENTRIES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'id 有重复');
  const titles = ENTRIES.map((entry) => entry.title);
  assert.equal(new Set(titles).size, titles.length, '标题有重复');
});

test('related 里的 id 都存在，且不指向自己', () => {
  for (const entry of ENTRIES) {
    for (const id of entry.related) {
      assert.ok(BY_ID[id], entry.id + ' 的 related 指向不存在的条目：' + id);
      assert.notEqual(id, entry.id, entry.id + ' 的 related 指向了自己');
    }
  }
});

test('七个分类每个都有条目，分类元数据完整', () => {
  assert.deepEqual(DATA.categories.map((c) => c.id), CATEGORY_ORDER, '分类顺序应与规格一致');
  for (const category of DATA.categories) {
    for (const field of ['id', 'label', 'short', 'desc']) {
      assert.ok(typeof category[field] === 'string' && category[field].trim(), '分类 ' + category.id + ' 缺少 ' + field);
    }
    const count = ENTRIES.filter((entry) => entry.category === category.id).length;
    assert.ok(count > 0, '分类 ' + category.id + ' 下没有条目');
  }
  assert.equal(new Set(DATA.categories.map((c) => c.label)).size, DATA.categories.length, '分类名称有重复');
});

test('三个难度都有条目', () => {
  for (const level of DIFFICULTIES) {
    const count = ENTRIES.filter((entry) => entry.difficulty === level).length;
    assert.ok(count > 0, '难度“' + level + '”下没有条目');
  }
});

test('规格列出的 12 条新增条目都存在（按标题判断）', () => {
  const titles = new Set(ENTRIES.map((entry) => entry.title));
  for (const title of NEW_TITLES) {
    assert.ok(titles.has(title), '缺少新增条目：' + title);
  }
  for (const id of NEW_IDS) assert.ok(BY_ID[id], '缺少新增条目 id：' + id);
  const engineering = ENTRIES.filter((entry) => entry.category === 'engineering');
  assert.equal(engineering.length, 10, '工程实践应有 10 条');
  assert.equal(BY_ID['spring-tx-too-long'].category, 'spring');
  assert.equal(BY_ID['career-clarify-requirements'].category, 'career');
});

test('字数符合规格：什么时候遇到 1–2 句、现象 1–2 句、根因 1–3 句、原则 1 句', () => {
  for (const entry of ENTRIES) {
    assert.ok(countSentences(entry.scenario) >= 1 && countSentences(entry.scenario) <= 2, entry.id + '：scenario 的句数');
    assert.ok(countSentences(entry.symptom) >= 1 && countSentences(entry.symptom) <= 2, entry.id + '：symptom 的句数');
    assert.ok(countSentences(entry.cause) >= 1 && countSentences(entry.cause) <= 3, entry.id + '：cause 的句数');
    assert.equal(countSentences(entry.principle), 1, entry.id + '：principle 应为一句');
  }
});

test('有 example 的条目 bad 和 good 都非空，语言有登记，行数 5–14 行', () => {
  let withExample = 0;
  for (const entry of ENTRIES) {
    if (!entry.example) continue;
    withExample += 1;
    assert.ok(DATA.meta.languages[entry.example.lang], entry.id + '：示例语言没有登记：' + entry.example.lang);
    for (const part of ['bad', 'good']) {
      const code = entry.example[part];
      assert.ok(typeof code === 'string' && code.trim(), entry.id + '：example.' + part + ' 为空');
      const count = linesOf(code).length;
      assert.ok(count >= 5 && count <= 14, entry.id + '：example.' + part + ' 有 ' + count + ' 行');
      assert.ok(!code.includes('</script'), entry.id + '：示例里不能出现 </script');
      if (entry.example.lang !== 'text') {
        assert.ok(code.includes('关键'), entry.id + '：example.' + part + ' 需要用注释标出关键的那一行');
      }
    }
  }
  assert.ok(withExample >= 50, '带代码示例的条目偏少：' + withExample);
  // 只有观点类的条目才可以省略示例
  for (const entry of ENTRIES) {
    if (entry.example) continue;
    assert.ok(['ai', 'career'].includes(entry.category), entry.id + '：技术类条目应当有代码示例');
  }
});

test('条目结构严格按规格，没有多余字段', () => {
  const allowed = ['id', 'title', 'category', 'difficulty', 'tags', 'scenario', 'symptom', 'cause', 'fix', 'example', 'principle', 'related'];
  for (const entry of ENTRIES) {
    for (const key of Object.keys(entry)) {
      assert.ok(allowed.includes(key), entry.id + '：出现规格之外的字段 ' + key);
    }
    if (entry.example) {
      assert.deepEqual(Object.keys(entry.example).sort(), ['bad', 'good', 'lang'], entry.id + '：example 的字段不对');
    }
  }
});

test('文案：全角标点，没有 emoji，没有占位文案，没有无法核实的来源表述', () => {
  for (const entry of ENTRIES) {
    const prose = proseOf(entry);
    for (const [field, text] of Object.entries(prose)) {
      const where = entry.id + '.' + field;
      assert.ok(!EMOJI_RE.test(text), where + '：出现了 emoji');
      for (const [re, label] of PROSE_PUNCT_RULES) {
        assert.ok(!re.test(text), where + '：' + label + ' :: ' + text);
      }
      for (const [word, label] of FORBIDDEN_CLAIMS) {
        assert.ok(!text.includes(word), where + '：' + label + '（' + word + '）');
      }
    }
  }
});

test('代码示例里没有真实公司的域名、IP 和密钥', () => {
  for (const entry of ENTRIES) {
    if (!entry.example) continue;
    for (const part of ['bad', 'good']) {
      const code = entry.example[part];
      const where = entry.id + '.' + part;
      assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(code), where + '：出现了 IP 地址');
      assert.ok(!/[a-z0-9-]+\.(com|cn|net|org|io)\b/i.test(code), where + '：出现了公网域名');
      assert.ok(!/password\s*=\s*\S+/i.test(code), where + '：出现了明文密码');
      assert.ok(!/-----BEGIN|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}/.test(code), where + '：出现了密钥');
      for (const line of linesOf(code)) {
        for (const comment of line.split(/\/\/|--(?=\s)|(?<=^|\s)#(?=\s)/).slice(1)) {
          assert.ok(!EMOJI_RE.test(comment), where + '：注释里出现了 emoji');
          assert.ok(!/[a-z0-9-]+\.(com|cn|net|org)\b/i.test(comment), where + '：注释里出现了域名');
        }
      }
    }
  }
});

/* ==========================================================================
   二、加载方式（浏览器与 Node）
   ========================================================================== */

test('Node 下可以 require：data.js 给出数据，core.js 给出带 create 的接口', () => {
  assert.equal(typeof DATA.entries.length, 'number');
  assert.equal(typeof CORE.create, 'function');
  assert.equal(CORE.entries.length, 0, '没有数据时默认接口应当是空的');
  assert.equal(core.entries.length, ENTRIES.length);
});

test('浏览器下挂在 window 上：先 data.js 再 core.js，core 直接读到 APP_DATA', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'), sandbox, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8'), sandbox, { filename: 'core.js' });
  assert.equal(sandbox.APP_DATA.entries.length, ENTRIES.length);
  assert.equal(sandbox.APP_CORE.entries.length, ENTRIES.length);
  assert.equal(sandbox.APP_CORE.get('redis-avalanche').title, '大量缓存 key 同时过期');
  assert.equal(typeof sandbox.APP_CORE.query, 'function');
});

/* ==========================================================================
   三、搜索
   ========================================================================== */

test('空查询原样返回，顺序不变，不改动原数组', () => {
  const result = core.search(ENTRIES, '');
  assert.deepEqual(result.map((e) => e.id), ENTRIES.map((e) => e.id));
  assert.deepEqual(core.search(ENTRIES, '   ').map((e) => e.id), ENTRIES.map((e) => e.id));
  assert.notEqual(result, ENTRIES, '应当返回新数组');
});

test('按标题搜索排在最前', () => {
  const result = core.search(ENTRIES, '雪崩');
  assert.equal(result[0].id, 'redis-avalanche');
  assert.ok(result.length > 1, '正文里提到雪崩的条目也应当被搜到');
});

test('标题命中排在只有标签、正文命中的前面', () => {
  const result = core.search(ENTRIES, '事务').map((e) => e.id);
  assert.ok(result.indexOf('spring-tx-too-long') < result.indexOf('mysql-isolation-level'));
  assert.ok(result.indexOf('spring-tx-self-invocation') < result.indexOf('mysql-isolation-level'));
  assert.ok(result.includes('mysql-isolation-level'), '标签里的事务也要能搜到');
});

test('多个词之间是“且”的关系', () => {
  const result = core.search(ENTRIES, '事务 远程').map((e) => e.id);
  assert.ok(result.includes('spring-tx-too-long'));
  assert.ok(!result.includes('redis-avalanche'), '只命中其中一个词的条目不应出现');
  assert.ok(!result.includes('spring-tx-self-invocation'));
  assert.deepEqual(core.search(ENTRIES, '雪崩 不存在词'), []);
});

test('中文和英文粘在一起也能切开', () => {
  assert.deepEqual(core.tokenize('spring事务'), ['spring', '事务']);
  assert.deepEqual(core.tokenize('Ｃache   Aside 缓存'), ['cache', 'aside', '缓存']);
  assert.deepEqual(core.tokenize('   '), []);
  assert.deepEqual(
    core.search(ENTRIES, 'spring事务').map((e) => e.id),
    core.search(ENTRIES, 'spring 事务').map((e) => e.id)
  );
});

test('不区分大小写和全角半角', () => {
  assert.deepEqual(
    core.search(ENTRIES, 'REDIS').map((e) => e.id),
    core.search(ENTRIES, 'redis').map((e) => e.id)
  );
  const result = core.search(ENTRIES, '＠ＴＲＡＮＳＡＣＴＩＯＮＡＬ').map((e) => e.id);
  assert.ok(result.includes('spring-tx-self-invocation'));
});

test('标签和正文都能搜到', () => {
  assert.ok(core.search(ENTRIES, '布隆过滤器').map((e) => e.id).includes('redis-penetration-breakdown'));
  assert.ok(core.search(ENTRIES, 'ForkJoinPool').map((e) => e.id).includes('java-stream-misuse'));
  assert.ok(core.search(ENTRIES, '看门狗').map((e) => e.id).includes('redis-distributed-lock'));
});

test('没有结果时返回空数组', () => {
  assert.deepEqual(core.search(ENTRIES, '这个词在任何条目里都没有出现zzz'), []);
});

/* ==========================================================================
   四、筛选
   ========================================================================== */

test('按主题筛选', () => {
  const result = core.query(ENTRIES, { category: 'redis' });
  assert.equal(result.length, 8);
  assert.ok(result.every((e) => e.category === 'redis'));
  assert.deepEqual(core.query(ENTRIES, { category: 'all' }).map((e) => e.id), ENTRIES.map((e) => e.id));
});

test('按难度筛选', () => {
  const result = core.query(ENTRIES, { difficulty: '资深' });
  assert.ok(result.length > 0);
  assert.ok(result.every((e) => e.difficulty === '资深'));
  assert.equal(result.length, ENTRIES.filter((e) => e.difficulty === '资深').length);
});

test('按阅读状态筛选：已读 / 未读', () => {
  const read = { 'redis-avalanche': 1, 'mysql-mvcc': 2 };
  const readList = core.query(ENTRIES, { status: 'read' }, read).map((e) => e.id);
  assert.deepEqual(readList.sort(), ['mysql-mvcc', 'redis-avalanche']);
  const unread = core.query(ENTRIES, { status: 'unread' }, read);
  assert.equal(unread.length, ENTRIES.length - 2);
  assert.ok(!unread.some((e) => read[e.id]));
  // 没有阅读记录时，状态筛选不该把所有条目都筛掉
  assert.equal(core.query(ENTRIES, { status: 'unread' }, {}).length, ENTRIES.length);
  assert.deepEqual(core.query(ENTRIES, { status: 'read' }, {}), []);
});

test('阅读记录可以是普通对象，也可以是 Set', () => {
  const asObject = core.query(ENTRIES, { status: 'read' }, { 'redis-avalanche': 1761000000000 });
  const asSet = core.query(ENTRIES, { status: 'read' }, new Set(['redis-avalanche']));
  assert.deepEqual(asObject.map((e) => e.id), asSet.map((e) => e.id));
  assert.deepEqual(asObject.map((e) => e.id), ['redis-avalanche']);
  assert.deepEqual(core.query(ENTRIES, { status: 'read' }, undefined), []);
});

test('主题、难度、状态和搜索可以叠加', () => {
  const read = { 'spring-tx-self-invocation': 1 };
  const result = core.query(ENTRIES, { category: 'spring', difficulty: '进阶', status: 'unread', query: '事务' }, read);
  assert.ok(result.length >= 1);
  assert.ok(result.every((e) => e.category === 'spring' && e.difficulty === '进阶' && !read[e.id]));
  assert.ok(result.every((e) => core.search([e], '事务').length === 1));
  assert.ok(result.every((e) => e.id !== 'spring-tx-self-invocation'));
  assert.deepEqual(core.query(ENTRIES, { category: 'redis', query: '事务' }), []);
});

test('hasActiveFilters 判断当前有没有生效的筛选条件', () => {
  assert.equal(core.hasActiveFilters({}), false);
  assert.equal(core.hasActiveFilters(null), false);
  assert.equal(core.hasActiveFilters({ category: 'all', difficulty: 'all', status: 'all', query: '  ' }), false);
  assert.equal(core.hasActiveFilters({ category: 'redis' }), true);
  assert.equal(core.hasActiveFilters({ difficulty: '入门' }), true);
  assert.equal(core.hasActiveFilters({ status: 'unread' }), true);
  assert.equal(core.hasActiveFilters({ query: '缓存' }), true);
});

test('countBy 按字段统计条数', () => {
  const byCategory = core.countBy(ENTRIES, 'category');
  assert.equal(byCategory.java, 10);
  assert.equal(byCategory.spring, 11);
  assert.equal(byCategory.redis, 8);
  assert.equal(byCategory.mysql, 8);
  assert.equal(byCategory.ai, 8);
  assert.equal(byCategory.engineering, 10);
  assert.equal(byCategory.career, 14);
  assert.equal(Object.values(byCategory).reduce((a, b) => a + b, 0), ENTRIES.length);
  const byDifficulty = core.countBy(ENTRIES, 'difficulty');
  assert.equal(Object.values(byDifficulty).reduce((a, b) => a + b, 0), ENTRIES.length);
});

test('分类名称', () => {
  assert.equal(core.categoryLabel('engineering'), '工程实践');
  assert.equal(core.categoryShort('java'), 'Java');
  assert.equal(core.categoryLabel('不存在'), '不存在');
  assert.equal(core.categoryOf('redis').desc.length > 0, true);
});

/* ==========================================================================
   五、相似条目推荐
   ========================================================================== */

test('推荐不包含自己，也不包含已经列为相关的条目', () => {
  for (const entry of ENTRIES) {
    const ids = core.recommend(entry.id, 5).map((e) => e.id);
    assert.ok(!ids.includes(entry.id), entry.id + '：推荐里有自己');
    for (const id of entry.related) {
      assert.ok(!ids.includes(id), entry.id + '：推荐里出现了已列为相关的 ' + id);
    }
    assert.equal(new Set(ids).size, ids.length, entry.id + '：推荐有重复');
  }
});

test('推荐按共同标签、反向相关、同主题打分，分数高的在前', () => {
  assert.deepEqual(SYNTH.recommend('a').map((e) => e.id), ['c', 'b', 'd']);
  // c：共同标签 1 个（3 分）+ 把 a 列为相关（4 分）+ 同主题（2 分）= 9
  // b：共同标签 2 个（6 分）+ 同主题（2 分）= 8
  // d：只有同主题（2 分）= 2
  // e：没有任何交集，不推荐
});

test('推荐的数量受 limit 控制，exclude 可以再排除', () => {
  assert.deepEqual(SYNTH.recommend('a').map((e) => e.id), ['c', 'b', 'd'].slice(0, 3));
  assert.deepEqual(SYNTH.recommend('a', 1).map((e) => e.id), ['c']);
  assert.deepEqual(SYNTH.recommend('a', 2).map((e) => e.id), ['c', 'b']);
  assert.deepEqual(SYNTH.recommend('a', 3, ['c']).map((e) => e.id), ['b', 'd']);
  assert.deepEqual(SYNTH.recommend('a', 0), []);
});

test('没有任何交集的条目不会被推荐，未知 id 返回空', () => {
  assert.deepEqual(SYNTH.recommend('e').map((e) => e.id), ['d']);
  // d 和 a、b、c 只是同主题（各 2 分，按原顺序），和 e 有共同标签（3 分）
  assert.deepEqual(SYNTH.recommend('d').map((e) => e.id), ['e', 'a', 'b']);
  assert.deepEqual(SYNTH.recommend('不存在'), []);
  assert.deepEqual(core.recommend('不存在', 3), []);
});

test('每条都至少能推荐出一条相似条目', () => {
  for (const entry of ENTRIES) {
    assert.ok(core.recommend(entry.id, 3).length >= 1, entry.id + '：推荐不出来');
  }
});

/* ==========================================================================
   六、上一条 / 下一条 / 随机
   ========================================================================== */

test('neighbor 取上一条和下一条，到头返回 null', () => {
  const list = core.entries;
  assert.equal(core.neighbor(list, list[0].id, 1).id, list[1].id);
  assert.equal(core.neighbor(list, list[1].id, -1).id, list[0].id);
  assert.equal(core.neighbor(list, list[0].id, -1), null);
  assert.equal(core.neighbor(list, list[list.length - 1].id, 1), null);
  assert.equal(core.neighbor(list, '不存在', 1), null);
  // 在筛选后的列表里，“下一条”是筛选结果里的下一条，不是全部条目里的下一条
  const redis = core.query(ENTRIES, { category: 'redis' });
  assert.equal(core.neighbor(redis, redis[redis.length - 1].id, 1), null);
});

test('position 返回条目在列表里的下标', () => {
  assert.equal(core.position(core.entries, 'redis-avalanche'), ENTRIES.findIndex((e) => e.id === 'redis-avalanche'));
  assert.equal(core.position(core.entries, '不存在'), -1);
});

test('unread 从列表里挑出未读的', () => {
  const read = { a: 1, b: 1 };
  assert.deepEqual(core.unread([{ id: 'a' }, { id: 'b' }, { id: 'c' }], read).map((e) => e.id), ['c']);
  assert.equal(core.unread(ENTRIES, {}).length, ENTRIES.length);
  assert.deepEqual(core.unread([], {}), []);
});

test('pickRandom 结果可复现，边界值安全', () => {
  const list = ['a', 'b', 'c'];
  assert.equal(core.pickRandom(list, () => 0), 'a');
  assert.equal(core.pickRandom(list, () => 0.999999), 'c');
  assert.equal(core.pickRandom(list, () => 1), 'c');
  assert.equal(core.pickRandom(list, () => -1), 'a');
  assert.equal(core.pickRandom(list, () => NaN), 'a');
  assert.equal(core.pickRandom([], () => 0.5), null);
  assert.equal(core.pickRandom(null), null);
});

test('随机打开的是一条未读的', () => {
  const read = Object.fromEntries(ENTRIES.slice(0, ENTRIES.length - 1).map((e) => [e.id, 1]));
  const picked = core.pickRandom(core.unread(ENTRIES, read), () => 0.5);
  assert.equal(picked.id, ENTRIES[ENTRIES.length - 1].id);
});

/* ==========================================================================
   七、复制要点：导出纯文本
   ========================================================================== */

test('导出的纯文本包含标题、主题难度、五个段落和编号的正确做法', () => {
  const entry = BY_ID['spring-tx-too-long'];
  const text = core.toPlainText(entry);
  const lines = text.split('\n');
  assert.equal(lines[0], '【' + entry.title + '】');
  assert.ok(text.includes('主题：Spring 生态　难度：进阶'));
  assert.ok(text.includes('标签：' + entry.tags.join('、')));
  assert.ok(text.includes('什么时候遇到：' + entry.scenario));
  assert.ok(text.includes('现象：' + entry.symptom));
  assert.ok(text.includes('根因：' + entry.cause));
  assert.ok(text.includes('正确做法：'));
  entry.fix.forEach((item, i) => assert.ok(text.includes('\n' + (i + 1) + '. ' + item)));
  assert.ok(text.endsWith('一句话原则：' + entry.principle));
  assert.ok(!text.includes('<'), '纯文本里不应有 HTML 标签');
  assert.equal(core.toPlainText(null), '');
});

test('每条都能导出纯文本，且首行是标题', () => {
  for (const entry of ENTRIES) {
    const text = core.toPlainText(entry);
    assert.equal(text.split('\n')[0], '【' + entry.title + '】');
    assert.ok(text.includes('什么时候遇到：') && text.includes('现象：') && text.includes('根因：'));
    assert.ok(text.includes('一句话原则：'));
  }
});

/* ==========================================================================
   八、代码分词
   ========================================================================== */

test('把注释从代码里分出来，不丢字符', () => {
  const code = 'String url = "http://a.internal/x"; // 关键：看这里\nint n = 1; /* 块注释 */ int m = 2;';
  const lines = core.splitCode(code, 'java');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].parts.map((p) => p.type), ['code', 'string', 'code', 'comment']);
  assert.equal(lines[0].key, true, '注释以“关键”开头的那一行要标出来');
  assert.equal(lines[1].key, false);
  assert.equal(lines.map((l) => l.parts.map((p) => p.text).join('')).join('\n'), code);
});

test('字符串里的注释符号不会被当成注释', () => {
  const java = core.splitCode('String s = "// 不是注释"; // 关键：是注释', 'java');
  assert.deepEqual(java[0].parts.map((p) => p.type), ['code', 'string', 'code', 'comment']);
  const sql = core.splitCode("SELECT '--' AS a -- 关键：是注释", 'sql');
  assert.deepEqual(sql[0].parts.map((p) => p.type), ['code', 'string', 'code', 'comment']);
  assert.equal(sql[0].key, true);
  const shell = core.splitCode('echo "# 不是注释"  # 关键：是注释', 'shell');
  assert.deepEqual(shell[0].parts.map((p) => p.type), ['code', 'string', 'code', 'comment']);
});

test('各种语言的注释符号都认识', () => {
  assert.equal(core.splitCode('# 关键：a\nx: 1', 'yaml')[0].key, true);
  assert.equal(core.splitCode('# 关键：a\nk=v', 'conf')[0].key, true);
  assert.equal(core.splitCode('-- 关键：a\nSELECT 1;', 'sql')[0].key, true);
  assert.equal(core.splitCode('x = 1  # 关键：a', 'properties')[0].key, true);
  assert.equal(core.splitCode('const a = 1; // 关键：a', 'js')[0].key, true);
});

test('text 语言不解析注释，未知语言按 text 处理', () => {
  const lines = core.splitCode('# 关键：不是注释\n第二行', 'text');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].parts, [{ type: 'code', text: '# 关键：不是注释' }]);
  assert.equal(lines[0].key, false);
  assert.equal(core.splitCode('a # b', '没听过的语言').length, 1);
  assert.equal(core.splitCode(null, 'java').length, 1);
});

test('CRLF 和 lone CR 都按一行处理', () => {
  const lines = core.splitCode('a = 1;\r\n// 关键：x\r\nb = 2;', 'java');
  assert.equal(lines.length, 3);
  assert.equal(lines[1].key, true);
  assert.ok(lines.every((l) => !l.parts.some((p) => p.text.includes('\r'))));
  const cr = core.splitCode('a = 1;// 关键：x\rb = 2;', 'java');
  assert.equal(cr.length, 2, '单独的 CR 也当作换行：注释之后是第二行');
  assert.equal(cr[0].key, true);
});

test('块注释跨行时，每一行都被标成注释', () => {
  const lines = core.splitCode('a; /* 第一行\n第二行 */ b;', 'java');
  assert.equal(lines[0].parts[1].type, 'comment');
  assert.equal(lines[1].parts[0].type, 'comment');
  assert.equal(lines[1].parts[1].type, 'code');
});

test('数据里的每一段代码：分词后拼回去和原文一致，并且各有且只有一行被标为关键', () => {
  for (const entry of ENTRIES) {
    if (!entry.example) continue;
    for (const part of ['bad', 'good']) {
      const code = entry.example[part];
      const lines = core.splitCode(code, entry.example.lang);
      const joined = lines.map((l) => l.parts.map((p) => p.text).join('')).join('\n');
      assert.equal(joined, String(code).replace(/\r\n?/g, '\n'), entry.id + '.' + part + '：分词后丢了字符');
      assert.equal(lines.length, linesOf(code).length);
      const keys = lines.filter((l) => l.key).length;
      if (entry.example.lang === 'text') {
        assert.equal(keys, 0, entry.id + '.' + part + '：文本示例不应有被标的关键行');
      } else {
        assert.equal(keys, 1, entry.id + '.' + part + '：被标为关键的行应当正好一行，现在是 ' + keys);
      }
    }
  }
});

test('isRead 兼容对象和 Set', () => {
  assert.equal(core.isRead({ a: 1 }, 'a'), true);
  assert.equal(core.isRead({ a: 1 }, 'b'), false);
  assert.equal(core.isRead(new Set(['a']), 'a'), true);
  assert.equal(core.isRead(null, 'a'), false);
});

test('normalize 与 compact', () => {
  assert.equal(core.normalize('ＡＢＣ Cache'), 'abc cache');
  assert.equal(core.compact(' Cache   Aside '), 'cacheaside');
  assert.equal(core.normalize(null), '');
});
