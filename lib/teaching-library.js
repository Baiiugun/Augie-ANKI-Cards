import { COURSES, USES, SOURCE_TYPES, metadataOf, matches, canonical } from './library-rules.js';
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const e = escapeHtml;
const options = (xs, current, label) => `<option value="">${label}</option>${xs.map((x) => `<option ${x === current ? 'selected' : ''}>${e(x)}</option>`).join('')}`;
export function mountLibrary(root, { api, papers, learners = [], learner, onAssigned, onMetadata }) {
  const f = { course: '', use: '', sourceType: '', query: '' }, selected = new Map(), cache = new Map(), recipients = new Set(learner ? [learner.id] : []);
  let expanded = '', wordQuery = '', busy = false, notice = '';
  const getBank = async (id) => { if (!cache.has(id)) cache.set(id, await api.getBankCards([id])); return cache.get(id); };
  const key = (p, s) => `${p.paper_id}|${s.id}`;
  const groupRows = (p, s) => (cache.get(p.paper_id) || []).filter((c) => !s || c.section_id === s.id);
  const count = (p, s) => groupRows(p, s).filter((c) => selected.has(c.card_key)).length;
  async function toggleGroup(p, s, checked, visibleIds) {
    try {
      busy = true; render(); await getBank(p.paper_id);
      for (const c of groupRows(p, s).filter((c) => !visibleIds || visibleIds.has(c.section_id))) checked ? selected.set(c.card_key, c) : selected.delete(c.card_key);
    } catch (err) { alert(err.message); } finally { busy = false; render(); }
  }
  function render() {
    const shown = papers.map((p) => ({ p, sections: p.sections.filter((s) => matches(p, s, f)) })).filter((x) => x.sections.length);
    root.innerHTML = `<div class="card"><h2>${learner ? `给 ${e(learner.name)} 选词` : '教学词库 · 选词与布置'}</h2>
      <div class="row"><select id="lc" aria-label="适用课程">${options(COURSES, f.course, '全部课程')}</select><select id="lu" aria-label="词汇用途">${options(USES, f.use, '全部用途')}</select><select id="lt" aria-label="来源类型">${options(SOURCE_TYPES, f.sourceType, '全部来源')}</select>
        <input type="text" id="lq" value="${e(f.query)}" placeholder="搜索材料、篇章、标签" style="flex:1;min-width:220px"><button id="lsearch">搜索</button><button id="lclear">清空筛选</button></div>
      <p class="faint">先筛选课程和材料，再勾选整本、整篇或具体单词。各筛选条件同时满足；隐藏的已选词仍保留。</p>
      ${shown.map(({ p, sections }) => { const m = metadataOf(p), visibleIds = new Set(sections.map((s) => s.id)), visible = groupRows(p).filter((c) => visibleIds.has(c.section_id)); return `<div class="tree"><div class="p"><label><input type="checkbox" data-all="${e(p.paper_id)}" ${busy ? 'disabled' : ''} ${visible.length && visible.every((c) => selected.has(c.card_key)) ? 'checked' : ''}><span>${e(p.name)}${sections.length < p.sections.length ? `（当前筛选 ${sections.length} 篇）` : ''}</span></label><span class="chip">${e(p.bank)}</span><button data-meta="${e(p.paper_id)}">编辑分类</button></div>
        <div class="faint" style="padding:8px 12px">${e(m.courses.join('、') || '待分类')} · ${e(m.sourceType || '来源类型待补')} ${m.edition ? ' · ' + e(m.edition) : ''}</div>
        ${sections.map((s) => `<div class="s"><label><input type="checkbox" data-sec="${e(key(p, s))}" ${busy ? 'disabled' : ''} ${cache.has(p.paper_id) && count(p, s) === groupRows(p, s).length && groupRows(p, s).length ? 'checked' : ''}><span>${e(s.label || [s.board, s.piece].filter(Boolean).join(' · '))}</span></label><span class="faint">${s.count || 0} 词</span><span class="chip">${e(s.tags?.[0] || p.name)}</span><span class="chip">${e(s.tags?.[1] || s.board || s.label)}</span><button data-words="${e(key(p, s))}">查看并选词</button></div>
          ${expanded === key(p, s) ? `<div style="padding:12px"><input type="text" id="wq" value="${e(wordQuery)}" placeholder="在本篇搜索单词、释义或标签"><div id="word-rows"></div></div>` : ''}`).join('')}</div>`; }).join('') || '<p class="empty">没有符合条件的材料。可清空筛选，或到“导入词库”加入新材料。</p>'}
      <div class="row"><b id="selected-count">已选 ${selected.size} 个词</b><button id="unselect">清空已选</button><span class="faint">${busy ? '正在读取词库…' : ''}</span></div>
      ${learner ? '' : `<h3>布置给谁</h3><div class="row">${learners.filter((l) => l.kind === 'yuedu' && l.status !== 'paused').map((l) => `<label class="row"><input type="checkbox" data-recipient="${e(l.id)}" ${recipients.has(l.id) ? 'checked' : ''}>${e(l.name)}</label>`).join('') || '<span class="sub">请先在学生页新增学生。</span>'}</div>`}
      <p class="faint">本次只追加你选中的词。已有进度保留；今后新导入的词，需要你再次勾选并布置。</p><button class="pri" id="lib-assign" ${busy || !selected.size || !recipients.size ? 'disabled' : ''}>确认布置 ${selected.size} 词给 ${recipients.size} 名学生</button><div class="msg" id="lib-message" aria-live="polite">${e(notice)}</div></div>`;
    root.querySelector('#lc').onchange = (ev) => { f.course = ev.target.value; render(); };
    root.querySelector('#lu').onchange = (ev) => { f.use = ev.target.value; render(); };
    root.querySelector('#lt').onchange = (ev) => { f.sourceType = ev.target.value; render(); };
    const search = () => { f.query = root.querySelector('#lq').value.trim(); render(); };
    root.querySelector('#lsearch').onclick = search;
    root.querySelector('#lq').onkeydown = (ev) => { if (ev.key === 'Enter') search(); };
    root.querySelector('#lclear').onclick = () => { Object.assign(f, { course: '', use: '', sourceType: '', query: '' }); render(); };
    root.querySelector('#unselect').onclick = () => { selected.clear(); render(); };
    root.querySelectorAll('[data-recipient]').forEach((cb) => cb.onchange = () => { cb.checked ? recipients.add(cb.dataset.recipient) : recipients.delete(cb.dataset.recipient); render(); });
    root.querySelectorAll('[data-all]').forEach((cb) => {
      const p = papers.find((p) => p.paper_id === cb.dataset.all), visibleIds = new Set(shown.find((x) => x.p.paper_id === p.paper_id).sections.map((s) => s.id));
      const visible = groupRows(p).filter((c) => visibleIds.has(c.section_id)), n = visible.filter((c) => selected.has(c.card_key)).length;
      cb.indeterminate = n > 0 && n < visible.length;
      cb.onchange = () => toggleGroup(p, null, cb.checked, visibleIds);
    });
    root.querySelectorAll('[data-sec]').forEach((cb) => {
      const [pid, sid] = cb.dataset.sec.split('|'), p = papers.find((p) => p.paper_id === pid), s = p.sections.find((s) => s.id === sid);
      cb.indeterminate = count(p, s) > 0 && count(p, s) < groupRows(p, s).length; cb.onchange = () => toggleGroup(p, s, cb.checked);
    });
    root.querySelectorAll('[data-words]').forEach((b) => b.onclick = async () => {
      try { const [pid] = b.dataset.words.split('|'); await getBank(pid); expanded = expanded === b.dataset.words ? '' : b.dataset.words; wordQuery = ''; render(); } catch (err) { alert(err.message); }
    });
    root.querySelectorAll('[data-meta]').forEach((b) => b.onclick = () => editMetadata(papers.find((p) => p.paper_id === b.dataset.meta)));
    root.querySelector('#wq')?.addEventListener('input', (ev) => { wordQuery = ev.target.value; renderWords(); });
    renderWords();
    root.querySelector('#lib-assign').onclick = assign;
  }
  function renderWords() {
    const target = root.querySelector('#word-rows'); if (!target) return;
    const [pid, sid] = expanded.split('|'), p = papers.find((p) => p.paper_id === pid), s = p.sections.find((s) => s.id === sid);
    const words = groupRows(p, s).filter((c) => canonical([c.data.w, c.data.mean, ...(c.data.tags || [])].join(' ')).includes(canonical(wordQuery)));
    target.innerHTML = `<p class="faint">匹配 ${words.length} 词 <button id="w-all">选中匹配词</button> <button id="w-none">取消匹配词</button></p><div class="tbl-wrap" style="max-height:320px;overflow:auto"><table><thead><tr><th>选择</th><th>单词</th><th>释义</th><th>标签</th></tr></thead><tbody>${words.map((c) => `<tr><td><input aria-label="选择 ${e(c.data.w)}" type="checkbox" data-word="${e(c.card_key)}" ${selected.has(c.card_key) ? 'checked' : ''}></td><td>${e(c.data.w)}</td><td>${e(c.data.mean)}</td><td class="faint">${e((c.data.tags || []).join(' · '))}</td></tr>`).join('')}</tbody></table></div>`;
    target.querySelectorAll('[data-word]').forEach((cb) => cb.onchange = () => { const c = words.find((c) => c.card_key === cb.dataset.word); cb.checked ? selected.set(c.card_key, c) : selected.delete(c.card_key); render(); });
    target.querySelector('#w-all').onclick = () => { words.forEach((c) => selected.set(c.card_key, c)); render(); };
    target.querySelector('#w-none').onclick = () => { words.forEach((c) => selected.delete(c.card_key)); render(); };
  }
  async function assign() {
    root.inert = true;
    const selection = [...selected.values()], ids = [...recipients];
    const message = root.querySelector('#lib-message'), button = root.querySelector('#lib-assign'); button.disabled = true;
    const success = []; const failures = [];
    for (const id of ids) {
      const who = (learner ? [learner] : learners).find((l) => l.id === id);
      try { message.textContent = `正在给 ${who.name} 布置…`; const n = await api.assignSelection(id, selection); success.push(`${who.name}：新增 ${n} 词，已有进度继续保留`); }
      catch (err) { failures.push(`${who?.name || id}：${err.message}`); }
    }
    notice = [...success, ...failures.map((s) => '失败：' + s)].join('；'); message.textContent = notice; button.disabled = false; root.inert = false;
    if (!failures.length) { selected.clear(); await onAssigned?.(success.join('；')); if (!onAssigned) render(); }
  }
  function editMetadata(p) {
    const dlg = document.createElement('dialog'); dlg.style.cssText = 'max-width:560px;width:90%;border:1px solid #ddd;border-radius:14px;padding:22px;background:var(--card);color:var(--ink)';
    dlg.innerHTML = `<h2>编辑分类：${e(p.name)}</h2><p>适用课程（可多选）</p><div class="row">${COURSES.map((c) => `<label><input type="checkbox" name="course" value="${e(c)}" ${p.source?.courses?.includes(c) ? 'checked' : ''}> ${e(c)}</label>`).join('')}</div><p><label>来源类型 <select id="mt">${options(SOURCE_TYPES, p.source?.sourceType, '请选择')}</select></label></p><p><label>书籍版本／试卷补充说明 <input type="text" id="me" value="${e(p.source?.edition)}"></label></p><p class="err" id="merr"></p><button class="pri" id="ms">保存分类</button> <button id="mc">取消</button>`;
    document.body.append(dlg); dlg.showModal(); dlg.addEventListener('close', () => dlg.remove()); dlg.querySelector('#mc').onclick = () => dlg.close();
    dlg.querySelector('#ms').onclick = async () => {
      const courses = [...dlg.querySelectorAll('[name=course]:checked')].map((x) => x.value), sourceType = dlg.querySelector('#mt').value;
      if (!courses.length || !sourceType) { dlg.querySelector('#merr').textContent = '请至少选择一门课程并填写来源类型'; return; }
      try { const source = { ...p.source, courses, sourceType, edition: dlg.querySelector('#me').value.trim() }; await api.saveMetadata(p.paper_id, source); p.source = source; dlg.close(); render(); await onMetadata?.(); }
      catch (err) { dlg.querySelector('#merr').textContent = err.message; }
    };
  }
  render();
}
