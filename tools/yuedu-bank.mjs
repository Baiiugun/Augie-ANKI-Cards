// 阅读词词库导入：把一个“词库包”（一套试卷，每个板块一个 .apkg）存进 Supabase 的阅读词词库。
// 卡片内容存数据库（anki_test_bank_cards），不放公开的 GitHub；读音 mp3 传到存储桶 anki-test-media/yuedu/。
// 两步，各自独立：
//   第 1 步（不联网，AI 可以运行）：
//     node yuedu-bank.mjs prepare "<词库包\第N版 文件夹>"
//       · 读 配套清单.json + 每个板块的 .apkg（只读）
//       · 读音解到 <项目>/import-work/media/yuedu/（私有区）
//       · 写待上传清单 <项目>/import-work/yuedu/<试卷编号>.json
//   第 2 步（联网，要老师密码——【只能你自己在终端里运行并输入密码】）：
//     node yuedu-bank.mjs upload "<上面的待上传清单>" [--dry]
//       · 登录老师账号 → 预览（新词 / 内容有变化 / 不变）→ 你输入 y 确认 → 传读音（已存在的跳过）→ 写试卷和词
//       · 【不碰任何学生的进度】。给学生布置，在老师页“阅读词-老师登录版本”里点。
// 卡片编号 card_key = "yd:" + sha1(Anki 笔记 guid) 前 16 位：词库包改版（第 2 版…）同一个词编号不变，学生进度接得上。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { readApkg } from './apkg.js';
import { WORK, SUPABASE_URL, ANON_KEY, BUCKET, TEACHER_EMAIL } from './config.mjs';

const MEDIA_SLUG = 'yuedu';
const args = process.argv.slice(2);
const cmd = args[0], target = args[1];
const has = (f) => args.includes(f);
if (!['prepare', 'upload'].includes(cmd) || !target) {
  console.error('用法：node yuedu-bank.mjs prepare "<词库包\\第N版 文件夹>"\n      node yuedu-bank.mjs upload "<import-work\\yuedu\\xxx.json>" [--dry]');
  process.exit(1);
}
const bye = (code) => { process.exitCode = code; setTimeout(() => process.exit(code), 80); return new Promise(() => {}); };
const die = (msg) => { console.error('!! ' + msg); process.exit(1); };

// ---------- 解析卡面 ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const text = (s) => decode(String(s || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
// 例句：只保留 <b>…</b>（重点词加粗），其余标签去掉；页面显示时还会再转义一遍
const boldOnly = (s) => decode(String(s || '').replace(/<(?!\/?b>)[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const grab = (html, cls) => { const m = String(html).match(new RegExp(`<(div|span) class="${cls}">([\\s\\S]*?)</\\1>`)); return m ? m[2] : ''; };
function parseNote(front, back) {
  const snd = (front.match(/\[sound:([^\]]+)\]/) || [])[1] || '';
  return {
    src: text(grab(front, 'source')),
    w: text(grab(front, 'word')),
    pos: text(grab(front, 'pos')) || text(grab(back, 'pos')),
    ipa: text(grab(front, 'ipa')).replace(/^\/+|\/+$/g, '').trim(),
    mean: text(grab(back, 'meaning')),
    cefr: text(grab(back, 'cefr')).replace(/^CEFR[:：]\s*/i, ''),
    en: boldOnly(grab(back, 'example example-en')),
    cn: boldOnly(grab(back, 'example example-cn')),
    snd: snd.trim(),
  };
}
const tierId = (t) => t.replace(/\+/g, 'p').replace(/[^A-Za-z0-9-]/g, '');

// ======================================================================================
if (cmd === 'prepare') {
  const dir = path.resolve(target);
  const mfFile = path.join(dir, '配套清单.json');
  if (!fs.existsSync(mfFile)) die(`找不到 ${mfFile}（要给“词库包\\第N版”这一层文件夹）`);
  const mf = JSON.parse(fs.readFileSync(mfFile, 'utf8'));
  const mat = mf.material || {};
  const paperId = String(mf.material_id || '').trim();
  if (!/^[A-Za-z0-9]{6,64}$/.test(paperId)) die('配套清单里的 material_id 不对：' + paperId);
  const paperName = mat.display_name || mat.name;
  if (!paperName) die('配套清单里没有试卷名');
  if (mf.deck && mf.deck !== '阅读词') console.log(`（提示：配套清单写的牌组是「${mf.deck}」，仍按“阅读词”导入）`);

  const secMeta = new Map((mf.sections || []).map((s) => [s.id, s]));
  const mediaDir = path.join(WORK, 'media', MEDIA_SLUG);
  const sections = [], cards = [], usedMedia = new Set(), seen = new Set();
  const parts = (mf.parts || []).filter((p) => p.files?.apkg && p.count > 0);
  if (!parts.length) die('配套清单里没有带 .apkg 的板块');
  for (const part of parts) {
    const sm = secMeta.get(part.source_id);
    if (!sm) die('配套清单 parts 里的板块在 sections 里找不到：' + part.source_id);
    if (sm.student_visible === false) { console.log(`（跳过学生不可见的板块 ${sm.label}）`); continue; }
    const apkg = path.join(dir, part.files.apkg);
    if (!fs.existsSync(apkg)) die('找不到 ' + apkg);
    const level = part.tier || '';
    const secId = `${part.source_id.slice(0, 8)}-${tierId(level) || 'x'}`;
    const board = sm.section || sm.label;
    const piece = sm.passage ? `${sm.passage}篇` : '';
    const sortBase = (Number(sm.order) || 0) * 1000;
    const r = await readApkg(apkg, mediaDir);
    try {
      const deckNames = new Set(r.cards.map((c) => r.decks.get(c.did)));
      if (deckNames.size !== 1 || !deckNames.has('阅读词')) console.log(`（提示：${path.basename(apkg)} 的牌组是 ${[...deckNames].join('、')}）`);
      const cardsByNote = new Map(); for (const c of r.cards) cardsByNote.set(c.nid, [...(cardsByNote.get(c.nid) || []), c]);
      let i = 0;
      for (const n of r.notes) {
        const cs = cardsByNote.get(n.id) || [];
        if (cs.length !== 1) die(`${path.basename(apkg)} 的笔记 ${n.id} 有 ${cs.length} 张卡（应为 1 张）`);
        if (cs[0].sched.type !== 0) die(`${path.basename(apkg)} 的卡 ${cs[0].id} 不是新卡；词库包只能是新卡`);
        const mdl = r.models.get(n.mid);
        const fi = (name) => mdl.fields.indexOf(name);
        if (fi('Front') < 0 || fi('Back') < 0) die(`笔记类型「${mdl.name}」没有 Front/Back 字段`);
        const d = parseNote(n.fields[fi('Front')], n.fields[fi('Back')]);
        if (!d.w || !d.mean) die(`${path.basename(apkg)} 的笔记 ${n.id} 读不出单词或释义`);
        let audio = '';
        if (d.snd) { audio = r.mediaMap.get(d.snd) || ''; if (!audio || !fs.existsSync(path.join(mediaDir, audio))) die(`读音文件缺失：${d.snd}（${d.w}）`); usedMedia.add(audio); }
        const key = 'yd:' + crypto.createHash('sha1').update(n.guid).digest('hex').slice(0, 16);
        if (seen.has(key)) die(`卡片编号重复：${key}（${d.w}）`); seen.add(key);
        const tags = n.tags;
        const data = { w: d.w, pos: d.pos, ipa: d.ipa, mean: d.mean, cefr: d.cefr, en: d.en, cn: d.cn, audio, guid: n.guid };
        if (Buffer.byteLength(JSON.stringify(data)) > 19000) die(`卡片内容太长：${d.w}`);
        if (!tags.some((t) => t === `难度_${level}`)) console.log(`（提示：${d.w} 的难度标签和配套清单的 ${level} 不一致：${tags.join(' ')}）`);
        cards.push({ card_key: key, section_id: secId, ord: sortBase + i++, data });
      }
      sections.push({ id: secId, label: sm.label, board, piece, level, count: i, sort: Number(sm.order) || 0 });
      console.log(`  ${sm.label} ${level}：${i} 个词`);
    } finally { r.cleanup(); }
  }
  sections.sort((a, b) => a.sort - b.sort);
  const outDir = path.join(WORK, 'yuedu'); fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${paperId}.json`);
  const plan = { paper: { paper_id: paperId, bank: '阅读词', name: paperName, sort: 0, sections,
      source: { pack: path.basename(path.dirname(dir)) + '/' + path.basename(dir), revision: mf.revision ?? null, fingerprint: mf.content_fingerprint || null, preparedAt: new Date().toISOString() } },
    cards, media: [...usedMedia].sort() };
  fs.writeFileSync(out, JSON.stringify(plan, null, 1));
  console.log(`✔ ${paperName}：${sections.length} 个板块，共 ${cards.length} 个词，读音 ${plan.media.length} 个（在 ${mediaDir}）`);
  console.log(`  待上传清单：${out}`);
  console.log('  下一步：【你在自己的终端】运行 upload（要输入老师密码），或双击项目文件夹里的“上传阅读词词库-双击运行.cmd”。');
  process.exit(0);
}

// ======================================================================================
// upload：联网。密码只在这里输入。
const plan = JSON.parse(fs.readFileSync(target, 'utf8'));
const P = plan.paper, mediaDir = path.join(WORK, 'media', MEDIA_SLUG);
console.log(`准备：试卷「${P.name}」，${P.sections.length} 个板块，${plan.cards.length} 个词，读音 ${plan.media.length} 个。`);
for (const s of P.sections) console.log(`  · ${s.label} ${s.level}：${s.count} 个词`);
const missing = plan.media.filter((f) => !fs.existsSync(path.join(mediaDir, f)));
if (missing.length) { console.error('!! 本机找不到这些读音文件，请先重新运行 prepare：', missing.slice(0, 5)); await bye(1); }
if (has('--dry')) { console.log('--dry：到此为止，没有联网。'); await bye(0); }

function askHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin; let buf = '';
    stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding('utf8');
    const on = (chunk) => {
      const t = chunk.replace(/\x1b\[[0-9;]*[A-Za-z~]/g, '').replace(/\x1b./g, '');
      for (const c of t) {
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
      if (res.status >= 500 && attempt < 6) lastErr = new Error('HTTP ' + res.status); else return res;
    } catch (e) { lastErr = e; }
    const wait = attempt * 2000;
    console.log(`  网络不稳（${lastErr.cause?.code || lastErr.message}），${wait / 1000} 秒后重试（第 ${attempt}/6 次）…`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw lastErr;
}
const jsonHdr = { 'Content-Type': 'application/json' };
const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' };

let token = null;
for (let attempt = 1; attempt <= 3 && !token; attempt++) {
  const password = await askHidden(`老师邮箱 ${TEACHER_EMAIL}\n请输入老师密码（输入时不显示）：`);
  const lr = await api('POST', '/auth/v1/token?grant_type=password', { body: JSON.stringify({ email: TEACHER_EMAIL, password }), headers: jsonHdr });
  if (lr.ok) token = (await lr.json()).access_token;
  else console.error(`登录失败（第 ${attempt}/3 次）：`, lr.status, (await lr.text()).slice(0, 160));
}
if (!token) { console.error('3 次都没登录成功。'); await bye(1); }
console.log('已登录老师账号。');

// 预览：库里这套试卷已经有哪些词
let r = await api('GET', `/rest/v1/anki_test_bank_cards?paper_id=eq.${encodeURIComponent(P.paper_id)}&select=card_key,section_id,ord,data`, { token, headers: { Range: '0-9999', 'Range-Unit': 'items' } });
if (!r.ok) {
  const t = await r.text();
  console.error('读取词库失败：', r.status, t.slice(0, 300));
  if (/anki_test_bank_cards|does not exist|schema cache/i.test(t)) console.error('→ 数据库还没运行 10 号 SQL（sql\\10-Augie-Anki测试系统-阅读词与布置.sql）。先在 Supabase Studio 运行它，再重新运行本程序。');
  await bye(1);
}
const old = new Map((await r.json()).map((x) => [x.card_key, x]));
const same = (a, b) => a.section_id === b.section_id && a.ord === b.ord && JSON.stringify(a.data) === JSON.stringify(b.data);
const add = plan.cards.filter((c) => !old.has(c.card_key));
const chg = plan.cards.filter((c) => old.has(c.card_key) && !same(old.get(c.card_key), c));
const gone = [...old.keys()].filter((k) => !plan.cards.some((c) => c.card_key === k));
console.log('\n===== 预览（还没有写入任何东西）=====');
console.log(`试卷「${P.name}」：新词 ${add.length} 个，内容有变化 ${chg.length} 个，不变 ${plan.cards.length - add.length - chg.length} 个。`);
if (gone.length) console.log(`库里有 ${gone.length} 个词不在这一版里：保留不动（学生进度也不动）。`);
console.log(`读音：${plan.media.length} 个（已存在的会跳过）。`);
console.log('不会改动任何学生的进度；布置给学生在老师页里做。');
const ok = await askLine('确认执行？输入 y 回车继续，其他任意键取消：');
if (ok.toLowerCase() !== 'y') { console.log('已取消，没有写入任何东西。'); await bye(0); }

// 读音
let done = 0, skipped = 0, failed = 0;
for (const f of plan.media) {
  const objPath = `${MEDIA_SLUG}/${f}`;
  const head = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objPath}`, { method: 'HEAD' }).catch(() => null);
  if (head && head.ok) { skipped++; continue; }
  const ext = path.extname(f).slice(1).toLowerCase();
  const res = await api('POST', `/storage/v1/object/${BUCKET}/${objPath}`, { token, body: fs.readFileSync(path.join(mediaDir, f)), headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' } });
  if (res.ok) done++;
  else { const txt = await res.text(); if (res.status === 409 || /Duplicate|already exists/i.test(txt)) skipped++; else { failed++; console.error(`上传失败 ${objPath}: ${res.status} ${txt.slice(0, 160)}`); } }
}
console.log(`读音：新传 ${done}，已存在 ${skipped}，失败 ${failed}`);
if (failed) { console.error('有读音上传失败，先不写词库。重新运行本程序即可续传。'); await bye(1); }

// 试卷（板块清单），再写词
const now = new Date().toISOString();
r = await api('POST', '/rest/v1/anki_test_bank_papers?on_conflict=paper_id', { token, body: JSON.stringify({ paper_id: P.paper_id, bank: P.bank, name: P.name, sort: P.sort, sections: P.sections, source: P.source, updated_at: now }), headers: { ...jsonHdr, Prefer: 'resolution=merge-duplicates,return=minimal' } });
if (!r.ok) { console.error('写试卷失败：', r.status, (await r.text()).slice(0, 300)); await bye(1); }
const rows = [...add, ...chg].map((c) => ({ card_key: c.card_key, paper_id: P.paper_id, section_id: c.section_id, ord: c.ord, data: c.data, updated_at: now }));
for (let i = 0; i < rows.length; i += 200) {
  r = await api('POST', '/rest/v1/anki_test_bank_cards?on_conflict=card_key', { token, body: JSON.stringify(rows.slice(i, i + 200)), headers: { ...jsonHdr, Prefer: 'resolution=merge-duplicates,return=minimal' } });
  if (!r.ok) { console.error('写词失败：', r.status, (await r.text()).slice(0, 300)); await bye(1); }
}
console.log(`\n完成：试卷「${P.name}」已在词库里（写入 ${rows.length} 个词）。打开“阅读词-老师登录版本”就能布置给学生。`);
await bye(0);
