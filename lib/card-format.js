// Lossless supported HTML/CSS. Unsupported content fails import; never silently strip it.
import { parseFragment, serialize, parse, walk, generate } from '../vendor/card-format-deps.js';
export const FORMAT_SCHEMA = 'anki-card-format-v1';
const fail = (what) => { throw new Error('原卡格式暂不支持：' + what + '。本包未通过格式校验，请保留原卡，不会自动删掉内容后继续导入。'); };
const tags = new Set('a abbr b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure font h1 h2 h3 h4 h5 h6 hr i img ins kbd label li mark ol p pre q rb rp rt rtc ruby s samp section small source span strike strong sub summary sup table tbody td tfoot th thead tr u ul var wbr audio video input svg path circle rect line polyline polygon ellipse g title'.split(' '));
const attrs = new Set('class id style title lang dir align valign width height border cellpadding cellspacing colspan rowspan color face size src href alt poster controls playsinline preload loop muted autoplay type value placeholder autocomplete autocapitalize spellcheck aria-label role viewbox d fill stroke stroke-width cx cy r rx ry x y x1 x2 y1 y2 points xmlns'.split(' '));
const decodeName = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
export function mappedMedia(url, mediaMap) {
  if (/^\/media\/[a-zA-Z0-9_.-]+$/.test(url)) return url;
  if (/^data:(image\/(png|jpeg|gif|webp)|audio\/[\w.+-]+);base64,[a-z\d+/=\s]+$/i.test(url)) return url;
  const value = mediaMap?.get(decodeName(url)) ?? mediaMap?.get(url);
  if (!value || !/^[a-zA-Z0-9_.-]+$/.test(value)) fail('媒体文件缺失或为外部资源：' + url);
  return '/media/' + value;
}
export function formatCss(css = '', mediaMap, context = 'stylesheet') {
  let ast;
  try { ast = parse(String(css), { context, parseCustomProperty: true, onParseError: (e) => { throw e; } }); }
  catch { fail('无法完整解析的CSS样式'); }
  walk(ast, (n) => {
    if (n.type === 'Atrule' && ['import', 'namespace', 'document'].includes(n.name.toLowerCase())) fail('外部或页面级CSS @' + n.name);
    if (n.type === 'Declaration' && ['behavior', '-moz-binding'].includes(n.property.toLowerCase())) fail('脚本样式');
    if (n.type === 'Function' && n.name.toLowerCase() === 'expression') fail('脚本样式');
    if (n.type === 'Url') n.value = mappedMedia(n.value, mediaMap);
    if (n.type === 'Raw') fail('无法完整核对的CSS语法');
  });
  return generate(ast);
}
export function formatHtml(html = '', mediaMap, { rendered = false } = {}) {
  const tree = parseFragment(String(html));
  function visit(node) {
    if (node.tagName) {
      const tag = node.tagName.toLowerCase();
      if (!tags.has(tag)) fail('HTML标签 <' + tag + '>');
      for (const attr of node.attrs || []) {
        const name = attr.name.toLowerCase();
        if (!attrs.has(name) && !name.startsWith('aria-') && !(rendered && name.startsWith('data-'))) fail('HTML属性 ' + name);
        if (name === 'style') attr.value = formatCss(attr.value, mediaMap, 'declarationList');
        if (['src', 'poster'].includes(name)) attr.value = mappedMedia(attr.value, mediaMap);
        if (name === 'href' && attr.value !== '#' && !/^https?:\/\//i.test(attr.value)) fail('非网页链接 ' + attr.value);
        if (tag === 'input' && name === 'type' && !/^(text|search)$/i.test(attr.value)) fail('输入框类型 ' + attr.value);
      }
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(tree);
  return serialize(tree);
}
export function plainText(html = '') {
  const tree = parseFragment(String(html));
  const read = (n) => n.nodeName === '#text' ? n.value : (['script', 'style'].includes(n.tagName) ? '' : (n.childNodes || []).map(read).join('') + (/^(br|div|p|li|tr)$/.test(n.tagName) ? ' ' : ''));
  return read(tree).replace(/\s+/g, ' ').trim();
}
export function classFragment(html, cls) {
  const tree = parseFragment(String(html || ''));
  const find = (n) => (n.attrs?.some((a) => a.name === 'class' && a.value.split(/\s+/).includes(cls)) ? n : (n.childNodes || []).map(find).find(Boolean));
  const node = find(tree); return node ? serialize(node) : '';
}
export function tableCells(html) {
  const tree = parseFragment(String(html || '')), rows = [];
  const visit = (n) => { if (n.tagName === 'tr') { const cells = (n.childNodes || []).filter((c) => c.tagName === 'td'); rows.push(cells.length === 1 ? serialize(cells[0]) : null); } else (n.childNodes || []).forEach(visit); };
  visit(tree); return rows.every((r) => r !== null) ? rows : [];
}
