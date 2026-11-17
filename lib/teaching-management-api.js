import { SUPABASE_URL, ANON_KEY } from './config.js';
import { getTeachingState } from './map-api.js';
export const MANAGEMENT_SCHEMA = 'teaching-card-management-v1';
async function call(token, name, body) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + (token || ANON_KEY), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok) { const e = new Error(value.message || 'HTTP ' + r.status); e.status = r.status; e.code = value.code; throw e; }
  return value;
}
const missing = (e) => e.status === 404 || e.code === 'PGRST202' || e.code === '42883';
export async function getManagedTeachingState(code) {
  try { return await call(null, 'anki_test_teaching_student_state', { p_code: code }); }
  catch (e) { if (!missing(e)) throw e; return { ...await getTeachingState(code), management_schema: null }; }
}
async function batches(send, keys) {
  const unique = [...new Set(keys)];
  if (!unique.length) return 0;
  let n = 0;
  for (let i = 0; i < unique.length; i += 500) {
    try { n += Number(await send(unique.slice(i, i + 500))) || 0; }
    catch (e) {
      const message = missing(e) ? '卡片管理接口尚未接入，请老师运行13号SQL后刷新。' : e.message;
      if (i > 0) throw new Error(message + '；前面批次已处理，请刷新核对后重试。');
      if (missing(e)) throw new Error(message);
      throw e;
    }
  }
  return n;
}
export function studentManagementActions(code) {
  const manage = (action, keys, value = {}) => batches((part) => call(null, 'anki_test_teaching_student_manage', { p_code: code, p_action: action, p_keys: part, p_value: value }), keys);
  return {
    manageCards: manage,
    setSuspended: (keys, value) => manage('suspend', keys, { value: !!value }),
    setFlag: (keys, value) => manage('flag', keys, { value }),
    setDeleted: (keys, value) => manage('delete', keys, { value: !!value }),
    setDueToday: (keys) => manage('due_today', keys),
    removeTag: (keys, tag) => manage('remove_tag', keys, { tag }),
  };
}
export function teacherManagementActions(token, convert) {
  return {
    async getManagementState(id) {
      try { return convert(await call(token, 'anki_test_teaching_teacher_state', { p_learner: id })); }
      catch (e) { if (missing(e)) throw new Error('请先运行13号SQL：13-Augie-Anki测试系统-教学卡片管理.sql，然后刷新本页。'); throw e; }
    },
    manageCards: (id, action, keys, value = {}) => batches((part) => call(token, 'anki_test_teaching_teacher_manage', { p_learner: id, p_action: action, p_keys: part, p_value: value }), keys),
  };
}
