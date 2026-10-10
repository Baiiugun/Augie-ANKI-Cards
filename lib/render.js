// Anki card-template renderer: {{Field}}, {{#F}}..{{/F}}, {{^F}}..{{/F}}, {{FrontSide}},
// filters (text, cloze, hint, furigana...), [sound:x] -> play buttons, media URL rewriting.
//
// Not supported (rendered as nothing / plain text): {{type:..}} input, {{tts ..}}, LaTeX.

const EMPTY_RE = /^[\s​]*(<br\s*\/?>|<div>\s*<\/div>)?[\s​]*$/i;
export const isEmptyField = (s) => s == null || EMPTY_RE.test(s);

const stripHtml = (s) =>
  s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

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
      if (stack.length > 1) stack.pop(); // tolerate mismatches
    } else {
      const parts = body.split(':');
      const name = parts.pop().trim();
      top.children.push({ type: 'field', name, filters: parts.map((p) => p.trim()).reverse() });
    }
  }
  if (last < src.length) stack[stack.length - 1].children.push({ type: 'text', text: src.slice(last) });
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
      return `<a class="hint" href="#" onclick="this.style.display='none';this.nextElementSibling.style.display='inline';return false;">${escAttr(fieldName)}</a>` +
        `<span class="hint" style="display:none">${value}</span>`;
    case 'kanji': return value.replace(/ ?([^ >]+?)\[(.+?)\]/g, '$1').replace(/<\/?rt>|<\/?ruby>/g, '');
    case 'kana': return value.replace(/ ?([^ >]+?)\[(.+?)\]/g, '$2');
    case 'furigana': return value.replace(/ ?([^ >]+?)\[(.+?)\]/g, '<ruby><rb>$1</rb><rt>$2</rt></ruby>');
    case 'type': return ctx.question ? '' : value; // type-in not supported: show the answer on the back only
    default:
      if (filter.startsWith('tts')) return '';
      return value;
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
      if (v == null) { out += `<span class="missing-field">{unknown field ${escAttr(n.name)}}</span>`; continue; }
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
  // <img|audio|video|source|embed ... src="x">
  html = html.replace(/(<(?:img|audio|video|source|embed)\b[^>]*?\ssrc\s*=\s*)(["']?)([^"'\s>]+)\2/gi,
    (all, pre, q, url) => {
      const f = lookupMedia(url, mediaMap);
      return f ? `${pre}"/media/${f}"` : all;
    });
  return html;
}

export function rewriteCssUrls(css, mediaMap) {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (all, q, url) => {
    const f = lookupMedia(url, mediaMap);
    return f ? `url("/media/${f}")` : all;
  });
}

function convertSounds(html, side, mediaMap) {
  return html.replace(/\[sound:([^\]]+)\]/g, (all, name) => {
    const f = lookupMedia(name.trim(), mediaMap);
    if (!f) return '';
    return `<a class="snd-btn" href="#" data-side="${side}" data-src="/media/${f}">&#9654;</a>`;
  });
}

const audioList = (html, side) => {
  const out = [];
  const re = /<a class="snd-btn"[^>]*data-side="(q|a)"[^>]*data-src="([^"]+)"/g;
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
  const tmpl = nt.templates[isCloze ? 0 : card.ord] ?? nt.templates[0];
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
