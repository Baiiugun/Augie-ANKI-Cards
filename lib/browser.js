// 卡片浏览器（对应 Anki 的 Browse，但全部用鼠标打勾，不用写搜索语法）。学生页和老师页共用。
//  左边：打勾分组。组内多选 = “或”（今天学过 + 昨天学过），组与组之间 = “且”。每项后面的数字 = 现在再勾它会剩几张。
//        Deck / 学习记录 / 表现 / 卡片状态 / 标签 永远有；选中“单个 Deck”时，再多出这个 Deck 自己的字段分组（声母、韵母、类型…）。
//        每个分组标题右边有“全选 | 取消全选”。
//  右边：表格的列 = 这个 Deck 自己的字段（不是别的 Deck 的），点表头排序，选中后“暂停 / 取消暂停 / 设为今天复习”。
//        选行方式照 Windows / Anki：单击 = 只选这一行；Ctrl+单击 = 加选/减选；Shift+单击 = 从上次点的行连选到这一行；
//        Ctrl+A = 全选；双击一行（或点行首的 ▸）= 展开这张卡的详情。小方框保留（iPad 没有 Ctrl/Shift）。
//  颜色标记（Flag，红橙绿蓝粉青紫，编号同 Anki）：左边“标记”分组筛选；选中卡片后点“标记”按钮（短按 = 红旗，再短按 = 取消；长按 / 右键 = 选其他颜色），Ctrl+1…7 同 Anki。
// 术语：Anki 的 Suspend 在本系统叫“暂停”（Bury 叫“搁置”，目前只占个位置，还没有这个功能）。
// 不直接联网：所有改动通过 opts.actions 交给调用方；学习记录通过 opts.loadReview() 取。
import { CRT } from './anki-sched.js';
import { FLAGS, flagColor, flagName, flagSvg, toggleTarget, noSqlHint, pressable, showFlagMenu } from './flag-ui.js';

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
.kb .side{border:1px solid var(--line,#ddd);border-radius:10px;background:var(--card,#fff);padding:4px 10px 10px}
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
/* 顶部整块（搜索框 / 已选条件 / 操作栏）吸顶：表格滚得再靠下，这些也一直在屏幕上方；表头排在它们下面（--kb-bar = 这一块的高度，由 JS 量） */
.kb .stk{position:sticky;top:var(--kb-top,0px);z-index:3;background:var(--bg,#f6f7f9);padding-top:6px}
.kb .stk .bar:last-child{margin-bottom:0;padding-bottom:8px}
.kb .tw{border:1px solid var(--line,#ddd);border-radius:10px;background:var(--card,#fff)}
.kb table{border-collapse:collapse;width:100%}
.kb th,.kb td{padding:7px 8px;border-bottom:1px solid var(--line,#eee);text-align:left;vertical-align:top;white-space:normal;overflow-wrap:anywhere;word-break:break-word;font-size:inherit}
.kb th.nw,.kb td.nw{white-space:nowrap;overflow-wrap:normal;word-break:keep-all}
.kb th{position:sticky;top:calc(var(--kb-top,0px) + var(--kb-bar,0px));background:var(--card,#fff);z-index:1;cursor:pointer;user-select:none;font-size:13px;color:var(--mute,#888);box-shadow:0 1px 0 var(--line,#ddd)}
.kb th.on{color:var(--ink,#222)}
.kb th.ck,.kb td.ck{width:78px;max-width:78px;padding-left:10px;padding-right:0;cursor:default;white-space:nowrap}
.kb td.ck input,.kb th.ck input{width:17px;height:17px;margin:0;vertical-align:middle}
.kb td.ck .ex{display:inline-block;width:20px;text-align:center;color:var(--mute,#888);cursor:pointer;user-select:none;margin-left:4px;border-radius:4px}
.kb td.ck .ex:hover{background:var(--bg,#eee);color:var(--ink,#222)}
.kb tr.cur td{background:var(--bg,#eef3ff)}
.kb tbody tr[data-r]{cursor:pointer;user-select:none;-webkit-user-select:none}
/* 行底色：暂停 = 淡黄（和 Anki 一样）；选中 = 蓝色（盖过黄色） */
.kb tbody tr.k-sus td{background:rgba(245,197,24,.2)}
.kb tbody tr.fl1 td{background:rgba(240,82,77,.2)}.kb tbody tr.fl2 td{background:rgba(245,153,58,.22)}.kb tbody tr.fl3 td{background:rgba(51,196,111,.2)}.kb tbody tr.fl4 td{background:rgba(74,140,245,.2)}
.kb tbody tr.fl5 td{background:rgba(238,111,224,.2)}.kb tbody tr.fl6 td{background:rgba(39,201,189,.2)}.kb tbody tr.fl7 td{background:rgba(160,92,240,.2)}
.kb tbody tr.sel td{background:rgba(30,111,255,.17)}
.kb td.ck .fg{display:inline-block;width:18px;margin-left:2px;vertical-align:middle;line-height:1}
.kb .flagbtn .fsv{margin-right:4px}.kb button.b.flagbtn{display:inline-flex;align-items:center}
.kb tbody tr.sel td.ck{box-shadow:inset 3px 0 0 var(--blue,var(--new,#1e6fff))}
/* 状态：圆点颜色照 Anki 左侧栏（新卡蓝 / 学习中红 / 复习绿 / 暂停黄 / 搁置橙） */
.kb .st{font-size:12px;border-radius:6px;padding:1px 7px;background:var(--bg,#eee);color:var(--mute,#666);white-space:nowrap}
.kb .st:before,.kb .dot{content:'';display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;background:var(--c,#999);vertical-align:baseline}
.kb .dot{margin-right:0;flex:none}
.kb .fsw{display:inline-flex;flex:none;width:16px;line-height:1;color:var(--mute,#888)}
.kb .st.sus{--c:#f5c518;color:#7a5f00;background:rgba(245,197,24,.25)}.kb .st.new{--c:#3b82f6;color:var(--blue,var(--new,#1e6fff))}.kb .st.rev{--c:#2b9a4a;color:var(--rev,#2b9a4a)}.kb .st.learn{--c:#e03131;color:var(--learn,#e03131)}
.kb summary .sa{margin-left:auto;display:inline-flex;gap:10px;font-weight:400;font-size:12px}
.kb summary .sa a{color:var(--blue,var(--new,#1e6fff));cursor:pointer}.kb summary .sa a:hover{text-decoration:underline}
.kb .acts-hint{color:var(--mute,#888);font-size:12px}
.kb .main:focus{outline:0}
.kb .cols{position:relative}.kb .cols .pop{position:absolute;right:0;top:100%;z-index:3;background:var(--card,#fff);border:1px solid var(--line,#ddd);border-radius:10px;padding:6px 10px;min-width:180px;max-height:50vh;overflow:auto;box-shadow:0 4px 14px rgba(0,0,0,.15)}
.kb .detail{border:1px solid var(--line,#ddd);border-radius:10px;background:var(--card,#fff);margin:2px 0 4px;padding:6px 12px;cursor:default;white-space:normal}
.kb tbody tr.dt{cursor:default}.kb tr.dt td{padding:0 8px 8px;background:var(--bg,#f7f8fa)}
.kb .detail .f{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line,#eee)}.kb .detail .f:last-child{border-bottom:0}
.kb .detail .f b{flex:none;width:96px;color:var(--mute,#888);font-weight:400}.kb .detail .f span{min-width:0;word-break:break-word}
.kb .detail textarea{width:100%;font:inherit;padding:6px 8px;border:1px solid var(--line,#ddd);border-radius:8px;background:var(--card,#fff);color:inherit;resize:vertical;min-height:38px}
.kb .detail .f.ro span{color:var(--mute,#888)}
.kb .detail .btns{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 0}
.kb .detail .tagged{color:var(--warn,#ff9800);font-size:12px;margin-left:6px}
@media (max-width:760px){.kb{grid-template-columns:minmax(0,1fr)}.kb .acts-hint{display:none}.kb th,.kb td{padding:6px 5px}.kb .detail .f{flex-direction:column;gap:2px}.kb .detail .f b{width:auto}}
`;

const TIME = [['d0', '今天学过'], ['d1', '昨天学过'], ['d2', '前天学过'], ['d3_6', '3~6 天前学过'], ['d7', '更早学过'], ['never', '从没学过']];
const PERF = [['again_today', '今天答错过'], ['again_ever', '曾经答错过'], ['clean', '学过且从没答错']];
// 第 3 项是圆点颜色（照 Anki 左侧栏）；“搁置”目前没有这个功能，数量永远是 0，先占个位置
const STATE = [['new', '新卡', '#3b82f6'], ['learn', '学习中', '#e03131'], ['rev', '复习', '#2b9a4a'], ['due', '今天到期', ''], ['sus', '暂停', '#f5c518'], ['bury', '搁置', '#f08c00']];
// 标记分组：值 = Anki 的 flag 编号（0 = 无标记）
const FLAG_OPTS = [[0, '无标记', '', 'flag'], ...FLAGS.map((f) => [f[0], `${f[1]} ${f[2]}`, f[3], 'flag'])];
// 分组标题下的小提示（没勾任何项时的含义等）
const NOTE = { pkg: '一个都不勾 = 显示全部 Deck。', perf: '“全选”会排除从没学过的卡（它们没有答题记录）。', flag: '“全选”= 勾上所有颜色（不含“无标记”），也就是所有被标记过的卡。' };

export function mountBrowser(el, opts) {
  const { packages, content, getStates, today, canManage, actions, onClose, loadReview } = opts;
  const canFlag = !!(actions && actions.flag);                // 能不能打标记（学生页不受“自己管理卡片”开关限制）
  const pkgName = Object.fromEntries(packages.map((p) => [p.slug, p.name]));
  const sel = new Map();                         // 分组id → 勾选的值（Set）
  const picked = new Set();                      // 勾选的卡（card key）
  const closed = new Set(), expanded = new Set();
  let q = '', limit = 300, focus = null, lastKey = null;   // lastKey = 上次点的那一行（Shift 连选的起点）
  let syncCur = () => {};                                  // 当前表格的“只刷新选中状态”函数
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
  const KIND = { new: '新卡', learn: '学习中', rev: '复习', sus: '暂停' };
  function view(x, st, td) {
    const s = st.get(x.key); if (!s) return null;
    const k = kind(s), r = review && review.get(x.key);
    const states = k === 'sus' ? ['sus'] : [k]; if (k === 'rev' && s.due <= td) states.push('due');
    let time = ['never'], perf = [];
    if (r && r.n > 0) {
      const d = td - dayOfMs(r.last); time = [d <= 0 ? 'd0' : d === 1 ? 'd1' : d === 2 ? 'd2' : d <= 6 ? 'd3_6' : 'd7'];
      if (r.again > 0) { perf.push('again_ever'); if (r.lastAgain && dayOfMs(r.lastAgain) === td) perf.push('again_today'); } else perf.push('clean');
    }
    return { x, s, k, r, states, time, perf, flag: s.flag || 0 };
  }
  // 注意：queue=1 的卡（学习中）的 due 是“到期的秒数”，不是“第几天”；暂停的学习中卡也一样（以前这里漏了，会显示 Invalid Date）
  const dueText = (v, td) => { const s = v.s; if (s.type === 0) return '新卡'; if (v.k === 'learn' || s.queue === 1) return '学习中'; return s.due <= td ? (s.due < td ? `逾期 ${td - s.due} 天` : '今天') : `${dateOfDay(s.due)}（${s.due - td} 天后）`; };
  const dueKey = (v) => (v.s.type === 0 ? 1e9 + v.s.due : v.s.queue === 1 ? dayOfMs(v.s.due * 1000) : v.s.due);
  const lastText = (v, td) => { if (!v.r || !v.r.n) return '—'; const d = td - dayOfMs(v.r.last); return d <= 0 ? '今天' : d === 1 ? '昨天' : `${d} 天前`; };

  // ---------- 分组定义 ----------
  function buildGroups(single) {
    const g = [
      { id: 'pkg', title: 'Deck', vals: (v) => [v.x.slug], opts: packages.map((p) => [p.slug, p.name]) },
      { id: 'time', title: '最近学习', vals: (v) => v.time, opts: TIME, review: true },
      { id: 'perf', title: '答题表现', vals: (v) => v.perf, opts: PERF, review: true },
      { id: 'state', title: '卡片状态', vals: (v) => v.states, opts: STATE },
      { id: 'flag', title: '标记', vals: (v) => [v.flag], opts: FLAG_OPTS },
    ];
    if (single) {
      const p = prep(single);
      p.fg.forEach((n) => g.push({ id: 'f:' + n, title: n, vals: (v) => [v.x.v[n] ?? ''], dyn: true, field: true }));
      if (p.models.length > 1) g.push({ id: 'model', title: '笔记类型', vals: (v) => [v.x.model], dyn: true });
      if (new Set(p.cards.map((x) => x.deck)).size > 1) g.push({ id: 'deck', title: '原 Deck', vals: (v) => [v.x.deck || '(无)'], dyn: true });
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
      '#': { label: '序', text: (v) => (v.x.idx + 1) + (opts.edit && v.x.c.ed ? ' ✎' : ''), key: (v) => v.x.idx, nw: true },
      _pkg: { label: 'Deck', text: (v) => pkgName[v.x.slug], key: (v) => packages.findIndex((p) => p.slug === v.x.slug) },
      _main: { label: '内容', text: (v) => v.x.main, key: (v) => v.x.main, str: true },
      _state: { label: '状态', html: (v) => `<span class="st ${v.k}">${KIND[v.k]}</span>`, text: (v) => KIND[v.k], key: (v) => ['new', 'learn', 'rev', 'sus'].indexOf(v.k), nw: true },
      _due: { label: '到期', text: (v) => dueText(v, td), key: dueKey },
      _last: { label: '最近学习', text: (v) => lastText(v, td), key: (v) => (v.r && v.r.n ? v.r.last : -1), desc: true, nw: true },
      _ivl: { label: '间隔', text: (v) => (v.s.ivl > 0 ? v.s.ivl + ' 天' : '—'), key: (v) => v.s.ivl, nw: true },
      _again: { label: '答错次数', text: (v) => (v.r ? v.r.again : '—'), key: (v) => (v.r ? v.r.again : -1), desc: true, nw: true },
      _n: { label: '答题次数', text: (v) => (v.r ? v.r.n : '—'), key: (v) => (v.r ? v.r.n : -1), desc: true, nw: true },
      _tpl: { label: '卡片类型', text: (v) => v.x.tpl, key: (v) => v.x.tpl, str: true },
      _deck: { label: '原 Deck', text: (v) => v.x.deck, key: (v) => v.x.deck, str: true },
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
    <div class="main" tabindex="-1">
      <div class="stk" id="kb-stk">
      <div class="bar"><button class="b g" id="kb-tog"></button>
        <input type="search" id="kb-q" placeholder="想找某个字或词，直接打字（可不填）">
        ${onClose ? '<button class="b g" id="kb-close">关闭</button>' : ''}</div>
      <div class="bar" id="kb-chips"></div>
      <div class="bar" id="kb-acts"></div></div>
      <div class="tw" id="kb-tw"></div>
      <div id="kb-more"></div>
    </div></div>`;
  const $ = (s) => el.querySelector(s);
  // 量一下吸顶区的高度（按钮换行、提示文字变化时高度会变），让表头正好贴在它下面
  const syncBar = () => { $('#kb-root').style.setProperty('--kb-bar', $('#kb-stk').offsetHeight + 'px'); };
  if (window.ResizeObserver) new ResizeObserver(syncBar).observe($('#kb-stk')); else window.addEventListener('resize', syncBar);
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
          const dot = o[3] === 'flag' ? `<b class="fsw">${flagSvg(o[2])}</b>` : o[2] !== undefined ? (o[2] ? `<b class="dot" style="--c:${o[2]}"></b>` : '<b class="dot" style="--c:transparent"></b>') : '';
          return `<label class="opt ${n === 0 && !on ? 'zero' : ''}" title="${esc(o[1])}"><input type="checkbox" data-g="${gi}" data-o="${oi}" ${on ? 'checked' : ''}>${dot}<span>${esc(o[1])}</span><i>${n}</i></label>`; }).join('')
          + (shown.length < opts.length ? `<button class="more" data-more="${esc(g.id)}">显示全部 ${opts.length} 项</button>` : (all && opts.length > 30 ? `<button class="more" data-less="${esc(g.id)}">收起</button>` : ''));
        if (g.id === 'pkg' && !m.single) body += '<div class="hint">选 1 个 Deck 时，这里下面会多出这个 Deck 自己的字段分组。</div>';
        if (NOTE[g.id]) body += `<div class="hint">${esc(NOTE[g.id])}</div>`;
      }
      const sa = g.review && reviewState !== 'ok' ? '' : `<span class="sa"><a data-sa="all" data-g="${gi}">全选</a><a data-sa="none" data-g="${gi}">取消全选</a></span>`;
      return `<details data-id="${esc(g.id)}" ${closed.has(g.id) ? '' : 'open'}><summary>${esc(g.title)}${nsel(g.id) ? ` <small>已选 ${nsel(g.id)}</small>` : ''}${sa}</summary>${body}</details>`;
    }).join('');
    side.scrollTop = top;
    side.querySelectorAll('details').forEach((d) => d.ontoggle = () => { d.open ? closed.delete(d.dataset.id) : closed.add(d.dataset.id); });
    // 每个板块的“全选 / 取消全选”：作用于这个板块的全部选项（包括被折叠、没露出来的）
    side.querySelectorAll('a[data-sa]').forEach((a) => a.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();   // 链接在 <summary> 里，别让它顺便把板块折叠/展开了
      const g = m.groups[+a.dataset.g];
      if (a.dataset.sa === 'all') sel.set(g.id, new Set(g.opts.map((o) => o[0]).filter((v) => g.id !== 'flag' || v !== 0))); else sel.delete(g.id);   // 标记分组的“全选”不含“无标记”：想要的是“所有被标记过的”
      if (g.id === 'pkg') for (const id of [...sel.keys()]) if (!['pkg', 'time', 'perf', 'state', 'flag'].includes(id)) sel.delete(id);
      limit = 300; render();
    });
    side.querySelectorAll('input[data-g]').forEach((i) => i.onchange = () => {
      const g = m.groups[+i.dataset.g], val = g.opts[+i.dataset.o][0];
      let s = sel.get(g.id); if (!s) sel.set(g.id, (s = new Set()));
      i.checked ? s.add(val) : s.delete(val);
      if (!s.size) sel.delete(g.id);
      if (g.id === 'pkg') for (const id of [...sel.keys()]) if (!['pkg', 'time', 'perf', 'state', 'flag'].includes(id)) sel.delete(id);
      limit = 300; render();
    });
    side.querySelectorAll('[data-more]').forEach((b) => b.onclick = () => { expanded.add(b.dataset.more); render(); });
    side.querySelectorAll('[data-less]').forEach((b) => b.onclick = () => { expanded.delete(b.dataset.less); render(); });
  }

  // ---------- 颜色标记：给一批卡打 / 取消标记（n=1~7 想设的颜色；全都已经是这个颜色就变成取消；n=0 直接取消） ----------
  const pickedFlagList = () => { const st = getStates(); return [...picked].map((k) => (st.get(k) || {}).flag || 0); };
  const pickedFlag = () => { const f = pickedFlagList(); return f.length && f.every((x) => x === f[0]) ? flagColor(f[0]) : ''; };   // 选中的卡全是同一种颜色就显示那个颜色
  async function flagKeys(ks, n) {
    if (!canFlag || !ks.length) return;
    const st = getStates(), target = toggleTarget(n, ks.map((k) => (st.get(k) || {}).flag || 0));
    const say = (t) => { const mm = $('#kb-msg'); if (mm) mm.textContent = t; };
    say('处理中…');
    try { await actions.flag(ks, target); render(); say(target ? `已标成${flagName(target)}：${ks.length} 张` : `已取消标记：${ks.length} 张`); }
    catch (e) { say('失败：' + noSqlHint(e.message)); }
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
    $('#kb-tw').innerHTML = `<table><thead><tr><th class="ck"><input type="checkbox" id="kb-all" title="选中全部符合条件的 ${rows.length} 张" ${allOn ? 'checked' : ''}></th>${col.list.map((id) => `<th data-s="${esc(id)}" class="${sort.col === id ? 'on' : ''} ${C[id].nw ? 'nw' : ''}">${esc(C[id].label)}${sort.col === id ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${shown.map((v, ri) => `<tr data-r="${ri}" class="${v.flag ? 'fl' + v.flag : v.k === 'sus' ? 'k-sus' : ''} ${picked.has(v.x.key) ? 'sel' : ''} ${focus === v.x.key ? 'cur' : ''}"><td class="ck"><input type="checkbox" data-k="${ri}" ${picked.has(v.x.key) ? 'checked' : ''}><span class="ex" data-x="${ri}" title="展开 / 收起这张卡的详情（也可以双击这一行）">${focus === v.x.key ? '▾' : '▸'}</span>${v.flag ? `<span class="fg" title="${esc(flagName(v.flag))}">${flagSvg(flagColor(v.flag), 15)}</span>` : ''}</td>${col.list.map((id) => `<td class="${C[id].nw ? 'nw' : ''}" title="${esc(C[id].html ? '' : C[id].text(v))}">${C[id].html ? C[id].html(v) : esc(C[id].text(v))}</td>`).join('')}</tr>${focus === v.x.key ? `<tr class="dt"><td colspan="${col.list.length + 1}"><div class="detail">${detailHtml(v, m.td)}</div></td></tr>` : ''}`).join('')
        || `<tr><td colspan="${col.list.length + 1}" class="msg" style="padding:16px">没有符合条件的卡片</td></tr>`}</tbody></table>`;
    const tw = $('#kb-tw');
    tw.querySelectorAll('th[data-s]').forEach((h) => h.onclick = () => { const id = h.dataset.s; sort = sort.col === id ? { col: id, dir: -sort.dir } : { col: id, dir: C[id].desc ? -1 : 1 }; render(); });
    // ---- 选行（照 Windows / Anki）：单击=只选这行；Ctrl+单击=加选/减选；Shift+单击=从上次点的行连选；双击或点 ▸ = 展开详情 ----
    // 选中状态变化时只更新行的底色和操作栏，不重画整张表（否则双击会被吃掉，几百行也慢）
    const idxOf = (key) => (key == null ? -1 : shown.findIndex((v) => v.x.key === key));
    const syncSel = () => {
      tw.querySelectorAll('tbody tr[data-r]').forEach((tr) => { const on = picked.has(shown[+tr.dataset.r].x.key); tr.classList.toggle('sel', on); const c = tr.querySelector('input[data-k]'); if (c) c.checked = on; });
      const all = $('#kb-all'); if (all) all.checked = rows.length > 0 && picked.size === rows.length;
      renderActs();
    };
    syncCur = syncSel;
    const toggleFocus = (k) => { focus = focus === k ? null : k; editing = null; draft = {}; emsg = ''; render(); };
    $('#kb-all').onchange = (e) => { e.target.checked ? rows.forEach((v) => picked.add(v.x.key)) : picked.clear(); syncSel(); };
    tw.querySelectorAll('input[data-k]').forEach((i) => i.onclick = (e) => {   // 小方框：点一下加/减一行；按住 Shift = 连选（iPad 没有 Ctrl/Shift，靠它）
      e.stopPropagation();
      const ri = +i.dataset.k, k = shown[ri].x.key, li = idxOf(lastKey);
      if (e.shiftKey && li >= 0) { for (let j = Math.min(li, ri); j <= Math.max(li, ri); j++) i.checked ? picked.add(shown[j].x.key) : picked.delete(shown[j].x.key); }
      else i.checked ? picked.add(k) : picked.delete(k);
      lastKey = k; syncSel();
    });
    tw.querySelectorAll('.ex').forEach((x) => x.onclick = (e) => { e.stopPropagation(); toggleFocus(shown[+x.dataset.x].x.key); });
    tw.querySelectorAll('tbody tr[data-r]').forEach((tr) => {
      tr.onclick = (e) => {
        if (e.target.closest('input,.ex,a,button')) return;
        if (e.detail > 1) return;   // 双击的第二下：交给 dblclick，不要再改选中
        const ri = +tr.dataset.r, k = shown[ri].x.key, li = idxOf(lastKey), multi = e.ctrlKey || e.metaKey;
        if (e.shiftKey && li >= 0) { if (!multi) picked.clear(); for (let j = Math.min(li, ri); j <= Math.max(li, ri); j++) picked.add(shown[j].x.key); }   // 连选：起点（lastKey）不动
        else if (multi) { picked.has(k) ? picked.delete(k) : picked.add(k); lastKey = k; }
        else { const only = picked.size === 1 && picked.has(k); picked.clear(); if (!only) picked.add(k); lastKey = k; }
        el.querySelector('.main').focus({ preventScroll: true });   // 让 Ctrl+A 生效
        syncSel();
      };
      tr.ondblclick = (e) => { if (e.target.closest('input,a,button')) return; toggleFocus(shown[+tr.dataset.r].x.key); };
    });
    $('#kb-more').innerHTML = rows.length > shown.length ? `<div class="bar" style="margin-top:8px"><button class="b g" id="kb-moreb">再显示 300 条（共 ${rows.length} 条符合）</button></div>` : '';
    if ($('#kb-moreb')) $('#kb-moreb').onclick = () => { limit += 300; render(); };

    // 操作栏（选中数变化时单独重画，见 syncSel）
    const renderActs = () => {
    const colBtn = col.chooser ? `<span class="cols"><button class="b g" id="kb-cols">列 ▾</button>${colsOpen ? `<div class="pop">${col.order.map((id) => `<label class="opt"><input type="checkbox" data-col="${esc(id)}" ${col.chosen.includes(id) ? 'checked' : ''}><span>${esc(C[id].label)}</span></label>`).join('')}<div class="hint">整列都是空的字段会自动隐藏</div></div>` : ''}</span>` : '';
    $('#kb-acts').innerHTML = `<span class="msg">符合 <b>${rows.length}</b> 张 / 共 ${m.total} 张 · 已选 <b>${picked.size}</b> 张</span>
      ${picked.size ? '<button class="b g" id="kb-none">取消选择</button>' : ''}
      ${canFlag ? `<button class="b g flagbtn" id="kb-flag" title="短按：标红旗（已是红旗再短按 = 取消）；长按或右键：选其他颜色；快捷键 Ctrl+1…7" ${picked.size ? '' : 'disabled'}>${flagSvg(pickedFlag())}标记</button>` : ''}
      ${picked.size && opts.edit ? '<button class="b g" id="kb-cid" title="把选中卡片的 Anki 编号（cid）复制下来，到 Anki 的浏览器搜索框里粘贴，就能选中同一批卡">复制 Anki 编号</button>' : ''}
      ${canManage ? `<button class="b" id="kb-rel" ${picked.size ? '' : 'disabled'}>取消暂停</button><button class="b" id="kb-sus" ${picked.size ? '' : 'disabled'}>暂停</button><button class="b" id="kb-due" ${picked.size ? '' : 'disabled'}>设为今天复习</button>` : '<span class="msg">老师没有开放“自己管理卡片”，这里只能查看。</span>'}
      <span style="flex:1"></span><span class="acts-hint">单击选中 · Ctrl+单击 加选 · Shift+单击 连选 · 双击看详情${canFlag ? ' · 标记：短按=红旗，长按=选颜色，Ctrl+1…7' : ''}</span>${colBtn}<span class="msg" id="kb-msg"></span>`;
    if ($('#kb-none')) $('#kb-none').onclick = () => { picked.clear(); syncSel(); };
    if ($('#kb-flag')) {
      const fb = $('#kb-flag'), cur = () => { const f = pickedFlagList(); return f.length && f.every((x) => x === f[0]) ? f[0] : 0; };
      pressable(fb, () => flagKeys([...picked], 1), () => showFlagMenu(fb, cur(), (n) => flagKeys([...picked], n)));
    }
    if ($('#kb-cid')) $('#kb-cid').onclick = async () => {
      const ids = [...picked].map((k) => k.slice(k.indexOf(':') + 1)), mm = $('#kb-msg');
      try { await navigator.clipboard.writeText('cid:' + ids.join(',')); mm.textContent = `已复制 ${ids.length} 个编号：到 Anki 浏览器的搜索框粘贴即可选中这批卡`; }
      catch (e) { mm.textContent = '复制失败（浏览器不让写剪贴板）'; }
    };
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
      $('#kb-rel').onclick = () => run((k) => actions.suspend(k, false), '已取消暂停 {n} 张', (n) => (n > 30 ? '取消暂停选中的 {n} 张卡？' : null));
      $('#kb-sus').onclick = () => run((k) => actions.suspend(k, true), '已暂停 {n} 张', '暂停选中的 {n} 张卡？它们不会再出现在学习队列里。');
      $('#kb-due').onclick = () => run((k) => actions.dueToday(k), '已把 {n} 张复习卡设为今天复习', '把选中的卡里“还没到期的复习卡”设为今天复习？（新卡、学习中的卡不受影响）');
    }
    };
    renderActs(); syncBar();

    bindDetail(m, rows);
  }

  // ---------- 点一行：在这一行下面展开这张卡的全部字段；老师可以直接改文字 ----------
  let editing = null, draft = {}, emsg = '';
  // 只允许改“纯文字”字段：没有复杂标签（只许 br/b/i/u/span/div 等简单格式和 [sound:…] 声音标记）、不是纯声音/图片
  const SIMPLE = /<\/?(?:br|b|i|u|strong|em|span|div|p|font|sup|sub)\b[^<>]*>|\[sound:[^\]]*\]/gi;
  const canEditRaw = (raw) => !raw.replace(SIMPLE, '').includes('<') && (raw.match(/<[^>]+>/g) || []).length <= 6 && !/^(\s|\[sound:[^\]]*\]|<br\s*\/?>)+$/i.test(raw);
  const toText = (raw) => raw.replace(/<br\s*\/?>/gi, '\n');
  const toRaw = (t) => t.replace(/\r?\n/g, '<br>');
  function detailHtml(fv, td) {
    const c = fv.x.c, p = prep(fv.x.slug), mdl = p.models[c.m], key = fv.x.key;
    const info = [['Deck', pkgName[fv.x.slug]], ['笔记类型 / 卡片', `${fv.x.model} / ${fv.x.tpl}`]];
    const tail = [['标签', fv.x.tags.join(' ') || '—'], ['状态', `${KIND[fv.k]}；到期：${dueText(fv, td)}；间隔 ${fv.s.ivl} 天`], ['标记', fv.flag ? flagName(fv.flag) : '无'],
      ['学习记录', fv.r ? `答过 ${fv.r.n} 次，答错 ${fv.r.again} 次；最近 ${lastText(fv, td)}` : '没有记录']];
    const row = ([n, t]) => `<div class="f"><b>${esc(n)}</b><span>${esc(t || '—')}</span></div>`;
    const can = opts.edit && c.r && mdl.tm;
    if (can && editing === key) {
      const fields = mdl.fields.map((n, i) => (canEditRaw(c.r[i])
        ? `<div class="f"><b>${esc(n)}</b><textarea data-fi="${i}" rows="${Math.min(6, 1 + ((draft[i] ?? toText(c.r[i])).match(/\n/g) || []).length)}">${esc(draft[i] ?? toText(c.r[i]))}</textarea></div>`
        : `<div class="f ro"><b>${esc(n)}</b><span>${esc(c.v[i] || '—')}　（声音、图片或复杂版式，不能在这里改）</span></div>`)).join('');
      return `${info.map(row).join('')}${fields}<div class="hint">文字里方括号 [sound:…] 是声音标记，请保留；换行直接按回车。</div>
        <div class="btns"><button class="b" id="kb-save">保存修改</button><button class="b g" id="kb-cancel">取消</button><span class="msg" id="kb-emsg">${esc(emsg)}</span></div>`;
    }
    const fields = Object.entries(fv.x.v).filter(([n]) => p.text.includes(n)).map(row).join('');
    const btns = can ? `<div class="btns"><button class="b g" id="kb-edit">✎ 修改文字</button>${c.ed ? '<button class="b g" id="kb-reset">恢复原文</button><span class="tagged">这张卡的文字被修改过</span>' : ''}<span class="msg" id="kb-emsg">${esc(emsg)}</span></div>` : '';
    const fl = canFlag && fv.flag ? `<div class="btns"><button class="b g flagbtn" id="kb-unflag">${flagSvg(flagColor(fv.flag))}取消标记（${esc(flagName(fv.flag))}）</button></div>` : '';
    return info.map(row).join('') + fields + tail.map(row).join('') + fl + btns;
  }
  function bindDetail(m, rows) {
    const root = el.querySelector('.detail'); if (!root) return;
    root.querySelectorAll('textarea[data-fi]').forEach((t) => { t.oninput = () => { draft[t.dataset.fi] = t.value; }; });
    const fv = rows.find((v) => v.x.key === focus); if (!fv) return;
    const c = fv.x.c, slug = fv.x.slug, key = fv.x.key, mdl = prep(slug).models[c.m];
    const done = (text) => { delete P[slug]; editing = null; draft = {}; emsg = ''; render(); const mm = $('#kb-msg'); if (mm) mm.textContent = text; };
    if ($('#kb-unflag')) $('#kb-unflag').onclick = () => flagKeys([key], 0);
    if ($('#kb-edit')) $('#kb-edit').onclick = () => { editing = key; draft = {}; emsg = ''; render(); };
    if ($('#kb-cancel')) $('#kb-cancel').onclick = () => { editing = null; draft = {}; emsg = ''; render(); };
    if ($('#kb-save')) $('#kb-save').onclick = async () => {
      const changes = {};
      for (const [k, txt] of Object.entries(draft)) {
        const i = +k; if (!canEditRaw(c.r[i])) continue;
        const nv = toRaw(txt);
        if (nv === toRaw(toText(c.r[i]))) continue;
        if (nv.replace(SIMPLE, '').includes('<')) { emsg = `「${mdl.fields[i]}」里不能有 < 符号`; render(); return; }
        changes[mdl.fields[i]] = nv;
      }
      if (!Object.keys(changes).length) { editing = null; draft = {}; emsg = ''; render(); return; }
      $('#kb-emsg').textContent = '保存中…';
      try { await opts.edit.save(key, changes); done('已保存修改'); } catch (e) { emsg = '失败：' + e.message; render(); }
    };
    if ($('#kb-reset')) $('#kb-reset').onclick = async () => {
      if (!confirm('把这张卡的文字恢复成最初导入的样子？')) return;
      try { await opts.edit.reset(key); done('已恢复原文'); } catch (e) { emsg = '失败：' + e.message; render(); }
    };
  }

  // Ctrl+A（Mac 为 ⌘A）：选中当前符合条件的全部卡（在输入框里打字时不拦截）
  el.addEventListener('keydown', (e) => {
    const t = e.target;
    if ((e.ctrlKey || e.metaKey) && /^[1-7]$/.test(e.key) && canFlag && picked.size && !(t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'checkbox'))) { e.preventDefault(); flagKeys([...picked], +e.key); return; }   // Ctrl+1…7：同 Anki
    if (!(e.ctrlKey || e.metaKey) || (e.key !== 'a' && e.key !== 'A')) return;
    if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'checkbox')) return;
    if (!M || !M.rows) return;
    e.preventDefault(); M.rows.forEach((v) => picked.add(v.x.key)); syncCur();
  });

  function render() { const m = compute(); renderSide(m); renderMain(m); setTog(); }
  render();
  if (loadReview) {
    loadReview().then((rows) => { review = new Map((rows || []).map((r) => [r[0], { last: r[1], n: r[2], again: r[3], lastAgain: r[4] }])); reviewState = 'ok'; render(); })
      .catch(() => { reviewState = 'err'; render(); });
  }
  return { refresh: render };
}
