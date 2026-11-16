// A versioned, card-type-independent contract, kept with the same vocabulary/card ID.
import { FORMAT_SCHEMA, formatCss, formatHtml } from './card-format.js';
import { renderCard } from './render.js';
export function makePresentation(note, model, cards, mediaMap, decks = new Map()) {
  if (!model?.templates?.length) throw new Error('原卡缺少完整正反面模板，无法保证格式一致');
  const used = new Set(), tracking = { get(name) { const value = mediaMap.get(name); if (value) used.add(value); return value; } };
  const css = formatCss(model.css || '', tracking);
  const fields = Object.fromEntries(model.fields.map((name, i) => [name, note.fields[i] || '']));
  // Validate all fields too, including ones not displayed on this card's active branch.
  for (const value of Object.values(fields)) formatHtml(value.replace(/\{\{c\d+::/g, '{{c::'), tracking);
  const faces = cards.map((card) => {
    const extra = { tags: (note.tags || []).join(' '), deck: decks.get(card.did) || '' };
    const rendered = renderCard(model, card, fields, extra, tracking);
    return { ord: card.ord, deck: extra.deck, name: model.templates[model.kind === 1 ? 0 : card.ord].name, ...rendered };
  });
  if (!faces.length) throw new Error('原卡没有可显示的卡面');
  const source = { schema: FORMAT_SCHEMA, model: { name: model.name, kind: model.kind || 0, fields: [...model.fields], css: model.css || '', templates: structuredClone(model.templates) }, fields: [...note.fields], tags: [...(note.tags || [])] };
  return { source, css, faces, media: [...used], bindings: [...mediaMap].filter(([, name]) => used.has(name)) };
}
export function verifyPresentation(presentation) {
  if (presentation?.source?.schema !== FORMAT_SCHEMA || !presentation.faces?.length) throw new Error('原卡格式协议缺失或版本不受支持，请重新校验原APKG');
  const { model, fields } = presentation.source;
  if (!model?.templates?.length || model.fields.length !== fields?.length) throw new Error('原卡字段/模板不完整');
  const mediaMap = new Map(presentation.bindings), values = Object.fromEntries(model.fields.map((name, i) => [name, fields[i]]));
  if (formatCss(model.css, mediaMap) !== presentation.css) throw new Error('原卡样式与网页样式不一致，停止导入');
  for (const face of presentation.faces) {
    formatHtml(face.front, null, { rendered: true }); formatHtml(face.back, null, { rendered: true });
    const expected = renderCard(model, { ord: face.ord }, values, { tags: (presentation.source.tags || []).join(' '), deck: face.deck || '' }, mediaMap);
    for (const key of ['front', 'back', 'frontAudio', 'backAudio']) if (JSON.stringify(face[key]) !== JSON.stringify(expected[key])) throw new Error('原卡与网页卡面不一致：' + key + '，停止导入');
  }
  formatCss(presentation.css);
  return true;
}
export function verifyImportCards(cards) {
  for (const card of cards) {
    try { verifyPresentation(card.data?.presentation); }
    catch (error) { throw new Error((card.data?.w || card.card_key || '卡片') + '：' + error.message); }
    if (new TextEncoder().encode(JSON.stringify(card.data)).length > 19000) throw new Error('原卡内容超出云端单卡大小限制，未删减原卡，请先调整包结构');
  }
}
