// Anki card-template renderer: {{Field}}, {{#F}}..{{/F}}, {{^F}}..{{/F}}, {{FrontSide}},
// filters (text, cloze, hint, furigana...), [sound:x] -> play buttons, media URL rewriting.
//
// Unsupported features fail explicitly; import and browser share this renderer.
import { formatHtml, plainText } from './card-format.js';

const EMPTY_RE = /^[\s​]*(<br\s*\/?>|<div>\s*<\/div>)?[\s​]*$/i;
export const isEmptyField = (s) => s == null || EMPTY_RE.test(s);

const stripHtml = (s) =>
  s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- template parsing ----------
function parseTemplate(src) {
  const re = /\{\{\s*([#^/!]?)\s*([^{}]*?)\s*\}\}/g;
  const root = { type: 'root', children: [] };
  const stack = [root];
  let last = 0, m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.children.push({ type: 'text', text: src.slice(last, m.index) });
    last = re.lastIndex;
    const [, sigil, body] = m;
    if (sigil === '!') continue;
    if (sigil === '#' || sigil === '^') {
      const node = { type: 'section', neg: sigil === '^', name: body, children: [] };
      top.children.push(node);
      stack.push(node);
    } else if (sigil === '/') {
      if (stack.length === 1 || stack[stack.length - 1].name !== body) throw new Error('原卡模板条件未正确闭合：' + body);
      stack.pop();
    } else {
      const parts = body.split(':');
      const name = parts.pop().trim();
      top.children.push({ type: 'field', name, filters: parts.map((p) => p.trim()).reverse() });
    }
  }
  if (last < src.length) stack[stack.length - 1].children.push({ type: 'text', text: src.slice(last) });
  if (stack.length !== 1) throw new Error('原卡模板条件未闭合：' + stack[stack.length - 1].name);
  return root;
}

// ---------- cloze ----------
// Parse "{{c1::text::hint}}" with nesting support. Returns rendered html.
function renderCloze(text, ord, question) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{{c', i);
    if (open < 0) { out += text.slice(i); break; }
    const head = /^\{\{c(\d+)::/.exec(text.slice(open));
    if (!head) { out += text.slice(i, open + 3); i = open + 3; continue; }
    out += text.slice(i, open);
    // find matching }}
    let depth = 1, j = open + head[0].length;
    while (j < text.length && depth > 0) {
      if (text.startsWith('{{', j)) { depth++; j += 2; }
      else if (text.startsWith('}}', j)) { depth--; j += 2; }
      else j++;
    }
    if (depth !== 0) { out += text.slice(open); break; } // unbalanced: leave as is
    const inner = text.slice(open + head[0].length, j - 2);
    // split hint at last top-level '::'
    let content = inner, hint = '';
    let d = 0, cut = -1;
    for (let k = 0; k < inner.length; k++) {
      if (inner.startsWith('{{', k)) { d++; k++; }
      else if (inner.startsWith('}}', k)) { d--; k++; }
      else if (d === 0 && inner.startsWith('::', k)) { cut = k; k++; }
    }
    if (cut >= 0) { content = inner.slice(0, cut); hint = inner.slice(cut + 2); }
    const n = Number(head[1]);
    if (n === ord) {
      out += question
        ? `<span class="cloze">[${hint ? hint : '...'}]</span>`
        : `<span class="cloze">${renderCloze(content, ord, question)}</span>`;
    } else {
      out += `<span class="cloze-inactive">${renderCloze(content, ord, question)}</span>`;
    }
    i = j;
  }
  return out;
}

// ---------- filters ----------
function applyFilter(filter, value, ctx, fieldName) {
  switch (filter) {
    case 'text': return stripHtml(value);
    case 'cloze': return renderCloze(value, ctx.clozeOrd, ctx.question);
    case 'hint':
      if (isEmptyField(value)) return '';
      return `<a class="hint hint-trigger" href="#">${escAttr(fieldName)}</a><span class="hint hint-value" style="display:none">${value}</span>`;
    case 'kanji': return value.replace(/ ?([^ >]+?)\[(.+?)\]/g, '$1').replace(/<\/?rt>|<\/?ruby>/g, '');
    case 'kana': return value.replace(/ ?([^ >]+?)\[(.+?)\]/g, '$2');
    case 'furigana': return value.replace(/ ?([^ >]+?)\[(.+?)\]/g, '<ruby><rb>$1</rb><rt>$2</rt></ruby>');
    case 'type': {
      const answer = plainText(value);
      return ctx.question
        ? `<input class="type-answer-input" type="text" data-type-field="${escAttr(fieldName)}" aria-label="输入答案" autocomplete="off" autocapitalize="off" spellcheck="false">`
        : `<span class="type-answer-result" data-type-field="${escAttr(fieldName)}" data-type-answer="${escAttr(answer)}">${escAttr(answer)}</span>`;
    }
    default:
      throw new Error('原卡模板暂不支持的过滤器：' + filter + '。不会省略该功能后继续导入。');
  }
}

function resolve(name, ctx) {
  switch (name) {
    case 'FrontSide': return ctx.frontSide ?? '';
    case 'Tags': return ctx.tags;
    case 'Deck': return ctx.deck;
    case 'Subdeck': return ctx.deck.split('::').pop();
    case 'Card': return ctx.cardName;
    case 'Type': return ctx.ntName;
    case 'CardFlag': return '';
    default: return ctx.fields[name];
  }
}

function renderNodes(nodes, ctx) {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') out += n.text;
    else if (n.type === 'field') {
      let v = resolve(n.name, ctx);
      if (v == null) throw new Error('原卡模板引用了不存在的字段：' + n.name);
      if (n.filters.includes('type') && n.filters.includes('cloze')) throw new Error('原卡的type:cloze组合尚未接入，不能显示错误的拼写答案后继续导入');
      if (n.name === 'FrontSide' && n.filters.length) throw new Error('原卡的FrontSide过滤器尚未接入，不能静默改变正反面内容');
      if (n.name === 'FrontSide') { out += v; continue; }
      for (const f of n.filters) v = applyFilter(f, v, ctx, n.name);
      out += v;
    } else if (n.type === 'section') {
      const has = !isEmptyField(resolve(n.name, ctx));
      if (n.neg ? !has : has) out += renderNodes(n.children, ctx);
    }
  }
  return out;
}

// ---------- media ----------
const SCHEME_RE = /^([a-z][a-z0-9+.-]*:|\/|#|\{)/i;

function lookupMedia(name, mediaMap) {
  if (!name || SCHEME_RE.test(name)) return null;
  let dec = name;
  try { dec = decodeURIComponent(name); } catch { /* keep */ }
  return mediaMap.get(dec) ?? mediaMap.get(name) ?? null;
}

export function rewriteMediaUrls(html, mediaMap) {
  return formatHtml(html, mediaMap, { rendered: true });
}

export function rewriteCssUrls(css, mediaMap) {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (all, q, url) => {
    const f = lookupMedia(url, mediaMap);
    return f ? `url("/media/${f}")` : all;
  });
}
export function preserveField(value, mediaMap) {
  return rewriteMediaUrls(String(value || '').replace(/\[sound:([^\]]+)\]/g, (raw, name) => {
    const stored = lookupMedia(name.trim(), mediaMap);
    if (!stored) throw new Error('原卡字段中的媒体缺失：' + name);
    return '[sound:' + stored + ']';
  }), mediaMap);
}

function convertSounds(html, side, mediaMap) {
  return html.replace(/\[sound:([^\]]+)\]/g, (all, name) => {
    const f = lookupMedia(name.trim(), mediaMap);
    if (!f) throw new Error('原卡音频文件缺失：' + name + '。不能省略音频后继续导入。');
    if (/\.(mp4|webm)$/i.test(f)) return `<video class="vid" data-side="${side}" controls playsinline preload="metadata" src="/media/${f}"></video>`;
    return `<a class="snd-btn replay-button soundLink" href="#" data-side="${side}" data-src="/media/${f}" aria-label="播放音频"><svg viewBox="0 0 64 64" width="32" height="32"><circle cx="32" cy="32" r="29" fill="#eeeeee"></circle><path d="M25 18 L49 32 L25 46 Z" fill="#555555"></path></svg></a>`;
  });
}

const audioList = (html, side) => {
  const out = [];
  const re = /<a class="snd-btn(?: [^"]*)?"[^>]*data-side="(q|a)"[^>]*data-src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) if (side === 'any' || m[1] === side) out.push(m[2]);
  return out;
};

// ---------- main entry ----------
const FRONT_TOKEN = '\u0000FRONT\u0000';

/**
 * @param nt   { name, kind (0 normal, 1 cloze), templates: [{name,qfmt,afmt}] }
 * @param card { ord }
 * @param fields  { FieldName: html }
 * @param extra   { tags: string, deck: string }
 * @param mediaMap Map<original name, stored filename>
 * @returns { front, back, frontAudio: string[], backAudio: string[] }
 */
export function renderCard(nt, card, fields, extra, mediaMap) {
  const isCloze = nt.kind === 1;
  const tmpl = nt.templates[isCloze ? 0 : card.ord];
  if (!tmpl) throw new Error('原卡模板序号不存在：' + card.ord);
  if (/\[latex\]|\[\$\$?\]|\\\(|\\\[|\[anki:tts/i.test(tmpl.qfmt + tmpl.afmt + Object.values(fields).join(''))) throw new Error('原卡包含暂不支持的LaTeX、MathJax或TTS，请先使用随包媒体；不会静默省略。');
  const base = {
    fields, tags: extra.tags ?? '', deck: extra.deck ?? '', cardName: tmpl.name, ntName: nt.name,
    clozeOrd: isCloze ? card.ord + 1 : 0,
  };
  const q = renderNodes(parseTemplate(tmpl.qfmt).children, { ...base, question: true });
  const a = renderNodes(parseTemplate(tmpl.afmt).children, { ...base, question: false, frontSide: FRONT_TOKEN });

  const frontHtml = rewriteMediaUrls(convertSounds(q, 'q', mediaMap), mediaMap);
  let backHtml = rewriteMediaUrls(convertSounds(a, 'a', mediaMap), mediaMap);
  backHtml = backHtml.split(FRONT_TOKEN).join(frontHtml);

  return {
    front: frontHtml,
    back: backHtml,
    frontAudio: audioList(frontHtml, 'q'),
    backAudio: audioList(backHtml, 'a'),
  };
}

// ---------- 字段原文 → 浏览器里显示/分组用的短文字（声音/图片/视频换成小图标） ----------
const FIELD_ENT = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" };
export const cleanField = (s) => (s || '')
  .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/\[sound:[^\]]*\]/g, ' 🔊 ').replace(/<img[^>]*>/gi, ' 🖼 ').replace(/<video[\s\S]*?<\/video>/gi, ' 🎞 ')
  .replace(/<br\s*\/?>|<\/(div|p|li|figure|tr)>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&#?\w+;/g, (m) => FIELD_ENT[m] ?? ' ')
  .replace(/\s+/g, ' ').trim().slice(0, 160);
