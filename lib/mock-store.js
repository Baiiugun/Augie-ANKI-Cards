// 离线演示用的“假云端”：存在本机浏览器里，学生页和老师页（?mock=1）共用同一份，互相看得到对方的修改。不联网。
const KEY = 'anki_test_mock_v3';

export function loadStore(manifest, contents) {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) return s; } catch (e) { /* 忽略 */ }
  const cards = [], hist = [];
  const DAY = 86400000, nowMs = Date.now();
  const today = Math.floor((Date.now() / 1000 - 1716148800) / 86400);
  for (const p of manifest.packages) {
    contents[p.slug].cards.forEach((c, i) => {
      if (i < 25) cards.push({ key: c.k, type: 0, queue: 0, due: i, ivl: 0, factor: 0, reps: 0, lapses: 0, lft: 0, suspended: false });
      else if (i < 40) cards.push({ key: c.k, type: 2, queue: 2, due: today - (i % 3), ivl: 5 + i, factor: 2500, reps: 4, lapses: 0, lft: 0, suspended: false });
      else if (i < 55) cards.push({ key: c.k, type: 2, queue: 2, due: today + 3 + (i % 9), ivl: 20 + i, factor: 2500, reps: 5, lapses: 0, lft: 0, suspended: false });
      else cards.push({ key: c.k, type: 0, queue: 0, due: i, ivl: 0, factor: 0, reps: 0, lapses: 0, lft: 0, suspended: i % 2 === 0 });
    });
  }
  cards.forEach((c, j) => { if (c.type === 2) hist.push({ key: c.key, ts: nowMs - (j % 7) * DAY, n: 3 + (j % 5), again: j % 3 === 0 ? 1 + (j % 2) : 0, lastAgain: j % 3 === 0 ? nowMs - (j % 7) * DAY : null }); });
  return { cards, hist, log: [], settings: {}, learner: { id: 'mock-1', name: '演示（离线）', new_per_day: 20, rev_per_day: 200, self_manage: true, code: 'MOCKMOCKMOCKMOCK', status: 'active', last_active: null } };
}
export function saveStore(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 忽略 */ } }
export function resetStore() { try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ } }
export const dayOf = (ms) => Math.floor((ms / 1000 - 1716148800) / 86400);

// 每张学过的卡的汇总：[card_key, 最近答题ms, 答题次数, 答错次数, 最近答错ms]（离线演示 = 预置历史 + 这次演示里的答题）
export function mockSummary(st) {
  const m = new Map();
  for (const h of st.hist || []) m.set(h.key, { last: h.ts, n: h.n, again: h.again, lastAgain: h.lastAgain });
  for (const l of st.log) { const r = m.get(l.key) || { last: 0, n: 0, again: 0, lastAgain: null }; r.n++; r.last = Math.max(r.last, l.ts || 0); if (l.ease === 1) { r.again++; r.lastAgain = Math.max(r.lastAgain || 0, l.ts || 0); } m.set(l.key, r); }
  return [...m].map(([k, r]) => [k, r.last, r.n, r.again, r.lastAgain]);
}
