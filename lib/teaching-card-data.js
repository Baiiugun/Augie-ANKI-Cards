import { makePresentation } from './card-presentation.js';
import { readTeachingNote } from './teaching-note.js';
import { cleanField } from './render.js';

export function applyTeachingFieldEdits(data, edits = data.field_edits) {
  if (!data.presentation?.source) return data;
  const original = data.original_presentation || data.presentation, src = original.source;
  const tagsChanged = Array.isArray(data.tags) && JSON.stringify(data.tags) !== JSON.stringify(src.tags || []);
  if (!edits && !tagsChanged) return data;
  edits ||= {};
  for (const [name, value] of Object.entries(edits)) {
    if (!src.model.fields.includes(name) || typeof value !== 'string') throw new Error('卡片文字修改字段不符合原卡。');
  }
  const fields = src.model.fields.map((name, i) => name in edits ? edits[name] : src.fields[i]);
  const note = { fields, tags: data.tags || src.tags || [], guid: data.guid };
  const cards = original.faces.map((f, i) => ({ ord: f.ord, did: String(i) }));
  const decks = new Map(original.faces.map((f, i) => [String(i), f.deck || '']));
  const presentation = makePresentation(note, src.model, cards, new Map(original.bindings), decks);
  const { sound, audio, ...index } = readTeachingNote(note, src.model, { use: (src.tags || []).includes('用途::语法词') ? '语法词' : '阅读词' });
  return { ...data, ...index, audio: sound ? new Map(original.bindings).get(sound) || data.audio : data.audio, original_presentation: original, presentation, field_edits: { ...edits } };
}

export function buildTeachingBrowserData(papers, cards) {
  const rows = cards instanceof Map ? [...cards.values()] : cards;
  const packages = [], content = {}, copies = new Map();
  for (const p of papers) for (const sec of p.sections) {
    const selected = rows.filter((c) => c.paper === p.paper_id && (c.d.source_sections || [c.sec]).includes(sec.id));
    if (!selected.length) continue;
    const slug = p.paper_id + '|' + sec.id;
    packages.push({ slug, name: p.name + ' / ' + (sec.label || sec.id) });
    const ct = content[slug] = { models: [], cards: [] }, models = new Map();
    for (const c of selected) {
      const d = c.d, presentation = d.presentation, source = presentation?.source;
      const model = source ? { name: source.model.name, fields: [...source.model.fields], css: presentation.css, kind: source.model.kind || 0, tm: source.model.templates, tpl: source.model.templates.map((t) => t.name) } :
        { name: '旧词卡（原卡格式待回补）', fields: ['单词', '释义', '英文例句', '中文例句'], css: '', tpl: ['词卡'] };
      const identity = JSON.stringify(model);
      if (!models.has(identity)) { models.set(identity, ct.models.length); ct.models.push(model); }
      const fields = source ? [...source.fields] : [d.w || '', d.mean || '', d.en || '', d.cn || ''];
      const view = { k: c.key, m: models.get(identity), o: presentation?.faces[0]?.ord || 0, d: presentation?.faces[0]?.deck || p.name,
        f: presentation?.faces[0]?.front || '', b: presentation?.faces[0]?.back || '', g: [...(d.tags || [])], v: fields.map(cleanField) };
      if (source) { view.r = fields; view.r0 = [...(d.original_presentation || presentation).source.fields]; view.ed = Object.keys(d.field_edits || {}).length ? { ...d.field_edits } : undefined; }
      ct.cards.push(view);
      if (!copies.has(c.key)) copies.set(c.key, []);
      copies.get(c.key).push(view);
    }
  }
  return { packages, content, copies };
}
