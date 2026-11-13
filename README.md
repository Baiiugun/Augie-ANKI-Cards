# Augie-ANKI-Cards

> ⚠️ **【临时测试系统】** 这是 Augie 和爸爸一起试用的 Anki 网页版，**不是正式产品**。
> 目的：在真实使用中看看还缺什么、哪里不顺手。随时可能改动、清空或整体删除。

## 这是什么

一个只给 Augie（学生）和爸爸（老师）用的网页版背单词 / 背汉字系统，背诵手感尽量接近 Anki，
但没有"同步"：所有进度只存在云端一份。

## 公网地址

- 背词页面（Augie 用，需要带学习码的链接才能进）：https://baiiugun.github.io/Augie-ANKI-Cards/
- 老师页面（登录后用）：https://baiiugun.github.io/Augie-ANKI-Cards/Augie-Anki测试-老师登录版本.html
- 高中“阅读词”学生页（要带老师发的专属链接）：https://baiiugun.github.io/Augie-ANKI-Cards/阅读词.html
- 阅读词老师页（登录后用：建学生、布置试卷词库、看进度）：https://baiiugun.github.io/Augie-ANKI-Cards/阅读词-老师登录版本.html
  （阅读词的卡片内容存在 Supabase，**不在本仓库**；需要先运行 `10-Augie-Anki测试系统-阅读词与布置.sql`。）
- 状态：**测试中**。背词页和老师页都已发布，但数据库那一步（`04-Augie-Anki测试系统-建表.sql`）要由老师在 Supabase 里运行后才能真正使用。

## 目录

| 路径 | 内容 |
|---|---|
| `index.html` | 学生背词页（`?mock=1` 是不联网的演示模式） |
| `Augie-Anki测试-老师登录版本.html` | 老师页：学生链接、每个 Deck 每天学多少、学生能否自管卡片、卡片管理、每天学习量、各 Deck 进度 |
| `lib/anki-sched.js` | Anki 旧调度（SM-2）的复刻，参数 = Augie 的 Anki 默认预设 |
| `lib/api.js`、`lib/teacher-api.js`、`lib/config.js` | 学生页 / 老师页和 Supabase 通话、公开配置（anon 公开密钥）；`?mock=1` 离线演示用 `lib/mock-store.js` |
| `lib/browser.js` | 卡片浏览器（搜索、按状态筛选、选中后暂停 / 取消暂停 / 设为今天复习），学生页和老师页共用 |
| `阅读词.html`、`阅读词-老师登录版本.html`、`lib/yuedu-api.js` | 高中“阅读词”：学生选试卷/篇章背词、“不再背诵”和 3 步撤销；老师建学生、按试卷→板块布置、看进度（`?mock=1` 离线演示） |
| `tools/yuedu-bank.mjs` | 把一个试卷词库包（每个板块一个 .apkg）存进 Supabase 的阅读词词库 |
| `data/` | 卡片文字内容（`manifest.json` + 每个 Deck 一个 json），**不含进度** |
| `tools/` | 导入程序：`build-content.mjs` 拆 .apkg，`upload.mjs` 上传媒体并导入进度（在老师电脑上运行，需要 Node >= 22.23.4） |
| `test/` | 用真实 Anki 答题记录检验调度规则的脚本 |

## 这个仓库里放什么、不放什么

| 放 | 不放 |
|---|---|
| 网页代码、卡片的文字内容 | 学习进度、学习码（在 Supabase 里） |
| 说明文档 | 带调度信息的 `.apkg` 原件（在作者本机，不进公开仓库） |
| | 音频 / 视频等媒体文件（放在 Supabase Storage） |
| | 任何密码、密钥 |

## 命名约定（所有 AI 和人请照此）

- 仓库：`Augie-ANKI-Cards`（注意 ANKI 大写）。
- 凡是这套系统的东西，名字里都要能看出"Augie / Anki / 测试"：
  - Supabase 里的表、函数统一前缀 `anki_test_`（试用结束后可按前缀整批删除）。
  - SQL 文件：`04-Augie-Anki测试系统-<内容>.sql`。
  - 页面顶部常显"测试版"横幅。

## 状态

方案与搭建记录见作者本机项目文件夹「云端单词背诵系统」里的 `操作记录-Augie-Anki测试系统.md`。
当前阶段：家庭版与阅读词学生版均已运行；2026-11-10 新版包含教学词库校验、筛选和逐词布置，使用方法见下。

## 家庭版与教学学生版（2026-11-10）

- 统一学习入口：<https://baiiugun.github.io/Augie-ANKI-Cards/>。新版按学习码识别家庭／学生身份，原有链接兼容。
- 家庭管理：`Augie-Anki测试-老师登录版本.html`，沿用 Augie 的 Deck 与进度。
- 学生管理：`阅读词-老师登录版本.html`，新增“词库 · 选词布置”和“导入词库”。只显示学生版学习者。
- APKG 导入：在仓库上一级双击 `启动学生版词库导入.cmd`。本机页面读取 APKG，老师在浏览器中自行登录、确认上传；本机服务不接收老师密码和云端令牌。支持现有阅读词模板和 Word/Meaning 等结构字段。
- 分类维度：适用课程、阅读词用途、来源类型、材料、篇章；后续批次合并到原材料。缺失标签默认拦截，可由老师明确确认后补齐。
- 教学卡片内容、标签和分配均在 Supabase；公开仓库不存教学词库和个人学习数据。本轮复用已有表，无新增 SQL。
- 回归检查：`node --test tools/tests/teaching-import.test.mjs`（只用自编数据，本机私有目录暂存并清理，不写真实数据库）。

## MAP Quiz 词库（2026-11-12）

- 老师打开 [MAP 词库](https://baiiugun.github.io/Augie-ANKI-Cards/MAP词库-老师登录版本.html)，直接选择 MAP 特别版导出的 APKG。浏览器核对来源清单、13 字段、原始 PDF 页码、固定词卡编号、恰好 8 个标签和 MP3 内容哈希，预览后上传。
- 每个 TXT／APKG 对应一份完整 Quiz；材料标签示例 `材料::MAP-Reading-G06-P002`。其余七项为课程、用途、MAP协议、MAP科目、材料年级、原书层级、档位，不需要补篇章标签。
- 导入只加入老师词库；老师按书册、年级、板块、原书层级、Quiz、词库档位和逐词 CEFR 选词，确认学生后布置。词库档位与单词 CEFR 独立保存。
- 同书同词形、词性、词义使用固定词卡编号，跨 Quiz 共享一份进度。撤回一个 Quiz 保留其他已布置 Quiz 的共同词；全部撤回后隐藏，重新布置沿用原进度。
- 学生原有 `阅读词.html` 链接继续使用，也可使用 `MAP阅读词.html`；学习码仍由老师私下提供，不写入仓库。家庭版和其他课程继续走原流程。
- 数据库前提：由老师本人在原 Supabase 项目运行本机项目 `sql/12-Augie-Anki测试系统-MAP多出处与布置.sql`。尚未接入时，MAP 页面会在任何上传之前停止；原阅读词入口兼容未安装 MAP 扩展的数据库。
- 解包与 SQLite/WASM 组件随站点提供，版本、完整性摘要及许可证在 `vendor/`，不依赖运行时外部 CDN。查询与语音仍由 Windows 助手使用 DeepSeek 和火山 TTS，网页导入不调用这些付费服务。
- 回归：`node --test tools/tests/teaching-import.test.mjs tools/tests/map-flow.test.mjs`。测试使用虚构数据；真实云端验收结果另记于本机操作记录。
