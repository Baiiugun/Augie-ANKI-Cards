// 阅读词（高中试卷词库）：学生页、老师页和云端的通话。卡片内容存在 Supabase（10 号 SQL），不在 GitHub。
// 学生只调函数（凭学习码，只拿到布置给自己的词）；老师用登录令牌走表（RLS is_teacher()）+ 布置函数。
// 另有离线演示（?mock=1）：两页共用浏览器里的假数据（localStorage yuedu_mock_v1），不联网。
// 演示词库默认是几个自编的示例词；本机测试时加 &bank=local 会改读 /_yuedu/bank.json（本机测试服务器提供，不进 GitHub）。
import { SUPABASE_URL, ANON_KEY } from './config.js';
import { dayNumber } from './anki-sched.js';

// ---------- 学生 ----------
async function rpc(name, body, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + (token || ANON_KEY), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = ''; try { msg = (await res.json()).message || ''; } catch (e) { /* 忽略 */ }
    const err = new Error(msg || ('HTTP ' + res.status)); err.status = res.status; throw err;
  }
  const t = await res.text(); return t ? JSON.parse(t) : null;
}
const pick = (c) => ({ type: c.type, queue: c.queue, due: c.due, ivl: c.ivl, factor: c.factor, reps: c.reps, lapses: c.lapses, lft: c.lft });
export const stateOf = pick;
// 函数返回的一行：[card_key, paper_id, section_id, ord, data, type, queue, due, ivl, factor, reps, lapses, lft, suspended]
const rowToCard = (r) => ({ key: r[0], paper: r[1], sec: r[2], ord: r[3], d: r[4] || {}, type: r[5], queue: r[6], due: Number(r[7]), ivl: r[8], factor: r[9], reps: r[10], lapses: r[11], lft: r[12], suspended: !!r[13] });
const toState = (r) => ({ learner: r.learner, nowMs: r.now_ms, today: r.today, todayLog: r.today_log || [], papers: r.papers || [], cards: (r.cards || []).map(rowToCard) });

export function createStudentApi(code) {
  return {
    getState: async () => toState(await rpc('anki_test_yuedu_get_state', { p_code: code })),
    answer: (key, state, log) => rpc('anki_test_student_answer', { p_code: code, p_card_key: key, p_state: pick(state), p_log: log }),
    undo: (key, prev, uid) => rpc('anki_test_student_undo', { p_code: code, p_card_key: key, p_prev: pick(prev), p_uid: uid }),
    setSuspended: (keys, flag) => rpc('anki_test_yuedu_set_suspended', { p_code: code, p_keys: keys, p_suspended: !!flag }),
  };
}

// ---------- 老师 ----------
async function call(token, method, path, body, extra = {}) {
  const res = await fetch(SUPABASE_URL + path, { method, headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + (token || ANON_KEY), 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) { let m = ''; try { m = (await res.json()).message; } catch (e) { /* 忽略 */ } const err = new Error(m || ('HTTP ' + res.status)); err.status = res.status; throw err; }
  const t = await res.text(); return t ? JSON.parse(t) : null;
}
async function getAll(token, path) {   // PostgREST 一次最多 1000 行，分页取
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = await call(token, 'GET', path, undefined, { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' });
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}

export function createTeacherApi(token) {
  return {
    listLearners: () => call(token, 'GET', '/rest/v1/anki_test_learners?select=*&order=created_at'),
    // 阅读词学生：kind=yuedu；self_manage=false 让旧的“删除/删标签/设为今天”函数一律拒绝
    addLearner: (name, code) => call(token, 'POST', '/rest/v1/anki_test_learners', { name, code, kind: 'yuedu', self_manage: false }, { Prefer: 'return=minimal' }),
    updateLearner: (id, patch) => call(token, 'PATCH', `/rest/v1/anki_test_learners?id=eq.${id}`, patch, { Prefer: 'return=minimal' }),
    listPapers: () => call(token, 'GET', '/rest/v1/anki_test_bank_papers?select=paper_id,bank,name,sort,sections,source,updated_at&order=sort,name'),
    listAssignments: (id) => call(token, 'GET', '/rest/v1/anki_test_assignments?select=learner_id,paper_id,section_id,assigned_at' + (id ? `&learner_id=eq.${id}` : '')),
    assign: (id, paper, secs) => rpc('anki_test_teacher_assign', { p_learner: id, p_paper: paper, p_sections: secs }, token),
    unassign: (id, paper, secs) => rpc('anki_test_teacher_unassign', { p_learner: id, p_paper: paper, p_sections: secs }, token),
    getCards: (id) => getAll(token, `/rest/v1/anki_test_card_state?learner_id=eq.${id}&card_key=like.yd:*&select=card_key,type,queue,due,ivl,reps,lapses,suspended,updated_at`),
    getBankCards: (paperIds) => (paperIds.length ? getAll(token, `/rest/v1/anki_test_bank_cards?paper_id=in.(${paperIds.map(encodeURIComponent).join(',')})&select=card_key,paper_id,section_id,ord,data&order=ord`) : Promise.resolve([])),
    async setSuspended(id, keys, flag) {
      for (let i = 0; i < keys.length; i += 100) await call(token, 'PATCH', `/rest/v1/anki_test_card_state?learner_id=eq.${id}&card_key=in.(${keys.slice(i, i + 100).join(',')})`, { suspended: !!flag, updated_at: new Date().toISOString() }, { Prefer: 'return=minimal' });
      return keys.length;
    },
    dailyStats: (id, days = 14) => call(token, 'POST', '/rest/v1/rpc/anki_test_teacher_daily_stats', { p_learner: id, p_days: days }),
  };
}

// ======================================================================================
// 离线演示（?mock=1）
const MKEY = 'yuedu_mock_v1';
const SAMPLE = (() => {   // 自编的示例词（不是任何试卷的原文）
  const P = 'mock-paper-1';
  const secs = [
    { id: 'mockA-B1p', label: '阅读A篇', board: '阅读', piece: 'A篇', level: 'B1+', sort: 0 },
    { id: 'mockB-B1p', label: '阅读B篇', board: '阅读', piece: 'B篇', level: 'B1+', sort: 1 },
    { id: 'mockQ-B1p', label: '七选五', board: '七选五', piece: '', level: 'B1+', sort: 4 },
  ];
  const W = [
    ['mockA-B1p', 'habit', 'n.', 'ˈhæbɪt', '习惯', 'B1', 'Reading every night is a good <b>habit</b>.', '每晚读书是个好<b>习惯</b>。'],
    ['mockA-B1p', 'improve', 'v.', 'ɪmˈpruːv', '提高', 'B1', 'Practice will <b>improve</b> your English.', '练习会<b>提高</b>你的英语。'],
    ['mockA-B1p', 'take part in', 'phr. v.', 'teɪk pɑːt ɪn', '参加', 'B1', 'She will <b>take part in</b> the race.', '她将<b>参加</b>比赛。'],
    ['mockA-B1p', 'confident', 'adj.', 'ˈkɒnfɪdənt', '自信的', 'B1', 'He felt <b>confident</b> before the test.', '考试前他感到很<b>自信</b>。'],
    ['mockB-B1p', 'protect', 'v.', 'prəˈtekt', '保护', 'B1', 'We must <b>protect</b> the forest.', '我们必须<b>保护</b>森林。'],
    ['mockB-B1p', 'species', 'n.', 'ˈspiːʃiːz', '物种', 'B2', 'Many <b>species</b> live in the river.', '许多<b>物种</b>生活在这条河里。'],
    ['mockB-B1p', 'reduce', 'v.', 'rɪˈdjuːs', '减少', 'B1', 'We should <b>reduce</b> waste.', '我们应该<b>减少</b>浪费。'],
    ['mockQ-B1p', 'in other words', 'phr.', 'ɪn ˈʌðə wɜːdz', '换句话说', 'B1', '<b>In other words</b>, practice makes perfect.', '<b>换句话说</b>，熟能生巧。'],
    ['mockQ-B1p', 'therefore', 'adv.', 'ˈðeəfɔː', '因此', 'B1', 'It rained; <b>therefore</b>, we stayed home.', '下雨了，<b>因此</b>我们待在家里。'],
  ];
  const cnt = {}; W.forEach((w) => { cnt[w[0]] = (cnt[w[0]] || 0) + 1; });
  return {
    papers: [{ paper_id: P, bank: '阅读词', name: '示例试卷（离线演示）', sort: 0, sections: secs.map((s) => ({ ...s, count: cnt[s.id] || 0 })), source: { pack: '离线演示' } }],
    bank: W.map((w, i) => ({ card_key: 'yd:mock' + String(i).padStart(4, '0'), paper_id: P, section_id: w[0], ord: secs.find((s) => s.id === w[0]).sort * 1000 + i, data: { w: w[1], pos: w[2], ipa: w[3], mean: w[4], cefr: w[5], en: w[6], cn: w[7], audio: '' } })),
  };
})();
async function loadBank() {
  if (new URLSearchParams(location.search).get('bank') === 'local') {
    const plan = await (await fetch('/_yuedu/bank.json')).json();   // import-work/yuedu/<试卷>.json（本机测试服务器提供）
    return { papers: [plan.paper], bank: plan.cards.map((c) => ({ ...c, paper_id: plan.paper.paper_id })) };
  }
  return SAMPLE;
}
async function mockStore() {
  let st = null;
  try { st = JSON.parse(localStorage.getItem(MKEY)); } catch (e) { /* 忽略 */ }
  const bank = await loadBank();
  if (!st || st.bankName !== bank.papers[0].name) {
    st = { bankName: bank.papers[0].name, learners: [
      { id: 'mock-augie', name: 'Augie', code: 'AUGIEAUGIEAUGIE2', kind: 'anki', new_per_day: 20, rev_per_day: 200, created_at: '2026-10-09T00:00:00Z', last_active: null },
      { id: 'mock-yd-1', name: '示例学生', code: 'MOCKMOCKMOCKMOCK', kind: 'yuedu', new_per_day: 20, rev_per_day: 200, created_at: new Date().toISOString(), last_active: null },
    ], assignments: [], state: {}, revlog: [] };
  }
  st.papers = bank.papers; st.bank = bank.bank;
  st.save = () => { try { const { papers, bank: b, save, ...rest } = st; localStorage.setItem(MKEY, JSON.stringify(rest)); } catch (e) { /* 忽略 */ } };
  return st;
}
export function resetMock() { try { localStorage.removeItem(MKEY); } catch (e) { /* 忽略 */ } }
const bankMap = (st) => new Map(st.bank.map((b) => [b.card_key, b]));
const assigned = (st, lid) => st.assignments.filter((a) => a.learner_id === lid);

export async function createMockStudentApi(code) {
  const st = await mockStore();
  const me = () => st.learners.find((l) => l.code === code);
  const states = () => (st.state[me().id] ||= {});
  return {
    async getState() {
      const l = me(); if (!l) throw new Error('invalid code'); if (l.kind !== 'yuedu') throw new Error('not yuedu learner');
      l.last_active = new Date().toISOString(); st.save();
      const today = dayNumber(Date.now()), bm = bankMap(st), asg = assigned(st, l.id);
      const isAsg = (b) => asg.some((a) => a.paper_id === b.paper_id && a.section_id === b.section_id);
      const papers = st.papers.filter((p) => asg.some((a) => a.paper_id === p.paper_id)).map((p) => ({ paper_id: p.paper_id, name: p.name, sort: p.sort, sections: p.sections.filter((s) => asg.some((a) => a.paper_id === p.paper_id && a.section_id === s.id)) }));
      const cards = Object.entries(states()).filter(([k]) => bm.has(k) && isAsg(bm.get(k))).map(([k, c]) => { const b = bm.get(k); return [k, b.paper_id, b.section_id, b.ord, b.data, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.lft, c.suspended]; });
      const todayLog = st.revlog.filter((r) => r.learner_id === l.id && dayNumber(r.ts) === today).map((r) => [r.card_key, r.prev_type, r.type]);
      return toState({ learner: { name: l.name, new_per_day: l.new_per_day, rev_per_day: l.rev_per_day }, now_ms: Date.now(), today, today_log: todayLog, papers, cards });
    },
    async answer(key, state, log) { const c = states()[key]; if (!c || c.suspended) { const e = new Error('card not found or suspended'); e.status = 400; throw e; } Object.assign(c, pick(state)); if (!st.revlog.some((r) => r.uid === log.uid)) st.revlog.push({ ...log, learner_id: me().id, card_key: key }); st.save(); },
    async undo(key, prev, uid) { const c = states()[key]; if (c && !c.suspended) Object.assign(c, pick(prev)); st.revlog = st.revlog.filter((r) => r.uid !== uid); st.save(); },
    async setSuspended(keys, flag) { let n = 0; for (const k of keys) { const c = states()[k]; if (c) { c.suspended = !!flag; c.updated_at = new Date().toISOString(); n++; } } st.save(); return n; },
    reset: resetMock,
  };
}

export async function createMockTeacherApi() {
  const st = await mockStore();
  const states = (id) => (st.state[id] ||= {});
  return {
    async listLearners() { return st.learners.map((l) => ({ ...l })); },
    async addLearner(name, code) { st.learners.push({ id: 'mock-' + Date.now().toString(36), name, code, kind: 'yuedu', self_manage: false, new_per_day: 20, rev_per_day: 200, created_at: new Date().toISOString(), last_active: null }); st.save(); },
    async updateLearner(id, patch) { Object.assign(st.learners.find((l) => l.id === id), patch); st.save(); },
    async listPapers() { return JSON.parse(JSON.stringify(st.papers)); },
    async listAssignments(id) { return st.assignments.filter((a) => !id || a.learner_id === id).map((a) => ({ ...a })); },
    async assign(id, paper, secs) {
      const p = st.papers.find((x) => x.paper_id === paper);
      for (const s of secs) if (p.sections.some((x) => x.id === s) && !st.assignments.some((a) => a.learner_id === id && a.paper_id === paper && a.section_id === s)) st.assignments.push({ learner_id: id, paper_id: paper, section_id: s, assigned_at: new Date().toISOString() });
      const ss = states(id); let base = Math.max(-1, ...Object.entries(ss).filter(([, c]) => c.queue === 0).map(([, c]) => c.due)), n = 0;
      for (const b of st.bank.filter((x) => x.paper_id === paper && secs.includes(x.section_id)).sort((a, b2) => a.ord - b2.ord)) if (!ss[b.card_key]) { ss[b.card_key] = { type: 0, queue: 0, due: ++base, ivl: 0, factor: 0, reps: 0, lapses: 0, lft: 0, suspended: false, updated_at: new Date().toISOString() }; n++; }
      st.save(); return n;
    },
    async unassign(id, paper, secs) { const before = st.assignments.length; st.assignments = st.assignments.filter((a) => !(a.learner_id === id && a.paper_id === paper && secs.includes(a.section_id))); st.save(); return before - st.assignments.length; },
    async getCards(id) { return Object.entries(states(id)).map(([k, c]) => ({ card_key: k, type: c.type, queue: c.queue, due: c.due, ivl: c.ivl, reps: c.reps, lapses: c.lapses, suspended: c.suspended, updated_at: c.updated_at || null })); },
    async getBankCards(paperIds) { return st.bank.filter((b) => paperIds.includes(b.paper_id)).map((b) => ({ ...b })); },
    async setSuspended(id, keys, flag) { for (const k of keys) { const c = states(id)[k]; if (c) { c.suspended = !!flag; c.updated_at = new Date().toISOString(); } } st.save(); return keys.length; },
    async dailyStats(id) {
      const by = {};
      for (const r of st.revlog.filter((x) => x.learner_id === id)) { const d = dayNumber(r.ts); const b = (by[d] ??= { day_no: d, n: new Set(), v: new Set(), answers: 0 }); (r.prev_type === 0 ? b.n : b.v).add(r.card_key); b.answers++; }
      return Object.values(by).sort((a, b) => b.day_no - a.day_no).map((b) => ({ day_no: b.day_no, day_date: new Date((1716148800 + b.day_no * 86400) * 1000 + 8 * 3600000).toISOString().slice(0, 10), new_cards: b.n.size, review_cards: b.v.size, answers: b.answers, from_import: false }));
    },
    reset: resetMock,
  };
}
