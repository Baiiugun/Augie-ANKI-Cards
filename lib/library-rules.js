// Both the local APKG validator and the teacher page use this catalogue.
export const COURSES = ['高中英语', 'MAP 阅读和语言运用', '考研英语一', '考研英语二', 'CET-4', 'CET-6'];
export const USES = ['阅读词', '写作词', '听力词'];
export const SOURCE_TYPES = ['真题', '模拟卷', '教材／书籍', '自编专题'];
export const courseTag = (s) => `课程::${s === COURSES[1] ? 'MAP' : s}`;
export const canonical = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s_－—-]+/g, '');
export function parseFilename(filename) {
  if (String(filename).split('__').length !== 5 || /[\x00-\x1f]/.test(String(filename))) throw new Error('文件名须恰好包含五段，用双下划线 __ 分隔');
  const m = String(filename).match(/^([^\\/:*?"<>|]+?)__([^\\/:*?"<>|]+?)__(阅读词|写作词|听力词)__B(\d{3})__v(\d{2})\.apkg$/i);
  if (!m || +m[4] < 1 || +m[5] < 1) throw new Error('文件名应为：材料简称__篇章编号-标题__阅读词__B001__v01.apkg（批次、版本从 1 开始）');
  const [locator, ...title] = m[2].split('-');
  if (!locator.trim() || !m[1].trim()) throw new Error('文件名中的材料和篇章不能为空');
  return { material: m[1].trim(), locator: locator.trim(), title: title.join('-').trim(), use: m[3], batch: `B${m[4]}`, version: `v${m[5]}` };
}
export function requiredTags(meta) {
  return [...meta.courses.map(courseTag), `用途::${meta.use}`, `材料::${meta.material}`, `篇章::${meta.locator}`];
}
export function checkTags(tags, meta, supplement = false) {
  const out = [...new Set(tags)];
  const errors = [];
  for (const t of out.filter((t) => t.startsWith('课程::'))) if (!meta.courses.some((c) => canonical(courseTag(c)) === canonical(t))) errors.push(`原包含未选择的课程标签 ${t}，请核对课程选择`);
  for (const [prefix, value] of [['用途::', meta.use], ['材料::', meta.material], ['篇章::', meta.locator]]) {
    if (out.some((t) => t.startsWith(prefix) && canonical(t.slice(prefix.length)) !== canonical(value))) errors.push(`标签 ${prefix} 与本次分类冲突`);
  }
  for (const tag of requiredTags(meta)) {
    if (!out.some((t) => canonical(t) === canonical(tag))) {
      if (supplement) out.push(tag); else errors.push(`缺少标签 ${tag}`);
    }
  }
  return { tags: out, errors };
}
export function metadataOf(p) {
  return { courses: p.source?.courses || [], sourceType: p.source?.sourceType || '', material: p.name, use: p.bank || '阅读词', edition: p.source?.edition || '' };
}
export function matches(p, s, f = {}) {
  const m = metadataOf(p);
  if (f.course && !m.courses.includes(f.course)) return false;
  if (f.use && m.use !== f.use) return false;
  if (f.sourceType && m.sourceType !== f.sourceType) return false;
  const hay = canonical([p.name, ...m.courses, m.sourceType, m.edition, m.use, s?.label, s?.board, s?.piece, ...(s?.tags || [])].join(' '));
  return !f.query || canonical(f.query).split(/[，,]+/).filter(Boolean).every((q) => hay.includes(q));
}
// Incremental batches merge with existing cards and sections; a missing old card is never a deletion.
export function mergeImport(existing, oldCards, plan) {
  if (existing && existing.bank !== plan.paper.bank) throw new Error('同一材料不同训练用途应分别登记，不能覆盖已有用途');
  const incoming = new Map(plan.cards.map((c) => [c.card_key, c]));
  const old = new Map(oldCards.map((c) => [c.card_key, c]));
  const all = new Map(old);
  const changes = { added: 0, changed: 0, same: 0 };
  for (const c of incoming.values()) {
    const prev = old.get(c.card_key);
    if (prev && prev.section_id !== c.section_id) throw new Error('同一张卡的篇章编号发生变化，请先核对来源；不会自动移动旧卡');
    if (prev) c.ord = prev.ord;
    else c.ord = Math.max(-1, ...[...all.values()].map((x) => x.ord)) + 1;
    const same = prev && JSON.stringify(prev.data) === JSON.stringify(c.data);
    changes[!prev ? 'added' : same ? 'same' : 'changed']++;
    all.set(c.card_key, c);
  }
  const sections = new Map((existing?.sections || []).map((s) => [s.id, { ...s }]));
  for (const s of plan.paper.sections) sections.set(s.id, { ...sections.get(s.id), ...s });
  for (const s of sections.values()) s.count = [...all.values()].filter((c) => c.section_id === s.id).length;
  const imports = [...(existing?.source?.imports || []).filter((x) => !(x.file === plan.file && x.fingerprint === plan.fingerprint)), { file: plan.file, fingerprint: plan.fingerprint, at: new Date().toISOString() }];
  const paper = { ...existing, ...plan.paper, sections: [...sections.values()], source: { ...existing?.source, ...plan.paper.source, courses: [...new Set([...(existing?.source?.courses || []), ...(plan.paper.source.courses || [])])], imports } };
  return { paper, rows: [...incoming.values()].map((c) => ({ ...c, paper_id: paper.paper_id })), changes };
}
