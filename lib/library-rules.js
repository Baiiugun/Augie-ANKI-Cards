// Both the local APKG validator and the teacher page use this catalogue.
export const COURSES = ['高中英语', 'MAP 阅读和语言运用', '考研英语一', '考研英语二', 'CET-4', 'CET-6'];
export const USES = ['阅读词', '写作词', '听力词'];
export const SOURCE_TYPES = ['真题', '模拟卷', '教材／书籍', '自编专题'];
export const VOCAB_TIERS = ['A2', 'B1+'];
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const UNMARKED = '__unmarked__';
export const courseTag = (s) => `课程::${s === COURSES[1] ? 'MAP' : s}`;
export const canonical = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s_－—-]+/g, '');
export function normalizeTier(value) {
  const s = String(value || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  return s === 'A2' ? 'A2' : ['B1+', 'B1PLUS', 'B1P'].includes(s) ? 'B1+' : '';
}
export function tiersFromTags(tags = []) {
  return [...new Set(tags.filter((t) => /^(?:档位::|词库档位::|难度_)/.test(t)).map((t) => normalizeTier(t.replace(/^(?:档位::|词库档位::|难度_)/, ''))).filter(Boolean))];
}
export function wordCefr(card) {
  // A package's B1+ tier is never evidence for the CEFR of an individual word.
  const raw = String(card.data?.cefr ?? '').normalize('NFKC').replace(/^CEFR\s*[:：]\s*/i, '').trim();
  if (!raw || /^(?:未标注|未提供|无|N\/?A|unknown|none|null|[-—–])$/i.test(raw)) return '';
  return /^(?:[ABC][12])\+?$/i.test(raw) ? raw.toUpperCase() : raw;
}
export function wordTiers(card, paper, section) {
  const own = [...new Set([...(card.data?.tiers || []).map(normalizeTier), ...tiersFromTags(card.data?.tags)].filter(Boolean))];
  if (own.length || Array.isArray(card.data?.tiers)) return own;
  const s = section || paper?.sections?.find((x) => x.id === card.section_id);
  // Old yuedu sections had a single explicit level. New aggregate tiers do not
  // prove the membership of an otherwise unmarked individual word.
  const legacy = normalizeTier(s?.level);
  return legacy ? [legacy] : [];
}
export function matchesWord(card, paper, section, filters = {}) {
  const tiers = wordTiers(card, paper, section);
  return (!filters.tiers?.length || filters.tiers.some((t) => t === UNMARKED ? !tiers.length : tiers.includes(t))) &&
    (!filters.cefrs?.length || filters.cefrs.includes(wordCefr(card) || UNMARKED));
}
export function parseFilename(filename) {
  if (![5, 6].includes(String(filename).split('__').length) || /[\x00-\x1f]/.test(String(filename))) throw new Error('文件名使用五段；分档词库可在末尾加第六段 A2 或 B1+，各段用 __ 分隔');
  const m = String(filename).match(/^([^\\/:*?"<>|]+?)__([^\\/:*?"<>|]+?)__(阅读词|写作词|听力词)__B(\d{3})__v(\d{2})(?:__(A2|B1\+))?\.apkg$/i);
  if (!m || +m[4] < 1 || +m[5] < 1) throw new Error('文件名应为：材料简称__篇章标识__阅读词__B001__v01[__A2 或 __B1+].apkg（无档位可省略末段；批次、版本从 1 开始）');
  const [locator, ...title] = m[2].split('-');
  if (!locator.trim() || !m[1].trim()) throw new Error('文件名中的材料和篇章不能为空');
  return { material: m[1].trim(), locator: locator.trim(), title: title.join('-').trim(), use: m[3], batch: `B${m[4]}`, version: `v${m[5]}`, tier: normalizeTier(m[6]) };
}
export function requiredTags(meta) {
  return [...meta.courses.map(courseTag), `用途::${meta.use}`, `材料::${meta.material}`, `篇章::${meta.locator}`];
}
function courseOfTag(tag) {
  const value = canonical(String(tag).slice('课程::'.length));
  return COURSES.find((course) => canonical(course) === value || canonical(courseTag(course).slice('课程::'.length)) === value);
}
export function checkTags(tags, meta, supplement = false) {
  const out = [...new Set(tags)];
  const errors = [], warnings = [];
  if (meta.tier && tiersFromTags(out).some((tier) => tier !== meta.tier)) errors.push('原包档位标签与文件名中的 A2／B1+ 档位冲突');
  for (const t of out.filter((t) => t.startsWith('课程::'))) {
    const course = courseOfTag(t);
    if (course && !meta.courses.includes(course)) errors.push(`原包含未选择的课程标签 ${t}，请核对课程选择`);
    else if (!course) {
      if (supplement) warnings.push(`额外标签 ${t} 已保留；适用课程以本次勾选为准。`);
      else errors.push(`额外课程标签 ${t} 未列入系统课程；请核对并明确勾选“补齐本次分类标签”后保留。`);
    }
  }
  for (const [prefix, value] of [['用途::', meta.use], ['材料::', meta.material], ['篇章::', meta.locator]]) {
    if (out.some((t) => t.startsWith(prefix) && canonical(t.slice(prefix.length)) !== canonical(value))) errors.push(`标签 ${prefix} 与本次分类冲突`);
  }
  for (const tag of requiredTags(meta)) {
    const present = tag.startsWith('课程::') ? out.some((t) => t.startsWith('课程::') && courseOfTag(t) === courseOfTag(tag)) : out.some((t) => canonical(t) === canonical(tag));
    if (!present) {
      if (supplement) out.push(tag); else errors.push(`缺少标签 ${tag}`);
    }
  }
  return { tags: out, errors, warnings };
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
    const tiers = [...new Set([...(prev?.data?.tiers || []), ...(c.data?.tiers || [])])];
    if (tiers.length) c.data = { ...c.data, tiers };
    if (prev) c.ord = prev.ord;
    else c.ord = Math.max(-1, ...[...all.values()].map((x) => x.ord)) + 1;
    const same = prev && JSON.stringify(prev.data) === JSON.stringify(c.data);
    changes[!prev ? 'added' : same ? 'same' : 'changed']++;
    all.set(c.card_key, c);
  }
  const sections = new Map((existing?.sections || []).map((s) => [s.id, { ...s }]));
  for (const s of plan.paper.sections) {
    const previous = sections.get(s.id);
    sections.set(s.id, { ...previous, ...s, tiers: [...new Set([...(previous?.tiers || []), normalizeTier(previous?.level), ...(s.tiers || []), normalizeTier(s.level)].filter(Boolean))] });
  }
  for (const s of sections.values()) s.count = [...all.values()].filter((c) => c.section_id === s.id).length;
  const imports = [...(existing?.source?.imports || []).filter((x) => !(x.file === plan.file && x.fingerprint === plan.fingerprint)), { file: plan.file, fingerprint: plan.fingerprint, at: new Date().toISOString() }];
  const paper = { ...existing, ...plan.paper, sections: [...sections.values()], source: { ...existing?.source, ...plan.paper.source, courses: [...new Set([...(existing?.source?.courses || []), ...(plan.paper.source.courses || [])])], tiers: [...new Set([...(existing?.source?.tiers || []), ...(plan.paper.source.tiers || [])])], imports } };
  return { paper, rows: [...incoming.values()].map((c) => ({ ...c, paper_id: paper.paper_id })), changes };
}
