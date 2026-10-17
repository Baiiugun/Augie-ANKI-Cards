// 学生页和云端的通话：只调 anki_test_student_* 函数（凭学习码）。另有离线演示模式（?mock=1），不联网，用于试界面。
import { SUPABASE_URL, ANON_KEY } from './config.js';
import { loadStore, saveStore, resetStore, dayOf, mockSummary } from './mock-store.js';
import { fetchEdits, fetchTagRemovals } from './edits.js';

const rowToCard = (r) => ({ key: r[0], type: r[1], queue: r[2], due: r[3], ivl: r[4], factor: r[5], reps: r[6], lapses: r[7], lft: r[8], suspended: r[9], flag: r[10] || 0, deleted: !!r[11] });   // flag（颜色标记 0~7）是第 11 项（08 号 SQL）、deleted（已删除）是第 12 项（09 号 SQL）；没运行对应 SQL 的数据库没有它们 → 当作 0 / false
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

// 每个 Deck 的上限设置：[slug, new_per_day, rev_per_day, today_day, today_new, today_rev] → { slug: {...} }
const settingsMap = (rows) => Object.fromEntries((rows || []).map((r) => [r[0], { new_per_day: r[1], rev_per_day: r[2], today_day: r[3], today_new: r[4], today_rev: r[5] }]));

export function createApi(code) {
  return {
    async getState() {
      const r = await rpc('anki_test_student_get_state', { p_code: code });
      return { learner: { self_manage: true, ...r.learner }, nowMs: r.now_ms, today: r.today, settings: settingsMap(r.settings), todayLog: r.today_log, cards: r.cards.map(rowToCard) };
    },
    answer: (key, state, log) => rpc('anki_test_student_answer', { p_code: code, p_card_key: key, p_state: pick(state), p_log: log }),
    undo: (key, prev, uid) => rpc('anki_test_student_undo', { p_code: code, p_card_key: key, p_prev: pick(prev), p_uid: uid }),
    setTodayLimits: (slug, n, r) => rpc('anki_test_student_set_today_limits', { p_code: code, p_slug: slug, p_new: n, p_rev: r }),
    setSuspended: (keys, flag) => rpc('anki_test_student_set_suspended', { p_code: code, p_keys: keys, p_suspended: flag }),
    setDueToday: (keys) => rpc('anki_test_student_set_due_today', { p_code: code, p_keys: keys }),
    // 颜色标记 0~7（0=取消，需要 08 号 SQL）；不受“自己管理卡片”开关限制；函数一次最多 500 张，这里自动分批
    async setFlag(keys, flag) { let n = 0; for (let i = 0; i < keys.length; i += 500) n += await rpc('anki_test_student_set_flag', { p_code: code, p_keys: keys.slice(i, i + 500), p_flag: flag }); return n; },
    // 删除 / 恢复卡片（放进“已删除”，不是永久删除）、删标签（隐藏）：需要 09 号 SQL 和“允许学生自己管理卡片”；函数一次最多 500 张，这里自动分批
    async setDeleted(keys, flag) { let n = 0; for (let i = 0; i < keys.length; i += 500) n += await rpc('anki_test_student_set_deleted', { p_code: code, p_keys: keys.slice(i, i + 500), p_deleted: !!flag }); return n; },
    async removeTag(keys, tag) { let n = 0; for (let i = 0; i < keys.length; i += 500) n += await rpc('anki_test_student_remove_tag', { p_code: code, p_keys: keys.slice(i, i + 500), p_tag: tag }); return n; },
    // 每张学过的卡：[card_key, 最近答题ms, 答题次数, 答错次数, 最近答错ms]（需要 06 号 SQL）
    getReviewSummary: () => rpc('anki_test_student_review_summary', { p_code: code }),
    getEdits: () => fetchEdits(),                 // 老师改过的卡片文字（需要 07 号 SQL；没有就当没有）
    getTagRemovals: () => fetchTagRemovals(),     // 被删掉（隐藏）的标签（需要 09 号 SQL；没有就当没有）
  };
}

// ---------- 离线演示（?mock=1） ----------
export function createMockApi(manifest, contents) {
  const st = loadStore(manifest, contents);
  const save = () => saveStore(st);
  const find = (key) => st.cards.find((x) => x.key === key);
  return {
    async getState() {
      const today = dayOf(Date.now());
      const todayLog = st.log.filter((l) => dayOf(l.ts) === today).map((l) => [l.key, l.prev_type, l.type]);
      return { learner: { ...st.learner }, nowMs: Date.now(), today, settings: JSON.parse(JSON.stringify(st.settings)), todayLog, cards: st.cards.map((c) => ({ ...c })) };
    },
    async answer(key, state, log) { Object.assign(find(key), pick(state)); st.log.push({ key, ...log }); save(); },
    async undo(key, prev, uid) { Object.assign(find(key), pick(prev)); st.log = st.log.filter((l) => l.uid !== uid); save(); },
    async setTodayLimits(slug, n, r) {
      st.settings[slug] = { ...(st.settings[slug] || {}), today_day: dayOf(Date.now()), today_new: n, today_rev: r }; save();
    },
    async setSuspended(keys, flag) {
      if (!st.learner.self_manage) throw new Error('not allowed');
      for (const k of keys) { const c = find(k); if (c) c.suspended = !!flag; } save(); return keys.length;
    },
    async setDueToday(keys) {
      if (!st.learner.self_manage) throw new Error('not allowed');
      const today = dayOf(Date.now()); let n = 0;
      for (const k of keys) { const c = find(k); if (c && c.type === 2 && c.queue === 2 && c.due > today) { c.due = today; n++; } } save(); return n;
    },
    async setFlag(keys, flag) { let n = 0; for (const k of keys) { const c = find(k); if (c) { c.flag = flag; n++; } } save(); return n; },
    async setDeleted(keys, flag) {
      if (!st.learner.self_manage) throw new Error('not allowed');
      let n = 0; for (const k of keys) { const c = find(k); if (c) { c.deleted = !!flag; n++; } } save(); return n;
    },
    async removeTag(keys, tag) {
      if (!st.learner.self_manage) throw new Error('not allowed');
      const tr = (st.tagRemovals ||= []); let n = 0;
      for (const k of keys) if (!tr.some((r) => r.card_key === k && r.tag === tag)) { tr.push({ card_key: k, tag }); n++; }
      save(); return n;
    },
    async getReviewSummary() { return mockSummary(st); },
    async getEdits() { return Object.entries(st.edits || {}).map(([card_key, fields]) => ({ card_key, fields })); },
    async getTagRemovals() { return [...(st.tagRemovals || [])]; },
    reset() { resetStore(); },
  };
}
