// 第 2 步：登录老师账号 → 上传媒体到 Supabase Storage → 建学生 → 导入进度和答题历史。
// 在【你自己的终端】里运行；老师密码只在这里输入，不写入任何文件，也不会被任何 AI 看到。
// 用法：node upload.mjs [--name Augie] [--dry] [--force-state]
//   --dry          只统计要做什么，不联网
//   --force-state  即使 Augie 已经在网页里学过，也强行用 Anki 的进度覆盖（会丢掉网页里的进度！）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SUPABASE_URL, ANON_KEY, BUCKET, TEACHER_EMAIL, WORK } from './config.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const NAME = args.includes('--name') ? args[args.indexOf('--name') + 1] : 'Augie';
const DRY = has('--dry'), FORCE = has('--force-state');

const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

const states = fs.readdirSync(WORK).filter((f) => /^state-.*\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(WORK, f), 'utf8')));
if (!states.length) { console.error('没找到 import-work/state-*.json，请先运行 node build-content.mjs'); process.exit(1); }
const mediaFiles = [];
for (const s of states) {
  const dir = path.join(WORK, 'media', s.slug);
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) mediaFiles.push({ slug: s.slug, file: f, full: path.join(dir, f) });
}
const nCards = states.reduce((a, s) => a + s.state.length, 0), nLog = states.reduce((a, s) => a + s.revlog.length, 0);
console.log(`准备：${states.length} 个包，${nCards} 张卡的进度，${nLog} 条答题历史，${mediaFiles.length} 个媒体文件。学生名：${NAME}`);
if (DRY) { console.log('--dry：到此为止，没有联网。'); process.exit(0); }

// ---- 隐藏输入密码 ----
// 空输入不算（防止终端里残留的回车直接提交空密码）；方向键等控制序列忽略；输完回显“已收到 N 个字符”（不显示内容）。
function askHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin; let buf = '';
    stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding('utf8');
    const on = (chunk) => {
      const text = chunk.replace(/\x1b\[[0-9;]*[A-Za-z~]/g, '').replace(/\x1b./g, '');
      for (const c of text) {
        if (c === '\r' || c === '\n') {
          if (!buf) continue;
          stdin.off('data', on); stdin.setRawMode?.(false); stdin.pause();
          process.stdout.write(`\n（已收到 ${[...buf].length} 个字符）\n`);
          return resolve(buf);
        }
        if (c === '\x03') { process.stdout.write('\n已取消\n'); stdin.setRawMode?.(false); stdin.pause(); process.exitCode = 1; setTimeout(() => process.exit(1), 80); return; }
        if (c === '\x7f' || c === '\b') buf = buf.slice(0, -1); else if (c >= ' ') buf += c;
      }
    };
    stdin.on('data', on);
  });
}
const bye = (code) => { process.exitCode = code; setTimeout(() => process.exit(code), 80); return new Promise(() => {}); }; // 稍等再退出，避免 Windows 上的 libuv 报错

async function api(method, p, { token, body, headers = {} } = {}) {
  return fetch(SUPABASE_URL + p, { method, headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + (token || ANON_KEY), ...headers }, body });
}
const jsonHdr = { 'Content-Type': 'application/json' };

// ---- 1. 登录（最多试 3 次） ----
let token = null, teacherId = null;
for (let attempt = 1; attempt <= 3 && !token; attempt++) {
  const password = await askHidden(`老师邮箱 ${TEACHER_EMAIL}\n请输入老师密码（输入时不显示）：`);
  const lr = await api('POST', '/auth/v1/token?grant_type=password', { body: JSON.stringify({ email: TEACHER_EMAIL, password }), headers: jsonHdr });
  if (lr.ok) { const auth = await lr.json(); token = auth.access_token; teacherId = auth.user?.id; }
  else console.error(`登录失败（第 ${attempt}/3 次）：`, lr.status, (await lr.text()).slice(0, 160));
}
if (!token) { console.error('3 次都没登录成功。先在浏览器里的老师页确认密码是否正确，再重新运行。'); await bye(1); }
console.log('已登录老师账号。');

// ---- 2. 上传媒体（已存在的跳过，可中断后重跑） ----
let done = 0, skipped = 0, failed = 0, lastErr = '', probing = true;
async function uploadOne(m) {
  const objPath = `${m.slug}/${m.file}`;
  const head = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objPath}`, { method: 'HEAD' }).catch(() => null);
  if (head && head.ok) { skipped++; return; }
  const ext = path.extname(m.file).slice(1).toLowerCase();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await api('POST', `/storage/v1/object/${BUCKET}/${objPath}`, { token, body: fs.readFileSync(m.full), headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' } });
      if (res.ok) { done++; return; }
      const txt = await res.text();
      if (res.status === 409 || /Duplicate|already exists/i.test(txt)) { skipped++; return; }   // 已经传过了
      if (attempt === 3 || /row-level security|Unauthorized/i.test(txt)) { failed++; lastErr = `${objPath}: ${res.status} ${txt.slice(0, 160)}`; if (!probing) console.error('上传失败 ' + lastErr); return; }
    } catch (e) { if (attempt === 3) { failed++; console.error(`上传失败 ${objPath}: ${e.message}`); } }
  }
}
// 先试传 1 个文件：不通就立刻停下说明原因，不去刷几千行报错
await uploadOne(mediaFiles[0]);
if (failed) {
  console.error(`\n第一个文件就上传失败了，先停在这里（没有写入任何进度）。\n原因：${lastErr}\n把上面这几行发给 AI。`);
  await bye(1);
}
probing = false;
let idx = 1;
const worker = async () => {
  while (idx < mediaFiles.length && failed < 5) {
    const m = mediaFiles[idx++];
    await uploadOne(m);
    const n = done + skipped + failed;
    if (n % 200 === 0) console.log(`  媒体 ${n}/${mediaFiles.length}（新传 ${done}，已存在 ${skipped}，失败 ${failed}）`);
  }
};
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`媒体完成：新传 ${done}，已存在 ${skipped}，失败 ${failed}`);
if (failed) { console.error('有媒体上传失败，先不导入进度。重新运行本命令即可续传。'); process.exit(1); }

// ---- 3. 学生 ----
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(16), (b) => ALPHA[b % 32]).join('');
let r = await api('GET', `/rest/v1/anki_test_learners?name=eq.${encodeURIComponent(NAME)}&select=id,code`, { token });
if (!r.ok) { console.error('读取学生失败（SQL 是否已运行？）：', r.status, (await r.text()).slice(0, 300)); process.exit(1); }
let learner = (await r.json())[0];
if (!learner) {
  r = await api('POST', '/rest/v1/anki_test_learners', { token, body: JSON.stringify({ name: NAME, code: newCode(), teacher_id: teacherId }), headers: { ...jsonHdr, Prefer: 'return=representation' } });
  if (!r.ok) { console.error('创建学生失败：', r.status, (await r.text()).slice(0, 300)); process.exit(1); }
  learner = (await r.json())[0];
  console.log(`已创建学生 ${NAME}。`);
} else console.log(`学生 ${NAME} 已存在，沿用。`);

// ---- 4. 进度 + 答题历史（已在网页里学过则拒绝覆盖） ----
r = await api('GET', `/rest/v1/anki_test_revlog?learner_id=eq.${learner.id}&source=eq.app&select=uid&limit=1`, { token });
const alreadyUsed = r.ok && (await r.json()).length > 0;
if (alreadyUsed && !FORCE) {
  console.log(`!! ${NAME} 已经在网页里学过了，为了不覆盖他的网页进度，跳过"进度导入"。（确要覆盖请加 --force-state）`);
} else {
  const rows = states.flatMap((s) => s.state.map((c) => ({ learner_id: learner.id, card_key: c.key, type: c.type, queue: c.queue, due: c.due, ivl: c.ivl, factor: c.factor, reps: c.reps, lapses: c.lapses, lft: c.lft, suspended: c.suspended })));
  for (let i = 0; i < rows.length; i += 400) {
    const res = await api('POST', '/rest/v1/anki_test_card_state?on_conflict=learner_id,card_key', { token, body: JSON.stringify(rows.slice(i, i + 400)), headers: { ...jsonHdr, Prefer: 'resolution=merge-duplicates,return=minimal' } });
    if (!res.ok) { console.error('导入卡片进度失败：', res.status, (await res.text()).slice(0, 300)); process.exit(1); }
  }
  console.log(`卡片进度已导入：${rows.length} 张`);
  const logs = states.flatMap((s) => s.revlog.map((x) => ({ learner_id: learner.id, ...x })));
  for (let i = 0; i < logs.length; i += 800) {
    const res = await api('POST', '/rest/v1/anki_test_revlog?on_conflict=uid', { token, body: JSON.stringify(logs.slice(i, i + 800)), headers: { ...jsonHdr, Prefer: 'resolution=ignore-duplicates,return=minimal' } });
    if (!res.ok) { console.error('导入答题历史失败：', res.status, (await res.text()).slice(0, 300)); process.exit(1); }
    if ((i / 800) % 5 === 0) console.log(`  答题历史 ${Math.min(i + 800, logs.length)}/${logs.length}`);
  }
  console.log(`答题历史已导入：${logs.length} 条`);
}

console.log('\n完成。Augie 的网页链接（这是他的"钥匙"，别贴到公开的地方）：');
console.log(`https://baiiugun.github.io/Augie-ANKI-Cards/#k=${learner.code}`);
