import { SUPABASE_URL, ANON_KEY } from './config.js';
import { answer, buildQueue, nextCard, previewIntervals, formatDelay } from './map-scheduler.js';

const SCHEMA = 'echoo.map.vocab.v1';
let token = '', busy = false;
const $ = (id) => document.getElementById(id);
const say = (message) => { $('notice').textContent = message; };
const node = (tag, text, parent) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (parent) parent.append(result);
  return result;
};

async function api(path, { method = 'GET', body } = {}, auth = token || ANON_KEY) {
  const response = await fetch(SUPABASE_URL + path, {
    method, headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let value; try { value = text ? JSON.parse(text) : null; } catch { value = null; }
  if (!response.ok) { const error = new Error(value?.message || value?.error_description || ('请求失败 HTTP ' + response.status)); error.status = response.status; error.code = value?.code; throw error; }
  return value;
}
const rpc = (name, body) => api('/rest/v1/rpc/' + name, { method: 'POST', body });
async function all(path) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const batch = await api(path + (path.includes('?') ? '&' : '?') + 'offset=' + offset + '&limit=1000');
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}
async function run(action) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try { await action(); } catch (error) { say(error.message); }
  finally {
    busy = false;
    document.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    if ($('upload')) $('upload').disabled = !teacher.plan;
  }
}
function options(id, values, label = '全部') {
  const select = $(id), old = select.value;
  select.replaceChildren();
  const first = node('option', label, select); first.value = '';
  for (const [value, title] of values) { const option = node('option', title, select); option.value = value; }
  if ([...select.options].some((o) => o.value === old)) select.value = old;
}
export function wordMatches(card, filters = {}) {
  const data = card.data || card.d || {}, tiers = data.tiers || [], cefr = data.cefr || '';
  const match = (values, own) => !values?.length || values.some((v) => v === '__unmarked__' ? !own.length : own.includes(v));
  return match(filters.tiers, tiers) && match(filters.cefrs, cefr ? [cefr] : []) &&
    (!filters.query || (data.w + ' ' + data.mean).toLowerCase().includes(filters.query.toLowerCase()));
}
export function sourceSelection(cards, relationships, sectionIds, filters = {}) {
  const selected = new Set(sectionIds), byKey = new Map();
  for (const relation of relationships) {
    if (!selected.has(relation.section_id)) continue;
    if (!byKey.has(relation.card_key)) byKey.set(relation.card_key, new Set());
    byKey.get(relation.card_key).add(relation.section_id);
  }
  return cards.filter((c) => byKey.has(c.card_key) && wordMatches(c, filters))
    .map((card) => ({ card, sections: [...byKey.get(card.card_key)] }));
}
export function visibleStudentCards(cards, picks) {
  return cards.filter((card) => (card.d.source_sections || [card.sec])
    .some((section) => picks.has(card.paper + '|' + section)));
}
export class AssignmentSnapshot {
  // Executable reference model for one word in several assignment sources.
  constructor() { this.links = new Map(); this.progress = new Map(); }
  assign(source, keys) {
    const current = this.links.get(source) || new Set();
    for (const key of keys) {
      current.add(key);
      if (!this.progress.has(key)) this.progress.set(key, { reps: 0 });
    }
    this.links.set(source, current);
  }
  unassign(source) { this.links.delete(source); }
  visible() { return new Set([...this.links.values()].flatMap((set) => [...set])); }
}

const teacher = { plan: null, nonce: '', papers: [], cards: [], sources: [], selected: new Map() };
async function capability() {
  let result;
  try { result = await rpc('anki_test_map_capabilities', {}); }
  catch (error) { if (error.status !== 404 && error.code !== 'PGRST202') throw error; throw new Error('云端 MAP 尚未接入，请老师本人在原 Supabase 项目的 SQL Editor 运行 12 号 MAP 接入脚本；未上传任何词库或读音。'); }
  if (result?.schema !== SCHEMA || !result.assignment_snapshot) throw new Error('云端 MAP 协议不匹配。');
}
async function loadTeacher() {
  await capability();
  const [papers, learners] = await Promise.all([
    all('/rest/v1/anki_test_bank_papers?select=paper_id,name,sections,source&order=name'),
    all('/rest/v1/anki_test_learners?select=id,name,status,kind&kind=eq.yuedu&status=eq.active&order=name'),
  ]);
  teacher.papers = papers.filter((p) => p.source?.map_schema === SCHEMA);
  options('paper', teacher.papers.map((p) => [p.paper_id, p.name]), '请选择材料');
  options('learner', learners.map((l) => [l.id, l.name]), '请选择学生');
  await loadMaterial();
}
async function loadMaterial() {
  teacher.selected.clear();
  const id = $('paper').value;
  if (!id) {
    teacher.cards = []; teacher.sources = [];
  } else {
    [teacher.cards, teacher.sources] = await Promise.all([
      all('/rest/v1/anki_test_bank_cards?paper_id=eq.' + encodeURIComponent(id) + '&select=card_key,paper_id,section_id,ord,data&order=ord'),
      all('/rest/v1/anki_test_map_word_sources?paper_id=eq.' + encodeURIComponent(id) + '&select=section_id,card_key'),
    ]);
  }
  const p = teacher.papers.find((paper) => paper.paper_id === id);
  const sections = p?.sections || [];
  const distinct = (fn) => [...new Set(sections.map(fn).filter(Boolean))].map((x) => [String(x), String(x)]);
  options('grade', distinct((s) => s.metadata?.grade));
  options('domain', distinct((s) => s.board));
  options('difficulty', distinct((s) => s.metadata?.difficulty));
  options('section', sections.map((s) => [s.id, s.label]));
  renderWords();
  await assignments();
}
function activeSections() {
  const paper = teacher.papers.find((p) => p.paper_id === $('paper').value);
  return (paper?.sections || []).filter((s) =>
    (!$('grade').value || String(s.metadata?.grade) === $('grade').value) &&
    (!$('domain').value || s.board === $('domain').value) &&
    (!$('difficulty').value || s.metadata?.difficulty === $('difficulty').value) &&
    (!$('section').value || s.id === $('section').value)).map((s) => s.id);
}
function filteredWords() {
  const selectedValues = (id) => [...$(id).selectedOptions].map((x) => x.value).filter(Boolean);
  return sourceSelection(teacher.cards, teacher.sources, activeSections(), {
    tiers: selectedValues('tier'), cefrs: selectedValues('cefr'), query: $('query').value.trim(),
  });
}
function renderWords() {
  $('words').replaceChildren();
  for (const row of filteredWords()) {
    const tr = node('tr', undefined, $('words')), td = node('td', undefined, tr);
    const check = node('input', undefined, td); check.type = 'checkbox';
    check.checked = teacher.selected.has(row.card.card_key);
    check.onchange = () => {
      if (check.checked) teacher.selected.set(row.card.card_key, row.sections);
      else teacher.selected.delete(row.card.card_key);
      selectionCount();
    };
    node('td', row.card.data.w + ' · ' + row.card.data.pos, tr);
    node('td', row.card.data.mean, tr);
    node('td', row.card.data.cefr || '未标注', tr);
    node('td', row.sections.join('、'), tr);
  }
  selectionCount();
}
function selectionCount() { $('selection-count').textContent = ($('learner').value ? $('learner').selectedOptions[0].textContent : '请选择学生') + ' · 已选 ' + teacher.selected.size + ' 词'; }
async function assignments() {
  $('assignments').replaceChildren();
  if (!$('learner').value) return;
  const links = await all('/rest/v1/anki_test_map_assignment_words?learner_id=eq.' +
    encodeURIComponent($('learner').value) + '&select=paper_id,section_id,card_key');
  const groups = new Map();
  for (const link of links) {
    const key = link.paper_id + '|' + link.section_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(link);
  }
  for (const rows of groups.values()) {
    const item = rows[0], paper = teacher.papers.find((p) => p.paper_id === item.paper_id);
    const section = paper?.sections.find((s) => s.id === item.section_id);
    const line = node('p', (paper?.name || item.paper_id) + ' · ' + (section?.label || item.section_id) + ' · ' + rows.length + ' 词', $('assignments'));
    const button = node('button', '撤回本练习', line);
    button.onclick = () => run(async () => {
      if (!confirm('撤回这个学生的本练习布置？其他有效练习引用的共同词仍保留，学习进度保留。')) return;
      await rpc('anki_test_map_unassign', { p_learner: $('learner').value, p_paper: item.paper_id, p_sections: [item.section_id] });
      await assignments(); say('已撤回本练习，词库和历史进度保留。');
    });
  }
}
async function preparePackage(file) {
  for (const media of teacher.plan?.media || []) if (media.url?.startsWith('blob:')) URL.revokeObjectURL(media.url);
  teacher.plan = null; $('upload').disabled = true; $('preview').replaceChildren();
  if (!file) return;
  let plan;
  if (!teacher.nonce) {
    say('正在浏览器中解包并校验完整 MAP APKG…');
    const { prepareBrowserMap } = await import('../lib/map-browser-import.js');
    plan = await prepareBrowserMap(file);
  } else {
  const response = await fetch('/api/prepare', { method: 'POST', headers: {
    'X-MAP-Nonce': teacher.nonce, 'X-MAP-Filename': encodeURIComponent(file.name),
    'Content-Type': 'application/octet-stream',
  }, body: await file.arrayBuffer() });
  plan = await response.json();
  if (!response.ok) throw new Error(plan.error || '本机校验未通过');
  }
  teacher.plan = plan;
  node('p', plan.paper.name + '：' + plan.cards.length + ' 个唯一词条，' +
    plan.paper.sections.length + ' 个练习分组，' + plan.relationships.length + ' 条出处关系，' +
    plan.media.length + ' 个读音。', $('preview'));
  if (plan.paper.source.partial) node('p', '这是已完成范围的累计快照，未完成练习已在来源清单标明。', $('preview'));
  node('p', '上传只加入老师词库，不自动布置给学生。', $('preview'));
  say('本机校验通过。请核对后点击上传。');
}
async function upload() {
  const plan = teacher.plan;
  if (!plan) return;
  await capability();
  if (!confirm('上传 ' + plan.paper.name + ' 的 ' + plan.cards.length + ' 个唯一词条及出处？不会自动布置学生。')) return;
  for (let i = 0; i < plan.media.length; i++) {
    const media = plan.media[i], url = SUPABASE_URL + '/storage/v1/object/anki-test-media/yuedu/' + encodeURIComponent(media.name);
    say('核对读音 ' + (i + 1) + '/' + plan.media.length);
    const exists = await fetch(url, { method: 'HEAD', headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token } });
    if (exists.ok && Number(exists.headers.get('Content-Length')) === media.size) continue;
    const audio = await fetch(media.url); if (!audio.ok) throw new Error('本机预览已失效，请重新选择 APKG。');
    const response = await fetch(url, { method: 'POST', headers: { apikey: ANON_KEY,
      Authorization: 'Bearer ' + token, 'Content-Type': 'audio/mpeg', 'x-upsert': 'true' }, body: await audio.blob() });
    if (!response.ok) throw new Error('读音上传未完成，可重新选择原包后继续。');
  }
  say('正在事务内保存词条与来源…');
  const result = await rpc('anki_test_map_import', { p_paper: plan.paper, p_cards: plan.cards,
    p_sources: plan.relationships, p_fingerprint: plan.fingerprint });
  if (!result?.complete) throw new Error('云端未确认完成，请重新核对。');
  for (const media of plan.media) if (media.url?.startsWith('blob:')) URL.revokeObjectURL(media.url);
  teacher.plan = null;
  await loadTeacher();
  say('云端已确认词库导入完成；尚未给学生布置。');
}
async function initTeacher() {
  try {
    if (location.hostname === '127.0.0.1') {
      const response = await fetch('/api/bootstrap');
      if (response.ok) teacher.nonce = (await response.json()).nonce || '';
    }
  } catch { /* Published management page has no local preparation endpoint. */ }
  $('local-hint').textContent = teacher.nonce ? '本机只校验 APKG；密码与登录令牌直接交给原云端服务。' :
    '直接选择 MAP 特别版的 APKG。浏览器先校验 8 标签、PDF 页码、词卡和读音，核对后上传；导入与布置分开。';
  $('login-form').onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      const password = $('password').value; $('password').value = '';
      const session = await api('/auth/v1/token?grant_type=password', { method: 'POST',
        body: { email: $('email').value.trim(), password } }, ANON_KEY);
      token = session.access_token;
      await loadTeacher(); $('login').hidden = true; $('workspace').hidden = false;
      say('已登录。导入与布置分别确认。');
    });
  };
  $('package').onchange = () => run(() => preparePackage($('package').files[0]));
  $('upload').onclick = () => run(upload);
  $('paper').onchange = () => run(loadMaterial);
  $('learner').onchange = () => { selectionCount(); run(assignments); };
  $('reload').onclick = () => run(loadTeacher);
  for (const id of ['grade', 'domain', 'difficulty', 'section', 'tier', 'cefr', 'query']) $(id).oninput = () => {
    teacher.selected.clear(); renderWords();
  };
  $('select-all').onclick = () => { for (const row of filteredWords()) teacher.selected.set(row.card.card_key, row.sections); renderWords(); };
  $('select-none').onclick = () => { teacher.selected.clear(); renderWords(); };
  $('assign').onclick = () => run(async () => {
    if (!$('learner').value || !teacher.selected.size) throw new Error('请选择学生和词条。');
    if (!confirm('给 ' + $('learner').selectedOptions[0].textContent + ' 追加布置 ' + teacher.selected.size + ' 个词？已有进度继续保留。')) return;
    const selected = [...teacher.selected].flatMap(([key, sections]) => sections.map((section) =>
      ({ card_key: key, section_id: section })));
    const count = await rpc('anki_test_map_assign', { p_learner: $('learner').value,
      p_paper: $('paper').value, p_selection: selected });
    teacher.selected.clear(); renderWords(); await assignments();
    say('布置完成：新增 ' + count + ' 个学习状态，已有词的进度保留。');
  });
  $('logout').onclick = () => { token = ''; location.reload(); };
}

const student = { code: '', state: null, picks: new Set(), initialized: false, current: null,
  history: [], offset: 0, storageKey: '' };
const stateFields = (card) => Object.fromEntries(['type','queue','due','ivl','factor','reps','lapses','lft'].map((key) => [key, card[key]]));
function studentCards() {
  return (student.state?.cards || []).filter((r) => r[4]?.map_schema === SCHEMA).map((r) => ({ key: r[0], paper: r[1], sec: r[2], ord: r[3], d: r[4],
    type: r[5], queue: r[6], due: Number(r[7]), ivl: r[8], factor: r[9], reps: r[10], lapses: r[11], lft: r[12], suspended: !!r[13] }));
}
async function refreshStudent() {
  student.state = await rpc('anki_test_map_get_state', { p_code: student.code });
  student.offset = student.state.now_ms - Date.now();
  const valid = new Set();
  $('source-picks').replaceChildren();
  for (const paper of student.state.papers) for (const section of paper.sections.filter((s) => s.map)) {
    const key = paper.paper_id + '|' + section.id; valid.add(key);
    const label = node('label', undefined, $('source-picks')); label.className = 'source-choice';
    const input = node('input', undefined, label); input.type = 'checkbox';
    if (!student.initialized) student.picks.add(key);
    input.checked = student.picks.has(key);
    input.onchange = () => { input.checked ? student.picks.add(key) : student.picks.delete(key); showNext(); };
    node('span', paper.name + ' · ' + section.label, label);
  }
  student.picks = new Set([...student.picks].filter((key) => valid.has(key)));
  student.initialized = true;
  $('student-name').textContent = student.state.learner.name + ' · 选择练习后开始背词';
  renderMyWords();
}
function showNext() {
  const cards = visibleStudentCards(studentCards(), student.picks);
  const logs = student.state.today_log || [];
  const counts = { newDone: new Set(logs.filter((l) => l[1] === 0).map((l) => l[0])).size,
    revDone: new Set(logs.filter((l) => l[1] === 2).map((l) => l[0])).size };
  const now = Date.now() + student.offset;
  const queue = buildQueue(cards, now, counts, { newPerDay: student.state.learner.new_per_day ?? 20,
    revPerDay: student.state.learner.rev_per_day ?? 200 });
  student.current = nextCard(queue);
  $('answer').hidden = true; $('show-answer').hidden = false;
  const card = student.current;
  if (!card) {
    $('word').textContent = student.picks.size ? '当前范围今天已完成' : '请先勾选练习';
    $('word-meta').textContent = ''; $('card-source').textContent = '';
    $('audio').hidden = true; $('show-answer').hidden = true; $('suspend').hidden = true;
    return;
  }
  $('audio').hidden = !card.d.audio; $('suspend').hidden = false;
  $('word').textContent = card.d.w; $('word-meta').textContent = card.d.pos + '  ' + card.d.ipa;
  const paper = student.state.papers.find((p) => p.paper_id === card.paper);
  const sourceIds = card.d.source_sections || [card.sec];
  $('card-source').textContent = (paper?.name || '') + ' · ' + (paper?.sections || [])
    .filter((s) => sourceIds.includes(s.id)).map((s) => s.label).join('；');
  $('meaning').textContent = card.d.mean;
  $('example').textContent = card.d.en; $('translation').textContent = card.d.cn;
  $('grades').replaceChildren();
  const intervals = previewIntervals(card, now);
  ['重来','困难','良好','简单'].forEach((name, index) => {
    const button = node('button', name + ' · ' + formatDelay(intervals[index]), $('grades'));
    button.onclick = () => run(() => recordAnswer(index + 1));
  });
}
async function sendPending() {
  const saved = sessionStorage.getItem(student.storageKey);
  if (!saved) return;
  const pending = JSON.parse(saved);
  await rpc('anki_test_student_answer', { p_code: student.code, p_card_key: pending.key,
    p_state: pending.state, p_log: pending.log });
  sessionStorage.removeItem(student.storageKey);
  student.history.push({ kind: 'answer', key: pending.key, prev: pending.prev, uid: pending.log.uid });
  student.history = student.history.slice(-3);
}
async function recordAnswer(ease) {
  if (!student.current) return;
  if (sessionStorage.getItem(student.storageKey)) {
    await sendPending(); await refreshStudent(); showNext();
    say('已确认上一条待同步的答题记录，请继续。');
    return;
  }
  const card = student.current, result = answer(card, ease, Date.now() + student.offset);
  sessionStorage.setItem(student.storageKey, JSON.stringify({ key: card.key, prev: stateFields(card),
    state: stateFields(result.card), log: { ...result.log, uid: crypto.randomUUID() } }));
  try { await sendPending(); }
  catch { throw new Error('本次答题结果尚未确认，已保留同一记录编号。请点击刷新后继续，避免重复答题。'); }
  await refreshStudent(); showNext(); say('进度已保存。');
}
function renderMyWords() {
  $('my-words').replaceChildren();
  for (const card of studentCards()) {
    const line = node('p', card.d.w + ' · ' + card.d.mean + ' · 已复习 ' + card.reps + ' 次', $('my-words'));
    if (card.suspended) {
      const button = node('button', '恢复背诵', line);
      button.onclick = () => run(async () => {
        await rpc('anki_test_yuedu_set_suspended', { p_code: student.code, p_keys: [card.key], p_suspended: false });
        await refreshStudent(); showNext();
      });
    }
  }
}
async function initStudent() {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('k') || '';
  $('code').value = /^[A-Za-z0-9]{16}$/.test(fromLink) ? fromLink : '';
  $('student-form').onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      student.code = $('code').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{16}$/.test(student.code)) throw new Error('学习码应为 16 位字母或数字。');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(student.code));
      student.storageKey = 'map-answer-' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2,'0')).join('');
      await refreshStudent(); await sendPending(); await refreshStudent();
      $('login').hidden = true; $('study').hidden = false; showNext(); say('学习范围已载入。');
    });
  };
  $('start-study').onclick = () => { showNext(); };
  $('refresh-study').onclick = () => run(async () => { await sendPending(); await refreshStudent(); showNext(); say('已同步老师布置和学习进度。'); });
  $('show-answer').onclick = () => { if (student.current) { $('answer').hidden = false; $('show-answer').hidden = true; } };
  $('audio').onclick = () => {
    if (!student.current?.d.audio) return;
    new Audio(SUPABASE_URL + '/storage/v1/object/public/anki-test-media/yuedu/' +
      encodeURIComponent(student.current.d.audio)).play().catch(() => say('读音加载失败，请稍后重试。'));
  };
  $('suspend').onclick = () => run(async () => {
    const card = student.current; if (!card) return;
    await rpc('anki_test_yuedu_set_suspended', { p_code: student.code, p_keys: [card.key], p_suspended: true });
    student.history.push({ kind: 'suspend', key: card.key }); student.history = student.history.slice(-3);
    await refreshStudent(); showNext();
  });
  $('undo').onclick = () => run(async () => {
    const previous = student.history.at(-1); if (!previous) return;
    if (previous.kind === 'answer') await rpc('anki_test_student_undo', { p_code: student.code,
      p_card_key: previous.key, p_prev: previous.prev, p_uid: previous.uid });
    else await rpc('anki_test_yuedu_set_suspended', { p_code: student.code, p_keys: [previous.key], p_suspended: false });
    student.history.pop(); await refreshStudent(); showNext(); say('已撤销上一步。');
  });
}

if (typeof document !== 'undefined') {
  if (document.body.dataset.role === 'teacher') initTeacher().catch((error) => say(error.message));
  else initStudent().catch((error) => say(error.message));
}
