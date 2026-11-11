import fs from 'node:fs';
import crypto from 'node:crypto';
import { readApkg } from './apkg.js';
import { COURSES, SOURCE_TYPES, parseFilename, checkTags, tiersFromTags } from '../lib/library-rules.js';
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
const text = (s) => String(s || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos|ndash|mdash|lsquo|rsquo);/gi, (raw, entity) => {
  if (entity.startsWith('#')) {
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;
  }
  return { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’' }[entity.toLowerCase()];
}).replace(/\s+/g, ' ').trim();
const grab = (html, cls) => {
  const source = String(html || '');
  // Scan opening tags only: matching an outer word-line div must not consume its word span.
  const re = /<([a-z][\w:-]*)\b[^>]*\bclass\s*=["']([^"']*)["'][^>]*>/gi;
  for (const m of source.matchAll(re)) if (m[2].split(/\s+/).includes(cls)) {
    const start = m.index + m[0].length;
    const tags = new RegExp('<\\/?' + m[1] + '\\b[^>]*>', 'gi');
    tags.lastIndex = start;
    let depth = 1;
    for (let tag = tags.exec(source); tag; tag = tags.exec(source)) {
      if (tag[0].startsWith('</')) depth--;
      else if (!/\/>$/.test(tag[0])) depth++;
      if (!depth) return source.slice(start, tag.index);
    }
  }
  return '';
};
function tableRows(html) {
  const rows = [];
  for (const row of String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length !== 1) return [];
    rows.push(text(cells[0][1]));
  }
  return rows;
}
function legacyTableVocabulary(front, back) {
  const f = tableRows(front), b = tableRows(back);
  // This is the established CEFR tool's Front/Back layout, not an arbitrary table.
  if (f.length !== 3 || b.length !== 6 || !f[0] ||
      f[0].normalize('NFKC').toLowerCase() !== b[0].normalize('NFKC').toLowerCase() ||
      !/^CEFR\s*[:：]/i.test(b[2])) return {};
  const pos = f[1];
  const ipa = pos && b[1].toLowerCase().endsWith(' ' + pos.toLowerCase()) ? b[1].slice(0, -pos.length).trim() : b[1];
  return { w: f[0], mean: b[3], pos, ipa, cefr: b[2].replace(/^CEFR\s*[:：]\s*/i, ''), en: b[4], cn: b[5] };
}
export function readTeachingNote(note, model) {
  const f = Object.fromEntries(model.fields.map((name, i) => [name.trim().toLowerCase(), note.fields[i]]));
  const front = f.front || '', back = f.back || '', table = legacyTableVocabulary(front, back);
  return {
    w: text(f.word || f.english || grab(front, 'word') || table.w),
    mean: text(f.meaning || f.mean || f.definition || grab(back, 'meaning') || table.mean),
    pos: text(f.pos || grab(front, 'pos') || grab(back, 'pos') || table.pos),
    ipa: text(f.ipa || grab(front, 'ipa') || table.ipa),
    cefr: text(f.cefr || grab(back, 'cefr') || table.cefr).replace(/^CEFR\s*[:：]\s*/i, ''),
    en: text(f.example || f.exampleen || grab(back, 'example-en') || table.en),
    cn: text(f.examplecn || grab(back, 'example-cn') || table.cn),
    audio: '', guid: note.guid,
    sound: (String(f.audio || front + '\n' + back).match(/\[sound:([^\]]+)\]/) || [])[1] || '',
  };
}
export async function prepareTeachingImport(file, filename, options, workDir) {
  const meta = { ...parseFilename(filename), ...options };
  // File identity always comes from the actual filename, never deck names or form overrides.
  Object.assign(meta, parseFilename(filename));
  if (!meta.courses?.length || meta.courses.some((c) => !COURSES.includes(c))) throw new Error('请选择有效的适用课程');
  if (!SOURCE_TYPES.includes(meta.sourceType)) throw new Error('请选择来源类型');
  if (meta.use !== '阅读词') throw new Error('本次先接入阅读词；写作词、听力词的训练方式尚未开通，请保留正确用途，待对应功能接入后再导入');
  const r = await readApkg(file, workDir + '/media', workDir);
  try {
    if (!r.cards.length || !r.notes.length) throw new Error('包内没有卡片');
    if (r.revlog.length || r.cards.some((c) => c.sched.reps || c.sched.type || c.sched.queue > 0)) throw new Error('请导出不含学习进度的新词库包，不能把个人答题记录导入教学词库');
    const paperId = 'teach:' + hash(meta.material.normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, '') + '|' + (meta.edition || '') + '|' + meta.use).slice(0, 24);
    const sectionId = 'part:' + hash(meta.locator).slice(0, 20);
    const errors = [], cards = [], media = new Set(), guids = new Set(), warnings = new Set();
    const activeNotes = new Set(r.cards.map((c) => c.nid));
    for (const n of r.notes.filter((x) => activeNotes.has(x.id))) {
      const model = r.models.get(n.mid);
      const { sound, ...d } = readTeachingNote(n, model);
      const result = checkTags(n.tags, meta, !!options.supplement);
      result.warnings.forEach((warning) => warnings.add(warning));
      if (!n.guid || guids.has(n.guid)) errors.push(`笔记 ${n.id}：缺少或重复的固定编号`);
      guids.add(n.guid);
      if (!d.w || !d.mean) errors.push(`笔记 ${n.id}：缺少单词或释义（支持 Word/Meaning 等字段或现有阅读词 Front/Back 模板）`);
      if (result.errors.length) errors.push(`${d.w || n.id}：${result.errors.join('；')}`);
      const snd = sound;
      if (snd) {
        d.audio = r.mediaMap.get(snd) || '';
        if (!d.audio) errors.push(`${d.w}：缺少音频 ${snd}`); else media.add(d.audio);
      }
      d.tags = result.tags;
      d.tiers = meta.tier ? [meta.tier] : tiersFromTags(n.tags);
      // File tiers describe a vocabulary selection, never fill or replace a missing word CEFR.
      if (meta.tier && !d.tags.includes(`档位::${meta.tier}`)) d.tags.push(`档位::${meta.tier}`);
      if (Buffer.byteLength(JSON.stringify(d)) > 19000) errors.push(`${d.w}：内容过长`);
      cards.push({ card_key: 'yd:' + hash(paperId + '|' + sectionId + '|' + n.guid).slice(0, 24), section_id: sectionId, ord: cards.length, data: d });
    }
    if (errors.length) { const e = new Error(`校验未通过（${errors.length} 项）：\n${errors.slice(0, 40).join('\n')}${errors.length > 40 ? '\n……请按同样规则检查其余卡片' : ''}`); e.validation = true; throw e; }
    const tiers = [...new Set(cards.flatMap((c) => c.data.tiers))];
    return {
      file: filename, fingerprint: hash(fs.readFileSync(file)), cards, media: [...media], warnings: [...warnings],
      paper: { paper_id: paperId, bank: meta.use, name: meta.material.replace(/-/g, ' '), sort: 0,
        sections: [{ id: sectionId, label: [meta.locator, meta.title].filter(Boolean).join(' · '), board: meta.locator, piece: meta.title, level: '', tiers, sort: 0, count: cards.length, tags: [meta.material.replace(/-/g, ' '), meta.locator] }],
        source: { schema: 1, courses: meta.courses, sourceType: meta.sourceType, edition: String(meta.edition || '').trim(), materialSlug: meta.material, filename, batch: meta.batch, version: meta.version, tiers, tagsSupplemented: !!options.supplement } },
    };
  } finally { r.cleanup(); }
}
