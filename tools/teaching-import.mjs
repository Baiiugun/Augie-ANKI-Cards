import fs from 'node:fs';
import crypto from 'node:crypto';
import { readApkg } from './apkg.js';
import { prepareMapImport } from './map-import.mjs';
import { COURSES, SOURCE_TYPES, parseFilename, checkTags, tiersFromTags } from '../lib/library-rules.js';
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
export { readTeachingNote } from '../lib/teaching-note.js';
import { readTeachingNote } from '../lib/teaching-note.js';
import { makePresentation } from '../lib/card-presentation.js';
export async function prepareTeachingImport(file, filename, options, workDir) {
  const meta = { ...parseFilename(filename), ...options };
  // File identity always comes from the actual filename, never deck names or form overrides.
  Object.assign(meta, parseFilename(filename));
  const r = await readApkg(file, workDir + '/media', workDir);
  try {
    if (r.mapManifest || r.notes.some((n) => n.tags.includes('MAP协议::v1') && n.tags.some((t) => t.startsWith('MAP科目::')))) {
      return await prepareMapImport(r, filename, file, workDir + '/media', readTeachingNote);
    }
    if (!meta.courses?.length || meta.courses.some((c) => !COURSES.includes(c))) throw new Error('请选择有效的适用课程');
    if (!SOURCE_TYPES.includes(meta.sourceType)) throw new Error('请选择来源类型');
    if (meta.use !== '阅读词') throw new Error('本次先接入阅读词；写作词、听力词的训练方式尚未开通，请保留正确用途，待对应功能接入后再导入');
    if (!r.cards.length || !r.notes.length) throw new Error('包内没有卡片');
    if (r.revlog.length || r.cards.some((c) => c.sched.reps || c.sched.type || c.sched.queue > 0)) throw new Error('请导出不含学习进度的新词库包，不能把个人答题记录导入教学词库');
    const paperId = 'teach:' + hash(meta.material.normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, '') + '|' + (meta.edition || '') + '|' + meta.use).slice(0, 24);
    const sectionId = 'part:' + hash(meta.locator).slice(0, 20);
    const errors = [], cards = [], media = new Set(), guids = new Set(), warnings = new Set();
    const activeNotes = new Set(r.cards.map((c) => c.nid));
    for (const n of r.notes.filter((x) => activeNotes.has(x.id))) {
      const model = r.models.get(n.mid);
      const { sound, ...d } = readTeachingNote(n, model);
      d.presentation = makePresentation(n, model, r.cards.filter((c) => c.nid === n.id), r.mediaMap, r.decks);
      d.presentation.media.forEach((name) => media.add(name));
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
