# 折向东 · 工具箱

四个在浏览器里直接运行的小工具。不需要登录，不向服务器发送任何数据。

| 工具 | 用途 | 在线使用 |
|---|---|---|
| 表格清洗 | 粘贴或上传 CSV / TSV，去重、删空行、规范数字与日期，导出干净表格 | [打开](https://shimmering-boba-ee233b.netlify.app/) |
| 数字化成熟度自评 | 对照四个维度二十道题，判断企业数字化所处等级，列出短板和行动建议 | [打开](https://euphonious-capybara-1038b2.netlify.app/) |
| PMP 助手 | 考试大纲速查、挣值计算器、风险登记册、考点速记卡 | [打开](https://jovial-stardust-dc4e72.netlify.app/) |
| 程序员避坑指南 | Java、Spring、Redis、MySQL、AI 编程与工程实践中的常见坑，按主题检索 | [打开](https://comforting-gelato-8e73f3.netlify.app/) |

## 本地运行

只依赖 Python 3（标准库）和 Node.js（跑测试）。

```bash
python -I build/build.py            # 构建全部应用，产物在 build/sites/<app>/index.html
python -I build/build.py table-cleaner   # 只构建一个
python -m http.server 8765 --directory build/sites   # 然后访问 http://127.0.0.1:8765/table-cleaner/
```

每个应用构建后是一个单文件 `index.html`：样式、字体、图标、脚本全部内联，可以直接部署到任何静态托管。

## 目录

```
apps/<app>/            应用源码
  index.html           外壳与各视图的静态结构
  styles.css           仅本应用的样式
  data.js              内容数据
  core.js              纯逻辑（浏览器和 Node 都能运行，便于单测）
  app.js               界面逻辑
  test/core.test.js    单元测试（node:test）
design/                设计系统
  tokens.css           颜色、字号、间距、圆角、阴影、动效的变量
  base.css             重置、排版、应用骨架（侧栏 + 工具栏 + 内容区）
  components.css       组件与 8 种交互状态
  icons.html           图标 sprite（Heroicons，统一 1.5px 描边）
  brand/               标志与网站图标
  shared.js            公共脚本：主题切换、轻提示、下载与复制
  _template/           新应用的起始模板
  _styleguide/         样式指南，组件的活样例
build/                 构建与生成脚本
```

## 设计系统

界面遵循 [OJO Design Skills](https://github.com/touchine-ojo/OJO-Design-Skills) 的方法（Convention Track，参照 Apple HIG）。几条贯穿全站的规则：

- 所有颜色、间距、圆角都来自 `design/tokens.css` 的变量，分浅色与深色两套，文字对比度不低于 4.5:1。
- 全站只用一个图标库、一种描边粗细，不使用 emoji 充当图标。
- 每个交互组件覆盖默认、悬停、聚焦、按下、禁用、加载、错误、成功八种状态，以 ARIA 属性作为状态钩子。
- 每个工具有一枚强调色，只用在主要按钮、当前导航、链接和关键强调上。

## 第三方资源

- 图标：[Heroicons](https://heroicons.com) v2.2.0，MIT 许可，版权归 Tailwind Labs, Inc.。
- 西文字体：Instrument Sans、JetBrains Mono，来自 Google Fonts，SIL Open Font License 1.1。
- 中文字体：MiSans，通过 [emfont](https://font.emtech.cc) 在运行时加载。

## 说明

「PMP 助手」和「数字化成熟度自评」是非官方的辅助资料，内容依据公开的考试大纲和评测指标整理并注明了出处，以相关机构发布的最新信息为准。PMP、PMBOK 是 Project Management Institute, Inc. 的商标。
