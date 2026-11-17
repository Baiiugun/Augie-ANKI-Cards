import { dayNumber } from './anki-sched.js';
import { MANAGEMENT_SCHEMA } from './teaching-management-api.js';
function migrate(st) {
  if (st.managementSchema !== MANAGEMENT_SCHEMA) {
    st.learners.filter((l) => l.kind === 'yuedu').forEach((l) => { l.self_manage = true; });
    st.managementSchema = MANAGEMENT_SCHEMA; st.save();
  }
}
export function mockTeachingScope(st, id) {
  const asg = st.assignments.filter((a) => a.learner_id === id), out = [];
  for (const b of st.bank) {
    const c = st.state[id]?.[b.card_key]; if (!c) continue;
    const refs = asg.filter((a) => a.paper_id === b.paper_id && (b.data.map_schema === 'echoo.map.vocab.v1' ? a.card_keys?.includes(b.card_key) : a.section_id === b.section_id));
    if (refs.length) out.push({ b, c, sections: [...new Set(refs.map((a) => a.section_id))].sort() });
  }
  return out;
}
export function mockManagementState(st, id) {
  migrate(st);
  const l = st.learners.find((l) => l.id === id && l.kind === 'yuedu');
  if (!l) throw new Error('not yuedu learner');
  const scope = mockTeachingScope(st, id), keys = new Set(scope.map((x) => x.b.card_key)), today = dayNumber(Date.now());
  const papers = st.papers.filter((p) => scope.some((x) => x.b.paper_id === p.paper_id)).map((p) => ({ ...p, sections: p.sections.filter((s) => scope.some((x) => x.b.paper_id === p.paper_id && x.sections.includes(s.id))) }));
  const review = new Map();
  for (const r of st.revlog.filter((r) => r.learner_id === id && keys.has(r.card_key))) {
    const v = review.get(r.card_key) || [r.card_key, 0, 0, 0, null];
    v[1] = Math.max(v[1], r.ts); v[2]++; if (r.ease === 1) { v[3]++; v[4] = Math.max(v[4] || 0, r.ts); } review.set(r.card_key, v);
  }
  return {
    management_schema: MANAGEMENT_SCHEMA, learner: { name: l.name, self_manage: l.self_manage, new_per_day: l.new_per_day, rev_per_day: l.rev_per_day },
    now_ms: Date.now(), today, papers,
    cards: scope.map(({ b, c, sections }) => {
      const tags = (b.data.tags || []).filter((tag) => !(st.teachingTagRemovals || []).some((r) => r.learner_id === id && r.card_key === b.card_key && r.tag === tag));
      const data = { ...b.data, tags, source_sections: sections, ...(st.teachingEdits?.[b.card_key] ? { field_edits: st.teachingEdits[b.card_key] } : {}) };
      return [b.card_key, b.paper_id, sections[0], b.ord, data, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.lft, !!c.suspended, c.flag || 0, !!c.deleted];
    }),
    today_log: st.revlog.filter((r) => r.learner_id === id && dayNumber(r.ts) === today).map((r) => [r.card_key, r.prev_type, r.type]),
    review: [...review.values()],
  };
}
export function mockManage(st, id, action, keys, value = {}, teacher = false) {
  migrate(st);
  const l = st.learners.find((l) => l.id === id && l.kind === 'yuedu');
  if (!l) throw new Error('not yuedu learner');
  if (!teacher && ((l.status || 'active') !== 'active' || l.expires_at && Date.parse(l.expires_at) <= Date.now())) throw new Error('invalid code');
  if (!teacher && ['edit', 'reset_edit'].includes(action)) throw new Error('teacher required');
  if (!teacher && action !== 'flag' && l.self_manage !== true) throw new Error('not allowed');
  const allowed = new Set(mockTeachingScope(st, id).map((x) => x.b.card_key));
  if (!keys.length || keys.length > 500 || keys.some((k) => !allowed.has(k))) throw new Error('card outside assignment');
  if (['suspend','delete'].includes(action) && typeof value.value !== 'boolean') throw new Error('bad value');
  if (action === 'flag' && (!Number.isInteger(value.value) || value.value < 0 || value.value > 7)) throw new Error('bad flag');
  if (action === 'remove_tag' && (!value.tag?.trim() || value.tag.length > 120)) throw new Error('bad tag');
  if (action === 'edit') {
    const fields = st.bank.find((b) => b.card_key === keys[0]).data.presentation?.source.model.fields;
    if (keys.length !== 1 || !fields || Object.entries(value.fields || {}).some(([name,v]) => !fields.includes(name) || typeof v !== 'string')) throw new Error('bad fields');
  }
  let n = 0;
  for (const k of [...new Set(keys)]) {
    const c = st.state[id][k];
    if (action === 'suspend') c.suspended = value.value;
    else if (action === 'delete') c.deleted = value.value;
    else if (action === 'flag') c.flag = value.value;
    else if (action === 'due_today') { const td = dayNumber(Date.now()); if (c.type !== 2 || c.queue !== 2 || c.due <= td) continue; c.due = td; }
    else if (action === 'remove_tag') {
      const list = st.teachingTagRemovals ||= [];
      if (list.some((r) => r.learner_id === id && r.card_key === k && r.tag === value.tag)) continue;
      list.push({ learner_id: id, card_key: k, tag: value.tag });
    } else if (action === 'edit') (st.teachingEdits ||= {})[k] = { ...value.fields };
    else if (action === 'reset_edit') { if (st.teachingEdits) delete st.teachingEdits[k]; }
    else throw new Error('bad action');
    c.updated_at = new Date().toISOString(); n++;
  }
  st.save(); return n;
}
export function mockStudentManagement(st, getId) {
  migrate(st);
  return { manageCards: async (action, keys, value) => mockManage(st, getId(), action, keys, value) };
}
export function mockTeacherManagement(st, convert) {
  migrate(st);
  return {
    getManagementState: async (id) => convert(mockManagementState(st, id)),
    manageCards: async (id, action, keys, value) => mockManage(st, id, action, keys, value, true),
  };
}
