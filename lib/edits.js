// 卡片文字修改：原文在 data/*.json（GitHub），老师改过的字段存在 Supabase 表 anki_test_card_edits，打开页面时叠加上去。
// 改过的卡用同一个渲染器（lib/render.js）按模板重新生成正面/背面，所以和原来的版式一模一样。
import { renderCard, cleanField } from './render.js';
import { SUPABASE_URL, ANON_KEY } from './config.js';

const IDENT = { get: (n) => n };   // data 里字段的文件名已经是上传后的名字，不用再换

const index = new WeakMap();       // content → Map(card key → 卡)
function find(content, key) {
  let m = index.get(content);
  if (!m) { m = new Map(); for (const s of Object.keys(content)) for (const c of content[s].cards) m.set(c.k, [s, c]); index.set(content, m); }
  return m.get(key);
}

// 按字段原文重新生成这张卡的正面/背面（和构建时的渲染一致）
export function rerender(ct, c) {
  const m = ct.models[c.m];
  const fields = Object.fromEntries(m.fields.map((n, i) => [n, c.r[i]]));
  const out = renderCard({ name: m.name, kind: m.kind || 0, templates: m.tm }, { ord: c.o }, fields, { tags: (c.g || []).join(' '), deck: c.d || '' }, IDENT);
  c.f = out.front; c.b = out.back;
  c.v = c.r.map(cleanField);
}

// changes = { 字段名: 新原文 }；把 content 里这张卡改掉。返回 false = 找不到这张卡
export function applyEdit(content, key, changes) {
  const hit = find(content, key); if (!hit) return false;
  const [slug, c] = hit, ct = content[slug], m = ct.models[c.m];
  if (!c.r || !m.tm) return false;
  if (!c.r0) c.r0 = c.r.slice();                       // 记住原文，方便“恢复原文”
  m.fields.forEach((n, i) => { if (n in changes) c.r[i] = changes[n]; });
  c.ed = Object.fromEntries(m.fields.map((n, i) => [n, c.r[i]]).filter(([, v], i) => v !== c.r0[i]));
  if (!Object.keys(c.ed).length) { delete c.ed; }
  rerender(ct, c);
  return true;
}

// 如果按 changes 修改，这张卡“和原文不同的字段”会是什么（不改动内存）。保存到云端用它。
export function nextEdited(content, key, changes) {
  const hit = find(content, key); if (!hit) return {};
  const [slug, c] = hit, m = content[slug].models[c.m], r0 = c.r0 || c.r;
  return Object.fromEntries(m.fields.map((n, i) => [n, n in changes ? changes[n] : c.r[i]]).filter(([, v], i) => v !== r0[i]));
}

export function resetEdit(content, key) {
  const hit = find(content, key); if (!hit || !hit[1].r0) return false;
  const [slug, c] = hit; c.r = c.r0.slice(); delete c.ed; rerender(content[slug], c);
  return true;
}

export function applyAllEdits(content, rows) {
  let n = 0; for (const r of rows || []) if (applyEdit(content, r.card_key, r.fields || {})) n++;
  return n;
}

// 读所有人改过的字段（卡片文字本来就是公开的，所以任何人都能读；写只有老师）。表不存在或读不到就当没有，不影响背词。
export async function fetchEdits(token) {
  const out = [];
  try {
    for (let from = 0; ; from += 1000) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/anki_test_card_edits?select=card_key,fields`, { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + (token || ANON_KEY), Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
      if (!res.ok) return out;
      const rows = await res.json(); out.push(...rows); if (rows.length < 1000) break;
    }
  } catch (e) { /* 忽略 */ }
  return out;
}
