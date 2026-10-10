// 卡片浏览器（对应 Anki 的 Browse，但全部用鼠标打勾，不用写搜索语法）。学生页和老师页共用。
//  左边：打勾分组。组内多选 = “或”（今天学过 + 昨天学过），组与组之间 = “且”。每项后面的数字 = 现在再勾它会剩几张。
//        包 / 学习记录 / 表现 / 卡片状态 / 标签 永远有；选中“单个包”时，再多出这个包自己的字段分组（声母、韵母、类型…）。
//  右边：表格的列 = 这个包自己的字段（不是别的包的），点表头排序，勾选后“放出 / 挂起 / 设为今天复习”。
// 不直接联网：所有改动通过 opts.actions 交给调用方；学习记录通过 opts.loadReview() 取。
import { CRT } from './anki-sched.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ENT = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"' };
const plain = (h) => (h || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<a class="snd-btn"[^>]*>[^<]*<\/a>/g, '').replace(/<video[\s\S]*?<\/video>/gi, '')
  .replace(/<[^>]+>/g, ' ').replace(/&#?\w+;/g, (m) => ENT[m] ?? ' ').replace(/\s+/g, ' ').trim();
const dateOfDay = (d) => new Date((CRT + d * 86400) * 1000).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
const dayOfMs = (ms) => Math.floor((ms / 1000 - CRT) / 86400);
const COLL = new Intl.Collator('zh', { numeric: true });
const MEDIA_ONLY = /^[\s🔊🖼🎞]*$/u;
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 忽略 */ } } };

const CSS = `
.kb{font-size:14px;color:var(--ink,#222);display:grid;grid-template-columns:250px minmax(0,1fr);gap:12px;align-items:start}
.kb.noside{grid-template-columns:minmax(0,1fr)}.kb.noside .side{display:none}
.kb button,.kb input,.kb summary{font:inherit}
.kb .side{border:1px solid var(--line,#ddd);border-radius:10px;background:var(--card,#fff);max-height:78vh;overflow:auto;padding:4px 10px 10px;position:sticky;top:6px}
.kb details{border-bottom:1px solid var(--line,#eee);padding:4px 0}.kb details:last-child{border-bottom:0}
.kb summary{cursor:pointer;font-weight:700;padding:7px 0;list-style:none;display:flex;align-items:center;gap:6px}
.kb summary::-webkit-details-marker{display:none}
.kb summary:before{content:'▾';color:var(--mute,#888);font-size:12px;width:12px}
.kb details:not([open]) summary:before{content:'▸'}
.kb summary small{font-weight:400;color:var(--blue,var(--new,#1e6fff))}
.kb .opt{display:flex;align-items:center;gap:8px;padding:5px 2px;cursor:pointer;border-radius:6px}
.kb .opt:hover{background:var(--bg,#f4f5f7)}
.kb .opt input{width:17px;height:17px;flex:none;margin:0}
.kb .opt span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kb .opt i{font-style:normal;color:var(--mute,#888);font-size:12px}
.kb .opt.zero{opacity:.4}
.kb .more{background:none;border:0;color:var(--blue,var(--new,#1e6fff));padding:4px 2px;cursor:pointer}
.kb .hint{color:var(--mute,#888);font-size:12px;padding:2px 2px 6px}
.kb .main{min-width:0}
.kb .bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 8px}
.kb input[type=search]{flex:1;min-width:120px;padding:7px 9px;border:1px solid var(--line,#ddd);border-radius:8px;background:var(--card,#fff);color:inherit}
.kb .chip{display:inline-flex;gap:4px;align-items:center;border:1px solid var(--line,#ddd);background:var(--card,#fff);color:inherit;border-radius:14px;padding:3px 6px 3px 10px;cursor:pointer}
.kb .chip b{font-weight:400;color:var(--mute,#888)}.kb .chip u{text-decoration:none;color:var(--mute,#888);padding:0 3px}
.kb button.b{border:0;border-radius:8px;padding:8px 12px;background:var(--blue,var(--new,#1e6fff));color:#fff;font-weight:600;cursor:pointer}
.kb button.b.g{background:transparent;color:var(--blue,var(--new,#1e6fff));border:1px solid var(--line,#ddd)}
.kb button.b:disabled{opacity:.35;cursor:default}
.kb .msg{color:var(--mute,#888);font-size:13px}
.kb .tw{border:1px solid var(--line,#ddd);border-radius:10px;background:var(--card,#fff);max-height:62vh;overflow:auto}
.kb table{border-collapse:collapse;width:100%}
.kb th,.kb td{padding:7px 9px;border-bottom:1px solid var(--line,#eee);text-align:left;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis}
.kb th{position:sticky;top:0;background:var(--card,#fff);z-index:1;cursor:pointer;user-select:none;font-size:13px;color:var(--mute,#888);box-shadow:0 1px 0 var(--line,#ddd)}
.kb th.on{color:var(--ink,#222)}
.kb th.ck,.kb td.ck{width:34px;max-width:34px;padding-left:10px;padding-right:0;cursor:default}
.kb td.ck input,.kb th.ck input{width:17px;height:17px;margin:0}
.kb tr.cur td{background:var(--bg,#eef3ff)}
.kb tbody tr{cursor:pointer}
.kb .st{font-size:12px;border-radius:6px;padding:1px 7px;background:var(--bg,#eee);color:var(--mute,#666)}
.kb .st.sus{color:#fff;background:#8a8f98}.kb .st.new{color:var(--blue,var(--new,#1e6fff))}.kb .st.rev{color:var(--rev,#2b9a4a)}.kb .st.learn{color:var(--learn,#e03131)}
.kb .cols{position:relative}.kb .cols .pop{position:absolute;right:0;top:100%;z-index:3;background:var(--card,#fff);border:1px solid var(--line,#ddd);border-radius:10px;padding:6px 10px;min-width:180px;max-height:50vh;overflow:auto;box-shadow:0 4px 14px rgba(0,0,0,.15)}
.kb .detail{border:1px solid var(--line,#ddd);border-radius:10px;background:var(--card,#fff);margin-top:8px;padding:6px 12px}
.kb .detail .f{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line,#eee)}.kb .detail .f:last-child{border-bottom:0}
.kb .detail .f b{flex:none;width:96px;color:var(--mute,#888);font-weight:400}.kb .detail .f span{min-width:0;word-break:break-word}
@media (max-width:760px){.kb{grid-template-columns:minmax(0,1fr)}.kb .side{position:static;max-height:52vh}}
`;

const TIME = [['d0', '今天学过'], ['d1', '昨天学过'], ['d2', '前天学过'], ['d3_6', '3~6 天前学过'], ['d7', '更早学过'], ['never', '从没学过']];
const PERF = [['again_today', '今天答错过'], ['again_ever', '曾经答错过'], ['clean', '学过且从没答错']];
const STATE = [['new', '新卡'], ['learn', '学习中'], ['rev', '复习'], ['due', '今天到期'], ['sus', '挂起']];

export function mountBrowser(el, opts) {
  const { packages, content, getStates, today, canManage, actions, onClose, loadReview } = opts;
  const pkgName = Object.fromEntries(packages.map((p) => [p.slug, p.name]));
  const sel = new Map();                         // 分组id → 勾选的值（Set）
  const picked = new Set();                      // 勾选的卡（card key）
  const closed = new Set(), expanded = new Set();
  let q = '', limit = 300, focus = null, last = null;
  let sort = { col: '#', dir: 1 };
  let review = null, reviewState = loadReview ? 'loading' : 'none';
  let colsOpen = false;
  sel.set('pkg', new Set([opts.startSlug || packages[0].slug]));
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width:760px)').matches;
  let sideOn = !narrow;

  // ---------- 每个包自己的字段 ----------
  const P = {};
  function prep(slug) {
    if (P[slug]) return P[slug];
    const ct = content[slug], names = [];
    ct.models.forEach((m) => (m.fields || []).forEach((f) => { if (!names.includes(f)) names.push(f); }));
    const cards = ct.cards.map((c, idx) => {
      const m = ct.models[c.m] || { fields: [] }, v = {};
      (m.fields || []).forEach((f, i) => { v[f] = (c.v || [])[i] ?? ''; });
      return { key: c.k, slug, idx, v, model: m.name || '', tpl: (m.tpl || [])[c.o] || '', tags: c.g || [], deck: c.d || '', c };
    });
    // 几乎全是声音/图片/视频的字段（>=90% 的卡里只有图标）不当文字字段，不出列、不分组
    const text = names.filter((n) => cards.filter((x) => MEDIA_ONLY.test(x.v[n] ?? '')).length < cards.length * 0.9);
    for (const x of cards) x.main = text.length ? text.map((n) => x.v[n]).filter((s) => s && !MEDIA_ONLY.test(s)).slice(0, 2).join(' · ') : plain(x.c.f).slice(0, 60);
    // 哪些字段适合当分组：不同的值不多（2~60 种），且不是几乎每张卡一个值
    const fg = [];
    for (const n of text) {
      const cnt = new Map(); for (const x of cards) { const s = x.v[n] ?? ''; cnt.set(s, (cnt.get(s) || 0) + 1); }
      const avg = [...cnt.keys()].reduce((a, s) => a + s.length, 0) / cnt.size;
      if (cnt.size >= 2 && cnt.size <= 60 && cnt.size <= cards.length * 0.6 && avg <= 24) fg.push(n);
    }
    return (P[slug] = { names, text, cards, fg, models: ct.models });
  }

  // ---------- 状态 / 学习记录 ----------
  const kind = (s) => (s.suspended ? 'sus' : s.type === 0 ? 'new' : s.type === 2 && s.queue === 2 ? 'rev' : 'learn');
  const KIND = { new: '新卡', learn: '学习中', rev: '复习', sus: '挂起' };
  function view(x, st, td) {
    const s = st.get(x.key); if (!s) return null;
    const k = kind(s), r = review && review.get(x.key);
    const states = k === 'sus' ? ['sus'] : [k]; if (k === 'rev' && s.due <= td) states.push('due');
    let time = ['never'], perf = [];
    if (r && r.n > 0) {
      const d = td - dayOfMs(r.last); time = [d <= 0 ? 'd0' : d === 1 ? 'd1' : d === 2 ? 'd2' : d <= 6 ? 'd3_6' : 'd7'];
      if (r.again > 0) { perf.push('again_ever'); if (r.lastAgain && dayOfMs(r.lastAgain) === td) perf.push('again_today'); } else perf.push('clean');
    }
    return { x, s, k, r, states, time, perf };
  }
  const dueText = (v, td) => { const s = v.s; if (s.type === 0) return '新卡'; if (v.k === 'learn') return '学习中'; return s.due <= td ? (s.due < td ? `逾期 ${td - s.due} 天` : '今天') : `${dateOfDay(s.due)}（${s.due - td} 天后）`; };
  const dueKey = (v) => (v.s.type === 0 ? 1e9 + v.s.due : v.k === 'learn' && v.s.queue === 1 ? dayOfMs(v.s.due * 1000) : v.s.due);
  const lastText = (v, td) => { if (!v.r || !v.r.n) return '—'; const d = td - dayOfMs(v.r.last); return d <= 0 ? '今天' : d === 1 ? '昨天' : `${d} 天前`; };

  // ---------- 分组定义 ----------
  function buildGroups(single) {
    const g = [
      { id: 'pkg', title: '包', vals: (v) => [v.x.slug], opts: packages.map((p) => [p.slug, p.name]) },
      { id: 'time', title: '最近学习', vals: (v) => v.time, opts: TIME, review: true },
      { id: 'perf', title: '答题表现', vals: (v) => v.perf, opts: PERF, review: true },
      { id: 'state', title: '卡片状态', vals: (v) => v.states, opts: STATE },
    ];
    if (single) {
      const p = prep(single);
      p.fg.forEach((n) => g.push({ id: 'f:' + n, title: n, vals: (v) => [v.x.v[n] ?? ''], dyn: true, field: true }));
      if (p.models.length > 1) g.push({ id: 'model', title: '笔记类型', vals: (v) => [v.x.model], dyn: true });
      if (new Set(p.cards.map((x) => x.deck)).size > 1) g.push({ id: 'deck', title: '原牌组', vals: (v) => [v.x.deck || '(无)'], dyn: true });
    }
    g.push({ id: 'tag', title: '标签', vals: (v) => (v.x.tags.length ? v.x.tags : ['(无标签)']), dyn: true });
    return g;
  }

  let M = null;   // 最近一次计算结果
  function compute() {
    const td = today(), st = getStates();
    const pk = sel.get('pkg'), single = pk && pk.size === 1 ? [...pk][0] : null;
    const groups = buildGroups(single);
    const views = [];
    for (const p of packages) for (const x of prep(p.slug).cards) { const v = view(x, st, td); if (v) views.push(v); }
    // 动态分组的选项 = 目前选中的包里出现过的值
    const scope = views.filter((v) => !pk || !pk.size || pk.has(v.x.slug));
    for (const g of groups) if (g.dyn) {
      const set = new Set(); for (const v of scope) g.vals(v).forEach((s) => set.add(s));
      let arr = [...set]; arr.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : COLL.compare(a, b)));
      g.opts = arr.map((s) => [s, s === '' ? '(空)' : s]);
    }
    for (const id of [...sel.keys()]) if (!groups.some((g) => g.id === id)) sel.delete(id);   // 换包后，别的包的分组勾选作废
    const counts = groups.map(() => new Map()), matched = [], qq = q.trim().toLowerCase();
    for (const v of views) {
      const fails = [];
      groups.forEach((g, gi) => { const s = sel.get(g.id); if (s && s.size && !g.vals(v).some((x) => s.has(x))) fails.push(gi); });
      if (qq && !(v.x.main + ' ' + Object.values(v.x.v).join(' ') + ' ' + v.x.tags.join(' ')).toLowerCase().includes(qq)) fails.push(-1);
      if (fails.length === 0) matched.push(v);
      // “包”这一组的数字不受包内字段/标签的筛选影响（那些筛选只在这个包里才有意义）
      if (fails.every((f) => f === 0 || (f > 0 && groups[f].dyn))) for (const x of groups[0].vals(v)) counts[0].set(x, (counts[0].get(x) || 0) + 1);
      if (fails.length <= 1) groups.forEach((g, gi) => { if (gi > 0 && (fails.length === 0 || fails[0] === gi)) for (const x of g.vals(v)) counts[gi].set(x, (counts[gi].get(x) || 0) + 1); });
    }
    for (const g of groups) { const s = sel.get(g.id); if (s) for (const x of [...s]) if (!g.opts.some((o) => o[0] === x)) s.delete(x); }
    M = { td, single, groups, counts, matched, total: views.length };
    return M;
  }

  // ---------- 列 ----------
  const colKey = (slug) => 'anki_test_kb_cols_' + slug;
  function columns(m) {
    const td = m.td;
    const C = {
      '#': { label: '序', text: (v) => v.x.idx + 1, key: (v) => v.x.idx },
      _pkg: { label: '包', text: (v) => pkgName[v.x.slug], key: (v) => packages.findIndex((p) => p.slug === v.x.slug) },
      _main: { label: '内容', text: (v) => v.x.main, key: (v) => v.x.main, str: true },
      _state: { label: '状态', html: (v) => `<span class="st ${v.k}">${KIND[v.k]}</span>`, key: (v) => ['new', 'learn', 'rev', 'sus'].indexOf(v.k) },
      _due: { label: '到期', text: (v) => dueText(v, td), key: dueKey },
      _last: { label: '最近学习', text: (v) => lastText(v, td), key: (v) => (v.r && v.r.n ? v.r.last : -1), desc: true },
      _ivl: { label: '间隔', text: (v) => (v.s.ivl > 0 ? v.s.ivl + ' 天' : '—'), key: (v) => v.s.ivl },
      _again: { label: '答错次数', text: (v) => (v.r ? v.r.again : '—'), key: (v) => (v.r ? v.r.again : -1), desc: true },
      _n: { label: '答题次数', text: (v) => (v.r ? v.r.n : '—'), key: (v) => (v.r ? v.r.n : -1), desc: true },
      _tpl: { label: '卡片类型', text: (v) => v.x.tpl, key: (v) => v.x.tpl, str: true },
      _deck: { label: '原牌组', text: (v) => v.x.deck, key: (v) => v.x.deck, str: true },
      _tags: { label: '标签', text: (v) => v.x.tags.join(' '), key: (v) => v.x.tags.join(' '), str: true },
    };
    if (!m.single) return { all: C, list: ['_pkg', '_main', '_state', '_due', '_last'], chooser: false };
    const p = prep(m.single);
    for (const n of p.text) C['f:' + n] = { label: n, text: (v) => v.x.v[n] ?? '', key: (v) => v.x.v[n] ?? '', str: true, field: true };
    let list;
    try { list = JSON.parse(LS.get(colKey(m.single)) || 'null'); } catch (e) { list = null; }
    if (!Array.isArray(list)) list = ['#', ...p.text.slice(0, 5).map((n) => 'f:' + n), '_state', '_due', '_last'];
    list = list.filter((id) => C[id]);
    // 这批卡里整列都是空的字段列，自动不显示（比如只看“Basic”类型时，别的类型的字段列就不占位置）
    const vis = list.filter((id) => !C[id].field || m.matched.some((v) => (v.x.v[id.slice(2)] ?? '') !== '') || !m.matched.length);
    return { all: C, list: vis, chosen: list, chooser: true, order: ['#', ...p.text.map((n) => 'f:' + n), '_state', '_due', '_last', '_ivl', '_again', '_n', '_tpl', '_deck', '_tags'] };
  }

  // ---------- 外壳（只建一次，搜索框不会被重绘打断） ----------
  el.innerHTML = `<style>${CSS}</style><div class="kb ${sideOn ? '' : 'noside'}" id="kb-root">
    <div class="side" id="kb-side"></div>
    <div class="main">
      <div class="bar"><button class="b g" id="kb-tog"></button>
        <input type="search" id="kb-q" placeholder="想找某个字或词，直接打字（可不填）">
        ${onClose ? '<button class="b g" id="kb-close">关闭</button>' : ''}</div>
      <div class="bar" id="kb-chips"></div>
      <div class="bar" id="kb-acts"></div>
      <div class="tw" id="kb-tw"></div>
      <div id="kb-more"></div>
      <div class="detail" id="kb-detail" hidden></div>
    </div></div>`;
  const $ = (s) => el.querySelector(s);
  let qt; $('#kb-q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { q = e.target.value; limit = 300; render(); }, 200); };
  $('#kb-tog').onclick = () => { sideOn = !sideOn; $('#kb-root').classList.toggle('noside', !sideOn); setTog(); };
  if ($('#kb-close')) $('#kb-close').onclick = onClose;
  const setTog = () => { $('#kb-tog').textContent = sideOn ? '◀ 收起筛选' : '▶ 筛选'; };

  function renderSide(m) {
    const side = $('#kb-side'), top = side.scrollTop;
    const nsel = (id) => (sel.get(id) ? sel.get(id).size : 0);
    side.innerHTML = m.groups.map((g, gi) => {
      let body;
      if (g.review && reviewState !== 'ok') {
        body = `<div class="hint">${reviewState === 'loading' ? '读取学习记录中…' : reviewState === 'err' ? '这组筛选暂时用不了：数据库还没运行 06 号 SQL（06-Augie-Anki测试系统-学习记录汇总.sql），运行后刷新本页。' : ''}</div>`;
      } else {
        const all = expanded.has(g.id), opts = g.opts.map((o, oi) => [o, oi]);
        // 选项太多（超过 30 个）时只先露出前 20 个（已勾选的永远露出）
        const shown = all || opts.length <= 30 ? opts : opts.filter(([o], i) => i < 20 || (sel.get(g.id) && sel.get(g.id).has(o[0])));
        body = shown.map(([o, oi]) => { const n = m.counts[gi].get(o[0]) || 0, on = sel.get(g.id) && sel.get(g.id).has(o[0]);
          return `<label class="opt ${n === 0 && !on ? 'zero' : ''}" title="${esc(o[1])}"><input type="checkbox" data-g="${gi}" data-o="${oi}" ${on ? 'checked' : ''}><span>${esc(o[1])}</span><i>${n}</i></label>`; }).join('')
          + (shown.length < opts.length ? `<button class="more" data-more="${esc(g.id)}">显示全部 ${opts.length} 项</button>` : (all && opts.length > 30 ? `<button class="more" data-less="${esc(g.id)}">收起</button>` : ''));
        if (g.id === 'pkg' && !m.single) body += '<div class="hint">选 1 个包时，这里下面会多出这个包自己的字段分组。</div>';
      }
      return `<details data-id="${esc(g.id)}" ${closed.has(g.id) ? '' : 'open'}><summary>${esc(g.title)}${nsel(g.id) ? ` <small>已选 ${nsel(g.id)}</small>` : ''}</summary>${body}</details>`;
    }).join('');
    side.scrollTop = top;
    side.querySelectorAll('details').forEach((d) => d.ontoggle = () => { d.open ? closed.delete(d.dataset.id) : closed.add(d.dataset.id); });
    side.querySelectorAll('input[data-g]').forEach((i) => i.onchange = () => {
      const g = m.groups[+i.dataset.g], val = g.opts[+i.dataset.o][0];
      let s = sel.get(g.id); if (!s) sel.set(g.id, (s = new Set()));
      i.checked ? s.add(val) : s.delete(val);
      if (!s.size) sel.delete(g.id);
      if (g.id === 'pkg') for (const id of [...sel.keys()]) if (!['pkg', 'time', 'perf', 'state'].includes(id)) sel.delete(id);
      limit = 300; render();
    });
    side.querySelectorAll('[data-more]').forEach((b) => b.onclick = () => { expanded.add(b.dataset.more); render(); });
    side.querySelectorAll('[data-less]').forEach((b) => b.onclick = () => { expanded.delete(b.dataset.less); render(); });
  }

  function renderMain(m) {
    // 已选条件
    const chips = [];
    m.groups.forEach((g) => { const s = sel.get(g.id); if (s) for (const v of s) { const o = g.opts.find((x) => x[0] === v); chips.push([g, v, `${g.title}：${o ? o[1] : v}`]); } });
    $('#kb-chips').innerHTML = chips.map(([, , t], i) => `<span class="chip" data-c="${i}">${esc(t)} <u>×</u></span>`).join('') + (chips.some(([g]) => g.id !== 'pkg') ? '<button class="b g" id="kb-clear">清除全部筛选</button>' : '');
    $('#kb-chips').querySelectorAll('[data-c]').forEach((c) => c.onclick = () => { const [g, v] = chips[+c.dataset.c]; const s = sel.get(g.id); s.delete(v); if (!s.size) sel.delete(g.id); render(); });
    if ($('#kb-clear')) $('#kb-clear').onclick = () => { for (const id of [...sel.keys()]) if (id !== 'pkg') sel.delete(id); $('#kb-q').value = ''; q = ''; render(); };

    // 排序
    const col = columns(m), C = col.all;
    if (!C[sort.col] || (!col.list.includes(sort.col) && sort.col !== '#')) sort = { col: '#', dir: 1 };
    const sc = C[sort.col], rows = [...m.matched];
    rows.sort((a, b) => {
      const ka = sc.key(a), kb = sc.key(b);
      let r;
      if (sc.str) { r = ka === '' ? (kb === '' ? 0 : 1) : kb === '' ? -1 : COLL.compare(ka, kb) * sort.dir; } else r = (ka - kb) * sort.dir;
      return r || a.x.slug.localeCompare(b.x.slug) || a.x.idx - b.x.idx;
    });
    m.rows = rows;
    const keys = new Set(rows.map((v) => v.x.key));
    for (const k of [...picked]) if (!keys.has(k)) picked.delete(k);   // 筛选变了，不在列表里的卡不再算“已选”

    const shown = rows.slice(0, limit), allOn = rows.length && picked.size === rows.length;
    const tw0 = $('#kb-tw'), st0 = tw0.scrollTop, sl0 = tw0.scrollLeft;
    $('#kb-tw').innerHTML = `<table><thead><tr><th class="ck"><input type="checkbox" id="kb-all" title="选中全部符合条件的 ${rows.length} 张" ${allOn ? 'checked' : ''}></th>${col.list.map((id) => `<th data-s="${esc(id)}" class="${sort.col === id ? 'on' : ''}">${esc(C[id].label)}${sort.col === id ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${shown.map((v, ri) => `<tr data-r="${ri}" class="${focus === v.x.key ? 'cur' : ''}"><td class="ck"><input type="checkbox" data-k="${ri}" ${picked.has(v.x.key) ? 'checked' : ''}></td>${col.list.map((id) => `<td title="${esc(C[id].html ? '' : C[id].text(v))}">${C[id].html ? C[id].html(v) : esc(C[id].text(v))}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${col.list.length + 1}" class="msg" style="padding:16px">没有符合条件的卡片</td></tr>`}</tbody></table>`;
    const tw = $('#kb-tw'); tw.scrollTop = st0; tw.scrollLeft = sl0;
    tw.querySelectorAll('th[data-s]').forEach((h) => h.onclick = () => { const id = h.dataset.s; sort = sort.col === id ? { col: id, dir: -sort.dir } : { col: id, dir: C[id].desc ? -1 : 1 }; render(); });
    $('#kb-all').onchange = (e) => { e.target.checked ? rows.forEach((v) => picked.add(v.x.key)) : picked.clear(); render(); };
    tw.querySelectorAll('input[data-k]').forEach((i) => i.onclick = (e) => {
      e.stopPropagation();
      const ri = +i.dataset.k, k = shown[ri].x.key;
      if (e.shiftKey && last != null) { const [a, b] = [Math.min(last, ri), Math.max(last, ri)]; for (let j = a; j <= b; j++) i.checked ? picked.add(shown[j].x.key) : picked.delete(shown[j].x.key); }
      else i.checked ? picked.add(k) : picked.delete(k);
      last = ri; render();
    });
    tw.querySelectorAll('tbody tr[data-r]').forEach((tr) => tr.onclick = (e) => { if (e.target.tagName === 'INPUT') return; const k = shown[+tr.dataset.r].x.key; focus = focus === k ? null : k; render(); });
    $('#kb-more').innerHTML = rows.length > shown.length ? `<div class="bar" style="margin-top:8px"><button class="b g" id="kb-moreb">再显示 300 条（共 ${rows.length} 条符合）</button></div>` : '';
    if ($('#kb-moreb')) $('#kb-moreb').onclick = () => { limit += 300; render(); };

    // 操作栏
    const colBtn = col.chooser ? `<span class="cols"><button class="b g" id="kb-cols">列 ▾</button>${colsOpen ? `<div class="pop">${col.order.map((id) => `<label class="opt"><input type="checkbox" data-col="${esc(id)}" ${col.chosen.includes(id) ? 'checked' : ''}><span>${esc(C[id].label)}</span></label>`).join('')}<div class="hint">整列都是空的字段会自动隐藏</div></div>` : ''}</span>` : '';
    $('#kb-acts').innerHTML = `<span class="msg">符合 <b>${rows.length}</b> 张 / 共 ${m.total} 张 · 已选 <b>${picked.size}</b> 张</span>
      ${picked.size ? '<button class="b g" id="kb-none">取消选择</button>' : ''}
      ${canManage ? `<button class="b" id="kb-rel" ${picked.size ? '' : 'disabled'}>放出（取消挂起）</button><button class="b" id="kb-sus" ${picked.size ? '' : 'disabled'}>挂起</button><button class="b" id="kb-due" ${picked.size ? '' : 'disabled'}>设为今天复习</button>` : '<span class="msg">老师没有开放“自己管理卡片”，这里只能查看。</span>'}
      <span style="flex:1"></span>${colBtn}<span class="msg" id="kb-msg"></span>`;
    if ($('#kb-none')) $('#kb-none').onclick = () => { picked.clear(); render(); };
    if ($('#kb-cols')) $('#kb-cols').onclick = () => { colsOpen = !colsOpen; render(); };
    el.querySelectorAll('input[data-col]').forEach((i) => i.onchange = () => {
      let cur = col.chosen.slice(); i.checked ? cur.push(i.dataset.col) : (cur = cur.filter((x) => x !== i.dataset.col));
      cur = col.order.filter((id) => cur.includes(id)); LS.set(colKey(m.single), JSON.stringify(cur)); render();
    });
    const run = async (fn, okText, confirmText) => {
      const ks = [...picked]; if (!ks.length) return;
      const ct = typeof confirmText === 'function' ? confirmText(ks.length) : confirmText;
      if (ct && !confirm(ct.replace('{n}', ks.length))) return;
      const msg = $('#kb-msg'); msg.textContent = '处理中…';
      try { const n = await fn(ks); picked.clear(); render(); const mm = $('#kb-msg'); if (mm) mm.textContent = okText.replace('{n}', n ?? ks.length); }
      catch (e) { msg.textContent = '失败：' + (e.message === 'not allowed' ? '老师没有开放这个功能' : e.message); }
    };
    if (canManage) {
      $('#kb-rel').onclick = () => run((k) => actions.suspend(k, false), '已放出 {n} 张', (n) => (n > 30 ? '放出选中的 {n} 张卡？' : null));
      $('#kb-sus').onclick = () => run((k) => actions.suspend(k, true), '已挂起 {n} 张', '挂起选中的 {n} 张卡？它们不会再出现在学习队列里。');
      $('#kb-due').onclick = () => run((k) => actions.dueToday(k), '已把 {n} 张复习卡设为今天复习', '把选中的卡里“还没到期的复习卡”设为今天复习？（新卡、学习中的卡不受影响）');
    }

    // 底部：点一行，看这张卡的全部字段（对应 Anki 下半部的编辑区）
    const fv = focus && rows.find((v) => v.x.key === focus), det = $('#kb-detail');
    if (!fv) { det.hidden = true; return; }
    det.hidden = false;
    const p = prep(fv.x.slug), td = m.td;
    det.innerHTML = [['包', pkgName[fv.x.slug]], ['笔记类型 / 卡片', `${fv.x.model} / ${fv.x.tpl}`], ...Object.entries(fv.x.v).filter(([n]) => p.text.includes(n)), ['标签', fv.x.tags.join(' ') || '—'],
      ['状态', `${KIND[fv.k]}；到期：${dueText(fv, td)}；间隔 ${fv.s.ivl} 天`], ['学习记录', fv.r ? `答过 ${fv.r.n} 次，答错 ${fv.r.again} 次；最近 ${lastText(fv, td)}` : '没有记录']]
      .map(([n, t]) => `<div class="f"><b>${esc(n)}</b><span>${esc(t || '—')}</span></div>`).join('');
  }

  function render() { const m = compute(); renderSide(m); renderMain(m); setTog(); }
  render();
  if (loadReview) {
    loadReview().then((rows) => { review = new Map((rows || []).map((r) => [r[0], { last: r[1], n: r[2], again: r[3], lastAgain: r[4] }])); reviewState = 'ok'; render(); })
      .catch(() => { reviewState = 'err'; render(); });
  }
  return { refresh: render };
}
