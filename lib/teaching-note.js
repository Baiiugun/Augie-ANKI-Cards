// Shared by local Node import, MAP browser import, repair and future card adapters.
import { plainText as text, formatHtml, classFragment as grab, tableCells } from './card-format.js';
function legacyTableVocabulary(front, back) {
  const fr = tableCells(front), br = tableCells(back), f = fr.map(text), b = br.map(text);
  if (f.length !== 3 || b.length !== 6 || !f[0] || f[0].normalize('NFKC').toLowerCase() !== b[0].normalize('NFKC').toLowerCase() || !/^CEFR\s*[:：]/i.test(b[2])) return {};
  const pos = f[1], ipa = pos && b[1].toLowerCase().endsWith(' ' + pos.toLowerCase()) ? b[1].slice(0, -pos.length).trim() : b[1];
  return { w: f[0], mean: b[3], pos, ipa, cefr: b[2].replace(/^CEFR\s*[:：]\s*/i, ''), en: br[4], cn: br[5] };
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
    en: formatHtml(f.example || f.exampleen || grab(back, 'example-en') || table.en),
    cn: formatHtml(f.examplecn || grab(back, 'example-cn') || table.cn),
    audio: '', guid: note.guid,
    sound: (String(f.audio || front + '\n' + back).match(/\[sound:([^\]]+)\]/) || [])[1] || '',
  };
}
