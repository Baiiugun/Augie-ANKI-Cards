// 【临时测试系统】公开配置（anon 公开密钥按设计就可以出现在网页里；service_role 万能密钥绝不出现）
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
