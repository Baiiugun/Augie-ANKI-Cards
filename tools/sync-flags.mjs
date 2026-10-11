// 把 Anki 里已有的颜色标记（红旗等）带进网页：只补标记，不碰任何学习进度，也不覆盖网页里已经打过的标记。
// 两步，各自独立：
//   第 1 步（不联网，AI 可以运行）：
//     node sync-flags.mjs prepare
//       · 只读 <项目>/Augie的卡片/*.apkg，找出所有有颜色标记的卡（Anki cards.flags 的低 3 位，编号和网页完全一致）
//       · 写到 <项目>/import-work/flags/flags-from-anki.json（私有区，不进 GitHub）
//   第 2 步（联网，要老师密码——【只能你自己在终端里运行并输入密码】）：
//     node sync-flags.mjs upload [--name Augie] [--dry]
//       · 登录老师账号 → 预览 → 你输入 y 确认 → 对每张有标记的卡：只有网页里"还没标记"（flag=0）的才写入
//       · 需要先在 Supabase 运行 08 号 SQL（给 card_state 加 flag 列）
// 重复运行是安全的（已经有标记的卡不会被改）。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { readApkg } from './apkg.js';
import { SRC_DIR, WORK, SLUGS, SUPABASE_URL, ANON_KEY, TEACHER_EMAIL } from './config.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const has = (f) => args.includes(f);
const NAME = has('--name') ? args[args.indexOf('--name') + 1] : 'Augie';
if (!['prepare', 'upload'].includes(cmd)) { console.error('用法：node sync-flags.mjs prepare\n      node sync-flags.mjs upload [--name Augie] [--dry]'); process.exit(1); }
const bye = (code) => { process.exitCode = code; setTimeout(() => process.exit(code), 80); return new Promise(() => {}); };   // 稍等再退出，避免 Windows 上的 libuv 报错
const FLAG_NAME = { 1: '红', 2: '橙', 3: '绿', 4: '蓝', 5: '粉', 6: '青', 7: '紫' };
const outFile = path.join(WORK, 'flags', 'flags-from-anki.json');

if (cmd === 'prepare') {
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.apkg')).sort();
  const flags = [];
  for (const f of files) {
    const m0 = f.match(/^(.*?)-Augie-v(\d+)\.apkg$/);
    const name = m0 ? m0[1] : f.replace(/\.apkg$/, '');
    const slug = SLUGS[name];
    if (!slug) { console.error('!! 没有给这个包起英文名（config.mjs 的 SLUGS）:', name); process.exit(1); }
    const r = await readApkg(path.join(SRC_DIR, f), path.join(WORK, 'media', slug));
    r.cleanup?.();
    const mine = r.cards.filter((c) => c.flag > 0);
    for (const c of mine) flags.push({ key: `${slug}:${c.id}`, flag: c.flag });
    console.log(`${name} → ${slug}: ${r.cards.length} 张卡，有颜色标记 ${mine.length} 张${mine.length ? '（' + mine.map((c) => FLAG_NAME[c.flag] + ' ' + c.id).join('，') + '）' : ''}`);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ generated: new Date().toISOString(), flags }));
  console.log(`\n共 ${flags.length} 张有标记 → ${outFile}`);
  process.exit(0);
}

// ======================================================================================
// upload：联网。密码只在这里输入。
if (!fs.existsSync(outFile)) { console.error('没找到 import-work/flags/flags-from-anki.json，请先运行 node sync-flags.mjs prepare'); process.exit(1); }
const plan = JSON.parse(fs.readFileSync(outFile, 'utf8'));
console.log(`准备：${plan.flags.length} 张卡带有 Anki 的颜色标记。学生名：${NAME}`);
if (has('--dry') || !plan.flags.length) { console.log(has('--dry') ? '--dry：到此为止，没有联网。' : '没有要同步的标记。'); process.exit(0); }

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
const askLine = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a.trim()); }); });

async function api(method, p, { token, body, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(SUPABASE_URL + p, { method, headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + (token || ANON_KEY), ...headers }, body });
      if (res.status >= 500 && attempt < 6) { lastErr = new Error('HTTP ' + res.status); }
      else return res;
    } catch (e) { lastErr = e; }
    const wait = attempt * 2000;
    console.log(`  网络不稳（${lastErr.cause?.code || lastErr.message}），${wait / 1000} 秒后重试（第 ${attempt}/6 次）…`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw lastErr;
}
const jsonHdr = { 'Content-Type': 'application/json' };

let token = null;
for (let attempt = 1; attempt <= 3 && !token; attempt++) {
  const password = await askHidden(`老师邮箱 ${TEACHER_EMAIL}\n请输入老师密码（输入时不显示）：`);
  const lr = await api('POST', '/auth/v1/token?grant_type=password', { body: JSON.stringify({ email: TEACHER_EMAIL, password }), headers: jsonHdr });
  if (lr.ok) token = (await lr.json()).access_token;
  else console.error(`登录失败（第 ${attempt}/3 次）：`, lr.status, (await lr.text()).slice(0, 160));
}
if (!token) { console.error('3 次都没登录成功。'); await bye(1); }
console.log('已登录老师账号。');

let r = await api('GET', `/rest/v1/anki_test_learners?name=eq.${encodeURIComponent(NAME)}&select=id,name`, { token });
if (!r.ok) { console.error('读取学生失败：', r.status, (await r.text()).slice(0, 300)); await bye(1); }
const learner = (await r.json())[0];
if (!learner) { console.error(`没找到学生 ${NAME}。`); await bye(1); }

// 预览：这些卡现在网页里的标记是什么（只有 flag=0 的会被写入）
const have = new Map();
for (let i = 0; i < plan.flags.length; i += 50) {
  const part = plan.flags.slice(i, i + 50);
  const rr = await api('GET', `/rest/v1/anki_test_card_state?learner_id=eq.${learner.id}&card_key=in.(${part.map((x) => encodeURIComponent(x.key)).join(',')})&select=card_key,flag`, { token });
  if (!rr.ok) { console.error('读取现有标记失败（08 号 SQL 运行了吗？）：', rr.status, (await rr.text()).slice(0, 300)); await bye(1); }
  for (const x of await rr.json()) have.set(x.card_key, x.flag);
}
const todo = plan.flags.filter((x) => have.has(x.key) && have.get(x.key) === 0);
const already = plan.flags.filter((x) => have.has(x.key) && have.get(x.key) !== 0).length;
const missing = plan.flags.filter((x) => !have.has(x.key)).length;
console.log('\n===== 预览（还没有写入任何东西）=====');
console.log(`学生 ${learner.name}：将写入 ${todo.length} 张卡的标记；网页里已经有标记的 ${already} 张（不会改）；库里没有这张卡的 ${missing} 张（跳过）。`);
if (!todo.length) { console.log('没有要写入的。'); await bye(0); }
const ok = await askLine('确认执行？输入 y 回车继续，其他任意键取消：');
if (ok.toLowerCase() !== 'y') { console.log('已取消，没有写入任何东西。'); await bye(0); }

let n = 0;
for (const x of todo) {
  // 条件 flag=eq.0：万一这期间网页里刚好标过，也不会被覆盖
  const res = await api('PATCH', `/rest/v1/anki_test_card_state?learner_id=eq.${learner.id}&card_key=eq.${encodeURIComponent(x.key)}&flag=eq.0`, { token, body: JSON.stringify({ flag: x.flag }), headers: { ...jsonHdr, Prefer: 'return=representation' } });
  if (!res.ok) { console.error(`写入 ${x.key} 失败：`, res.status, (await res.text()).slice(0, 200)); await bye(1); }
  n += (await res.json()).length;
}
console.log(`完成：已写入 ${n} 张卡的标记。`);
await bye(0);
