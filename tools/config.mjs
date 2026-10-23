// 【临时测试系统】公开配置（anon 公开密钥按设计就可以出现在网页里；service_role 万能密钥绝不出现）
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 2026-10-21 Node.js 安全更新：Brotli 解码越界写入（CVE-2026-111497）等漏洞。
// fetch 会自动解压 Brotli 响应，所以连 Supabase 的脚本必须用修补版；直接 node xxx.mjs 运行时 package.json 的 engines 不会被检查，所以在这里查。
const MIN_NODE = { 22: [22, 23, 4], 24: [24, 22, 1], 26: [26, 12, 1] };
export function nodeVersionProblem(version) {
  const v = version.split('.').map(Number);
  const min = MIN_NODE[v[0]];
  if (!min) return `Node ${version} 已停止维护或不受支持，请换成 22.23.4 以上的 22.x（或 24.22.1 / 26.12.1 以上）`;
  for (let i = 0; i < 3; i++) {
    if (v[i] > min[i]) return null;
    if (v[i] < min[i]) return `Node ${version} 低于修补版 ${min.join('.')}`;
  }
  return null;
}
const nodeProblem = nodeVersionProblem(process.versions.node);
if (nodeProblem) {
  console.error(`✗ ${nodeProblem}。
  原因：2026-10-21 Node.js 安全更新修复了 Brotli 解码的远程代码执行漏洞（CVE-2026-111497），导入程序联网时会碰到。
  请先升级 Node（官方安装包或 winget upgrade OpenJS.NodeJS），再重新运行。`);
  process.exit(1);
}

export const SUPABASE_URL = 'https://br-cute-tahr-8eff7472.supabase.aidap-global.cn-beijing.volces.com';
export const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1wbGF0Zm9ybSIsInJvbGUiOiJhbm9uIiwiZXhwIjozNjg2OTI1NzYzfQ.y45vSsbxFjV9k-psYujSR2YMtDOeZW_IDZS6eBlbRFc';
export const BUCKET = 'anki-test-media';
export const TEACHER_EMAIL = 'baiyuguang@gmail.com';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..');              // Augie-ANKI-Cards（公开仓库）
export const PROJECT = path.resolve(REPO, '..');           // 云端单词背诵系统
export const SRC_DIR = path.join(PROJECT, 'Augie的卡片');   // Augie 的 .apkg 原件（只读）
export const WORK = path.join(PROJECT, 'import-work');     // 私有工作区：进度、答题历史、媒体缓存（不进 GitHub）

// Storage 对象路径要用英文名；中文名只用于显示
export const SLUGS = {
  '01-26个英文字母_听音写字': 'alphabet',
  'Super_WHY': 'super-why',
  '拼音学习-看汉字写拼音': 'pinyin-learn',
  '拼音混淆': 'pinyin-confuse',
  '汉字学习': 'hanzi-learn',
  '汉字混淆': 'hanzi-confuse',
};
