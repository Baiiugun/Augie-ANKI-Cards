import fs from 'node:fs';
import crypto from 'node:crypto';
import { readApkg } from './apkg.js';
import { COURSES, SOURCE_TYPES, parseFilename, checkTags } from '../lib/library-rules.js';
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
const text = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const grab = (html, cls) => {
  const re = /<(div|span|p)\b[^>]*class=["']([^"']*)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of String(html || '').matchAll(re)) if (m[2].split(/\s+/).includes(cls)) return m[3];
  return '';
};
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
    const errors = [], cards = [], media = new Set(), guids = new Set();
    const activeNotes = new Set(r.cards.map((c) => c.nid));
    for (const n of r.notes.filter((x) => activeNotes.has(x.id))) {
      const model = r.models.get(n.mid);
      const f = Object.fromEntries(model.fields.map((name, i) => [name.toLowerCase(), n.fields[i]]));
      const front = f.front || '', back = f.back || '';
      const d = {
        w: text(f.word || f.english || grab(front, 'word')),
        mean: text(f.meaning || f.mean || f.definition || grab(back, 'meaning')),
        pos: text(f.pos || grab(front, 'pos') || grab(back, 'pos')),
        ipa: text(f.ipa || grab(front, 'ipa')),
        cefr: text(f.cefr || grab(back, 'cefr')).replace(/^CEFR[:：]\s*/i, ''),
        en: text(f.example || f.exampleen || grab(back, 'example-en')),
        cn: text(f.examplecn || grab(back, 'example-cn')),
        audio: '', guid: n.guid,
      };
      const result = checkTags(n.tags, meta, !!options.supplement);
      if (!n.guid || guids.has(n.guid)) errors.push(`笔记 ${n.id}：缺少或重复的固定编号`);
      guids.add(n.guid);
      if (!d.w || !d.mean) errors.push(`笔记 ${n.id}：缺少单词或释义（支持 Word/Meaning 等字段或现有阅读词 Front/Back 模板）`);
      if (result.errors.length) errors.push(`${d.w || n.id}：${result.errors.join('；')}`);
      const snd = (String(f.audio || front).match(/\[sound:([^\]]+)\]/) || [])[1];
      if (snd) {
        d.audio = r.mediaMap.get(snd) || '';
        if (!d.audio) errors.push(`${d.w}：缺少音频 ${snd}`); else media.add(d.audio);
      }
      d.tags = result.tags;
      if (Buffer.byteLength(JSON.stringify(d)) > 19000) errors.push(`${d.w}：内容过长`);
      cards.push({ card_key: 'yd:' + hash(paperId + '|' + sectionId + '|' + n.guid).slice(0, 24), section_id: sectionId, ord: cards.length, data: d });
    }
    if (errors.length) { const e = new Error(`校验未通过（${errors.length} 项）：\n${errors.slice(0, 40).join('\n')}${errors.length > 40 ? '\n……请按同样规则检查其余卡片' : ''}`); e.validation = true; throw e; }
    return {
      file: filename, fingerprint: hash(fs.readFileSync(file)), cards, media: [...media],
      paper: { paper_id: paperId, bank: meta.use, name: meta.material.replace(/-/g, ' '), sort: 0,
        sections: [{ id: sectionId, label: [meta.locator, meta.title].filter(Boolean).join(' · '), board: meta.locator, piece: meta.title, level: '', sort: 0, count: cards.length, tags: [meta.material.replace(/-/g, ' '), meta.locator] }],
        source: { schema: 1, courses: meta.courses, sourceType: meta.sourceType, edition: String(meta.edition || '').trim(), materialSlug: meta.material, filename, batch: meta.batch, version: meta.version, tagsSupplemented: !!options.supplement } },
    };
  } finally { r.cleanup(); }
}
