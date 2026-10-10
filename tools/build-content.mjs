// 第 1 步：只读 Augie 的 .apkg，生成
//   公开：../data/manifest.json、../data/<slug>.json      （卡片文字内容，会进 GitHub）
//   私有：<项目>/import-work/state-<slug>.json            （Augie 的进度、挂起、答题历史，不进 GitHub）
//         <项目>/import-work/media/<slug>/…               （音频图片视频，待上传 Supabase）
// 用法：node build-content.mjs
import fs from 'node:fs';
import path from 'node:path';
import { readApkg } from './apkg.js';
import { renderCard } from './render.js';
import { REPO, SRC_DIR, WORK, SLUGS } from './config.mjs';

const CRT = 1716148800;
const dataDir = path.join(REPO, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.apkg')).sort();
const manifest = { generated: new Date().toISOString(), note: '【临时测试系统】卡片文字内容；进度不在这里', packages: [] };
const qFromType = { 0: 0, 1: 1, 2: 2, 3: 1 };

// 字段原文 → 浏览器里显示/分组用的短文字：去标签，声音/图片/视频换成小图标
const ENT = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" };
const cleanField = (s) => (s || '')
  .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/\[sound:[^\]]*\]/g, ' 🔊 ').replace(/<img[^>]*>/gi, ' 🖼 ').replace(/<video[\s\S]*?<\/video>/gi, ' 🎞 ')
  .replace(/<br\s*\/?>|<\/(div|p|li|figure|tr)>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&#?\w+;/g, (m) => ENT[m] ?? ' ')
  .replace(/\s+/g, ' ').trim().slice(0, 160);

for (const f of files) {
  const m0 = f.match(/^(.*?)-Augie-v(\d+)\.apkg$/);
  const name = m0 ? m0[1] : f.replace(/\.apkg$/, '');
  const version = m0 ? m0[2] : '';
  const slug = SLUGS[name];
  if (!slug) { console.error('!! 没有给这个包起英文名（config.mjs 的 SLUGS）:', name); process.exit(1); }
  const mediaDir = path.join(WORK, 'media', slug);
  const r = await readApkg(path.join(SRC_DIR, f), mediaDir);
  if (r.crt !== CRT) console.warn(`!! ${name}: 集合创建时间 ${r.crt} 不是预期的 ${CRT}，到期天数可能错位`);

  const byId = new Map(r.notes.map((n) => [n.id, n]));
  const modelList = [...r.models.entries()];
  const modelIdx = new Map(modelList.map(([id], i) => [id, i]));
  const warn = [];
  for (const [, mm] of modelList) {
    if (mm.templates.some((t) => /<script/i.test(t.qfmt + t.afmt))) warn.push(`笔记类型「${mm.name}」的模板里有 <script>`);
    if (/@font-face|@import/i.test(mm.css)) warn.push(`笔记类型「${mm.name}」的样式里有自定义字体/外部引用`);
  }

  const cards = [], state = [];
  for (const c of r.cards) {
    const n = byId.get(c.nid), mdl = r.models.get(n.mid);
    const fields = Object.fromEntries(mdl.fields.map((k, i) => [k, n.fields[i]]));
    const deck = r.decks.get(c.did) || '';
    const out = renderCard(mdl, c, fields, { tags: n.tags.join(' '), deck }, r.mediaMap);
    const key = `${slug}:${c.id}`;
    const entry = { k: key, f: out.front, b: out.back, m: modelIdx.get(n.mid), o: c.ord, v: mdl.fields.map((k) => cleanField(fields[k])) };
    if (n.tags.length) entry.g = n.tags;
    if (deck && deck !== 'Default' && deck !== '默认') entry.d = deck;
    cards.push(entry);

    const s = c.sched;
    state.push({ key, type: s.type, queue: s.queue === -1 ? qFromType[s.type] : s.queue, suspended: s.queue === -1,
      due: s.due, ivl: s.ivl, factor: s.factor, reps: s.reps, lapses: s.lapses, lft: s.left % 1000 });
  }

  // 答题历史 → 复习记录（跳过手动改期）
  const seen = new Set(), revlog = [];
  for (const x of r.revlog) {
    if (x.type === 4 || x.ease === 0) continue;
    const key = `${slug}:${x.cid}`;
    const first = !seen.has(key); seen.add(key);
    const prev_type = x.type === 0 ? (first ? 0 : 1) : x.type === 1 ? 2 : 3;
    revlog.push({ uid: `imp-${x.id}-${x.cid}`, card_key: key, ts: x.id, ease: x.ease, ivl: x.ivl, last_ivl: x.lastIvl,
      factor: x.factor, time_ms: Math.min(Math.max(x.time, 0), 600000), type: x.type === 3 ? 1 : x.type, prev_type, source: 'anki-import' });
  }

  fs.writeFileSync(path.join(dataDir, `${slug}.json`), JSON.stringify({ slug, name, version, models: modelList.map(([, mm]) => ({ name: mm.name, css: mm.css, fields: mm.fields, tpl: mm.templates.map((t) => t.name) })), cards }));
  fs.writeFileSync(path.join(WORK, `state-${slug}.json`), JSON.stringify({ slug, name, crt: r.crt, state, revlog }));
  manifest.packages.push({ slug, name, version, count: cards.length, media: r.mediaMap.size });
  const sus = state.filter((x) => x.suspended).length;
  console.log(`${name} → ${slug}: ${cards.length} 张卡 | 媒体 ${r.mediaMap.size} | 挂起 ${sus} | 答题历史 ${revlog.length}${warn.length ? ' | ⚠ ' + warn.join('；') : ''}`);
  r.cleanup();
}
fs.writeFileSync(path.join(dataDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('完成。公开内容：', dataDir, '；私有进度与媒体：', WORK);
