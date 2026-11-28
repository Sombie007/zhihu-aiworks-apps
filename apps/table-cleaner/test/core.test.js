/*
 * 表格清洗 · core.js 单元测试
 * ----------------------------------------------------------------------------
 * 运行（在项目根目录）：
 *   node --test apps/table-cleaner/
 *   或  node --test apps/table-cleaner/test/core.test.js
 *
 * 只用 Node 内置的 node:test 和 node:assert，不依赖第三方包。
 * 需要参照值的地方（GB18030 的字节、官方区间表）都在用例旁边写明了出处。
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const core = require('../core.js');

/* ---------- 小工具 ---------- */

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
const cp = (n) => String.fromCodePoint(n);
const utf8 = (s) => new TextEncoder().encode(s);
const gbDecoder = new TextDecoder('gb18030');

function run(header, rows, rules, options) {
  return core.applyRules({ header: header, rows: rows }, rules, options);
}
function reportOf(result, id) {
  return result.rules.find((r) => r.id === id);
}

/* ==========================================================================
   编码
   ========================================================================== */

describe('GB18030 编码表', () => {
  const table = core.gb18030Table();

  test('两字节表共 23,940 个码位，逐个用解码器解回，结果一致', () => {
    assert.equal(table.decode.length, 23940);
    for (let p = 0; p < 23940; p++) {
      const t = p % 190;
      const bytes = new Uint8Array([0x81 + Math.floor(p / 190), t < 0x3f ? 0x40 + t : 0x41 + t]);
      assert.equal(gbDecoder.decode(bytes).charCodeAt(0), table.decode[p], '指针 ' + p);
    }
  });

  test('两字节表的指纹和生成时记录的一致（UTF-16BE 字节的 SHA-256）', () => {
    const buf = Buffer.alloc(table.decode.length * 2);
    for (let i = 0; i < table.decode.length; i++) { buf[i * 2] = table.decode[i] >> 8; buf[i * 2 + 1] = table.decode[i] & 0xff; }
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'),
      'cff50468440b4654167396762719ddd62c927582eeed3623f3d6f11793096410');
  });

  /* WHATWG 官方 index-gb18030-ranges.txt 的 207 条（文件标识 2024-09-18 版，
    SHA-256 874c6b6f6f74cf7d427ad228d5b41ddd9354fffd92a2259bf429f86e6baa7a1e）。
    写法：码点.指针，都是十六进制 */
  const OFFICIAL_RANGES = '80.0,a5.24,a9.26,b2.2d,b8.32,d8.51,e2.59,eb.5f,ee.60,f4.64,f8.67,fb.68,fd.69,102.6d,114.7e,11c.85,12c.94,145.ac,149.af,14e.b3,16c.d0,1cf.132,1d1.133,1d3.134,1d5.135,1d7.136,1d9.137,1db.138,1dd.139,1fa.155,252.1ac,262.1bb,2c8.220,2cc.221,2da.22e,3a2.2e5,3aa.2e6,3c2.2ed,3ca.2ee,402.325,450.333,452.334,2011.1ef2,2017.1ef4,201a.1ef5,201e.1ef7,2027.1efe,2031.1f07,2034.1f08,2036.1f09,203c.1f0e,20ad.1f7e,2104.1fd4,2106.1fd5,210a.1fd8,2117.1fe4,2122.1fee,216c.202c,217a.2030,2194.2046,219a.2048,2209.20b6,2210.20bc,2212.20bd,2216.20c0,221b.20c4,2221.20c6,2224.20c8,2226.20c9,222c.20ca,222f.20cc,2238.20d1,223e.20d6,2249.20e0,224d.20e3,2253.20e8,2262.20f5,2268.20f7,2270.20fd,2296.2122,229a.2125,22a6.2130,22c0.2149,2313.219b,246a.22e8,249c.22f2,254c.2356,2574.235a,2590.2367,2596.236a,25a2.2374,25b4.2384,25be.238c,25c8.2394,25cc.2397,25d0.2399,25e6.23ab,2607.23ca,260a.23cc,2641.2402,2643.2403,2e82.2c41,2e85.2c43,2e89.2c46,2e8d.2c48,2e98.2c52,2ea8.2c61,2eab.2c63,2eaf.2c66,2eb4.2c6a,2eb8.2c6c,2ebc.2c6f,2ecb.2c7d,2ffc.2da2,3004.2da6,3018.2da7,301f.2dac,302a.2dae,303f.2dc2,3094.2dc4,309f.2dcb,30f7.2dcd,30ff.2dd2,312a.2dd8,322a.2ece,3232.2ed5,32a4.2f46,3390.3030,339f.303c,33a2.303e,33c5.3060,33cf.3069,33d3.306b,33d6.306d,3448.30de,3474.3109,359f.3233,360f.32a2,361b.32ad,3919.35aa,396f.35ff,39d1.365f,39e0.366d,3a74.3700,3b4f.37da,3c6f.38f9,3ce1.396a,4057.3cdf,4160.3de7,4338.3fbe,43ad.4032,43b2.4036,43de.4061,44d7.4159,464d.42ce,4662.42e2,4724.43a3,472a.43a8,477d.43fa,478e.440a,4948.45c3,497b.45f5,497e.45f7,4984.45fb,4987.45fc,499c.4610,49a0.4613,49b8.4629,4c78.48e8,4ca4.490f,4d1a.497e,4daf.4a12,9fa6.4a63,e76c.82bd,e7c8.82be,e7e7.82bf,e815.82cc,e819.82cd,e81f.82d2,e827.82d9,e82d.82dd,e833.82e1,e83c.82e9,e844.82f0,e856.8300,e865.830e,f92d.93d5,f97a.9421,f996.943c,f9e8.948d,f9f2.9496,fa10.94b0,fa12.94b1,fa15.94b2,fa19.94b5,fa22.94bb,fa25.94bc,fa2a.94be,fe32.98c4,fe45.98c5,fe53.98c9,fe58.98ca,fe67.98cb,fe6c.98cc,ff5f.9961,ffe6.99e2,10000.2e248';

  test('四字节区间：官方 207 条起点全部在内、指针一致，只多出两个等价的起点', () => {
    const official = OFFICIAL_RANGES.split(',').map((s) => { const [c, p] = s.split('.'); return [parseInt(c, 16), parseInt(p, 16)]; });
    assert.equal(official.length, 207);
    const mine = new Map();
    for (let i = 0; i < table.ranges.length; i += 2) mine.set(table.ranges[i], table.ranges[i + 1]);
    for (const [c, p] of official) assert.equal(mine.get(c), p, 'U+' + c.toString(16));
    const officialSet = new Set(official.map(([c]) => c));
    const extra = [...mine.keys()].filter((c) => !officialSet.has(c)).sort((a, b) => a - b);
    /* U+E7C7 官方用一条特殊规则表示；U+1E40 官方由前一段线性延伸覆盖 */
    assert.deepEqual(extra.map((c) => [c, mine.get(c)]), [[0x1e40, 7458], [0xe7c7, 7457]]);
    assert.equal(table.side.length, 18);
  });

  test('全部 111 万个码点：编码后用解码器解回，只有规范允许的 19 个例外', () => {
    let total = 0;
    let mismatches = 0;
    let chunk = '';
    const flush = () => {
      if (!chunk) return;
      const back = gbDecoder.decode(core.encodeText(chunk, 'gb18030'));
      let i = 0;
      let j = 0;
      while (i < chunk.length) {
        const a = chunk.codePointAt(i);
        const b = back.codePointAt(j);
        i += a > 0xffff ? 2 : 1;
        j += b > 0xffff ? 2 : 1;
        total++;
        if (a !== b) mismatches++;
      }
      assert.equal(j, back.length);
      chunk = '';
    };
    for (let c = 0; c <= 0x10ffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      chunk += cp(c);
      if (chunk.length >= 60000) flush();
    }
    flush();
    assert.equal(total, 1112064);      /* 0x110000 个码点去掉 2,048 个代理区码点 */
    /* 18 个附表里的私用区码点按规范写成旧的两字节（解回来会是别的字符），加 U+E5E5 无法编码 */
    assert.equal(mismatches, 19);
  });

  /* 下面的期望字节由 Python 3.13 的 gb18030 编解码器给出，和 core.js 的实现互为印证 */
  test('和 Python 的 gb18030 编解码器给出的字节一致', () => {
    const cases = [
      ['中文', 'd6 d0 ce c4'], ['，', 'a3 ac'], ['。', 'a1 a3'], ['￥', 'a3 a4'], ['€', 'a2 e3'],
      ['\u3000', 'a1 a1'], ['“', 'a1 b0'], ['é', 'a8 a6'], ['〇', 'a9 96'],
      ['😀', '94 39 fc 36'], ['₹', '81 36 b4 34'],
      ['A1', '41 31'], ['ab,中文', '61 62 2c d6 d0 ce c4']
    ];
    for (const [text, expected] of cases) assert.equal(hex(core.encodeText(text, 'gb18030')), expected, JSON.stringify(text));
  });

  test('无法编码的字符写成 ?，孤立的代理项不会抛错', () => {
    assert.equal(hex(core.encodeText(cp(0xe5e5), 'gb18030')), '3f');
    assert.equal(hex(core.encodeText('a\ud800b', 'gb18030')), '61 3f 62');
  });

  test('返回的字节和 TextEncoder 一样大小恰好相等，底层缓冲区里没有多余的零', () => {
    for (const text of ['中文', 'a', '😀', '订单 SO-2023-0417，金额 12800.50', '']) {
      const bytes = core.encodeText(text, 'gb18030');
      assert.equal(bytes.byteOffset, 0, JSON.stringify(text));
      assert.equal(bytes.buffer.byteLength, bytes.byteLength, JSON.stringify(text));
    }
    assert.equal(hex(Buffer.from(core.encodeText('中文', 'gb18030').buffer)), 'd6 d0 ce c4');
  });
});

describe('编码探测', () => {
  test('合法的 UTF-8 按 UTF-8 解码', () => {
    const r = core.decodeBytes(utf8('订单号,金额\nSO-1,¥12.5'));
    assert.equal(r.encoding, 'utf-8');
    assert.equal(r.text, '订单号,金额\nSO-1,¥12.5');
    assert.equal(r.bom, false);
    assert.equal(r.replaced, 0);
  });

  test('UTF-8 BOM 会被标记，开头的 U+FEFF 被去掉', () => {
    const r = core.decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('a,b')]));
    assert.equal(r.encoding, 'utf-8');
    assert.equal(r.bom, true);
    assert.equal(r.text, 'a,b');
  });

  test('不是合法 UTF-8 时按 GB18030 解码（国内 Excel 导出的 GBK 文件）', () => {
    const r = core.decodeBytes(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0x2c, 0x31]));   /* “中文,1” */
    assert.equal(r.encoding, 'gb18030');
    assert.equal(r.text, '中文,1');
  });

  test('带 BOM 的 UTF-16 能识别，并且知道字节序', () => {
    const le = core.decodeBytes(new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]));
    assert.deepEqual({ encoding: le.encoding, text: le.text, bom: le.bom }, { encoding: 'utf-16le', text: '中文', bom: true });
    const be = core.decodeBytes(new Uint8Array([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87]));
    assert.deepEqual({ encoding: be.encoding, text: be.text, bom: be.bom }, { encoding: 'utf-16be', text: '中文', bom: true });
  });

  test('GB18030 也解不了的字节被替换，并统计替换数', () => {
    const r = core.decodeBytes(new Uint8Array([0xd6, 0xd0, 0x81]));
    assert.equal(r.encoding, 'gb18030');
    assert.equal(r.text, '中\uFFFD');
    assert.equal(r.replaced, 1);
  });

  test('空文件', () => {
    const r = core.decodeBytes(new Uint8Array(0));
    assert.deepEqual([r.text, r.encoding, r.bytes], ['', 'utf-8', 0]);
  });
});

describe('导出编码', () => {
  test('UTF-8 与 TextEncoder 的结果相同；带 BOM 时在最前面加 EF BB BF', () => {
    assert.deepEqual(core.encodeText('a中', 'utf-8'), utf8('a中'));
    assert.equal(hex(core.encodeText('中', 'utf-8-bom')), 'ef bb bf e4 b8 ad');
    assert.throws(() => core.encodeText('a', 'big5'));
  });
  test('编码标签', () => {
    assert.equal(core.encodingLabel('utf-8-bom'), 'UTF-8 带 BOM');
    assert.equal(core.encodingLabel('gb18030'), 'GB18030');
  });
});

/* ==========================================================================
   分隔符
   ========================================================================== */

describe('分隔符识别', () => {
  test('四种分隔符都能认出来，各行次数一致', () => {
    assert.equal(core.detectDelimiter('a,b,c\n1,2,3\n4,5,6').delimiter, ',');
    assert.equal(core.detectDelimiter('a\tb\tc\n1\t2\t3').delimiter, '\t');
    assert.equal(core.detectDelimiter('a;b;c\n1;2;3').delimiter, ';');
    assert.equal(core.detectDelimiter('a|b|c\n1|2|3').delimiter, '|');
    assert.equal(core.detectDelimiter('a,b,c\n1,2,3').confidence, 'high');
  });

  test('引号里的分隔符不计入', () => {
    const r = core.detectDelimiter('"x, y",b,c\n"p, q",r,s');
    assert.equal(r.delimiter, ',');
    assert.deepEqual(r.counts[','], [2, 2]);
  });

  test('取出现次数一致且最多的那个', () => {
    assert.equal(core.detectDelimiter('a,b;c;d\nx,y;z;w').delimiter, ';');
  });

  test('平手时取逗号，并列出打成平手的分隔符', () => {
    const r = core.detectDelimiter('a,b;c\nx,y;z');
    assert.equal(r.delimiter, ',');
    assert.deepEqual(r.tiedWith, [';']);
  });

  test('都是 0 次时识别不出', () => {
    const r = core.detectDelimiter('张三丰\n李四\n王五');
    assert.equal(r.delimiter, null);
    assert.equal(r.confidence, 'none');
    assert.equal(r.delimiterId, null);
    assert.equal(core.detectDelimiter('').confidence, 'none');
  });

  test('各行次数不一致时，按总次数取，并标明置信度低', () => {
    const r = core.detectDelimiter('a,b,c,d\na,b\na,b,c,d');
    assert.equal(r.delimiter, ',');
    assert.equal(r.confidence, 'low');
  });

  test('只看前 5 个非空行，空行跳过', () => {
    const r = core.detectDelimiter('\n  \na;b;c\n1;2;3\n4;5;6\n7;8;9\n10;11;12\nx,y,z\nx,y,z\nx,y,z');
    assert.equal(r.delimiter, ';');
    assert.equal(r.lines, 5);
    assert.equal(r.confidence, 'high');
  });

  test('制表符的 id 与字符可以互查', () => {
    assert.equal(core.delimiterChar('tab'), '\t');
    assert.equal(core.delimiterId(';'), 'semicolon');
    assert.equal(core.delimiterLabel('|'), '竖线');
  });
});

/* ==========================================================================
   CSV 解析
   ========================================================================== */

describe('CSV 解析（RFC 4180）', () => {
  test('基本字段', () => {
    assert.deepEqual(core.parseCsv('a,b,c\n1,2,3').records, [['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('引号里的逗号不是分隔符', () => {
    const r = core.parseCsv('姓名,地址\n张某,"上海市浦东新区张江路 1 号, 3 栋"', ',');
    assert.deepEqual(r.records[1], ['张某', '上海市浦东新区张江路 1 号, 3 栋']);
  });

  test('"" 是一个双引号', () => {
    const r = core.parseCsv('"he said ""hi""","a""b"', ',');
    assert.deepEqual(r.records[0], ['he said "hi"', 'a"b']);
    assert.equal(r.quoteGlitches, 0);
  });

  test('引号里可以有换行（CRLF 和 LF），换行是内容的一部分', () => {
    assert.deepEqual(core.parseCsv('"line1\r\nline2",b\nc', ',').records, [['line1\r\nline2', 'b'], ['c']]);
    assert.deepEqual(core.parseCsv('"line1\nline2",b', ',').records, [['line1\nline2', 'b']]);
  });

  test('CRLF、LF、单独的 CR 都能断行', () => {
    assert.deepEqual(core.parseCsv('a\r\nb\rc\nd', ',').records, [['a'], ['b'], ['c'], ['d']]);
  });

  test('末尾的换行不会多出一个空行', () => {
    assert.deepEqual(core.parseCsv('a,b\n', ',').records, [['a', 'b']]);
    assert.deepEqual(core.parseCsv('a,b\r\n', ',').records, [['a', 'b']]);
  });

  test('中间的空行是一个全空行', () => {
    assert.deepEqual(core.parseCsv('a\n\nb', ',').records, [['a'], [''], ['b']]);
  });

  test('去掉开头的 UTF-8 BOM', () => {
    const r = core.parseCsv('\uFEFF订单号,金额\nSO-1,12', ',');
    assert.equal(r.records[0][0], '订单号');
    assert.equal(r.records[0][0].charCodeAt(0), 0x8ba2);
  });

  test('最后一行以分隔符结尾、后面没有换行：这一行和末尾的空字段都要保留', () => {
    assert.deepEqual(core.parseCsv('a,b,', ',').records, [['a', 'b', '']]);
    assert.deepEqual(core.parseCsv('a,', ',').records, [['a', '']]);
    assert.deepEqual(core.parseCsv('a,b,\n', ',').records, [['a', 'b', '']]);
    assert.deepEqual(core.parseCsv('h1,h2\nr1,r2,', ',').records, [['h1', 'h2'], ['r1', 'r2', '']]);
  });

  test('空字段和用引号包住的空字段；引号不在字段开头时只是普通字符', () => {
    assert.deepEqual(core.parseCsv('a,,c\n"",""," "', ',').records, [['a', '', 'c'], ['', '', ' ']]);
    assert.deepEqual(core.parseCsv(' "",x', ',').records, [[' ""', 'x']]);
  });

  test('引号后面还有字符：并入字段，并计入不规范数', () => {
    const r = core.parseCsv('"abc"def,ghi', ',');
    assert.deepEqual(r.records[0], ['abcdef', 'ghi']);
    assert.equal(r.quoteGlitches, 1);
  });

  test('没加引号的字段里出现引号：按普通字符处理', () => {
    const r = core.parseCsv('ab"cd,ef"', ',');
    assert.deepEqual(r.records[0], ['ab"cd', 'ef"']);
    assert.equal(r.quoteGlitches, 2);
  });

  test('引号没有闭合：读到末尾，并报告', () => {
    const r = core.parseCsv('a,"bc\nd,e', ',');
    assert.deepEqual(r.records, [['a', 'bc\nd,e']]);
    assert.equal(r.unclosedQuotes, 1);
  });

  test('其他分隔符', () => {
    assert.deepEqual(core.parseCsv('a\tb\tc\n" x\ty "\tz', '\t').records, [['a', 'b', 'c'], [' x\ty ', 'z']]);
    assert.deepEqual(core.parseCsv('a;b|c;d', '|').records, [['a;b', 'c;d']]);
  });

  test('不传分隔符时按逗号；空文本得到空数组', () => {
    assert.deepEqual(core.parseCsv('', null).records, []);
    assert.deepEqual(core.parseCsv(null).records, []);
  });
});

describe('建表', () => {
  test('列数不足的行补空，多出的列命名为「附加列」', () => {
    const t = core.buildTable([['a', 'b'], ['1'], ['1', '2', '3', '4']], { hasHeader: true });
    assert.deepEqual(t.header, ['a', 'b', '附加列 1', '附加列 2']);
    assert.deepEqual(t.rows, [['1', '', '', ''], ['1', '2', '3', '4']]);
    assert.deepEqual(t.report, { leadingBlank: 0, shortRows: 1, longRows: 1, extraCols: 2, blankRows: 0 });
  });

  test('全空行不计入「列数不一致」', () => {
    const t = core.buildTable([['a', 'b'], [''], ['1', '2']], { hasHeader: true });
    assert.equal(t.report.shortRows, 0);
    assert.equal(t.report.blankRows, 1);
  });

  test('表头之前的空行被跳过', () => {
    const t = core.buildTable([['  '], ['a', 'b'], ['1', '2']], { hasHeader: true });
    assert.equal(t.report.leadingBlank, 1);
    assert.deepEqual(t.header, ['a', 'b']);
  });

  test('没有表头时列名是「列 N」', () => {
    const t = core.buildTable([['1', '2', '3'], ['4']], { hasHeader: false });
    assert.deepEqual(t.header, ['列 1', '列 2', '列 3']);
    assert.deepEqual(t.rows, [['1', '2', '3'], ['4', '', '']]);
    assert.equal(t.report.shortRows, 1);
  });

  test('没有任何内容时返回 null', () => {
    assert.equal(core.buildTable([], {}), null);
    assert.equal(core.buildTable([[], ['  ']], {}), null);
  });

  test('不修改传入的记录', () => {
    const records = [['a', 'b'], ['1']];
    core.buildTable(records, {});
    assert.deepEqual(records, [['a', 'b'], ['1']]);
  });
});

/* ==========================================================================
   数字
   ========================================================================== */

describe('数字规范化', () => {
  const all = { thousands: true, currency: true, percent: true, fullwidth: true };
  const cases = [
    ['¥12,800.50', '12800.50'],
    ['$1,200', '1200'],
    ['15,000', '15000'],
    ['1,234,567.89', '1234567.89'],
    ['12800.50', '12800.50'],
    ['8600', '8600'],
    ['+5', '5'],
    ['-¥2,350', '-2350'],
    ['1200美元', '1200'],
    ['1,200 美元', '1200'],
    ['.5', '0.5'],
    ['-0.50', '-0.50'],
    ['２０２３', '2023'],
    ['０１０１２３', '010123'],
    ['12.5%', '0.125'],
    ['95%', '0.95'],
    ['-3%', '-0.03'],
    ['1,250%', '12.50']
  ];
  for (const [input, expected] of cases) {
    test(JSON.stringify(input) + ' → ' + JSON.stringify(expected), () => {
      assert.equal(core.normalizeNumber(input, all), expected);
    });
  }

  const untouched = [
    '0012345', '010123', '0', '0.5', '12,34', '1234,567', '1.200,50', '2023-03-12',
    'N/A', '', 'abc', '1 200', '3年', '13800138000', '1.2e3', '010-12345678', '(1,200)'
  ];
  for (const input of untouched) {
    test('保持原样：' + JSON.stringify(input), () => {
      assert.equal(core.normalizeNumber(input, all), input);
    });
  }

  test('全角数字转半角不受「必须是纯数字」的限制', () => {
    assert.equal(core.normalizeNumber('１２　３４', all), '12　34');
    assert.equal(core.normalizeNumber('２０２３-０３-１２', all), '2023-03-12');
    assert.equal(core.normalizeNumber('１２　３４', { thousands: true, currency: true }), '１２　３４');
    assert.equal(core.halfWidthDigits('共３件，合计１２，８００元'), '共3件，合计12,800元');
    assert.equal(core.halfWidthDigits('不含全角数字'), '不含全角数字');
  });

  test('小数位数保持原样，很长的整数不丢精度', () => {
    assert.equal(core.normalizeNumber('12345678901234567890', all), '12345678901234567890');
    assert.equal(core.normalizeNumber('12,345,678,901,234,567,890', all), '12345678901234567890');
    assert.equal(core.normalizeNumber('7.10', all), '7.10');
  });

  test('只有最终能得到纯数字时才改写（要么都处理，要么都不动）', () => {
    assert.equal(core.normalizeNumber('¥12,800', { thousands: true, currency: false }), '¥12,800');
    assert.equal(core.normalizeNumber('¥12,800', { thousands: false, currency: true }), '¥12,800');
    assert.equal(core.normalizeNumber('$ 1,200 ', { thousands: true, currency: true }), '1200');
    assert.equal(core.normalizeNumber('元', { currency: true }), '元');
  });

  test('百分号转小数是可选项，默认不开', () => {
    assert.equal(core.normalizeNumber('95%', { thousands: true, currency: true }), '95%');
    assert.equal(core.normalizeNumber('1,250%', { thousands: true, percent: true }), '12.50');
    assert.equal(core.normalizeNumber('1,250%', { thousands: false, percent: true }), '1,250%');
    assert.equal(core.defaultRules().number.percent, false);
  });

  test('带前导零的编号在全角转半角后前导零仍在', () => {
    assert.equal(core.normalizeNumber('００１２３４５', all), '0012345');
    assert.equal(core.normalizeNumber('00.50', all), '00.50');
  });

  test('全角的数字、小数点、千分位逗号', () => {
    assert.equal(core.normalizeNumber('１２，８００．５０', all), '12800.50');
    assert.equal(core.normalizeNumber('２０２３', { fullwidth: false }), '２０２３');
  });
});

/* ==========================================================================
   日期
   ========================================================================== */

describe('日期识别', () => {
  const okCases = [
    ['2023-03-12', '2023-03-12'],
    ['2023-3-9', '2023-03-09'],
    ['2023/3/12', '2023-03-12'],
    ['2023年3月12日', '2023-03-12'],
    ['2023年12月05号', '2023-12-05'],
    ['20230312', '2023-03-12'],
    ['2023.3.12', '2023-03-12'],
    ['25/04/2023', '2023-04-25'],     /* 日大于 12，可以确定是「日/月/年」 */
    ['12/25/2023', '2023-12-25'],     /* 月在前的美式写法，第二个数大于 12 */
    ['18.05.2023', '2023-05-18'],
    ['2023-07-01', '2023-07-01'],
    ['2000-02-29', '2000-02-29'],     /* 世纪年能被 400 整除，是闰年 */
    ['2024/2/29', '2024-02-29'],
    ['2023 年 3 月 12 日', '2023-03-12'],
    ['２０２３０９０６', '2023-09-06'],
    ['２０２３年３月１２日', '2023-03-12']
  ];
  for (const [input, iso] of okCases) {
    test(JSON.stringify(input) + ' → ' + iso, () => {
      const d = core.parseDateValue(input, 'keep');
      assert.equal(d.ok, true);
      assert.equal(d.iso, iso);
      assert.equal(d.time, '');
    });
  }

  test('带时间的写法：日期规范化，时间只补零', () => {
    const cases = [
      ['2023/3/12 9:05', '2023-03-12 09:05'],
      ['2023-03-12 14:30:00', '2023-03-12 14:30:00'],
      ['2023年3月12日14:30', '2023-03-12 14:30'],
      ['2023/3/129:05', '2023-03-12 09:05'],
      ['2023 年 3 月 12 日 9:05', '2023-03-12 09:05']
    ];
    for (const [input, out] of cases) {
      const d = core.parseDateValue(input, 'keep');
      assert.equal(d.ok, true, input);
      assert.equal(d.iso + (d.time ? ' ' + d.time : ''), out);
    }
  });

  test('日月顺序不明确的日期默认不改，并说明原因', () => {
    const d = core.parseDateValue('03/04/2023', 'keep');
    assert.equal(d.ok, false);
    assert.equal(d.reason, 'ambiguous');
    assert.match(d.message, /3 月 4 日/);
    assert.match(d.message, /4 月 3 日/);
    assert.equal(core.parseDateValue('03.04.2023', 'keep').reason, 'ambiguous');
    assert.equal(core.parseDateValue('03-04-2023', 'keep').reason, 'ambiguous');
  });

  test('可以指定按「日/月/年」或「月/日/年」解读', () => {
    const dmy = core.parseDateValue('03/04/2023', 'dmy');
    assert.equal(dmy.ok, true);
    assert.equal(dmy.iso, '2023-04-03');
    assert.equal(dmy.ambiguousResolved, true);
    assert.equal(core.parseDateValue('03/04/2023', 'mdy').iso, '2023-03-04');
    /* 日或月已经能确定时，设置不起作用 */
    assert.equal(core.parseDateValue('25/04/2023', 'mdy').iso, '2023-04-25');
    assert.equal(core.parseDateValue('25/04/2023', 'keep').ambiguousResolved, false);
  });

  test('不是有效日期', () => {
    const bad = [
      ['2023-02-30', /2 月只有 28 天/],
      ['2023-02-29', /不是闰年/],
      ['1900-02-29', /不是闰年/],     /* 1900 能被 100 整除但不能被 400 整除 */
      ['2100-02-29', /不是闰年/],
      ['2023-13-01', /月份 13/],
      ['2023/3/32', /日 32/],
      ['2023年4月31日', /4 月只有 30 天/],
      ['13/13/2023', /都超过了 12/]
    ];
    for (const [input, re] of bad) {
      const d = core.parseDateValue(input, 'keep');
      assert.equal(d.ok, false, input);
      assert.equal(d.reason, 'invalid', input);
      assert.match(d.message, re, input);
    }
  });

  test('年份只有两位、只有年月：像日期，但不改并说明原因', () => {
    assert.equal(core.parseDateValue('23/03/12', 'keep').reason, 'two-digit-year');
    assert.equal(core.parseDateValue('3/12/23', 'keep').reason, 'two-digit-year');
    assert.equal(core.parseDateValue('2023-03', 'keep').reason, 'month-only');
    assert.equal(core.parseDateValue('2023年3月', 'keep').reason, 'month-only');
  });

  test('不像日期的值返回 null', () => {
    for (const v of ['12800.50', '13800138000', '010-12345678', 'abc', '', '2023', '1.2.23', '3.2.10',
      '2023-03-12T10:30:00', '2023-03-12 25:30', '2023-03-12 10:60', '10:30', '12%', '20231301 元', '202303120906']) {
      assert.equal(core.parseDateValue(v, 'keep'), null, JSON.stringify(v));
    }
  });

  test('8 位数字但不是日期：单独看是「无效日期」，是否报告由整列决定', () => {
    assert.equal(core.parseDateValue('20231301', 'keep').reason, 'invalid');
    assert.equal(core.parseDateValue('20233500', 'keep').reason, 'invalid');
  });

  test('判断一列是不是日期列用的 isDateLike', () => {
    assert.equal(core.isDateLike('2023-03-12'), true);
    assert.equal(core.isDateLike('2023-02-30'), true);     /* 写错的非 8 位日期仍然算日期的写法 */
    assert.equal(core.isDateLike('03/04/2023'), true);
    assert.equal(core.isDateLike('20230312'), true);       /* 合法的 8 位日期 */
    assert.equal(core.isDateLike('20231301'), false);      /* 8 位数字但不是日期：当作编号 */
    assert.equal(core.isDateLike('12800.50'), false);
    assert.equal(core.isDateLike('20230131'), true);       /* 单看一个值分不清，要靠整列来判断 */
  });
});

/* ==========================================================================
   清洗规则（逐条）
   ========================================================================== */

describe('规则 1 · 去除首尾空白', () => {
  test('去掉首尾的半角空格、全角空格，中间的保留', () => {
    const r = run(['a', 'b'], [['  x  ', '中\u3000文']], core.defaultRules());
    assert.deepEqual(r.rows, [['x', '中\u3000文']]);
    assert.deepEqual(reportOf(r, 'trim').changes, [{ row: 0, col: 0, before: '  x  ', after: 'x' }]);
  });

  test('首尾的制表符、不间断空格、BOM 也会去掉', () => {
    const r = run(['a'], [['\tx\u00a0'], ['\uFEFFy ']], core.defaultRules());
    assert.deepEqual(r.rows, [['x'], ['y']]);
  });

  test('关掉后不动；默认开启', () => {
    assert.equal(core.defaultRules().trim.on, true);
    const rules = core.defaultRules();
    rules.trim.on = false;
    assert.deepEqual(run(['a'], [[' x ']], rules).rows, [[' x ']]);
  });
});

describe('规则 2 · 清理不可见字符', () => {
  test('零宽字符、BOM、除换行外的控制字符被删除，换行保留', () => {
    const rules = core.defaultRules();
    rules.trim.on = false;    /* 单独看这条规则的效果 */
    const r = run(['a', 'b', 'c', 'd'], [['武\u200b汉', 'x\u0007y', '第一行\n第二行', 'x\uFEFFy'],
      ['汉\u200c\u200d口', 'a\u0000b\u001fb', 'p\r\nq', 'z']], rules);
    assert.deepEqual(r.rows, [['武汉', 'xy', '第一行\n第二行', 'xy'], ['汉口', 'abb', 'p\r\nq', 'z']]);
    assert.equal(reportOf(r, 'invisible').cells, 5);
  });

  test('制表符换成空格，而不是删掉（删掉会把两边的字粘在一起）', () => {
    const rules = core.defaultRules();
    rules.trim.on = false;
    assert.deepEqual(run(['a'], [['x\ty\tz']], rules).rows, [['x y z']]);
  });

  test('默认开启；关掉后不动', () => {
    assert.equal(core.defaultRules().invisible.on, true);
    const rules = core.defaultRules();
    rules.invisible.on = false;
    assert.deepEqual(run(['a'], [['武\u200b汉']], rules).rows, [['武\u200b汉']]);
  });
});

describe('规则 3 · 删除全空行', () => {
  test('整行所有单元格去空白后都为空的行被删除', () => {
    const r = run(['a', 'b'], [['1', 'x'], ['', ''], ['  ', '\u3000'], ['2', 'y']], core.defaultRules());
    assert.deepEqual(r.rows, [['1', 'x'], ['2', 'y']]);
    assert.equal(r.stats.removedEmpty, 2);
    assert.equal(reportOf(r, 'emptyRows').removedRows, 2);
    assert.deepEqual(r.removed, [{ row: 1, reason: 'empty' }, { row: 2, reason: 'empty' }]);
    assert.deepEqual(r.rowMap, [0, 3]);
  });

  test('关掉「去除首尾空白」时，只有空白的行也算全空行', () => {
    const rules = core.defaultRules();
    rules.trim.on = false;
    assert.deepEqual(run(['a', 'b'], [[' ', '  '], ['x', 'y']], rules).rowMap, [1]);
  });

  test('默认开启；关掉后保留', () => {
    assert.equal(core.defaultRules().emptyRows.on, true);
    const rules = core.defaultRules();
    rules.emptyRows.on = false;
    assert.deepEqual(run(['a'], [[''], ['x']], rules).rows, [[''], ['x']]);
  });
});

describe('规则 4 · 删除全空列', () => {
  test('默认关闭', () => {
    assert.equal(core.defaultRules().emptyCols.on, false);
    assert.deepEqual(run(['a', 'b'], [['1', '']], core.defaultRules()).header, ['a', 'b']);
  });

  test('整列都为空的列被删除，列下标映射随之更新', () => {
    const rules = core.defaultRules();
    rules.emptyCols.on = true;
    const r = run(['a', '空一', 'b', '空二'], [['1', '', 'x', '  '], ['2', '\u3000', 'y', '']], rules);
    assert.deepEqual(r.header, ['a', 'b']);
    assert.deepEqual(r.rows, [['1', 'x'], ['2', 'y']]);
    assert.deepEqual(r.colMap, [0, 2]);
    assert.deepEqual(r.removedCols, [1, 3]);
    assert.equal(r.stats.originalCols, 4);
    assert.equal(r.stats.finalCols, 2);
    assert.equal(r.stats.removedCols, 2);
    assert.equal(reportOf(r, 'emptyCols').removedCols, 2);
  });

  test('表头有名字、但数据全空的列也算空列；被删掉的行不影响判断', () => {
    const rules = core.defaultRules();
    rules.emptyCols.on = true;
    const r = run(['备注', 'a'], [['只有这一行有值', '1'], ['', '2'], ['', '3']], rules);
    assert.deepEqual(r.header, ['备注', 'a']);    /* 删掉全空行之前，「备注」列并不是全空 */
    assert.deepEqual(r.rows, [['只有这一行有值', '1'], ['', '2'], ['', '3']]);
  });
});

describe('规则 5 · 整行去重', () => {
  test('完全相同的行只留第一次出现的那一行', () => {
    const r = run(['a', 'b'], [['1', 'x'], ['2', 'y'], ['1', 'x'], ['1', 'x'], ['3', 'z']], core.defaultRules());
    assert.deepEqual(r.rows, [['1', 'x'], ['2', 'y'], ['3', 'z']]);
    assert.deepEqual(r.removed, [{ row: 2, reason: 'duplicate', first: 0 }, { row: 3, reason: 'duplicate', first: 0 }]);
    assert.deepEqual(r.rowMap, [0, 1, 4]);
    assert.equal(r.stats.removedDuplicates, 2);
    assert.equal(r.stats.removedEmpty, 0);
    assert.equal(reportOf(r, 'dedupe').removedRows, 2);
  });

  test('在「去除首尾空白」之后比较：只差首尾空白的行算重复', () => {
    assert.deepEqual(run(['a', 'b'], [['a', '1'], [' a', '1 ']], core.defaultRules()).rowMap, [0]);
  });

  test('关掉「去除首尾空白」后，只差空白的行不算重复', () => {
    const rules = core.defaultRules();
    rules.trim.on = false;
    assert.deepEqual(run(['a', 'b'], [['a', '1'], [' a', '1 ']], rules).rowMap, [0, 1]);
  });

  test('单元格里正好有 \\u0000 的两行不会被误判成重复', () => {
    const rules = core.defaultRules();
    rules.invisible.on = false;
    /* 前两行用 \u0000 拼出来的键完全相同，但内容不同；第三行和第二行才是真正的重复 */
    const r = run(['x', 'y'], [['a\u0000', 'b'], ['a', '\u0000b'], ['a', '\u0000b']], rules);
    assert.deepEqual(r.rowMap, [0, 1]);
    assert.deepEqual(r.removed, [{ row: 2, reason: 'duplicate', first: 1 }]);
  });

  test('默认开启；关掉后全部保留', () => {
    assert.equal(core.defaultRules().dedupe.on, true);
    const rules = core.defaultRules();
    rules.dedupe.on = false;
    assert.equal(run(['a'], [['1'], ['1']], rules).stats.finalRows, 2);
  });
});

describe('规则 6 · 表头规范化', () => {
  test('去首尾空白、删除换行', () => {
    const r = run([' 订单号 ', '客户\n编号', '金\r\n额'], [['1', '2', '3']], core.defaultRules());
    assert.deepEqual(r.header, ['订单号', '客户编号', '金额']);
    assert.deepEqual(r.headerChanged, Uint8Array.from([1, 1, 1]));
    assert.equal(r.stats.headerChanged, 3);
  });

  test('空表头填「列 N」', () => {
    assert.deepEqual(run(['a', '', 'b'], [['1', '2', '3']], core.defaultRules()).header, ['a', '列 2', 'b']);
  });

  test('重名表头追加序号', () => {
    assert.deepEqual(run(['金额', '金额', '金额'], [['1', '2', '3']], core.defaultRules()).header, ['金额', '金额 (2)', '金额 (3)']);
  });

  test('已经有「金额 (2)」时，序号往后顺延', () => {
    assert.deepEqual(run(['金额', '金额 (2)', '金额'], [['1', '2', '3']], core.defaultRules()).header, ['金额', '金额 (2)', '金额 (3)']);
  });

  test('去掉空列之后，「列 N」按剩下的列重新数', () => {
    const rules = core.defaultRules();
    rules.emptyCols.on = true;
    /* 第 2、4 列连数据都是空的，被删掉；第 3 列表头是空的但有数据，留下来变成第 2 列 */
    const r = run(['a', '', '', ''], [['1', '', '9', '']], rules);
    assert.deepEqual(r.header, ['a', '列 2']);
    assert.deepEqual(r.rows, [['1', '9']]);
  });

  test('改动记在报表里，表头的改动 row 为 -1', () => {
    const r = run([' a ', 'b'], [['1', '2']], core.defaultRules());
    assert.deepEqual(reportOf(r, 'header').changes, [{ row: -1, col: 0, before: ' a ', after: 'a' }]);
    assert.equal(reportOf(r, 'header').headers, 1);
    assert.equal(reportOf(r, 'header').kind, 'header');
  });

  test('和「清理不可见字符」联动：表头里的零宽字符也会去掉', () => {
    assert.deepEqual(run(['金\u200b额'], [['1']], core.defaultRules()).header, ['金额']);
    const rules = core.defaultRules();
    rules.invisible.on = false;
    assert.deepEqual(run(['金\u200b额'], [['1']], rules).header, ['金\u200b额']);
  });

  test('默认开启；关掉后表头原样保留', () => {
    assert.equal(core.defaultRules().header.on, true);
    const rules = core.defaultRules();
    rules.header.on = false;
    assert.deepEqual(run([' a ', ''], [['1', '2']], rules).header, [' a ', '']);
  });
});

describe('规则 7 · 数字规范化', () => {
  test('默认：去掉千分位逗号和货币符号、全角数字转半角；百分号和带前导零的编号不动', () => {
    const r = run(['金额', '折扣', '年份', '客户编号'], [['¥12,800.50', '95%', '２０２３', '0012345']], core.defaultRules());
    assert.deepEqual(r.rows, [['12800.50', '95%', '2023', '0012345']]);
    assert.deepEqual(reportOf(r, 'number').changes[0], { row: 0, col: 0, before: '¥12,800.50', after: '12800.50' });
  });

  test('勾选「百分号转小数」之后才转换百分数', () => {
    const rules = core.defaultRules();
    rules.number.percent = true;
    assert.deepEqual(run(['折扣'], [['95%'], ['12.5%']], rules).rows, [['0.95'], ['0.125']]);
  });

  test('四项可以单独开关', () => {
    const rules = core.defaultRules();
    rules.number.thousands = false;
    assert.deepEqual(run(['a'], [['¥12,800']], rules).rows, [['¥12,800']]);
    rules.number = { on: true, thousands: true, currency: false };
    assert.deepEqual(run(['a'], [['¥12,800']], rules).rows, [['¥12,800']]);
    rules.number = { on: true, thousands: true, currency: true, fullwidth: false };
    assert.deepEqual(run(['a'], [['２０２３']], rules).rows, [['２０２３']]);
  });

  test('全角数字在任何单元格里都会转成半角', () => {
    const rules = core.defaultRules();
    rules.number.fullwidth = false;
    const rows = [['共３件', 'Ａ-００１']];
    const on = run(['x', 'y'], rows, core.defaultRules()).rows;
    assert.deepEqual(on, [['共3件', 'Ａ-001']]);
    assert.deepEqual(run(['x', 'y'], rows, rules).rows, rows);
  });

  test('默认开启', () => {
    assert.equal(core.defaultRules().number.on, true);
  });
});

describe('规则 8 · 日期规范化', () => {
  test('几种写法统一成 YYYY-MM-DD', () => {
    const r = run(['日期'], [['2023/3/12'], ['2023年3月13日'], ['2023.3.14'], ['2023-03-15'], ['25/03/2023']], core.defaultRules());
    assert.deepEqual(r.rows, [['2023-03-12'], ['2023-03-13'], ['2023-03-14'], ['2023-03-15'], ['2023-03-25']]);
    assert.equal(reportOf(r, 'date').cells, 4);     /* 已经是目标写法的那一个没变 */
    assert.equal(r.dateIssues.total, 0);
  });

  test('日月顺序不明确的日期保留原值，并进入日期歧义报告', () => {
    const r = run(['日期'], [['03/04/2023']], core.defaultRules());
    assert.deepEqual(r.rows, [['03/04/2023']]);
    assert.equal(r.dateIssues.total, 1);
    assert.deepEqual(r.dateIssues.byReason, { ambiguous: 1, invalid: 0, 'two-digit-year': 0, 'month-only': 0 });
    assert.equal(r.dateIssues.items[0].row, 0);
    assert.equal(r.dateIssues.items[0].col, 0);
    assert.equal(r.dateIssues.items[0].value, '03/04/2023');
    assert.equal(r.dateIssues.items[0].reason, 'ambiguous');
    assert.match(r.dateIssues.items[0].message, /无法判断|不明确/);
  });

  test('写错的日期保留原值，并说明错在哪里', () => {
    const r = run(['日期'], [['2023-02-30'], ['2023-03-01']], core.defaultRules());
    assert.deepEqual(r.rows, [['2023-02-30'], ['2023-03-01']]);
    assert.equal(r.dateIssues.items[0].reason, 'invalid');
    assert.match(r.dateIssues.items[0].message, /2 月只有 28 天/);
  });

  test('指定按「日/月/年」或「月/日/年」解读后，不明确的日期会被转换', () => {
    const dmy = core.defaultRules();
    dmy.date.ambiguous = 'dmy';
    const r1 = run(['日期'], [['03/04/2023']], dmy);
    assert.deepEqual(r1.rows, [['2023-04-03']]);
    assert.equal(reportOf(r1, 'date').ambiguousResolved, 1);
    const mdy = core.defaultRules();
    mdy.date.ambiguous = 'mdy';
    assert.deepEqual(run(['日期'], [['03/04/2023']], mdy).rows, [['2023-03-04']]);
  });

  test('8 位纯数字：所在列基本都是日期时才转换', () => {
    const r1 = run(['下单日期'], [['20230312'], ['2023-03-13'], ['20230314']], core.defaultRules());
    assert.deepEqual(r1.rows, [['2023-03-12'], ['2023-03-13'], ['2023-03-14']]);
  });

  test('8 位编号即使恰好是合法日期，只要不是日期列就不动，也不报告', () => {
    const r = run(['订单编号'], [['20230101'], ['20230102'], ['10000001']], core.defaultRules());
    assert.deepEqual(r.rows, [['20230101'], ['20230102'], ['10000001']]);
    assert.equal(r.dateIssues.total, 0);
  });

  test('日期列里写错的 8 位日期会保留并报告；空值不计入判断', () => {
    const rows = [];
    for (let d = 1; d <= 12; d++) rows.push([String(d), '202303' + String(d).padStart(2, '0')]);   /* 12 个合法的 8 位日期 */
    rows.splice(6, 0, ['x', '20230230'], ['y', '']);                                                /* 一个写错的，一个空值 */
    const r = run(['序号', '下单日期'], rows, core.defaultRules());
    assert.equal(r.rows.length, 14);
    assert.deepEqual(r.rows.slice(0, 8).map((x) => x[1]), ['2023-03-01', '2023-03-02', '2023-03-03', '2023-03-04', '2023-03-05', '2023-03-06', '20230230', '']);
    assert.deepEqual(r.dateIssues.items.map((x) => [x.value, x.reason]), [['20230230', 'invalid']]);
  });

  test('日期列里有一两个其他写法的笔误，不会连累 8 位日期', () => {
    const rows = [['2023/3/12'], ['2023-02-30'], ['20230313'], ['03/04/2023'], ['20230314']];
    assert.deepEqual(run(['日期'], rows, core.defaultRules()).rows.map((x) => x[0]),
      ['2023-03-12', '2023-02-30', '2023-03-13', '03/04/2023', '2023-03-14']);
  });

  test('全角数字写的 8 位日期能被识别（数字规范化排在前面）', () => {
    assert.deepEqual(run(['日期'], [['２０２３０３１２'], ['2023-03-13']], core.defaultRules()).rows, [['2023-03-12'], ['2023-03-13']]);
  });

  test('默认开启', () => {
    assert.equal(core.defaultRules().date.on, true);
    assert.equal(core.defaultRules().date.ambiguous, 'keep');
  });
});

describe('规则 9 · 空值填充', () => {
  test('默认关闭；开启后只填充空单元格', () => {
    assert.equal(core.defaultRules().fill.on, false);
    const rules = core.defaultRules();
    rules.fill.on = true;
    const r = run(['a', 'b'], [['a', ''], ['', 'b']], rules);
    assert.deepEqual(r.rows, [['a', '（空）'], ['（空）', 'b']]);
    assert.equal(reportOf(r, 'fill').cells, 2);
  });

  test('占位文本可以改；不填充表头', () => {
    const rules = core.defaultRules();
    rules.fill.on = true;
    rules.header.on = false;         /* 否则空表头会先被「表头规范化」填成「列 2」 */
    rules.fill.text = '待补';
    const r = run(['a', ''], [['', 'x']], rules);
    assert.deepEqual(r.rows, [['待补', 'x']]);
    assert.deepEqual(r.header, ['a', '']);
  });

  test('只有空白的单元格也算空', () => {
    const rules = core.defaultRules();
    rules.fill.on = true;
    rules.trim.on = false;
    rules.emptyRows.on = false;      /* 否则这一行会先被当成全空行删掉 */
    assert.deepEqual(run(['a'], [['  ']], rules).rows, [['（空）']]);
  });

  test('占位文本为空时规则不执行，并说明发生了什么、为什么、怎么改', () => {
    const rules = core.defaultRules();
    rules.fill.on = true;
    rules.fill.text = '  ';
    const r = run(['a', 'b'], [['', 'x']], rules);
    assert.deepEqual(r.rows, [['', 'x']]);
    assert.equal(r.ruleErrors.length, 1);
    assert.equal(r.ruleErrors[0].rule, 'fill');
    assert.equal(r.ruleErrors[0].code, 'empty-fill');
    assert.match(r.ruleErrors[0].title, /没有执行/);
    assert.match(r.ruleErrors[0].reason, /占位文本.*是空的/);
    assert.match(r.ruleErrors[0].fix, /填写|关闭/);
  });
});

describe('规则 10 · 查找替换', () => {
  /* 只留查找替换，避免其他规则的改动干扰 */
  function onlyReplace(replace) {
    const rules = core.defaultRules();
    core.RULE_IDS.forEach((id) => { rules[id].on = false; });
    rules.replace = Object.assign({ on: true, scope: 'all', cols: [], find: '', replacement: '', regex: false }, replace);
    return rules;
  }

  test('默认关闭', () => {
    assert.equal(core.defaultRules().replace.on, false);
  });

  test('按普通文本替换所有出现的位置', () => {
    const r = run(['a', 'b'], [['aab', 'ca'], ['zzz', 'a']], onlyReplace({ find: 'a', replacement: 'X' }));
    assert.deepEqual(r.rows, [['XXb', 'cX'], ['zzz', 'X']]);
    assert.equal(reportOf(r, 'replace').rows, 2);
    assert.equal(reportOf(r, 'replace').cells, 3);
  });

  test('按普通文本时，替换为里的 $ 不是特殊符号', () => {
    const r = run(['a'], [['a-b']], onlyReplace({ find: 'a', replacement: '$&$1' }));
    assert.deepEqual(r.rows, [['$&$1-b']]);
  });

  test('按正则表达式替换，可以用 $1 引用分组', () => {
    const r = run(['a'], [['订单 a1 共 23 件']], onlyReplace({ find: '(\\d)', replacement: '[$1]', regex: true }));
    assert.deepEqual(r.rows, [['订单 a[1] 共 [2][3] 件']]);
  });

  test('替换为空就是删除', () => {
    assert.deepEqual(run(['a'], [['x-y-z']], onlyReplace({ find: '-', replacement: '' })).rows, [['xyz']]);
  });

  test('作用范围：全表 / 指定列；不替换表头', () => {
    const rows = [['a', 'a'], ['a', 'a']];
    assert.deepEqual(run(['a', 'b'], rows, onlyReplace({ find: 'a', replacement: 'b' })).rows, [['b', 'b'], ['b', 'b']]);
    const r = run(['a', 'b'], rows, onlyReplace({ find: 'a', replacement: 'b', scope: 'cols', cols: [1] }));
    assert.deepEqual(r.rows, [['a', 'b'], ['a', 'b']]);
    assert.deepEqual(r.header, ['a', 'b']);
  });

  test('没有勾选任何一列时不执行，并说明怎么改', () => {
    const r = run(['a'], [['x']], onlyReplace({ find: 'x', scope: 'cols', cols: [] }));
    assert.equal(r.ruleErrors[0].code, 'no-columns');
    assert.match(r.ruleErrors[0].reason, /一列都没有/);
    assert.match(r.ruleErrors[0].fix, /勾选一列|全表/);
  });

  test('查找内容为空时不执行，并说明怎么改', () => {
    const r = run(['a'], [['x']], onlyReplace({ find: '' }));
    assert.equal(r.ruleErrors[0].code, 'empty-find');
    assert.match(r.ruleErrors[0].fix, /填写|关闭/);
  });

  test('正则写错时不执行；报错按「发生了什么 / 为什么 / 怎么改」给出', () => {
    const r = run(['a'], [['x']], onlyReplace({ find: '([a-z', regex: true }));
    assert.equal(r.ruleErrors.length, 1);
    assert.equal(r.ruleErrors[0].rule, 'replace');
    assert.equal(r.ruleErrors[0].title, '查找替换没有执行');
    assert.match(r.ruleErrors[0].reason, /方括号/);
    assert.match(r.ruleErrors[0].reason, /原始报错/);
    assert.match(r.ruleErrors[0].fix, /正则表达式|普通文本/);
  });

  test('一条规则出错不影响其他规则', () => {
    const rules = onlyReplace({ find: '(', regex: true });
    rules.englishCase = { on: true, mode: 'upper' };
    const r = run(['a'], [['pending']], rules);
    assert.deepEqual(r.rows, [['PENDING']]);
    assert.equal(r.ruleErrors.length, 1);
    assert.equal(reportOf(r, 'replace').cells, 0);
    assert.equal(reportOf(r, 'englishCase').cells, 1);
  });
});

describe('规则 11 · 英文大小写', () => {
  function withMode(mode) {
    const rules = core.defaultRules();
    core.RULE_IDS.forEach((id) => { rules[id].on = false; });
    rules.englishCase = { on: true, mode: mode };
    return rules;
  }

  test('默认关闭，选项是「不改」', () => {
    assert.equal(core.defaultRules().englishCase.on, false);
    assert.equal(core.defaultRules().englishCase.mode, 'none');
  });

  test('全部小写 / 全部大写 / 首字母大写', () => {
    const rows = [['Pending'], ['nEW YORK']];
    assert.deepEqual(run(['a'], rows, withMode('lower')).rows, [['pending'], ['new york']]);
    assert.deepEqual(run(['a'], rows, withMode('upper')).rows, [['PENDING'], ['NEW YORK']]);
    assert.deepEqual(run(['a'], rows, withMode('title')).rows, [['Pending'], ['New York']]);
  });

  test('只影响纯英文字母的单元格', () => {
    const rows = [['ABC-123'], ['N/A'], ['中文abc'], ['abc123'], ['A1'], ['中文 English'], ['OK']];
    assert.deepEqual(run(['a'], rows, withMode('lower')).rows, [['ABC-123'], ['N/A'], ['中文abc'], ['abc123'], ['A1'], ['中文 English'], ['ok']]);
  });

  test('选「不改」时什么也不做', () => {
    assert.deepEqual(run(['a'], [['Pending']], withMode('none')).rows, [['Pending']]);
  });
});

describe('规则的顺序与报表', () => {
  test('报表的顺序和规则的顺序一致，共 11 条', () => {
    assert.equal(core.RULE_IDS.length, 11);
    assert.deepEqual(run(['a'], [['1']], core.defaultRules()).rules.map((r) => r.id), core.RULE_IDS);
  });

  test('先删全空行再去重：全空行记为空行，不记为重复', () => {
    const r = run(['a'], [[''], [''], ['']], core.defaultRules());
    assert.equal(r.stats.removedEmpty, 3);
    assert.equal(r.stats.removedDuplicates, 0);
  });

  test('「修改的单元格数」按最终结果算：一条链上改了几次只算一个', () => {
    const r = run(['金额'], [[' ¥12,800.50 '], ['0012345']], core.defaultRules());
    assert.deepEqual(r.rows, [['12800.50'], ['0012345']]);
    assert.equal(reportOf(r, 'trim').cells, 1);
    assert.equal(reportOf(r, 'number').cells, 1);
    assert.equal(r.stats.changedCells, 1);
    assert.equal(r.stats.changedRows, 1);
    assert.deepEqual(r.cellChanged, [Uint8Array.from([1]), null]);
  });

  test('cellChanged 按清洗后的列下标标记；被删的列不占位置', () => {
    const rules = core.defaultRules();
    rules.emptyCols.on = true;
    const r = run(['a', '空', 'b'], [['1', '', ' x ']], rules);
    assert.deepEqual(r.cellChanged, [Uint8Array.from([0, 1])]);
  });

  test('改动样例最多记录 maxChanges 处，但计数是完整的', () => {
    const rules = core.defaultRules();
    rules.number.on = false;
    const rows = [[' 1 '], [' 2 '], [' 3 '], [' 4 '], [' 5 ']];
    const r = run(['a'], rows, rules, { maxChanges: 2 });
    assert.equal(reportOf(r, 'trim').changes.length, 2);
    assert.equal(reportOf(r, 'trim').cells, 5);
    assert.equal(reportOf(r, 'trim').rows, 5);
  });

  test('日期问题最多记录 maxIssues 条，但总数是完整的', () => {
    const rows = [];
    for (let i = 0; i < 30; i++) rows.push([String(i), '03/04/2023']);     /* 第一列各不相同，不会被去重 */
    const r = run(['序号', '日期'], rows, core.defaultRules(), { maxIssues: 10 });
    assert.equal(r.dateIssues.items.length, 10);
    assert.equal(r.dateIssues.total, 30);
  });

  test('不修改传入的 table 和 rules', () => {
    const table = { header: [' a ', 'b'], rows: [[' 1 ', ''], ['']] };
    const snapshot = JSON.stringify(table);
    const rules = core.defaultRules();
    const rulesSnapshot = JSON.stringify(rules);
    core.applyRules(table, rules, {});
    assert.equal(JSON.stringify(table), snapshot);
    assert.equal(JSON.stringify(rules), rulesSnapshot);
  });

  test('规则对象缺字段时用默认值补全；不合法的取值回到默认', () => {
    assert.deepEqual(core.normalizeRules(null), core.defaultRules());
    const r = core.normalizeRules({ number: { on: true }, date: { ambiguous: '随便写的' }, englishCase: { mode: 'x' }, replace: { scope: 'cols', cols: [1, 'a', -2] } });
    assert.equal(r.number.thousands, true);
    assert.equal(r.number.percent, false);
    assert.equal(r.date.ambiguous, 'keep');
    assert.equal(r.englishCase.mode, 'none');
    assert.deepEqual(r.replace.cols, [1]);
    assert.equal(core.normalizeRules({ trim: { on: 1 } }).trim.on, true);
  });

  test('全部关闭时数据原样返回', () => {
    const rules = core.defaultRules();
    core.RULE_IDS.forEach((id) => { rules[id].on = false; });
    const table = { header: [' a ', ''], rows: [[' 1 ', '¥2,000'], [''], [' 1 ', '¥2,000']] };
    const r = core.applyRules(table, rules);
    /* 传进来的行列数不齐时会被补空，这是 applyRules 的约定 */
    assert.deepEqual(r.rows, [[' 1 ', '¥2,000'], ['', ''], [' 1 ', '¥2,000']]);
    assert.deepEqual(r.header, table.header);
    assert.deepEqual([r.stats.finalRows, r.stats.removedRows, r.stats.changedCells, r.stats.headerChanged], [3, 0, 0, 0]);
    assert.equal(r.dateIssues.total, 0);
  });

  test('每条规则报表的 kind', () => {
    assert.deepEqual(core.RULE_IDS.map((id) => core.RULE_KIND[id]),
      ['cell', 'cell', 'row', 'col', 'row', 'header', 'cell', 'cell', 'cell', 'cell', 'cell']);
  });
});

/* ==========================================================================
   示例数据
   ========================================================================== */

describe('示例数据（data.js）', () => {
  function loadSample() {
    const box = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8'), box);
    return box.window.APP_DATA.sample;
  }
  const sample = loadSample();

  function clean(rules) {
    const parsed = core.parseCsv(sample.csv, core.delimiterChar(core.detectDelimiter(sample.csv).delimiterId));
    const table = core.buildTable(parsed.records, { hasHeader: true });
    return core.applyRules(table, rules || core.defaultRules());
  }

  test('结构完整：名称、说明、CSV、问题清单', () => {
    assert.equal(sample.name, '订单数据');
    assert.ok(sample.description.length > 20);
    assert.equal(sample.csv.split('\n').length, 25);        /* 表头 + 24 行 */
    assert.equal(sample.issues.length, 14);
    for (const issue of sample.issues) {
      assert.ok(issue.title && issue.detail, JSON.stringify(issue));
    }
  });

  test('里面确实埋着这些问题', () => {
    const text = sample.csv;
    const count = (re) => (text.match(re) || []).length;
    assert.equal(count(/\u200b/g), 1);                       /* 零宽字符 1 处 */
    assert.ok(count(/\u3000/g) >= 3);                        /* 全角空格 */
    assert.ok(count(/\u00a0/g) >= 2);                        /* 不间断空格 */
    assert.ok(text.includes('"¥12,800.50"') && text.includes('"$1,200"'));
    assert.ok(text.includes('２'));
    assert.ok(text.includes('２０２３０５０４'));
    assert.ok(text.includes('03/04/2023'));
    assert.ok(text.includes('0012345'));
    assert.ok(text.includes('"上海市浦东新区张江路 1 号, 3 栋"'));
    /* 7 种日期写法各自都在 */
    for (const d of ['2023-03-12', '2023/3/12', '2023年3月23日', '20230315', '2023.3.16', '25/04/2023', '２０２３０５０４']) {
      assert.ok(text.includes(d), d);
    }
    assert.equal(text.split('\n').filter((l) => l.trim() === '').length, 1);   /* 一个空行 */
    assert.equal(text.split('\n').filter((l) => /^,+$/.test(l)).length, 1);    /* 一个只有逗号的行 */
  });

  test('分隔符识别为逗号，置信度高', () => {
    const d = core.detectDelimiter(sample.csv);
    assert.equal(d.delimiter, ',');
    assert.equal(d.confidence, 'high');
  });

  test('解析报告：有一行少了后面的列，两行全空，没有多出的列', () => {
    const parsed = core.parseCsv(sample.csv, ',');
    const table = core.buildTable(parsed.records, { hasHeader: true });
    assert.equal(table.width, 12);
    assert.equal(table.rows.length, 24);
    assert.deepEqual(table.report, { leadingBlank: 0, shortRows: 1, longRows: 0, extraCols: 0, blankRows: 2 });
    assert.equal(parsed.unclosedQuotes, 0);
    assert.equal(parsed.quoteGlitches, 0);
  });

  test('按默认规则清洗的结果', () => {
    const r = clean();
    assert.deepEqual(r.stats, {
      originalRows: 24, finalRows: 18, removedRows: 6, removedDuplicates: 4, removedEmpty: 2,
      changedCells: 34, changedRows: 17, originalCols: 12, finalCols: 12, removedCols: 0, headerChanged: 0
    });
    assert.deepEqual(r.rules.map((x) => [x.id, x.rows, x.cells, x.removedRows]), [
      ['trim', 8, 9, 0], ['invisible', 1, 1, 0], ['emptyRows', 2, 0, 2], ['emptyCols', 0, 0, 0], ['dedupe', 4, 0, 4],
      ['header', 0, 0, 0], ['number', 17, 19, 0], ['date', 10, 10, 0], ['fill', 0, 0, 0], ['replace', 0, 0, 0], ['englishCase', 0, 0, 0]
    ]);
    assert.deepEqual(r.removed, [
      { row: 5, reason: 'empty' },
      { row: 8, reason: 'duplicate', first: 0 },
      { row: 12, reason: 'empty' },
      { row: 16, reason: 'duplicate', first: 1 },
      { row: 19, reason: 'duplicate', first: 4 },
      { row: 23, reason: 'duplicate', first: 4 }
    ]);
    assert.deepEqual(r.rowMap, [0, 1, 2, 3, 4, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 20, 21, 22]);
  });

  test('默认规则下几处有代表性的结果', () => {
    const r = clean();
    const col = (name) => r.header.indexOf(name);
    const rowOf = (orderNo) => {
      const row = r.rows.find((x) => x[col('订单号')] === orderNo);
      assert.ok(row, orderNo);
      return row;
    };
    assert.equal(rowOf('SO-2023-0417')[col('金额')], '12800.50');
    assert.equal(rowOf('SO-2023-0417')[col('下单日期')], '2023-03-12');
    assert.equal(rowOf('SO-2023-0417')[col('客户编号')], '0012345');           /* 前导零保留 */
    assert.equal(rowOf('SO-2023-0417')[col('折扣')], '95%');                   /* 百分号默认不动 */
    assert.equal(rowOf('SO-2023-0419')[col('客户名称')], '武汉楚天云数据服务有限公司');   /* 零宽字符已去掉 */
    assert.equal(rowOf('SO-2023-0419')[col('金额')], '8637.20');               /* 首尾的不间断空格去掉了 */
    assert.equal(rowOf('SO-2023-0420')[col('下单日期')], '2023-03-15');        /* 8 位日期 */
    assert.equal(rowOf('SO-2023-0427')[col('下单日期')], '2023-04-25');        /* 25/04/2023 */
    assert.equal(rowOf('SO-2023-0432')[col('下单日期')], '2023-05-04');        /* 全角数字写的 8 位日期 */
    assert.equal(rowOf('SO-2023-0432')[col('数量')], '22');
    assert.equal(rowOf('SO-2023-0429')[col('数量')], '2');                     /* 全角数字 ２ */
    assert.equal(rowOf('SO-2023-0430')[col('下单日期')], '2023/4/31');         /* 写错的日期保留原值 */
    assert.equal(rowOf('SO-2023-0431')[col('下单日期')], '03/04/2023');        /* 日月不明确的保留原值 */
    assert.deepEqual(r.rows.find((x) => x[col('订单号')] === 'SO-2023-0433').slice(3), ['', '', '', '', '', '', '', '', '']);   /* 缺列的那一行补了空 */
    assert.deepEqual(r.dateIssues.items.map((x) => [x.value, x.reason]), [['2023/4/31', 'invalid'], ['03/04/2023', 'ambiguous']]);
  });

  test('打开「删除全空列」后去掉「备注」列', () => {
    const rules = core.defaultRules();
    rules.emptyCols.on = true;
    const r = clean(rules);
    assert.equal(r.header.length, 11);
    assert.equal(r.header.includes('备注'), false);
    assert.deepEqual(r.removedCols, [11]);
  });

  test('打开「英文大小写 · 全部大写」后客户等级统一', () => {
    const rules = core.defaultRules();
    rules.englishCase = { on: true, mode: 'upper' };
    const r = clean(rules);
    const col = r.header.indexOf('客户等级');
    /* 那一行缺列的订单客户等级是空的 */
    assert.deepEqual([...new Set(r.rows.map((row) => row[col]))].sort(), ['', 'PRO', 'STANDARD', 'VIP']);
  });

  test('打开「百分号转小数」', () => {
    const rules = core.defaultRules();
    rules.number.percent = true;
    const r = clean(rules);
    const col = r.header.indexOf('折扣');
    const rowOf = (orderNo) => r.rows.find((x) => x[0] === orderNo);
    assert.equal(rowOf('SO-2023-0417')[col], '0.95');
    assert.equal(rowOf('SO-2023-0418')[col], '0.88');
    assert.equal(rowOf('SO-2023-0419')[col], '1.00');
  });

  test('日月不明确的日期可以指定解读方式', () => {
    const rules = core.defaultRules();
    rules.date.ambiguous = 'dmy';
    const r = clean(rules);
    const col = r.header.indexOf('下单日期');
    assert.equal(r.rows.find((x) => x[0] === 'SO-2023-0431')[col], '2023-04-03');
    assert.equal(r.dateIssues.total, 1);
    assert.equal(reportOf(r, 'date').ambiguousResolved, 1);
  });

  test('用导出的 CSV 再解析一遍，得到同样的数据', () => {
    const r = clean();
    const back = core.parseCsv(core.formatCsv([r.header, ...r.rows]), ',').records;
    assert.deepEqual(back, [r.header, ...r.rows]);
    const json = JSON.parse(core.formatJson(r.header, r.rows));
    assert.equal(json.length, 18);
    assert.deepEqual(json[0], Object.fromEntries(r.header.map((h, i) => [h, r.rows[0][i]])));
  });
});

/* ==========================================================================
   类型推断与列概况
   ========================================================================== */

describe('类型推断', () => {
  const type = (values) => core.inferType(values);
  const cases = [
    [['1', '20', '-3', '120'], 'integer'],
    [['1.5', '2', '0.25'], 'decimal'],
    [['95%', '12.5%', '100%'], 'percent'],
    [['¥12', '$1.50', '3元'], 'currency'],
    [['¥12,800.50', '$1,200', '15,000元', '€ 9.843,60'], 'text'],   /* 最后一个是欧洲写法，不认；3/4 = 75%，不到 90% */
    [['¥12,800.50', '$1,200', '15,000元'], 'currency'],
    [['2023-03-12', '2023/3/2', '2023年3月3日'], 'date'],
    [['是', '否', '是'], 'boolean'],
    [['true', 'false', 'TRUE'], 'boolean'],
    [['False', 'True'], 'boolean'],
    [['1', '0', '1'], 'boolean'],
    [['abc', '2023-03-12x', '3元整'], 'text'],
    [['0012345', '0100864'], 'text'],
    [['', '', ''], 'empty'],
    [[], 'empty']
  ];
  for (const [values, expected] of cases) {
    test(JSON.stringify(values) + ' → ' + expected, () => {
      assert.equal(type(values), expected);
    });
  }

  test('非空值中 ≥ 90% 能解析成该类型，就认定为该类型', () => {
    assert.equal(type(['1', '2', '3', '4', '5', '6', '7', '8', '9', '待定']), 'integer');
    assert.equal(type(['1', '2', '3', '4', '5', '6', '7', '8', '待定', '无']), 'text');
    assert.equal(type(['2023-01-01', '2023-01-02', 'x']), 'text');
  });

  test('布尔：仅当全部取值只有这两种', () => {
    assert.equal(type(['1', '0', '2']), 'integer');
    assert.equal(type(['1', '1', '1']), 'integer');
    assert.equal(type(['是', '否', '待定']), 'text');
    assert.equal(type(['true', 'false', '是']), 'text');
    assert.equal(type(['是', '是']), 'boolean');
  });

  test('整数和小数混在一列时算小数；带千分位的整数算整数', () => {
    assert.equal(type(['1', '2.5', '3']), 'decimal');
    assert.equal(type(['1,000', '2,500']), 'integer');
    assert.equal(type(['1,000.50', '2,500']), 'decimal');
  });
});

describe('列概况', () => {
  const header = ['订单号', '客户编号', '金额', '日期', '已开票', '折扣', '备注', '数量'];
  const rows = [
    ['SO-1', '0012345', '12800.50', '2023-03-12', '是', '95%', '', '12'],
    ['SO-2', '0000210', '8600', '2023-04-02', '否', '88%', '', '4'],
    ['SO-3', '0012345', '15000.75', '2023-03-12', '是', '', '', '25'],
    ['SO-4', '', '', '', '否', '95%', '', '7']
  ];

  test('每列的类型、缺失、唯一值数、最小值与最大值', () => {
    const cols = core.profileColumns(header, rows);
    assert.deepEqual(cols.map((c) => [c.name, c.type]), [
      ['订单号', 'text'], ['客户编号', 'text'], ['金额', 'decimal'], ['日期', 'date'],
      ['已开票', 'boolean'], ['折扣', 'percent'], ['备注', 'empty'], ['数量', 'integer']
    ]);
    assert.deepEqual(cols[2], {
      type: 'decimal', total: 4, nonEmpty: 3, missing: 1, missingRate: 0.25, unique: 3,
      samples: ['12800.50', '8600', '15000.75'], min: '8600', max: '15000.75', index: 2, name: '金额'
    });
    assert.deepEqual([cols[3].min, cols[3].max], ['2023-03-12', '2023-04-02']);
    assert.deepEqual([cols[5].min, cols[5].max], ['88%', '95%']);
    assert.deepEqual([cols[6].missing, cols[6].missingRate, cols[6].unique, cols[6].min, cols[6].max, cols[6].samples],
      [4, 1, 0, null, null, []]);
    assert.equal(cols[0].min, null);
  });

  test('最小值和最大值按数值比较，不是按字符串比较', () => {
    const [c] = core.profileColumns(['n'], [['9'], ['10'], ['100'], ['2.5']]);
    assert.deepEqual([c.min, c.max], ['2.5', '100']);
  });

  test('带千分位的货币金额也算货币；最小值和最大值按去掉符号后的数值比较', () => {
    assert.equal(core.valueType('¥12,800.50'), 'currency');
    assert.equal(core.valueType('$1,200'), 'currency');
    assert.equal(core.valueType('1.200,50'), 'text');
    assert.equal(core.valueType('€ 9.843,60'), 'text');
    const [c] = core.profileColumns(['金额'], [['¥12,800.50'], ['$1,200'], ['15,000元'], ['']]);
    assert.equal(c.type, 'currency');
    assert.deepEqual([c.min, c.max], ['$1,200', '15,000元']);
  });

  test('只有数值、日期这类列才有最小值和最大值；类型不过关的列不拿一部分值硬算', () => {
    /* 货币写法 6 个、不带符号的 3 个，没有哪一种过 90%，整列算文本，不给范围 */
    const [mixed] = core.profileColumns(['金额'], [['¥1,200'], ['$3,456'], ['¥8,600'], ['¥9,840'], ['¥6,318'], ['¥4,797'], ['15,246'], ['8,637'], ['12,036']]);
    assert.equal(mixed.type, 'text');
    assert.deepEqual([mixed.min, mixed.max], [null, null]);
    /* 过了 90% 的列正常给范围，而且只按这一种类型的值算 */
    const [currency] = core.profileColumns(['金额'], [['¥1,200'], ['$3,456'], ['¥8,600'], ['¥9,840'], ['¥6,318'], ['¥4,797'], ['¥12,036'], ['¥7,514'], ['¥1,286'], ['不适用']]);
    assert.equal(currency.type, 'currency');
    assert.deepEqual([currency.min, currency.max], ['¥1,200', '¥12,036']);
    const [text] = core.profileColumns(['备注'], [['2023-01-01'], ['2023-12-31'], ['待定'], ['无']]);
    assert.equal(text.type, 'text');
    assert.deepEqual([text.min, text.max], [null, null]);
  });

  test('示例值最多 3 个，是不重复的非空值', () => {
    const [c] = core.profileColumns(['x'], [['a'], ['a'], [''], ['b'], ['c'], ['d']]);
    assert.deepEqual(c.samples, ['a', 'b', 'c']);
    assert.equal(c.unique, 4);
  });

  test('没有数据行时', () => {
    const [c] = core.profileColumns(['a'], []);
    assert.deepEqual([c.type, c.total, c.missing, c.missingRate, c.unique], ['empty', 0, 0, 0, 0]);
  });
});

/* ==========================================================================
   导出
   ========================================================================== */

describe('导出格式', () => {
  const rows = [['h1', 'h,2', 'h"3', '多行\n表头'], ['a,b', 'c"d', 'e\nf', ''], ['', '', '', '']];

  test('CSV：含分隔符、双引号、换行的字段用双引号包住；行尾 CRLF；文件以换行结尾', () => {
    assert.equal(core.formatCsv(rows),
      'h1,"h,2","h""3","多行\n表头"\r\n"a,b","c""d","e\nf",\r\n,,,\r\n');
  });

  test('TSV：用制表符分隔；单元格里的制表符和换行替换成空格；不加引号', () => {
    assert.equal(core.formatTsv([['a\tb', 'c"d', 'e\nf'], ['x', 'y', 'z']]),
      'a b\tc"d\te f\r\nx\ty\tz\r\n');
  });

  test('导出的 CSV 能原样解析回来', () => {
    const back = core.parseCsv(core.formatCsv(rows), ',').records;
    assert.deepEqual(back, rows);
    assert.equal(rows[0][3], back[0][3]);
  });

  test('没有数据行时输出空字符串', () => {
    assert.equal(core.formatCsv([]), '');
    assert.equal(core.formatTsv([]), '');
  });

  test('JSON：对象数组，每行一个，值都是字符串，文件以换行结尾', () => {
    const out = core.formatJson(['订单号', '金额'], [['SO-1', '12800.50'], ['SO-2', '']]);
    assert.equal(out, '[\n{"订单号":"SO-1","金额":"12800.50"},\n{"订单号":"SO-2","金额":""}\n]\n');
    assert.deepEqual(JSON.parse(out), [{ 订单号: 'SO-1', 金额: '12800.50' }, { 订单号: 'SO-2', 金额: '' }]);
    assert.equal(core.formatJson(['a'], []), '[]\n');
  });

  test('JSON 的键重名或为空时，按表头规范化的规则处理', () => {
    assert.equal(core.formatJson(['金额', '金额', ''], [['1', '2', '3']]), '[\n{"金额":"1","金额 (2)":"2","列 3":"3"}\n]\n');
  });

  test('文件名：cleaned_YYYYMMDD_HHmm.扩展名', () => {
    assert.equal(core.defaultFileName(new Date(2026, 10, 28, 14, 5), 'csv'), 'cleaned_20261128_1405.csv');
    assert.equal(core.defaultFileName(new Date(2026, 0, 3, 7, 4), 'tsv'), 'cleaned_20260103_0704.tsv');
  });

  test('文件名里的非法字符被去掉，空名字回到默认值，扩展名跟着格式走', () => {
    assert.equal(core.safeFileName('a/b:c*?"<>|.csv', 'tsv'), 'abc.tsv');
    assert.equal(core.safeFileName('  ', 'json'), 'cleaned.json');
    assert.equal(core.safeFileName('季度 报表.csv', 'json'), '季度 报表.json');
  });
});

/* ==========================================================================
   正则表达式的报错翻译
   ========================================================================== */

describe('正则表达式的报错翻译', () => {
  function explain(pattern) {
    try {
      new RegExp(pattern, 'g');
      return null;
    } catch (err) {
      return core.explainRegexError(err);
    }
  }

  test('括号没有闭合', () => { assert.match(explain('(abc').reason, /左括号/); });
  test('方括号没有闭合', () => { assert.match(explain('[a-z').reason, /方括号/); });
  test('量词里的数字写反了', () => { assert.match(explain('a{3,1}').reason, /写反/); });
  test('开头就是量词', () => { assert.match(explain('*a').reason, /没有可以重复/); });
  test('字符范围写反了', () => { assert.match(explain('[z-a]').reason, /从小到大/); });
  test('多出一个右括号', () => { assert.match(explain('a)').reason, /多了一个/); });
  test('命名分组重名', () => { assert.match(explain('(?<a>x)(?<a>y)').reason, /同一个名字/); });

  test('每个结果都有「发生了什么 / 为什么 / 怎么改」和原始报错', () => {
    for (const pattern of ['(abc', '[a-z', 'a{3,1}', '*a', '[z-a]', 'a)', '(?<a>x)(?<a>y)', '\\1', '(?<']) {
      const r = explain(pattern);
      if (!r) continue;
      assert.equal(r.title, '正则表达式无法识别', pattern);
      assert.ok(r.reason.length > 4, pattern);
      assert.match(r.fix, /修改|关掉/, pattern);
      assert.ok(r.raw.length > 0, pattern);
    }
  });

  test('compileFind：默认替换每一处；用了 \\p{…} 或 \\u{…} 时加上 u 标志', () => {
    assert.equal(core.compileFind('a', false).re, null);
    assert.equal(core.compileFind('a', true).re.flags, 'g');
    assert.equal(core.compileFind('\\p{L}+', true).re.flags, 'gu');
    assert.ok(core.compileFind('\\p{L}+', true).re.test('中'));
    const bad = core.compileFind('(', true);
    assert.equal(bad.re, undefined);
    assert.equal(bad.error.code, 'regex');
    assert.equal(bad.error.rule, 'replace');
  });
});

/* ==========================================================================
   辅助函数
   ========================================================================== */

describe('辅助函数', () => {
  test('千分位', () => {
    assert.deepEqual([0, 1247, 1183, 1000000, -1234, 'abc'].map(core.fmtInt), ['0', '1,247', '1,183', '1,000,000', '-1,234', '0']);
  });

  test('百分比保留一位小数', () => {
    assert.deepEqual([0, 0.1111, 1, 0.0556].map(core.fmtRate), ['0.0%', '11.1%', '100.0%', '5.6%']);
  });

  test('prettyValue：看不见的字符写成转义形式，必要时加引号', () => {
    assert.deepEqual([' ¥12,800 ', '', 'a\u200bb', 'x\ty', 'abc', '第一行\n第二行'].map(core.prettyValue),
      ["' ¥12,800 '", "''", "'a\\u200bb'", "'x\\ty'", 'abc', "'第一行\\n第二行'"]);
  });

  test('清洗配方：数据规模、分隔符、编码、每条启用的规则及参数', () => {
    const text = core.formatRecipe({
      generatedAt: '2026-11-28 14:05', tool: '折向东 · 工具箱 · 表格清洗 v2.0',
      source: { name: '订单数据.csv', encodingLabel: 'GB18030', delimiterLabel: '制表符', hasHeader: true },
      original: { rows: 1247, cols: 9 },
      result: { rows: 1183, cols: 8, removedRows: 64, removedDuplicates: 41, removedEmpty: 23, changedCells: 312 },
      rules: [
        { name: '去除首尾空白', state: 'on', detail: '' },
        { name: '数字规范化', state: 'on', detail: '去除千分位逗号、去除货币符号' },
        { name: '空值填充', state: 'off', detail: '占位文本：（空）' }
      ]
    });
    assert.match(text, /订单数据\.csv/);
    assert.match(text, /GB18030，分隔符：制表符/);
    assert.match(text, /1,247 行 × 9 列/);
    assert.match(text, /1\. 去除首尾空白\n  2\. 数字规范化：去除千分位逗号、去除货币符号/);
    assert.match(text, /未启用：空值填充/);
    assert.match(text, /1,183 行 × 8 列/);
    assert.match(text, /删除 64 行（重复 41，空行 23）/);
    assert.match(text, /修改 312 个单元格/);
    assert.ok(text.endsWith('\n') === false);
  });

  test('normalizeHeaderNames 是规则 6 和 JSON 导出共用的实现', () => {
    assert.deepEqual(core.normalizeHeaderNames([' a ', '', 'a', 'a'], false), { names: ['a', '列 2', 'a (2)', 'a (3)'], changed: 4 });
  });
});

/* ==========================================================================
   内联安全
   ========================================================================== */

describe('内联进页面时的安全', () => {
  /* 构建会把 core.js、data.js、app.js 原样放进 HTML 的 script 元素里。
     HTML 解析器不管 JavaScript 的字符串和注释：只要看到「</script」就认为脚本结束了，
     后面的代码会变成页面上的文字，整个应用失效。 */
  test('三个脚本里都没有会让浏览器提前结束脚本的序列', () => {
    for (const name of ['core.js', 'data.js', 'app.js']) {
      const source = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
      assert.equal(/<\/script/i.test(source), false, name + ' 里出现了 </script');
      assert.equal(/<!--/.test(source), false, name + ' 里出现了 <!--');
    }
  });

  test('样式表里没有结束 style 元素的序列', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    assert.equal(/<\/style/i.test(source), false);
  });
});

/* ==========================================================================
   性能
   ========================================================================== */

/* 生成一份带各种脏数据的订单表：首尾空白、全角空格、零宽字符、千分位和货币符号、
   5 种日期写法、带前导零的编号、重复行、空行 */
function makeBigCsv(n) {
  const companies = ['杭州恒瑞机械制造有限公司', '苏州明川电子科技有限公司', '武汉楚天云数据服务有限公司', '青岛海诺生物工程有限公司',
    '成都市锦江区云图文创工作室', '广州汇丰达贸易有限公司', '上海临港数联智能科技有限公司', '南京鼓楼区启明教育培训中心'];
  const dates = ['2023-03-12', '2023/3/13', '2023年3月14日', '20230315', '2023.3.16'];
  const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const lines = new Array(n + 1);
  let k = 1;
  let prev = '';
  let blanks = 0;
  let duplicates = 0;
  lines[0] = '订单号,客户编号,客户名称,下单日期,数量,金额,折扣,已开票,客户等级,备注';
  for (let i = 0; i < n; i++) {
    if (i % 500 === 0) { lines[k++] = ''; blanks++; continue; }       /* 每 500 行一个空行；最后一行不留空 */
    if (i % 97 === 96) { lines[k++] = prev; duplicates++; continue; }
    const cents = (i * 7919) % 900000 + 120037;
    const amount = Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');
    const [intPart, frac] = amount.split('.');
    const line = [
      (i % 7 === 0 ? ' ' : '') + 'SO-2023-' + String(100000 + i) + (i % 7 === 0 ? ' ' : ''),
      String(1000000 + (i % 8000)).padStart(7, '0'),
      (i % 3 === 0 ? '\u3000' : '') + companies[i % 8] + (i % 3 === 1 ? ' ' : '') + (i % 11 === 0 ? '\u200b' : ''),
      dates[i % 5],
      String(i % 300),
      '"' + (i % 3 === 0 ? '¥' : i % 3 === 1 ? '$' : '') + group(intPart) + '.' + frac + '"',
      (80 + (i % 21)) + '%',
      i % 2 ? '是' : '否',
      i % 4 === 0 ? 'vip' : 'Standard',
      i % 50 === 0 ? '加急\t' : ''
    ].join(',');
    lines[k++] = line;
    prev = line;
  }
  return { text: lines.join('\r\n'), rows: n, blanks: blanks, duplicates: duplicates };
}

describe('性能', () => {
  test('5 万行数据：解析 + 建表 + 清洗在 1 秒内完成', () => {
    const big = makeBigCsv(50000);
    assert.equal(big.blanks, 100);
    assert.equal(big.duplicates, 514);

    const t0 = performance.now();
    const parsed = core.parseCsv(big.text, ',');
    const t1 = performance.now();
    const table = core.buildTable(parsed.records, { hasHeader: true });
    const t2 = performance.now();
    const result = core.applyRules(table, core.defaultRules());
    const t3 = performance.now();
    core.profileColumns(result.header, result.rows);
    const t4 = performance.now();

    console.log('  5 万行 × 10 列：解析 ' + Math.round(t1 - t0) + ' ms，建表 ' + Math.round(t2 - t1) +
      ' ms，清洗 ' + Math.round(t3 - t2) + ' ms，合计 ' + Math.round(t3 - t0) + ' ms；列概况 ' + Math.round(t4 - t3) + ' ms');

    assert.equal(table.rows.length, big.rows);
    assert.equal(result.stats.removedEmpty, big.blanks);
    assert.equal(result.stats.removedDuplicates, big.duplicates);
    assert.equal(result.stats.finalRows, big.rows - big.blanks - big.duplicates);
    assert.equal(result.header.length, 10);
    assert.ok(result.stats.changedCells > 100000);
    assert.ok(t3 - t0 < 1000, '解析 + 建表 + 清洗用了 ' + Math.round(t3 - t0) + ' ms，超过了 1 秒');
  });
});

