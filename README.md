# Augie-ANKI-Cards

> ⚠️ **【临时测试系统】** 这是 Augie 和爸爸一起试用的 Anki 网页版，**不是正式产品**。
> 目的：在真实使用中看看还缺什么、哪里不顺手。随时可能改动、清空或整体删除。

## 这是什么

一个只给 Augie（学生）和爸爸（老师）用的网页版背单词 / 背汉字系统，背诵手感尽量接近 Anki，
但没有"同步"：所有进度只存在云端一份。

## 公网地址

- 背词页面（Augie 用，需要带学习码的链接才能进）：https://baiiugun.github.io/Augie-ANKI-Cards/
- 老师页面（登录后用）：https://baiiugun.github.io/Augie-ANKI-Cards/Augie-Anki测试-老师登录版本.html
- 状态：**测试中**。背词页和老师页都已发布，但数据库那一步（`04-Augie-Anki测试系统-建表.sql`）要由老师在 Supabase 里运行后才能真正使用。

## 目录

| 路径 | 内容 |
|---|---|
| `index.html` | 学生背词页（`?mock=1` 是不联网的演示模式） |
| `Augie-Anki测试-老师登录版本.html` | 老师页：学生链接、每个包每天学多少、学生能否自管卡片、卡片管理、每天学习量、各包进度 |
| `lib/anki-sched.js` | Anki 旧调度（SM-2）的复刻，参数 = Augie 的 Anki 默认预设 |
| `lib/api.js`、`lib/teacher-api.js`、`lib/config.js` | 学生页 / 老师页和 Supabase 通话、公开配置（anon 公开密钥）；`?mock=1` 离线演示用 `lib/mock-store.js` |
| `lib/browser.js` | 卡片浏览器（搜索、按状态筛选、勾选后挂起 / 放出 / 设为今天复习），学生页和老师页共用 |
| `data/` | 卡片文字内容（`manifest.json` + 每个包一个 json），**不含进度** |
| `tools/` | 导入程序：`build-content.mjs` 拆 .apkg，`upload.mjs` 上传媒体并导入进度（在老师电脑上运行） |
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
当前阶段：页面和导入程序已做好；数据库待运行建表 SQL，然后导入 Augie 的进度。
