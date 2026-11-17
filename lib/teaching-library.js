import { COURSES, USES, SOURCE_TYPES, VOCAB_TIERS, CEFR_LEVELS, UNMARKED, metadataOf, matches, matchesWord, wordCefr, wordTiers, canonical } from './library-rules.js';
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const e = escapeHtml;
const options = (xs, current, label) => `<option value="">${label}</option>${xs.map((x) => `<option ${x === current ? 'selected' : ''}>${e(x)}</option>`).join('')}`;
export function mountLibrary(root, { api, papers, learners = [], learner, onAssigned, onMetadata }) {
  const f = { course: '', use: '', sourceType: '', query: '', tiers: [], cefrs: [] }, selected = new Map(), cache = new Map(), loading = new Map(), recipients = new Set(learner ? [learner.id] : []);
  let expanded = '', wordQuery = '', busy = false, notice = '', filterFailed = false;
  let activePaperId = '', resultPage = 0, expandedFolder = '';
  const pageSize = 10;
  const candidates = () => papers.filter((p) => p.sections.some((s) => matches(p, s, f)));
  const getBank = async (id) => {
    if (cache.has(id)) return cache.get(id);
    if (!loading.has(id)) loading.set(id, (api.getLibraryCards ? api.getLibraryCards([id]) : api.getBankCards([id])).then((rows) => { cache.set(id, rows); return rows; }).finally(() => loading.delete(id)));
    return loading.get(id);
  };
  // UNIFIED-TEACHING-LIBRARY-V1: preserve each selected Quiz provenance for shared cards.
  const isMap = (c) => c.data?.map_schema === 'echoo.map.vocab.v1';
  const origins = (c) => isMap(c) ? c.source_sections || [] : [c.section_id];
  const picked = (c) => selected.has(c.card_key) && (!isMap(c) || (c.selected_sections || origins(c)).every((sid) => selected.get(c.card_key).selected_sections?.includes(sid)));
  const addSelected = (c) => selected.set(c.card_key, isMap(c) ? { ...c, selected_sections: [...new Set([...(selected.get(c.card_key)?.selected_sections || []), ...(c.selected_sections || origins(c))])] } : c);
  const removeSelected = (c) => {
    const old = selected.get(c.card_key); if (!old) return;
    if (!isMap(c)) return selected.delete(c.card_key);
    const remaining = old.selected_sections.filter((sid) => !(c.selected_sections || origins(c)).includes(sid));
    if (remaining.length) selected.set(c.card_key, { ...old, selected_sections: remaining }); else selected.delete(c.card_key);
  };
  const key = (p, s) => `${p.paper_id}|${s.id}`;
  const hasWordFilters = () => f.tiers.length > 0 || f.cefrs.length > 0;
  const groupRows = (p, s) => (cache.get(p.paper_id) || []).filter((c) => (!s || origins(c).includes(s.id)) && matchesWord(c, p, s, f)).map((c) => isMap(c) ? { ...c, selected_sections: s ? [s.id] : origins(c) } : c);
  const scopeTiers = new Map();
  const scopeKey = (p, s) => `${p.paper_id}|${s?.id || '*'}`;
  function foldersOf(p, sections = p.sections) {
    const groups = new Map();
    sections.forEach((s) => { const board = s.board || s.id; if (!groups.has(board)) groups.set(board, []); groups.get(board).push(s); });
    return [...groups.entries()].map(([board, parts]) => parts.length > 1 ? { id: '@board:' + encodeURIComponent(board), label: board, sectionIds: parts.map((s) => s.id) } : parts[0]);
  }
  const scopeOf = (p, id) => p.sections.find((s) => s.id === id) || foldersOf(p).find((s) => s.id === id);
  const scopeIds = (p, s) => new Set(s && !s.sectionIds ? [s.id] : p.sections.filter((part) => (!s || s.sectionIds.includes(part.id)) && matches(p, part, f)).map((part) => part.id));
  const scopeRows = (p, s, tiers = scopeTiers.get(scopeKey(p, s))) => {
    const ids = scopeIds(p, s);
    return groupRows(p, s?.sectionIds ? null : s).filter((c) => origins(c).some((sid) => ids.has(sid)) && (!tiers?.length || tiers.some((tier) => wordTiers(c, p, s?.sectionIds ? null : s).includes(tier)))).map((c) => isMap(c) ? { ...c, selected_sections: origins(c).filter((sid) => ids.has(sid)) } : c);
  };
  function quickControls(p, s) {
    const id = scopeKey(p, s), tiers = scopeTiers.get(id) || [], label = s ? s.label || [s.board, s.piece].filter(Boolean).join(' · ') : '整套';
    return `<label class="quick-select"><input type="checkbox" data-quick-select="${e(id)}" aria-label="选择${s ? '篇章' : '整套'} ${e(p.name)}${s ? ' ' + e(label) : ''}" ${busy ? 'disabled' : ''}><span>${e(label)}</span></label>${['A2', 'B1+'].map((tier) => `<button class="quick-tier" data-quick-tier="${e(tier)}" data-scope="${e(id)}" aria-label="${e(p.name)} ${s ? e(label) : '整套'} ${e(tier)}" aria-pressed="${tiers.includes(tier)}" ${busy ? 'disabled' : ''}>${e(tier)}</button>`).join('')}`;
  }
  function rememberScope(p, s, tiers) {
    const ids = scopeIds(p, s);
    if (tiers?.length) scopeTiers.set(scopeKey(p, s), tiers); else scopeTiers.delete(scopeKey(p, s));
    if (s) {
      scopeTiers.delete(scopeKey(p, null));
      if (!s.sectionIds) foldersOf(p).filter((folder) => folder.sectionIds?.includes(s.id)).forEach((folder) => scopeTiers.delete(scopeKey(p, folder)));
    }
    if (!s || s.sectionIds) for (const part of [...p.sections, ...foldersOf(p).filter((folder) => folder.sectionIds)].filter((part) => part.sectionIds ? !s : ids.has(part.id))) {
      if (tiers?.length) scopeTiers.set(scopeKey(p, part), [...tiers]); else scopeTiers.delete(scopeKey(p, part));
    }
  }
  async function quickSelect(p, s, checked, tier) {
    if (busy) return;
    const id = scopeKey(p, s), previous = scopeTiers.get(id) || [];
    const tiers = tier ? previous.includes(tier) ? previous.filter((x) => x !== tier) : [...previous, tier] : previous;
    const select = tier ? tiers.length > 0 : checked;
    try {
      busy = true; render();
      if (select) await getBank(p.paper_id);
      const ids = scopeIds(p, s);
      for (const c of [...selected.values()]) if (c.paper_id === p.paper_id && (isMap(c) || ids.has(c.section_id))) removeSelected(isMap(c) ? { ...c, selected_sections: c.selected_sections.filter((sid) => ids.has(sid)) } : c);
      rememberScope(p, s, select ? tiers : []);
      const rows = select ? scopeRows(p, s, tiers) : [];
      rows.forEach(addSelected);
      filterFailed = false;
      notice = select ? rows.length ? `已选择 ${p.name}${s ? ' · ' + (s.label || s.board || '') : ' · 整套'}${tiers.length ? ' · ' + tiers.join('、') : ' · 全部版本'}：${rows.length} 词。` : `这个范围没有符合${tiers.length ? ' ' + tiers.join('、') : '当前筛选'}的词，未选择任何词。` : '';
    } catch (err) { notice = '选词读取失败：' + err.message + '。请重新勾选后再布置。'; filterFailed = true; }
    finally {
      busy = false; render();
      [...root.querySelectorAll(tier ? '[data-quick-tier]' : '[data-quick-select]')].find((b) => tier ? b.dataset.scope === id && b.dataset.quickTier === tier : b.dataset.quickSelect === id)?.focus({ preventScroll: true });
    }
  }
  const focusTitle = (id) => [...root.querySelectorAll('[data-open-paper]')].find((b) => b.dataset.openPaper === id)?.focus({ preventScroll: true });
  async function refreshFilters() {
    filterFailed = false;
    if (activePaperId && !candidates().some((p) => p.paper_id === activePaperId)) { activePaperId = ''; expanded = ''; expandedFolder = ''; }
    if (activePaperId && hasWordFilters()) {
      busy = true; render();
      try {
        await getBank(activePaperId);
      } catch (err) { notice = '筛选读取未完成：' + err.message + '。请重新筛选，或清空筛选后重试。'; filterFailed = true; }
      finally { busy = false; }
    }
    // A changed CEFR/tier must not silently send previously selected words of other levels.
    let removed = 0;
    for (const [id, c] of selected) {
      const p = papers.find((p) => p.paper_id === c.paper_id);
      if (!matchesWord(c, p, null, f)) { selected.delete(id); removed++; }
    }
    if (removed && !filterFailed) notice = `已取消 ${removed} 个不符合当前档位／CEFR 筛选的已选词。`;
    render();
  }
  async function openPaper(id) {
    if (busy) return;
    if (activePaperId === id) { activePaperId = ''; expanded = ''; expandedFolder = ''; wordQuery = ''; render(); focusTitle(id); return; }
    activePaperId = id; expanded = ''; expandedFolder = ''; wordQuery = ''; filterFailed = false; notice = '';
    busy = true; render();
    try { await getBank(id); }
    catch (err) { notice = '词库读取失败：' + err.message + '。请重新打开词库重试。'; filterFailed = true; }
    finally { busy = false; render(); focusTitle(id); }
  }
  function renderSection(p, s) {
    return `<div class="s">${quickControls(p, s)}<span class="faint">${hasWordFilters() && cache.has(p.paper_id) ? `符合 ${groupRows(p, s).length} / 共 ${s.count || 0}` : s.count || 0} 词</span><button data-words="${e(key(p, s))}" aria-expanded="${expanded === key(p, s)}" ${busy ? 'disabled' : ''}>${expanded === key(p, s) ? '收起单词' : '展开单词'}</button></div>
      ${expanded === key(p, s) ? `<div style="padding:12px"><input type="text" id="wq" value="${e(wordQuery)}" placeholder="在本篇搜索单词、释义或标签"><div id="word-rows"></div></div>` : ''}`;
  }
  function renderSections(p, sections) {
    return foldersOf(p, sections).map((part) => !part.sectionIds ? renderSection(p, part) : `<div class="scope-folder"><div class="s folder-heading">${quickControls(p, part)}<button data-folder="${e(key(p, part))}" aria-expanded="${expandedFolder === key(p, part)}" ${busy ? 'disabled' : ''}>${expandedFolder === key(p, part) ? '收起篇章' : '展开篇章'}</button></div>${expandedFolder === key(p, part) ? `<div class="folder-parts">${sections.filter((s) => part.sectionIds.includes(s.id)).map((s) => renderSection(p, s)).join('')}</div>` : ''}</div>`).join('');
  }
  function render() {
    const results = candidates(), pageCount = Math.max(1, Math.ceil(results.length / pageSize));
    resultPage = Math.min(resultPage, pageCount - 1);
    const pageResults = results.slice(resultPage * pageSize, (resultPage + 1) * pageSize);
    const active = results.find((p) => p.paper_id === activePaperId);
    const shown = active && !filterFailed ? [{ p: active, sections: active.sections.filter((s) => matches(active, s, f) && (!hasWordFilters() || groupRows(active, s).length > 0)) }].filter((x) => x.sections.length) : [];
    const eligible = learner ? [learner] : learners.filter((l) => l.kind === 'yuedu' && l.status !== 'paused');
    const recipientNames = eligible.filter((l) => recipients.has(l.id)).map((l) => l.name);
    const cefrChoices = [...new Set([...CEFR_LEVELS, ...[...cache.values()].flatMap((rows) => rows.map(wordCefr)).filter(Boolean), ...f.cefrs.filter((x) => x !== UNMARKED)])];
    root.innerHTML = `<div class="card"><h2>${learner ? `给 ${e(learner.name)} 选词` : '教学词库 · 选词与布置'}</h2>
      <div class="assignment-bar" aria-label="布置对象与确认">
        ${learner ? '' : `<fieldset class="recipient-picker"><legend>1. 布置给谁</legend><div class="row recipient-options">${eligible.map((l) => `<label class="row"><input type="checkbox" data-recipient="${e(l.id)}" ${recipients.has(l.id) ? 'checked' : ''}>${e(l.name)}</label>`).join('') || '<span class="sub">请先在学生页新增学生。</span>'}</div></fieldset>`}
        <div class="row"><b>布置给：</b><span id="recipient-summary" class="recipient-summary ${recipientNames.length ? '' : 'err'}">${recipientNames.length ? recipientNames.map(e).join('、') : '尚未选择学生'}</span><span class="sp"></span><b id="selected-count">已选 ${selected.size} 个词</b><button id="unselect" ${busy || !selected.size ? 'disabled' : ''}>清空已选</button><button class="pri" id="lib-assign" ${busy || filterFailed || !selected.size || !recipients.size ? 'disabled' : ''}>确认布置 ${selected.size} 词给 ${recipients.size} 名学生</button></div>
        <div class="faint">${busy ? '正在读取词库…' : '勾选下方材料、篇章或单词，再确认布置。已有进度保留。'}</div>
        <div class="msg" id="lib-message" role="status" aria-live="polite" ${notice ? '' : 'hidden'}>${e(notice)}</div>
      </div>
      ${learner ? '' : '<h3>2. 选择要布置的词</h3>'}
      <h3>查找词库</h3>
      <div class="row"><select id="lc" aria-label="适用课程">${options(COURSES, f.course, '全部课程')}</select><select id="lu" aria-label="词汇用途">${options(USES, f.use, '全部用途')}</select><select id="lt" aria-label="来源类型">${options(SOURCE_TYPES, f.sourceType, '全部来源')}</select>
        <input type="text" id="lq" value="${e(f.query)}" aria-label="搜索词库" placeholder="输入词库名、篇章或标签" style="flex:1;min-width:220px"><button id="lsearch">搜索词库</button><button id="lclear">清空筛选</button></div>
      <details class="word-filters" ${hasWordFilters() ? 'open' : ''}><summary>词库档位 / 单词 CEFR 筛选${hasWordFilters() ? '（已启用）' : '（不限，点击设置）'}</summary>
      <fieldset style="margin-top:12px"><legend>词库档位（可多选）</legend><div class="row">${[...VOCAB_TIERS, UNMARKED].map((x) => `<label><input type="checkbox" data-tier-filter="${e(x)}" ${f.tiers.includes(x) ? 'checked' : ''}> ${x === UNMARKED ? '未标档位' : e(x)}</label>`).join('')}</div></fieldset>
      <fieldset style="margin-top:10px"><legend>单词 CEFR（可多选）</legend><div class="row">${[...cefrChoices, UNMARKED].map((x) => `<label><input type="checkbox" data-cefr-filter="${e(x)}" ${f.cefrs.includes(x) ? 'checked' : ''}> ${x === UNMARKED ? '未标注' : e(x)}</label>`).join('')}</div></fieldset>
      <p class="faint">每组不勾选表示全部；同组多选满足任一项，各组同时满足。B1+ 是词库档位；单词的 B1、B2 等等级按原始 CEFR 筛选，未标注不会猜级。等级筛选用于当前打开词库中的词。整套／整篇勾选只选符合条件的词；切换等级会取消不符合的已选词。</p></details>
      <p class="faint">不用展开即可选词：勾“整套”选择全部版本；点 A2 或 B1+ 只选该版本，两项可同时选择。展开后的每个板块／篇章也一样。点标题只展开查看。</p>
      <div class="library-results" aria-label="词库标题列表">${pageResults.map((paper, i) => `<div class="library-result"><div class="library-heading"><label class="quick-select"><input type="checkbox" data-quick-select="${e(scopeKey(paper, null))}" aria-label="选择整套 ${e(paper.name)}" ${busy ? 'disabled' : ''}><span>整套</span></label><button class="library-title" id="library-title-${i}" data-open-paper="${e(paper.paper_id)}" aria-expanded="${paper.paper_id === activePaperId}" aria-controls="library-content-${i}" ${busy ? 'disabled' : ''}>${e(paper.name)}</button>${['A2', 'B1+'].map((tier) => `<button class="quick-tier" data-quick-tier="${e(tier)}" data-scope="${e(scopeKey(paper, null))}" aria-label="${e(paper.name)} 整套 ${e(tier)}" aria-pressed="${(scopeTiers.get(scopeKey(paper, null)) || []).includes(tier)}" ${busy ? 'disabled' : ''}>${e(tier)}</button>`).join('')}</div><div class="library-content" id="library-content-${i}" role="region" aria-labelledby="library-title-${i}" ${paper.paper_id === activePaperId ? '' : 'hidden'}>
      ${paper.paper_id === activePaperId ? shown.map(({ p, sections }) => { const m = metadataOf(p); return `<div class="tree"><div class="p"><span class="sp">整套${sections.length < p.sections.length ? `（当前筛选 ${sections.length} 篇）` : ''}</span><span class="chip">${e(p.bank)}</span><button data-meta="${e(p.paper_id)}">编辑分类</button></div>
        <div class="faint" style="padding:8px 12px">${e(m.courses.join('、') || (p.bank === '语法词' ? '跨课程' : '待分类'))} · ${e(m.sourceType || '来源类型待补')} ${p.source?.topic ? ' · ' + e(p.source.topic) : ''}${m.edition ? ' · ' + e(m.edition) : ''}</div>
        ${renderSections(p, sections)}</div>`; }).join('') || `<p class="empty">${busy ? '正在读取当前词库…' : filterFailed ? '读取未完成，请收起后重新打开词库。' : '当前词库没有符合筛选条件的篇章或单词。'}</p>` : ''}</div></div>`).join('') || '<p class="empty">没有符合条件的材料，请调整关键词或筛选条件。</p>'}</div>
      ${pageCount > 1 ? `<div class="row library-pagination"><button id="lib-prev" ${busy || !resultPage ? 'disabled' : ''}>上一页</button><span role="status">第 ${resultPage + 1} / ${pageCount} 页</span><button id="lib-next" ${busy || resultPage + 1 === pageCount ? 'disabled' : ''}>下一页</button></div>` : ''}
      <p class="faint">切换、收起词库或清空筛选会保留已选词，确认栏显示全部已选词数；“清空已选”可取消。今后新导入的词需再次选择布置。</p></div>`;
    const findLibraries = () => { activePaperId = ''; expanded = ''; expandedFolder = ''; resultPage = 0; return refreshFilters(); };
    root.querySelector('#lc').onchange = (ev) => { f.course = ev.target.value; return findLibraries(); };
    root.querySelector('#lu').onchange = (ev) => { f.use = ev.target.value; return findLibraries(); };
    root.querySelector('#lt').onchange = (ev) => { f.sourceType = ev.target.value; return findLibraries(); };
    const search = () => { f.query = root.querySelector('#lq').value.trim(); return findLibraries(); };
    root.querySelector('#lsearch').onclick = search;
    root.querySelector('#lq').onkeydown = (ev) => { if (ev.key === 'Enter') search(); };
    root.querySelector('#lclear').onclick = () => { Object.assign(f, { course: '', use: '', sourceType: '', query: '', tiers: [], cefrs: [] }); return findLibraries(); };
    root.querySelectorAll('[data-open-paper]').forEach((b) => b.onclick = () => openPaper(b.dataset.openPaper));
    root.querySelector('#lib-prev')?.addEventListener('click', () => { activePaperId = ''; expanded = ''; expandedFolder = ''; resultPage--; render(); });
    root.querySelector('#lib-next')?.addEventListener('click', () => { activePaperId = ''; expanded = ''; expandedFolder = ''; resultPage++; render(); });
    for (const [attribute, field] of [['data-tier-filter', 'tiers'], ['data-cefr-filter', 'cefrs']]) root.querySelectorAll(`[${attribute}]`).forEach((cb) => cb.onchange = () => {
      const value = cb.getAttribute(attribute);
      f[field] = cb.checked ? [...new Set([...f[field], value])] : f[field].filter((x) => x !== value);
      return refreshFilters();
    });
    root.querySelectorAll('#lc,#lu,#lt,#lq,#lsearch,#lclear,[data-tier-filter],[data-cefr-filter]').forEach((x) => { x.disabled = busy; });
    root.querySelector('#unselect').onclick = () => { selected.clear(); scopeTiers.clear(); render(); };
    root.querySelectorAll('[data-recipient]').forEach((cb) => cb.onchange = () => { cb.checked ? recipients.add(cb.dataset.recipient) : recipients.delete(cb.dataset.recipient); render(); });
    root.querySelectorAll('[data-quick-select]').forEach((cb) => {
      const [pid, sid] = cb.dataset.quickSelect.split('|'), p = papers.find((p) => p.paper_id === pid), s = scopeOf(p, sid);
      const rows = scopeRows(p, s), n = rows.filter(picked).length;
      cb.checked = rows.length > 0 && n === rows.length; cb.indeterminate = n > 0 && n < rows.length;
      cb.onchange = () => quickSelect(p, s, cb.checked);
    });
    root.querySelectorAll('[data-quick-tier]').forEach((b) => b.onclick = () => {
      const [pid, sid] = b.dataset.scope.split('|'), p = papers.find((p) => p.paper_id === pid), s = scopeOf(p, sid);
      return quickSelect(p, s, true, b.dataset.quickTier);
    });
    root.querySelectorAll('[data-folder]').forEach((b) => b.onclick = () => { expandedFolder = expandedFolder === b.dataset.folder ? '' : b.dataset.folder; expanded = ''; render(); });
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
    target.innerHTML = `<p class="faint">匹配 ${words.length} 词 <button id="w-all">选中匹配词</button> <button id="w-none">取消匹配词</button></p><div class="tbl-wrap" style="max-height:320px;overflow:auto"><table><thead><tr><th>选择</th><th>单词</th><th>释义</th><th>词库档位</th><th>CEFR</th><th>标签</th></tr></thead><tbody>${words.map((c) => `<tr><td><input aria-label="选择 ${e(c.data.w)}" type="checkbox" data-word="${e(c.card_key)}" ${picked(c) ? 'checked' : ''}></td><td>${e(c.data.w)}</td><td>${e(c.data.mean)}</td><td>${e(wordTiers(c, p, s).join('、') || '未标档位')}</td><td>${e(wordCefr(c) || '未标注')}</td><td class="faint">${e((c.data.tags || []).join(' · '))}</td></tr>`).join('')}</tbody></table></div>`;
    target.querySelectorAll('[data-word]').forEach((cb) => cb.onchange = () => { const c = words.find((c) => c.card_key === cb.dataset.word); cb.checked ? addSelected(c) : removeSelected(c); render(); });
    target.querySelector('#w-all').onclick = () => { words.forEach(addSelected); render(); };
    target.querySelector('#w-none').onclick = () => { words.forEach(removeSelected); render(); };
  }
  async function assign() {
    if (root.inert || busy || filterFailed || !selected.size || !recipients.size) return;
    root.inert = true;
    const selection = [...selected.values()], ids = [...recipients];
    const message = root.querySelector('#lib-message'), button = root.querySelector('#lib-assign'); button.disabled = true; message.hidden = false;
    const success = []; const failures = [];
    for (const id of ids) {
      const who = (learner ? [learner] : learners).find((l) => l.id === id);
      try { message.textContent = `正在给 ${who.name} 布置…`; const n = await api.assignSelection(id, selection); success.push(`${who.name}：新增 ${n} 词，已有进度继续保留`); }
      catch (err) { failures.push(`${who?.name || id}：${err.message}`); }
    }
    notice = [...success, ...failures.map((s) => '失败：' + s)].join('；'); root.inert = false;
    if (!failures.length) { selected.clear(); scopeTiers.clear(); }
    render();
    if (!failures.length) await onAssigned?.(success.join('；'));
  }
  function editMetadata(p) {
    const dlg = document.createElement('dialog'); dlg.style.cssText = 'max-width:560px;width:90%;border:1px solid #ddd;border-radius:14px;padding:22px;background:var(--card);color:var(--ink)';
    dlg.innerHTML = `<h2>编辑分类：${e(p.name)}</h2><p>适用课程（可多选）</p><div class="row">${COURSES.map((c) => `<label><input type="checkbox" name="course" value="${e(c)}" ${p.source?.courses?.includes(c) ? 'checked' : ''}> ${e(c)}</label>`).join('')}</div><p><label>来源类型 <select id="mt">${options(SOURCE_TYPES, p.source?.sourceType, '请选择')}</select></label></p><p><label>书籍版本／试卷补充说明 <input type="text" id="me" value="${e(p.source?.edition)}"></label></p><p class="err" id="merr"></p><button class="pri" id="ms">保存分类</button> <button id="mc">取消</button>`;
    document.body.append(dlg); dlg.showModal(); dlg.addEventListener('close', () => dlg.remove()); dlg.querySelector('#mc').onclick = () => dlg.close();
    dlg.querySelector('#ms').onclick = async () => {
      const courses = [...dlg.querySelectorAll('[name=course]:checked')].map((x) => x.value), sourceType = dlg.querySelector('#mt').value;
      if ((!courses.length && p.bank !== '语法词') || !sourceType) { dlg.querySelector('#merr').textContent = p.bank === '语法词' ? '请填写来源类型，语法词可以不选课程' : '请至少选择一门课程并填写来源类型'; return; }
      try { const source = { ...p.source, courses, sourceType, edition: dlg.querySelector('#me').value.trim() }; await api.saveMetadata(p.paper_id, source); p.source = source; dlg.close(); await refreshFilters(); await onMetadata?.(); }
      catch (err) { dlg.querySelector('#merr').textContent = err.message; }
    };
  }
  render();
}
