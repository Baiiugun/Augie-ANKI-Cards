// 用 Augie 真实的 Anki 答题记录检验 lib/anki-sched.js：我的规则能不能复现他的 Anki 结果？
// 用法：node validate-against-revlog.mjs <sched.json>   （sched.json 由 原型代码-wordsite/lib/_dump_sched.py 导出，含个人学习历史，不要提交到仓库）
import fs from 'node:fs';
import { CRT, CFG, passingIntervals, fuzzBounds, dayNumber, answer } from '../lib/anki-sched.js';
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const day = (ms) => Math.floor((ms / 1000 - CRT) / 86400);
const tot = { review: { n: 0, inFuzz: 0, within1: 0, byEase: {} }, factor: { n: 0, ok: 0, bad: [] }, learn: { n: 0, ok: 0, bad: {} }, lapse: { n: 0, ok: 0 } };
for (const [pkg, d] of Object.entries(data)) {
  const byCard = new Map();
  for (const r of d.revlog) { if (!byCard.has(r[1])) byCard.set(r[1], []); byCard.get(r[1]).push(r); }
  for (const rows of byCard.values()) {
    let prev = null;
    for (const [id, cid, ease, ivl, lastIvl, factor, type] of rows) {
      if (type === 4 || ease === 0) { continue; }           // 手动改期，跳过
      const cur = { id, ease, ivl, lastIvl, factor, type };
      if (prev) {
        // ---- 易度规则 ----
        if (type === 1 && prev.factor > 0 && factor > 0) {
          const exp = ease === 1 ? Math.max(1300, prev.factor - 200) : ease === 2 ? Math.max(1300, prev.factor - 150) : ease === 3 ? prev.factor : prev.factor + 150;
          tot.factor.n++; if (exp === factor) tot.factor.ok++; else if (tot.factor.bad.length < 5) tot.factor.bad.push({ pkg, ease, prevF: prev.factor, f: factor, exp });
        }
        // ---- 复习卡间隔规则 ----
        if (type === 1 && ease >= 2 && ivl > 0 && lastIvl > 0 && prev.factor > 0) {
          const prevDue = day(prev.id) + (prev.ivl > 0 ? prev.ivl : 0);
          const daysLate = Math.max(day(id) - prevDue, 0);
          const p = passingIntervals({ ivl: lastIvl, factor: prev.factor }, daysLate, CFG);
          const raw = ease === 2 ? p.hard : ease === 3 ? p.good : p.easy;
          const [lo, hi] = fuzzBounds(raw, 1, CFG.maxIvl);
          const t = tot.review; t.n++;
          const be = (t.byEase[ease] ??= { n: 0, inFuzz: 0 }); be.n++;
          if (ivl >= lo && ivl <= hi) { t.inFuzz++; be.inFuzz++; }
          if (Math.abs(ivl - raw) <= Math.max(1, Math.round(raw * 0.08))) t.within1++;
        }
        // ---- 答错（复习卡）：应进入 10 分钟重学 ----
        if (type === 1 && ease === 1) { tot.lapse.n++; if (ivl === -600) tot.lapse.ok++; }
      }
      // ---- 学习步骤规则（只看每张卡的前几条学习记录，上一条是学习状态才可靠）----
      if (type === 0) {
        const L = tot.learn;
        let exp = null;
        if (lastIvl === 0 || (prev && prev.type === 0 && false)) { /* 新卡首次答 */ }
        if (lastIvl === 0) exp = ease === 1 ? -60 : ease === 2 ? -330 : ease === 3 ? -600 : 4;           // 首次：重来1分/难5.5分/好10分/简单4天
        else if (lastIvl === -60) exp = ease === 1 ? -60 : ease === 2 ? -330 : ease === 3 ? -600 : 4;
        else if (lastIvl === -330) exp = ease === 1 ? -60 : ease === 2 ? -600 : ease === 3 ? -600 : 4;
        else if (lastIvl === -600) exp = ease === 1 ? -60 : ease === 2 ? -600 : ease === 3 ? 1 : 4;
        if (exp === 4 && ease === 4) { L.n++; if (ivl >= 3 && ivl <= 5) L.ok++; else { const k = `easy:${ivl}`; L.bad[k] = (L.bad[k] || 0) + 1; } }
        else if (exp !== null) { L.n++; if (exp === ivl) L.ok++; else { const k = `${lastIvl}→e${ease}:${ivl}(exp ${exp})`; L.bad[k] = (L.bad[k] || 0) + 1; } }
      }
      prev = cur;
    }
  }
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
console.log('易度变化规则   ', tot.factor.ok, '/', tot.factor.n, pct(tot.factor.ok, tot.factor.n), tot.factor.bad.length ? JSON.stringify(tot.factor.bad) : '');
console.log('复习间隔(在抖动范围内)', tot.review.inFuzz, '/', tot.review.n, pct(tot.review.inFuzz, tot.review.n), ' 按按钮:', JSON.stringify(tot.review.byEase));
console.log('答错→10分钟重学', tot.lapse.ok, '/', tot.lapse.n, pct(tot.lapse.ok, tot.lapse.n));
console.log('学习步骤规则   ', tot.learn.ok, '/', tot.learn.n, pct(tot.learn.ok, tot.learn.n));
const bad = Object.entries(tot.learn.bad).sort((a, b) => b[1] - a[1]).slice(0, 8);
if (bad.length) console.log('  学习步骤不一致的前几种:', JSON.stringify(bad));
