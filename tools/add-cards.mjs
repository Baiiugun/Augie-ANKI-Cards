// 只增补新卡：把一个新的 .apkg 里"库里还没有的卡"追加进已有的 Deck（不动已有卡、不动任何进度）。
// 两步，各自独立：
//   第 1 步（不联网，AI 可以运行）：
//     node add-cards.mjs prepare "<.apkg 路径>" [--slug super-why] [--live]
//     新建一个全新的 Deck（data 里还没有它）：node add-cards.mjs prepare "<.apkg>" --slug <英文简称> --new-deck "<显示名>" [--live]
//       · 追加卡片文字到 ../data/<slug>.json，更新 ../data/manifest.json 里该 Deck 的张数/媒体数/generated
//       · 媒体解到 <项目>/import-work/media/<slug>/（私有区，不进 GitHub）
//       · 把"要建的进度"写到 <项目>/import-work/add/<slug>-<包名>.json（**不是** state-*.json，不会被 upload.mjs 误读）
//       · 默认新卡导入为"暂停"（--live 则直接可学）
//   第 2 步（联网，要老师密码——【只能你自己在终端里运行并输入密码】）：
//     node add-cards.mjs upload "<上面生成的 add/…json>" [--dry]
//       · 登录老师账号 → 上传媒体（已存在的跳过）→ 先预览、你输入 y 确认 → 给每个学生建这些新卡的进度
//       · 进度用 ignore-duplicates 写入：库里已经有的卡一律不改；不写任何答题记录
// 判重依据：card_key = <slug>:<cid>。重复运行是安全的（已有的卡会被跳过）。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { readApkg } from './apkg.js';
import { renderCard, rewriteMediaUrls, cleanField } from './render.js';
import { REPO, WORK, SLUGS, SUPABASE_URL, ANON_KEY, BUCKET, TEACHER_EMAIL } from './config.mjs';

const args = process.argv.slice(2);
const cmd = args[0], file = args[1];
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const has = (f) => args.includes(f);
if (!['prepare', 'upload'].includes(cmd) || !file) { console.error('用法：node add-cards.mjs prepare "<.apkg>" [--slug x] [--live]\n      node add-cards.mjs upload "<add/xxx.json>" [--dry]'); process.exit(1); }

const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
const bye = (code) => { process.exitCode = code; setTimeout(() => process.exit(code), 80); return new Promise(() => {}); };   // 稍等再退出，避免 Windows 上的 libuv 报错

// ======================================================================================
if (cmd === 'prepare') {
  const dataDir = path.join(REPO, 'data'), addDir = path.join(WORK, 'add');
  fs.mkdirSync(addDir, { recursive: true });
  const base = path.basename(file).replace(/\.apkg$/i, '');

  // 先读 .apkg（媒体解到私有区；文件名按内容哈希，已存在的不重复写）
  const probe = await readApkg(file, path.join(WORK, '_probe'));   // 先只为拿牌组名
  const deckNames = [...new Set(probe.cards.map((c) => probe.decks.get(c.did)).filter(Boolean))];
  probe.cleanup();
  fs.rmSync(path.join(WORK, '_probe'), { recursive: true, force: true });
  const slug = opt('--slug') || (deckNames.length === 1 ? SLUGS[deckNames[0]] : null);
  if (!slug) { console.error('!! 不能确定要并入哪个 Deck：包里的牌组 =', deckNames, '；请加 --slug <已有的 Deck 简称>'); process.exit(1); }
  const dataFile = path.join(dataDir, `${slug}.json`);
  // 已有的 Deck：追加；全新的 Deck：必须同时给 --new-deck "<显示名>"（会新建 data 文件和 manifest 里的一项）
  const newName = opt('--new-deck');
  let data;
  if (fs.existsSync(dataFile)) {
    if (newName) { console.error(`!! ${slug} 已经存在，不能再 --new-deck；去掉 --new-deck 就是往里增补。`); process.exit(1); }
    const rawOld = fs.readFileSync(dataFile, 'utf8');
    data = JSON.parse(rawOld);
    if (JSON.stringify(data) !== rawOld) { console.error('!! 现有 data 文件读出再写回和原文不一致，为了不破坏已有卡片，停止。'); process.exit(1); }
  } else {
    if (!newName) { console.error(`!! 找不到 ${dataFile}。要新建一个 Deck 请加：--slug ${slug} --new-deck "<显示名>"`); process.exit(1); }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) { console.error('!! --slug 只能用小写英文字母、数字和连字符（它会出现在卡片编号和媒体路径里）'); process.exit(1); }
    data = { slug, name: newName, version: new Date().toISOString().slice(0, 10).replace(/-/g, ''), models: [], cards: [] };
    console.log(`（新建 Deck：${slug} =「${newName}」）`);
  }
  const have = new Set(data.cards.map((c) => c.k));

  const mediaDir = path.join(WORK, 'media', slug);
  const r = await readApkg(file, mediaDir);
  const SCHEME = /^([a-z][a-z0-9+.-]*:|\/|#|\{)/i;
  const rawField = (s, mediaMap) => rewriteMediaUrls((s || '').replace(/\[sound:([^\]]+)\]/g, (all, name) => {
    name = name.trim(); let dec = name; try { dec = decodeURIComponent(name); } catch { /* 原样 */ }
    const f = SCHEME.test(name) ? null : (mediaMap.get(dec) ?? mediaMap.get(name) ?? null);
    return f ? '[sound:' + f + ']' : '';
  }), mediaMap);
  if (r.crt !== 1716148800) console.log(`（提示：这个包的集合创建时间与 Augie 的不同；因为只导入【新卡】，到期天数不受影响。）`);

  const byId = new Map(r.notes.map((n) => [n.id, n]));
  // 笔记类型：与已有的 model 完全相同（名称+字段+模板+样式）就复用，否则追加新的
  const same = (a, b) => a.name === b.name && JSON.stringify(a.fields) === JSON.stringify(b.fields) && a.css === b.css && JSON.stringify(a.tm) === JSON.stringify(b.tm);
  const toModel = (mm) => ({ name: mm.name, css: mm.css, fields: mm.fields, kind: mm.kind, tpl: mm.templates.map((t) => t.name), tm: mm.templates.map((t) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })) });
  const modelIdx = new Map(); let newModels = 0;
  const newCards = [], newState = [], skipped = [];
  const ordered = [...r.cards].sort((a, b) => a.sched.due - b.sched.due || (a.id < b.id ? -1 : 1));
  for (const c of ordered) {
    const key = `${slug}:${c.id}`;
    if (have.has(key)) { skipped.push(key); continue; }
    const n = byId.get(c.nid), mdl = r.models.get(n.mid);
    if (c.sched.type !== 0) { console.error(`!! 卡 ${c.id} 不是新卡（type=${c.sched.type}）。这个工具只增补新卡；带进度的卡请走 upload.mjs。`); process.exit(1); }
    if (!modelIdx.has(n.mid)) {
      const cand = toModel(mdl);
      let i = data.models.findIndex((x) => same(x, cand));
      if (i < 0) { data.models.push(cand); i = data.models.length - 1; newModels++; }
      modelIdx.set(n.mid, i);
    }
    const fields = Object.fromEntries(mdl.fields.map((k, i) => [k, n.fields[i]]));
    const deck = r.decks.get(c.did) || '';
    const out = renderCard(mdl, c, fields, { tags: n.tags.join(' '), deck }, r.mediaMap);
    const entry = { k: key, f: out.front, b: out.back, m: modelIdx.get(n.mid), o: c.ord, v: mdl.fields.map((k) => cleanField(fields[k])), r: mdl.fields.map((k) => rawField(fields[k], r.mediaMap)) };
    if (n.tags.length) entry.g = n.tags;
    if (deck && deck !== 'Default' && deck !== '默认') entry.d = deck;
    newCards.push(entry);
    // 新卡的 due = 出现顺序（按编号先后），保证 S01E04-01、-02… 依次出现
    newState.push({ key, type: 0, queue: 0, due: newState.length, ivl: 0, factor: 0, reps: 0, lapses: 0, lft: 0, suspended: !has('--live') });
  }
  // 这几张新卡用到的媒体文件（上传时用）
  const used = new Set();
  for (const e of newCards) for (const s of [e.f, e.b, ...e.r]) for (const m of String(s).matchAll(/(?:\/media\/|\[sound:)([^"\]\s<>]+)/g)) used.add(decodeURIComponent(m[1]));
  const media = [...used].filter((f) => fs.existsSync(path.join(mediaDir, f)));
  const missing = [...used].filter((f) => !fs.existsSync(path.join(mediaDir, f)));
  if (missing.length) { console.error('!! 有卡片用到的媒体文件没找到：', missing.slice(0, 10)); process.exit(1); }

  if (!newCards.length) { console.log(`没有要新增的卡（${skipped.length} 张已在 ${slug} 里）。什么都没改。`); r.cleanup(); process.exit(0); }

  // 写 data（追加；已有卡一字不动）+ manifest + 待上传清单
  const firstOld = JSON.stringify(data.cards);
  data.cards.push(...newCards);
  if (JSON.stringify(data.cards.slice(0, have.size)) !== firstOld) { console.error('!! 内部检查失败：已有卡被改动，停止（未写任何文件）。'); process.exit(1); }
  fs.writeFileSync(dataFile, JSON.stringify(data));
  const mfFile = path.join(dataDir, 'manifest.json');
  const mf = JSON.parse(fs.readFileSync(mfFile, 'utf8'));
  let pk = mf.packages.find((p) => p.slug === slug);
  if (!pk) { pk = { slug, name: data.name, version: data.version, count: 0, media: 0 }; mf.packages.push(pk); }
  pk.count = data.cards.length;
  pk.media = fs.readdirSync(mediaDir).length;
  mf.generated = new Date().toISOString();     // 页面用它当缓存版本号，改了才会重新下载 data
  fs.writeFileSync(mfFile, JSON.stringify(mf, null, 1));
  const addFile = path.join(addDir, `${slug}-${base}.json`);
  fs.writeFileSync(addFile, JSON.stringify({ slug, source: path.basename(file), createdAt: new Date().toISOString(), suspended: !has('--live'), state: newState, media }, null, 1));
  console.log(`✔ 已并入 ${slug}：新增 ${newCards.length} 张（原 ${have.size} 张不动；已存在被跳过 ${skipped.length}）；新增笔记类型 ${newModels} 个；该 Deck 现共 ${data.cards.length} 张`);
  console.log(`  这批卡用到媒体 ${media.length} 个（已解到私有区 ${mediaDir}）；进度状态：${has('--live') ? '直接可学' : '暂停（在卡片管理里取消暂停才会出现）'}`);
  console.log(`  待上传清单：${addFile}`);
  console.log('  下一步：提交并推送 data（GitHub），然后【你在自己的终端】运行第 2 步 upload。');
  r.cleanup();
  process.exit(0);
}

// ======================================================================================
// upload：联网。密码只在这里输入。
const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
const mediaDir = path.join(WORK, 'media', plan.slug);
console.log(`准备：Deck ${plan.slug}，新增 ${plan.state.length} 张卡的进度（${plan.suspended ? '暂停' : '直接可学'}），媒体 ${plan.media.length} 个。`);
if (has('--dry')) { console.log('--dry：到此为止，没有联网。'); process.exit(0); }

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

let r = await api('GET', '/rest/v1/anki_test_learners?select=id,name', { token });
if (!r.ok) { console.error('读取学生失败：', r.status, (await r.text()).slice(0, 300)); await bye(1); }
const learners = await r.json();
// 预览：库里这些卡已经有多少（有的不会被改）
const keys = plan.state.map((s) => s.key);
const existing = new Map();
for (const l of learners) {
  const found = [];
  for (let i = 0; i < keys.length; i += 50) {
    const rr = await api('GET', `/rest/v1/anki_test_card_state?learner_id=eq.${l.id}&card_key=in.(${keys.slice(i, i + 50).map((k) => encodeURIComponent(k)).join(',')})&select=card_key`, { token });
    if (!rr.ok) { console.error('检查已有进度失败：', rr.status, (await rr.text()).slice(0, 300)); await bye(1); }
    found.push(...(await rr.json()).map((x) => x.card_key));
  }
  existing.set(l.id, new Set(found));
}
console.log('\n===== 预览（还没有写入任何东西）=====');
console.log(`媒体：${plan.media.length} 个（已存在的会跳过）`);
for (const l of learners) { const n = plan.state.filter((s) => !existing.get(l.id).has(s.key)).length; console.log(`学生 ${l.name}：将新增 ${n} 张卡的进度（${plan.suspended ? '暂停状态' : '直接可学'}），库里已有 ${existing.get(l.id).size} 张（不会改动）；不写答题记录`); }
const ok = await askLine('确认执行？输入 y 回车继续，其他任意键取消：');
if (ok.toLowerCase() !== 'y') { console.log('已取消，没有写入任何东西。'); await bye(0); }

// 媒体
let done = 0, skipped = 0, failed = 0;
for (const f of plan.media) {
  const objPath = `${plan.slug}/${f}`;
  const head = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objPath}`, { method: 'HEAD' }).catch(() => null);
  if (head && head.ok) { skipped++; continue; }
  const ext = path.extname(f).slice(1).toLowerCase();
  const res = await api('POST', `/storage/v1/object/${BUCKET}/${objPath}`, { token, body: fs.readFileSync(path.join(mediaDir, f)), headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' } });
  if (res.ok) done++;
  else { const txt = await res.text(); if (res.status === 409 || /Duplicate|already exists/i.test(txt)) skipped++; else { failed++; console.error(`上传失败 ${objPath}: ${res.status} ${txt.slice(0, 160)}`); } }
}
console.log(`媒体：新传 ${done}，已存在 ${skipped}，失败 ${failed}`);
if (failed) { console.error('有媒体上传失败，先不写进度。重新运行本命令即可续传。'); await bye(1); }

// 进度：只写库里还没有的卡，且用 ignore-duplicates（即使判断有误也不会覆盖已有进度）
for (const l of learners) {
  const rows = plan.state.filter((s) => !existing.get(l.id).has(s.key)).map((s) => ({ learner_id: l.id, card_key: s.key, type: s.type, queue: s.queue, due: s.due, ivl: s.ivl, factor: s.factor, reps: s.reps, lapses: s.lapses, lft: s.lft, suspended: s.suspended }));
  if (!rows.length) { console.log(`学生 ${l.name}：没有要新增的。`); continue; }
  const res = await api('POST', '/rest/v1/anki_test_card_state?on_conflict=learner_id,card_key', { token, body: JSON.stringify(rows), headers: { ...jsonHdr, Prefer: 'resolution=ignore-duplicates,return=minimal' } });
  if (!res.ok) { console.error(`写入 ${l.name} 的进度失败：`, res.status, (await res.text()).slice(0, 300)); await bye(1); }
  console.log(`学生 ${l.name}：已新增 ${rows.length} 张卡的进度。`);
}
console.log(`\n完成。${plan.suspended ? '新卡目前是“暂停”状态：在卡片管理里筛出来，选中后点“取消暂停”，学生才会看到。' : '新卡已可学习。'}`);
await bye(0);
