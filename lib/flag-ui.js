// 颜色标记（Flag）的共用界面件：学生背卡页和管理卡片（卡片浏览器）都用它。
// 编号、颜色顺序、英文名都和 Anki 完全一致：1 红 Red、2 橙 Orange、3 绿 Green、4 蓝 Blue、5 粉 Pink、6 青 Turquoise、7 紫 Purple；0 = 没有标记。
// 按钮的手感：短按 = 标红旗（已经是红旗再短按 = 取消）；长按（或鼠标右键）= 弹出 7 种颜色 + “取消标记”自己选。
// 选中的颜色如果就是卡片现在的颜色，再选一次 = 取消（和 Anki 的 Ctrl+1…7 一样）。

export const FLAGS = [
  [1, '红色', 'Red', '#f0524d'], [2, '橙色', 'Orange', '#f5993a'], [3, '绿色', 'Green', '#33c46f'], [4, '蓝色', 'Blue', '#4a8cf5'],
  [5, '粉色', 'Pink', '#ee6fe0'], [6, '青色', 'Turquoise', '#27c9bd'], [7, '紫色', 'Purple', '#a05cf0'],
];
export const flagColor = (n) => (FLAGS.find((f) => f[0] === n) || [])[3] || '';
export const flagName = (n) => (FLAGS.find((f) => f[0] === n) || [0, '无标记'])[1];
// 点一次要变成什么：n = 想设成的颜色（1~7）；current = 现在的颜色（单张卡）或一批卡现有颜色的数组。全都已经是 n → 取消（0）
export const toggleTarget = (n, current) => { const cur = Array.isArray(current) ? current : [current]; return n === 0 || (cur.length && cur.every((f) => (f || 0) === n)) ? 0 : n; };
// 数据库没运行 08 号 SQL 时各种报错的统一说明
export const noSqlHint = (msg) => (/does not exist|schema cache|could not find|HTTP 404|column|function/i.test(msg || '')
  ? '数据库还没运行 08 号 SQL（08-Augie-Anki测试系统-颜色标记.sql），运行后刷新页面才能保存标记' : msg);

// 小旗子图标：有颜色 = 实心；没有颜色 = 空心灰色轮廓
export function flagSvg(color, size = 16) {
  const c = color || 'currentColor';
  return `<svg class="fsv" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.5v13" stroke="${c}" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M4.3 2.4h8.2l-2.3 3.1 2.3 3.1H4.3z" fill="${color || 'none'}" stroke="${c}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
}

const CSS = `
.flagmenu{position:fixed;z-index:9999;background:var(--card,#fff);color:var(--ink,#222);border:1px solid var(--line,#ddd);border-radius:12px;padding:6px;box-shadow:0 8px 28px rgba(0,0,0,.25);min-width:210px;font-size:15px;-webkit-user-select:none;user-select:none}
.flagmenu button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;color:inherit;font:inherit;padding:10px 12px;border-radius:8px;cursor:pointer;text-align:left}
.flagmenu button:hover,.flagmenu button:focus-visible{background:var(--bg,#eef0f3);outline:0}
.flagmenu button.on{font-weight:700;background:var(--bg,#eef0f3)}
.flagmenu button i{margin-left:auto;font-style:normal;color:var(--mute,#888);font-size:12px}
.flagmenu hr{border:0;border-top:1px solid var(--line,#e5e7ea);margin:4px 2px}
.flagmenu .fsv{flex:none}
.flagbtn{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation}
.fsv{vertical-align:-3px}
`;
let styled = false;
function ensureStyle() { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

// 弹出颜色菜单。anchor = 按钮；current = 现在的颜色（高亮用）；onPick(n)：n=1~7 选了某色，n=0 取消标记。
let openMenu = null;
export function closeFlagMenu() { if (openMenu) { openMenu(); openMenu = null; } }
export function showFlagMenu(anchor, current, onPick) {
  ensureStyle(); closeFlagMenu();
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;   // 触屏设备没有 Ctrl 键，不显示快捷键提示
  const m = document.createElement('div'); m.className = 'flagmenu'; m.setAttribute('role', 'menu');
  m.innerHTML = FLAGS.map((f) => `<button data-f="${f[0]}" class="${current === f[0] ? 'on' : ''}">${flagSvg(f[3], 18)}<span>${f[1]} ${f[2]}</span>${touch ? '' : `<i>Ctrl+${f[0]}</i>`}</button>`).join('')
    + `<hr><button data-f="0">${flagSvg('', 18)}<span>取消标记</span></button>`;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8), top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);   // 下面放不下就弹在按钮上面
  m.style.left = left + 'px'; m.style.top = top + 'px';
  const opened = Date.now();
  const close = () => { m.remove(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true); window.removeEventListener('scroll', closeFlagMenu, true); window.removeEventListener('resize', closeFlagMenu); };
  const away = (e) => { if (!m.contains(e.target)) closeFlagMenu(); };
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeFlagMenu(); } };
  m.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]'); if (!b || Date.now() - opened < 250) return;   // 刚弹出的 0.25 秒内不响应（防止长按松手时误点）
    closeFlagMenu(); onPick(+b.dataset.f);
  });
  document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true);
  window.addEventListener('scroll', closeFlagMenu, true); window.addEventListener('resize', closeFlagMenu);
  openMenu = close;
  m.querySelector('button.on, button')?.focus({ preventScroll: true });
}

// 让一个按钮拥有“短按 / 长按”：onShort() = 短按；onLong() = 长按 450 毫秒（或鼠标右键 / 触屏长按菜单）。键盘回车/空格 = 短按。
export function pressable(btn, onShort, onLong, ms = 450) {
  ensureStyle(); btn.classList.add('flagbtn');
  let t = null;
  const clear = () => { clearTimeout(t); t = null; };
  btn.addEventListener('pointerdown', (e) => { if (e.button > 0 || btn.disabled) return; clear(); t = setTimeout(() => { t = null; onLong(); }, ms); });
  btn.addEventListener('pointerup', () => { if (t) { clear(); onShort(); } });   // 没到 450 毫秒就松手 = 短按；到了的话长按菜单早就弹出，这里什么也不做
  btn.addEventListener('pointerleave', clear); btn.addEventListener('pointercancel', clear);
  btn.addEventListener('contextmenu', (e) => { e.preventDefault(); clear(); if (!btn.disabled) onLong(); });
  btn.addEventListener('click', (e) => { e.preventDefault(); if (e.detail === 0 && !btn.disabled) onShort(); });   // detail=0：键盘触发
}
