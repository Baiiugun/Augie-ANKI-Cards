// Shared by local Node import, MAP browser import, repair and future card adapters.
import { plainText as text, formatHtml, classFragment as grab, tableCells } from './card-format.js';
function legacyTableVocabulary(front, back) {
  const fr = tableCells(front), br = tableCells(back), f = fr.map(text), b = br.map(text);
  if (f.length !== 3 || b.length !== 6 || !f[0] || f[0].normalize('NFKC').toLowerCase() !== b[0].normalize('NFKC').toLowerCase() || !/^CEFR\s*[:：]/i.test(b[2])) return {};
  const pos = f[1], ipa = pos && b[1].toLowerCase().endsWith(' ' + pos.toLowerCase()) ? b[1].slice(0, -pos.length).trim() : b[1];
  return { w: f[0], mean: b[3], pos, ipa, cefr: b[2].replace(/^CEFR\s*[:：]\s*/i, ''), en: br[4], cn: br[5] };
}
export function readTeachingNote(note, model, options = {}) {
  const f = Object.fromEntries(model.fields.map((name, i) => [name.trim().toLowerCase(), note.fields[i]]));
  const front = f.front || '', back = f.back || '', table = legacyTableVocabulary(front, back);
  // Grammar adapters only supply index fields. Original fields/templates remain
  // untouched in presentation, including hints, base forms and highlighted text.
  const grammar = options.use === '语法词';
  const spellingWord = grammar && grab(front, 'chinese') && grab(back, 'english-word');
  const grammarWord = grammar ? grab(front, 'headword') || (spellingWord ? text(spellingWord).replace(/[（(]\s*原[形型]\s*[:：]\s*[^)）]+[)）]/gu, '').replace(/\s+,/g, ',').trim() : '') : '';
  return {
    w: text(f.word || f.english || grab(front, 'word') || table.w || grammarWord),
    mean: text(f.meaning || f.mean || f.definition || grab(back, 'meaning') || table.mean || (spellingWord ? grab(front, 'chinese') : '')),
    pos: text(f.pos || grab(front, 'pos') || grab(back, 'pos') || table.pos),
    ipa: text(f.ipa || grab(front, 'ipa') || table.ipa || (grammar ? grab(back, 'phon') : '')),
    cefr: text(f.cefr || grab(back, 'cefr') || table.cefr).replace(/^CEFR(?:\s*[:：]\s*|\s+)/i, ''),
    en: formatHtml(f.example || f.exampleen || grab(back, 'example-en') || table.en || (spellingWord ? grab(back, 'example') : '')),
    cn: formatHtml(f.examplecn || grab(back, 'example-cn') || table.cn || (grammar ? grab(back, 'example-zh') || (spellingWord ? grab(back, 'translation') : '') : '')),
    audio: '', guid: note.guid,
    sound: (String(f.audio || front + '\n' + back).match(/\[sound:([^\]]+)\]/) || [])[1] || '',
  };
}
