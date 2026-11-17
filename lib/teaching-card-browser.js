import { mountBrowser } from './browser.js';
import { mountOriginalCard } from './card-view.js';
import { mediaBase } from './config.js';
import { buildTeachingBrowserData, applyTeachingFieldEdits } from './teaching-card-data.js';
import { cleanField } from './render.js';

export function mountTeachingBrowser(root, { state, api, teacher = false, learnerId, onClose, onChange, beforeManage, startScope }) {
  const states = state.cards instanceof Map ? state.cards : new Map(state.cards.map((c) => [c.key, c]));
  const { packages, content, copies } = buildTeachingBrowserData(state.papers, states);
  if (!packages.length) { root.innerHTML = '<p>目前没有已布置的卡片。</p>'; return { refresh() {}, destroy() {} }; }
  const canManage = teacher || state.learner.self_manage === true;
  const send = async (action, keys, value = {}) => {
    await beforeManage?.();
    return teacher ? api.manageCards(learnerId, action, keys, value) : api.manageCards(action, keys, value);
  };
  const patch = (keys, change) => { for (const key of keys) { const c = states.get(key); if (c) change(c); } onChange?.(states); };
  const updateText = (key, data, notify = true) => {
    const c = states.get(key); c.d = data;
    for (const view of copies.get(key) || []) {
      view.r = [...data.presentation.source.fields]; view.v = view.r.map(cleanField);
      view.f = data.presentation.faces[0].front; view.b = data.presentation.faces[0].back;
      view.ed = Object.keys(data.field_edits || {}).length ? { ...data.field_edits } : undefined;
    }
    if (notify) onChange?.(states);
  };
  return mountBrowser(root, {
    packages, content, uniqueCards: true, learnerName: state.learner.name, copyAnkiId: false, startSlug: startScope && content[startScope] ? startScope : packages[0].slug,
    getStates: () => states, today: () => state.today, canManage, onClose,
    loadReview: () => Promise.resolve(state.review || []),
    preview(host, key, side) {
      const presentation = states.get(key)?.d.presentation;
      if (!presentation) { host.textContent = '本卡尚未回补原卡格式；卡片管理可用，原卡预览需先完成格式回补。'; return () => {}; }
      return mountOriginalCard(host, presentation, { side, mediaBase: mediaBase('yuedu') });
    },
    edit: teacher ? {
      async save(key, changes) {
        const d = states.get(key).d, original = d.original_presentation || d.presentation;
        const edits = { ...(d.field_edits || {}), ...changes };
        original.source.model.fields.forEach((name, i) => { if (edits[name] === original.source.fields[i]) delete edits[name]; });
        const next = applyTeachingFieldEdits(d, edits);
        await send('edit', [key], { fields: edits }); updateText(key, next);
      },
      async reset(key) {
        const next = applyTeachingFieldEdits(states.get(key).d, {});
        await send('reset_edit', [key]); updateText(key, next);
      },
    } : undefined,
    actions: {
      flag: async (keys, value) => { const n = await send('flag', keys, { value }); patch(keys, (c) => { c.flag = value; }); return n; },
      ...(canManage ? {
        suspend: async (keys, value) => { const n = await send('suspend', keys, { value }); patch(keys, (c) => { c.suspended = value; }); return n; },
        remove: async (keys, value) => { const n = await send('delete', keys, { value }); patch(keys, (c) => { c.deleted = value; }); return n; },
        dueToday: async (keys) => { const n = await send('due_today', keys); patch(keys, (c) => { if (c.type === 2 && c.queue === 2 && c.due > state.today) c.due = state.today; }); return n; },
        removeTag: async (keys, tag) => {
          const n = await send('remove_tag', keys, { tag });
          for (const key of keys) {
            const c = states.get(key), d = { ...c.d, tags: (c.d.tags || []).filter((t) => t !== tag) };
            if (d.presentation) updateText(key, applyTeachingFieldEdits(d), false); else c.d = d;
          }
          onChange?.(states); return n;
        },
      } : {}),
    },
  });
}
