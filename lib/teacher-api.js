// 老师页和云端的通话（用老师账号登录后的令牌；表由 RLS 的 is_teacher() 放行）。另有离线演示（?mock=1）。
import { SUPABASE_URL, ANON_KEY } from './config.js';
import { loadStore, saveStore, dayOf } from './mock-store.js';

async function call(token, method, path, body, extra = {}) {
  const res = await fetch(SUPABASE_URL + path, { method, headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + (token || ANON_KEY), 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) { let m = ''; try { m = (await res.json()).message; } catch (e) { /* 忽略 */ } const err = new Error(m || ('HTTP ' + res.status)); err.status = res.status; throw err; }
  const t = await res.text(); return t ? JSON.parse(t) : null;
}
async function getAll(token, path) {   // PostgREST 一次最多返回 1000 行，分页取
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = await call(token, 'GET', path, undefined, { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' });
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}

export async function login(email, password) {
  const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error('邮箱或密码不对（' + r.status + '）');
  return (await r.json()).access_token;
}

export function createTeacherApi(token) {
  const inList = (keys) => keys.join(',');
  return {
    listLearners: () => call(token, 'GET', '/rest/v1/anki_test_learners?select=*&order=created_at'),
    addLearner: (name, code) => call(token, 'POST', '/rest/v1/anki_test_learners', { name, code }, { Prefer: 'return=minimal' }),
    updateLearner: (id, patch) => call(token, 'PATCH', `/rest/v1/anki_test_learners?id=eq.${id}`, patch, { Prefer: 'return=minimal' }),
    getCards: (id) => getAll(token, `/rest/v1/anki_test_card_state?learner_id=eq.${id}&select=card_key,type,queue,due,ivl,suspended`),
    async getSettings(id) {
      const rows = await call(token, 'GET', `/rest/v1/anki_test_deck_settings?learner_id=eq.${id}&select=*`);
      return Object.fromEntries(rows.map((r) => [r.slug, r]));
    },
    saveSettings: (id, slug, v) => call(token, 'POST', '/rest/v1/anki_test_deck_settings?on_conflict=learner_id,slug', { learner_id: id, slug, new_per_day: v.new_per_day, rev_per_day: v.rev_per_day, updated_at: new Date().toISOString() }, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    dailyStats: (id, days = 14) => call(token, 'POST', '/rest/v1/rpc/anki_test_teacher_daily_stats', { p_learner: id, p_days: days }),
    async setSuspended(id, keys, flag) {
      for (let i = 0; i < keys.length; i += 100) await call(token, 'PATCH', `/rest/v1/anki_test_card_state?learner_id=eq.${id}&card_key=in.(${inList(keys.slice(i, i + 100))})`, { suspended: !!flag }, { Prefer: 'return=minimal' });
      return keys.length;
    },
    async setDueToday(id, keys, today) {
      let n = 0;
      for (let i = 0; i < keys.length; i += 100) {
        const rows = await call(token, 'PATCH', `/rest/v1/anki_test_card_state?learner_id=eq.${id}&card_key=in.(${inList(keys.slice(i, i + 100))})&type=eq.2&queue=eq.2&due=gt.${today}`, { due: today }, { Prefer: 'return=representation' });
        n += rows.length;
      }
      return n;
    },
  };
}

export function createMockTeacherApi(manifest, contents) {
  const st = loadStore(manifest, contents), save = () => saveStore(st);
  const find = (k) => st.cards.find((c) => c.key === k);
  return {
    async listLearners() { return [{ ...st.learner }]; },
    async addLearner() { throw new Error('演示模式不能新增学生'); },
    async updateLearner(id, patch) { Object.assign(st.learner, patch); save(); },
    async getCards() { return st.cards.map((c) => ({ card_key: c.key, type: c.type, queue: c.queue, due: c.due, ivl: c.ivl, suspended: c.suspended })); },
    async getSettings() { return Object.fromEntries(Object.entries(st.settings).map(([slug, v]) => [slug, { slug, ...v }])); },
    async saveSettings(id, slug, v) { st.settings[slug] = { ...(st.settings[slug] || {}), new_per_day: v.new_per_day, rev_per_day: v.rev_per_day }; save(); },
    async dailyStats() {
      const by = {};
      for (const l of st.log) { const d = dayOf(l.ts); const b = (by[d] ??= { day_no: d, newSet: new Set(), revSet: new Set(), answers: 0 }); l.prev_type === 0 ? b.newSet.add(l.key) : b.revSet.add(l.key); b.answers++; }
      return Object.values(by).sort((a, b) => b.day_no - a.day_no).map((b) => ({ day_no: b.day_no, day_date: new Date((1716148800 + b.day_no * 86400) * 1000).toISOString().slice(0, 10), new_cards: b.newSet.size, review_cards: b.revSet.size, answers: b.answers, from_import: false }));
    },
    async setSuspended(id, keys, flag) { for (const k of keys) { const c = find(k); if (c) c.suspended = !!flag; } save(); return keys.length; },
    async setDueToday(id, keys, today) { let n = 0; for (const k of keys) { const c = find(k); if (c && c.type === 2 && c.queue === 2 && c.due > today) { c.due = today; n++; } } save(); return n; },
  };
}
