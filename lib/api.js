// 学生页和云端的通话：只调 anki_test_student_* 三个函数（凭学习码）。另有一个离线演示模式（?mock=1），不联网，用于试界面。
import { SUPABASE_URL, ANON_KEY } from './config.js';

const rowToCard = (r) => ({ key: r[0], type: r[1], queue: r[2], due: r[3], ivl: r[4], factor: r[5], reps: r[6], lapses: r[7], lft: r[8], suspended: r[9] });
const pick = (c) => ({ type: c.type, queue: c.queue, due: c.due, ivl: c.ivl, factor: c.factor, reps: c.reps, lapses: c.lapses, lft: c.lft });
export const stateOf = pick;

async function rpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).message || ''; } catch (e) { /* 忽略 */ }
    const err = new Error(msg || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export function createApi(code) {
  return {
    async getState() {
      const r = await rpc('anki_test_student_get_state', { p_code: code });
      return { learner: r.learner, nowMs: r.now_ms, today: r.today, todayLog: r.today_log, cards: r.cards.map(rowToCard) };
    },
    answer: (key, state, log) => rpc('anki_test_student_answer', { p_code: code, p_card_key: key, p_state: pick(state), p_log: log }),
    undo: (key, prev, uid) => rpc('anki_test_student_undo', { p_code: code, p_card_key: key, p_prev: pick(prev), p_uid: uid }),
  };
}

// ---------- 离线演示（?mock=1）：用 manifest 里的卡片临时编一份进度，存在本机浏览器里，不碰云端 ----------
export function createMockApi(manifest, contents) {
  const KEY = 'anki_test_mock_state_v1';
  let st = null;
  try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* 忽略 */ }
  if (!st) {
    const cards = [];
    const today = Math.floor((Date.now() / 1000 - 1716148800) / 86400);
    for (const p of manifest.packages) {
      const list = contents[p.slug].cards;
      list.forEach((c, i) => {
        if (i < 25) cards.push({ key: c.k, type: 0, queue: 0, due: i, ivl: 0, factor: 0, reps: 0, lapses: 0, lft: 0, suspended: false });
        else if (i < 40) cards.push({ key: c.k, type: 2, queue: 2, due: today - (i % 3), ivl: 5 + i, factor: 2500, reps: 4, lapses: 0, lft: 0, suspended: false });
        else cards.push({ key: c.k, type: 0, queue: 0, due: i, ivl: 0, factor: 0, reps: 0, lapses: 0, lft: 0, suspended: i % 2 === 0 });
      });
    }
    st = { cards, log: [] };
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 忽略 */ } };
  return {
    async getState() {
      const today = Math.floor((Date.now() / 1000 - 1716148800) / 86400);
      const todayLog = st.log.filter((l) => Math.floor((l.ts / 1000 - 1716148800) / 86400) === today).map((l) => [l.key, l.prev_type, l.type]);
      return { learner: { name: '演示（离线）', new_per_day: 20, rev_per_day: 200 }, nowMs: Date.now(), today, todayLog, cards: st.cards.map((c) => ({ ...c })) };
    },
    async answer(key, state, log) {
      const c = st.cards.find((x) => x.key === key); Object.assign(c, pick(state));
      st.log.push({ key, ...log }); save();
    },
    async undo(key, prev, uid) {
      const c = st.cards.find((x) => x.key === key); Object.assign(c, pick(prev));
      st.log = st.log.filter((l) => l.uid !== uid); save();
    },
    reset() { try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ } },
  };
}
