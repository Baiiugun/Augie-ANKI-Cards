// 卡片浏览器（对应 Anki 的 Browse）：按包、按状态筛选，搜索文字，勾选后“放出 / 挂起 / 设为今天复习”。
// 学生页和老师页共用。不直接联网：所有改动通过 opts.actions 交给调用方去做。
import { CRT } from './anki-sched.js';

const ENT = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#9654;': '' };
const plain = (h) => (h || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<a class="snd-btn"[^>]*>[^<]*<\/a>/g, '')
  .replace(/<video[\s\S]*?<\/video>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&#?\w+;/g, (m) => ENT[m] ?? ' ').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dateOfDay = (d) => new Date((CRT + d * 86400) * 1000).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

const CSS = `
.kb{font-size:14px;color:var(--ink,#222)}
.kb .bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0}
.kb select,.kb input[type=search]{font:inherit;padding:7px 9px;border:1px solid var(--line,#ddd);border-radius:8px;background:var(--card,#fff);color:inherit}
.kb input[type=search]{flex:1;min-width:120px}
.kb .chip{border:1px solid var(--line,#ddd);background:var(--card,#fff);color:inherit;border-radius:16px;padding:5px 11px;cursor:pointer;font:inherit}
.kb .chip.on{background:var(--blue,var(--new,#1e6fff));color:#fff;border-color:transparent}
.kb .list{border:1px solid var(--line,#ddd);border-radius:10px;background:var(--card,#fff);max-height:50vh;overflow:auto}
.kb .r{display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--line,#eee)}
.kb .r:last-child{border-bottom:0}
.kb .r .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kb .r .t b{font-weight:600}.kb .r .t span{color:var(--mute,#888)}
.kb .st{font-size:12px;color:var(--mute,#888);white-space:nowrap}
.kb .st.sus{color:#fff;background:#8a8f98;border-radius:6px;padding:1px 6px}
.kb .act{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;align-items:center}
.kb button.b{font:inherit;border:0;border-radius:8px;padding:8px 12px;background:var(--blue,var(--new,#1e6fff));color:#fff;font-weight:600;cursor:pointer}
.kb button.b.g{background:transparent;color:var(--blue,var(--new,#1e6fff));border:1px solid var(--line,#ddd)}
.kb button.b:disabled{opacity:.35;cursor:default}
.kb .msg{color:var(--mute,#888);font-size:13px}
`;

export function mountBrowser(el, opts) {
  const { packages, content, getStates, today, canManage, actions, onClose } = opts;
  let slug = opts.startSlug || packages[0].slug, filter = 'all', q = '', limit = 150;
  const sel = new Set();
  const cache = {};
  // 每个包的文字：去掉“所有卡片共有的开头”（比如每张卡正面都是同一段提示语），只留有区别的部分，列表里才看得出是哪张卡
  const cpl = (arr) => { if (arr.length < 2) return 0; let n = Math.min(...arr.map((x) => x.length)); const a0 = arr[0]; for (let i = 0; i < n; i++) { for (const x of arr) if (x[i] !== a0[i]) return i; } return n; };
  const texts = (s) => {
    if (cache[s]) return cache[s];
    const raw = content[s].cards.map((c) => {
      const back = (c.b || '').split(/<hr id="?answer"?>/i)[1] ?? c.b;
      return { k: c.k, f: plain(c.f), b: plain(back), tags: (c.g || []).join(' ') };
    });
    const pf = cpl(raw.map((r) => r.f)), pb = cpl(raw.map((r) => r.b));
    const m = new Map();
    for (const r of raw) { const fr = r.f.slice(pf).trim(), br = r.b.slice(pb).trim(); m.set(r.k, { ...r, main: fr || br, sub: fr ? br : '' }); }
    return (cache[s] = m);
  };

  const kind = (s, td) => (s.suspended ? 'sus' : s.type === 0 ? 'new' : s.type === 2 && s.queue === 2 ? 'rev' : 'learn');
  function rows() {
    const T = texts(slug), st = getStates(), td = today();
    const out = [];
    for (const c of content[slug].cards) {
      const s = st.get(c.k); if (!s) continue;
      const k = kind(s, td);
      if (filter === 'new' && k !== 'new') continue;
      if (filter === 'learn' && k !== 'learn') continue;
      if (filter === 'rev' && k !== 'rev') continue;
      if (filter === 'due' && !(k === 'rev' && s.due <= td)) continue;
      if (filter === 'sus' && k !== 'sus') continue;
      const t = T.get(c.k);
      if (q && !(t.f + ' ' + t.b + ' ' + t.tags).toLowerCase().includes(q)) continue;
      out.push({ c, s, k, t });
    }
    out.sort((a, b) => a.s.due - b.s.due);
    return out;
  }
  const label = (r, td) => {
    const s = r.s; const base = s.type === 0 ? '新卡' : (s.type === 2 && s.queue === 2) ? (s.due <= td ? `复习·今天到期${s.due < td ? `（逾期 ${td - s.due} 天）` : ''}·间隔 ${s.ivl} 天` : `复习·${s.due - td} 天后(${dateOfDay(s.due)})·间隔 ${s.ivl} 天`) : '学习中';
    return s.suspended ? `挂起（${s.type === 0 ? '新卡' : s.type === 2 ? '复习' : '学习中'}）` : base;
  };

  function render() {
    const td = today(), all = rows();
    const shown = all.slice(0, limit);
    const counts = { all: 0, new: 0, learn: 0, rev: 0, due: 0, sus: 0 };
    const stAll = getStates();
    for (const c of content[slug].cards) { const s = stAll.get(c.k); if (!s) continue; const k = kind(s); counts.all++; counts[k]++; if (k === 'rev' && s.due <= td) counts.due++; }
    const chips = [['all', '全部'], ['new', '新卡'], ['learn', '学习中'], ['rev', '复习'], ['due', '今天到期'], ['sus', '挂起']];
    el.innerHTML = `<style>${CSS}</style><div class="kb">
      <div class="bar"><select id="kb-pkg">${packages.map((p) => `<option value="${p.slug}" ${p.slug === slug ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <input type="search" id="kb-q" placeholder="搜索文字或标签" value="${esc(q)}">${onClose ? '<button class="b g" id="kb-close">关闭</button>' : ''}</div>
      <div class="bar">${chips.map(([k, n]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${n} ${counts[k]}</button>`).join('')}</div>
      <div class="act">
        <button class="b g" id="kb-all">全选当前 ${shown.length} 条</button><button class="b g" id="kb-none">取消选择</button>
        <span class="msg">已选 ${sel.size} 张</span></div>
      ${canManage ? `<div class="act"><button class="b" id="kb-rel" ${sel.size ? '' : 'disabled'}>放出（取消挂起）</button>
        <button class="b" id="kb-sus" ${sel.size ? '' : 'disabled'}>挂起</button>
        <button class="b" id="kb-due" ${sel.size ? '' : 'disabled'}>设为今天复习</button><span class="msg" id="kb-msg"></span></div>` : '<div class="msg">老师没有开放“自己管理卡片”，这里只能查看。</div>'}
      <div class="list">${shown.map((r) => `<label class="r"><input type="checkbox" data-k="${esc(r.c.k)}" ${sel.has(r.c.k) ? 'checked' : ''}>
        <div class="t"><b>${esc(r.t.main.slice(0, 30))}</b> <span>${esc(r.t.sub.slice(0, 34))}</span></div>
        <div class="st ${r.k === 'sus' ? 'sus' : ''}">${esc(label(r, td))}</div></label>`).join('') || '<div class="r"><span class="msg">没有符合条件的卡片</span></div>'}</div>
      ${all.length > shown.length ? `<div class="act"><button class="b g" id="kb-more">再显示 150 条（共 ${all.length} 条符合）</button></div>` : `<div class="msg">共 ${all.length} 条符合</div>`}
    </div>`;
    const $ = (s) => el.querySelector(s);
    $('#kb-pkg').onchange = (e) => { slug = e.target.value; sel.clear(); limit = 150; render(); };
    let tm; $('#kb-q').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { q = e.target.value.trim().toLowerCase(); limit = 150; render(); const i = el.querySelector('#kb-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    el.querySelectorAll('.chip').forEach((b) => b.onclick = () => { filter = b.dataset.f; limit = 150; render(); });
    $('#kb-all').onclick = () => { shown.forEach((r) => sel.add(r.c.k)); render(); };
    $('#kb-none').onclick = () => { sel.clear(); render(); };
    el.querySelectorAll('input[data-k]').forEach((i) => i.onchange = () => { i.checked ? sel.add(i.dataset.k) : sel.delete(i.dataset.k); const m = el.querySelector('.act .msg'); if (m) m.textContent = `已选 ${sel.size} 张`; ['kb-rel', 'kb-sus', 'kb-due'].forEach((id) => { const b = el.querySelector('#' + id); if (b) b.disabled = !sel.size; }); });
    if ($('#kb-more')) $('#kb-more').onclick = () => { limit += 150; render(); };
    if ($('#kb-close')) $('#kb-close').onclick = onClose;
    const run = async (fn, okText, confirmText) => {
      const keys = [...sel]; if (!keys.length) return;
      const ct = typeof confirmText === 'function' ? confirmText(keys.length) : confirmText;
      if (ct && !confirm(ct.replace('{n}', keys.length))) return;
      const msg = $('#kb-msg'); msg.textContent = '处理中…';
      try { const n = await fn(keys); sel.clear(); render(); const m = el.querySelector('#kb-msg'); if (m) m.textContent = okText.replace('{n}', n ?? keys.length); }
      catch (e) { msg.textContent = '失败：' + (e.message === 'not allowed' ? '老师没有开放这个功能' : e.message); }
    };
    if (canManage) {
      $('#kb-rel').onclick = () => run((k) => actions.suspend(k, false), '已放出 {n} 张', (n) => (n > 30 ? '放出选中的 {n} 张卡？' : null));
      $('#kb-sus').onclick = () => run((k) => actions.suspend(k, true), '已挂起 {n} 张', '挂起选中的 {n} 张卡？它们不会再出现在学习队列里。');
      $('#kb-due').onclick = () => run((k) => actions.dueToday(k), '已把 {n} 张复习卡设为今天复习', '把选中的卡里“还没到期的复习卡”设为今天复习？（新卡、学习中的卡不受影响）');
    }
  }
  render();
  return { refresh: render };
}
