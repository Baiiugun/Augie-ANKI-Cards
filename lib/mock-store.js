// 离线演示用的“假云端”：存在本机浏览器里，学生页和老师页（?mock=1）共用同一份，互相看得到对方的修改。不联网。
const KEY = 'anki_test_mock_v2';

export function loadStore(manifest, contents) {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) return s; } catch (e) { /* 忽略 */ }
  const cards = [];
  const today = Math.floor((Date.now() / 1000 - 1716148800) / 86400);
  for (const p of manifest.packages) {
    contents[p.slug].cards.forEach((c, i) => {
      if (i < 25) cards.push({ key: c.k, type: 0, queue: 0, due: i, ivl: 0, factor: 0, reps: 0, lapses: 0, lft: 0, suspended: false });
      else if (i < 40) cards.push({ key: c.k, type: 2, queue: 2, due: today - (i % 3), ivl: 5 + i, factor: 2500, reps: 4, lapses: 0, lft: 0, suspended: false });
      else if (i < 55) cards.push({ key: c.k, type: 2, queue: 2, due: today + 3 + (i % 9), ivl: 20 + i, factor: 2500, reps: 5, lapses: 0, lft: 0, suspended: false });
      else cards.push({ key: c.k, type: 0, queue: 0, due: i, ivl: 0, factor: 0, reps: 0, lapses: 0, lft: 0, suspended: i % 2 === 0 });
    });
  }
  return { cards, log: [], settings: {}, learner: { id: 'mock-1', name: '演示（离线）', new_per_day: 20, rev_per_day: 200, self_manage: true, code: 'MOCKMOCKMOCKMOCK', status: 'active', last_active: null } };
}
export function saveStore(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 忽略 */ } }
export function resetStore() { try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ } }
export const dayOf = (ms) => Math.floor((ms / 1000 - 1716148800) / 86400);
