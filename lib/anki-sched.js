// Anki 旧调度（SM-2）的复刻，参数 = Augie 的 Anki 里带出来的 "Default" 预设。
// 【临时测试系统】按我对 Anki v3 规则的理解实现，并用 Augie 真实答题记录做过一致性检验（见 test/）。
// 不是 Anki 源码的逐行翻译；与 Anki 有出入的地方写在 DEVIATIONS 里。
//
// 卡片字段（同 Anki cards 表）：
//   type  0 新卡 1 学习中 2 复习 3 重学
//   queue 0 新卡 1 学习中(due=Unix 秒) 2 复习(due=第几天) 3 跨天学习(due=第几天)
//   due / ivl / factor(千分数) / reps / lapses / lft(学习步骤剩余)
//
// 浏览器和 Node 通用（纯函数、无依赖）。

export const CRT = 1716148800; // Anki 集合创建时间（2024-05-20 04:00 +08），"第几天"从这里起算；每天 04:00 换天

export const CFG = Object.freeze({
  learnSteps: [1, 10],      // 分钟
  relearnSteps: [10],       // 分钟
  gradGood: 1,              // 学习"好"毕业间隔（天）
  gradEasy: 4,              // 学习"简单"毕业间隔（天）
  initialEase: 2500,
  easyBonus: 1.3,
  hardMult: 1.2,
  intervalMult: 1.0,
  newInterval: 0.0,         // 答错后新间隔 = 原间隔 × 0%
  minLapseIvl: 1,
  maxIvl: 36500,
  learnAheadSecs: 20 * 60,
  newPerDay: 20,
  revPerDay: 200,
});

export const DEVIATIONS = [
  '间隔随机抖动（fuzz）的取值范围按 Anki 公式，但随机数不是 Anki 的同一个种子，所以同一张卡的具体天数可能差 1~几天。',
  '学习卡"今天剩余步数"用 lft 的个位表示剩余步骤数，Anki 的千位（今天剩余次数）不使用。',
  '新卡/复习卡的混合顺序、复习卡当天内的顺序是近似 Anki 默认（先到期天数、同天随机；新卡按位置均匀穿插）。',
];

export const dayNumber = (nowMs) => Math.floor((nowMs / 1000 - CRT) / 86400);
const minToSec = (m) => Math.round(m * 60);

// ---------- 间隔与随机抖动 ----------
export function fuzzBounds(ivl, minimum, maxIvl) {
  if (ivl < 2.5) return [Math.max(Math.round(ivl), minimum), Math.min(Math.max(Math.round(ivl), minimum), maxIvl)];
  let delta = 1.0;
  for (const [s, e, f] of [[2.5, 7, 0.15], [7, 20, 0.1], [20, Infinity, 0.05]]) delta += f * Math.max(Math.min(ivl, e) - s, 0);
  let lo = Math.round(ivl - delta), hi = Math.round(ivl + delta);
  lo = Math.max(lo, minimum, 1);
  hi = Math.min(hi, maxIvl);
  if (hi < lo) hi = lo;
  return [lo, hi];
}

// 复习卡答对后的三个"原始间隔"（未抖动、未取整的上下限在 constrain 里处理）
export function passingIntervals(card, daysLate, cfg = CFG) {
  const cur = card.ivl, ease = card.factor / 1000;
  const mult = cfg.intervalMult;
  const hardMin = cfg.hardMult <= 1 ? 0 : cur + 1;
  const hard = Math.max(Math.round(cur * cfg.hardMult * mult), hardMin);
  const goodMin = cfg.hardMult <= 1 ? cur + 1 : hard + 1;
  const good = Math.max(Math.round((cur + daysLate / 2) * ease * mult), goodMin);
  const easy = Math.max(Math.round((cur + daysLate) * ease * cfg.easyBonus * mult), good + 1);
  return { hard, good, easy };
}

function pickIvl(raw, minimum, cfg, fuzz, rng) {
  const r = Math.min(Math.max(raw, minimum, 1), cfg.maxIvl);
  if (!fuzz) return r;
  const [lo, hi] = fuzzBounds(r, Math.max(minimum, 1), cfg.maxIvl);
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ---------- 作答 ----------
// 返回 { card: 新状态, log: 复习记录需要的字段 }。ease: 1 重来 2 难 3 好 4 简单
export function answer(card, ease, nowMs, cfg = CFG, opts = {}) {
  const { fuzz = true, rng = Math.random } = opts;
  const nowSec = Math.floor(nowMs / 1000);
  const today = dayNumber(nowMs);
  const c = { ...card };
  const prevType = card.type;
  let logType;

  const setLearning = (delayMin, remaining, isRelearn) => {
    const sec = minToSec(delayMin);
    c.type = isRelearn ? 3 : 1;
    c.lft = remaining;
    if (sec >= 86400) { c.queue = 3; c.due = today + Math.max(1, Math.round(sec / 86400)); }
    else { c.queue = 1; c.due = nowSec + sec; }
    c.logIvl = sec >= 86400 ? Math.round(sec / 86400) : -sec;
  };
  const graduate = (ivlDays) => {
    c.type = 2; c.queue = 2; c.lft = 0; c.ivl = ivlDays; c.due = today + ivlDays; c.logIvl = ivlDays;
  };

  if (card.type === 2) {
    // ---- 复习卡 ----
    logType = 1;
    const daysLate = Math.max(today - card.due, 0);
    if (ease === 1) {
      c.lapses = card.lapses + 1;
      c.factor = Math.max(1300, card.factor - 200);
      const raw = Math.round(card.ivl * cfg.newInterval);
      const newIvl = Math.min(Math.max(raw, cfg.minLapseIvl), cfg.maxIvl);
      c.ivl = newIvl;
      if (cfg.relearnSteps.length) setLearning(cfg.relearnSteps[0], cfg.relearnSteps.length, true);
      else { c.due = today + newIvl; c.logIvl = newIvl; }
    } else {
      const p = passingIntervals(card, daysLate, cfg);
      if (ease === 2) { c.factor = Math.max(1300, card.factor - 150); c.ivl = pickIvl(p.hard, 1, cfg, fuzz, rng); }
      else if (ease === 3) { c.ivl = pickIvl(p.good, 1, cfg, fuzz, rng); }
      else { c.factor = card.factor + 150; c.ivl = pickIvl(p.easy, 1, cfg, fuzz, rng); }
      c.due = today + c.ivl; c.logIvl = c.ivl;
    }
  } else {
    // ---- 新卡 / 学习中 / 重学 ----
    const isRelearn = card.type === 3;
    logType = isRelearn ? 2 : 0;
    const steps = isRelearn ? cfg.relearnSteps : cfg.learnSteps;
    const n = steps.length;
    const remaining = card.type === 0 || !card.lft || card.lft > n ? n : card.lft;
    const idx = n - remaining;
    if (card.type === 0) { c.factor = card.factor || cfg.initialEase; }

    if (ease === 1) {
      setLearning(steps[0], n, isRelearn);
    } else if (ease === 2) {
      let delay;
      if (idx === 0) delay = n > 1 ? (steps[0] + steps[1]) / 2 : Math.min(steps[0] * 1.5, steps[0] + 1440);
      else delay = steps[idx];
      setLearning(delay, remaining, isRelearn);
    } else if (ease === 3) {
      if (idx + 1 < n) setLearning(steps[idx + 1], remaining - 1, isRelearn);
      else if (isRelearn) graduate(Math.max(card.ivl, 1));
      else graduate(cfg.gradGood);
    } else {
      if (isRelearn) graduate(Math.min(Math.max(card.ivl, 1) + 1, cfg.maxIvl));
      else graduate(pickIvl(cfg.gradEasy, 1, cfg, fuzz, rng));   // Anki 对"简单"毕业间隔也做抖动（4 天 → 3~5 天）
    }
  }

  c.reps = card.reps + 1;
  const logIvl = c.logIvl; delete c.logIvl;
  return {
    card: c,
    log: { ts: nowMs, ease, ivl: logIvl ?? 0, last_ivl: card.queue === 1 ? -Math.abs(card.ivl || 0) : card.ivl, factor: c.factor, type: logType, prev_type: prevType },
  };
}

// 四个按钮下面显示的"下次多久后再出现"（不抖动）
export function previewIntervals(card, nowMs, cfg = CFG) {
  const today = dayNumber(nowMs), nowSec = Math.floor(nowMs / 1000);
  return [1, 2, 3, 4].map((e) => {
    const { card: n } = answer(card, e, nowMs, cfg, { fuzz: false });
    return n.queue === 1 ? { sec: n.due - nowSec } : { days: n.due - today };
  });
}

export function formatDelay(d) {
  if (d.sec !== undefined) {
    const s = Math.max(d.sec, 0);
    if (s < 60) return '<1分';
    if (s < 3600) return Math.round(s / 60) + '分';
    return (s / 3600).toFixed(1).replace(/\.0$/, '') + '小时';
  }
  const days = d.days;
  if (days < 30) return days + '天';
  if (days < 365) return (days / 30).toFixed(1).replace(/\.0$/, '') + '个月';
  return (days / 365).toFixed(1).replace(/\.0$/, '') + '年';
}

// ---------- 今天的学习队列 ----------
// cards: [{key, type, queue, due, ... , suspended}]；counts: {newDone, revDone}（今天已经学的）
// 返回 { learnDue, learnAhead, interday, reviews, news, counts:{new, learn, review} }
export function buildQueue(cards, nowMs, counts, limits = { newPerDay: CFG.newPerDay, revPerDay: CFG.revPerDay }, cfg = CFG, rng = Math.random) {
  const today = dayNumber(nowMs), nowSec = Math.floor(nowMs / 1000);
  const act = cards.filter((c) => !c.suspended);
  const learn = act.filter((c) => c.queue === 1).sort((a, b) => a.due - b.due);
  const learnDue = learn.filter((c) => c.due <= nowSec);
  const learnAhead = learn.filter((c) => c.due > nowSec && c.due <= nowSec + cfg.learnAheadSecs);
  const interday = act.filter((c) => c.queue === 3 && c.due <= today);
  const revAll = act.filter((c) => c.queue === 2 && c.due <= today);
  // 先按到期天数，同一天内随机
  const revSorted = revAll.map((c) => ({ c, r: rng() })).sort((a, b) => a.c.due - b.c.due || a.r - b.r).map((x) => x.c);
  const reviews = revSorted.slice(0, Math.max(limits.revPerDay - (counts.revDone || 0), 0));
  const news = act.filter((c) => c.queue === 0).sort((a, b) => a.due - b.due)
    .slice(0, Math.max(limits.newPerDay - (counts.newDone || 0), 0));
  return { learnDue, learnAhead, interday, reviews, news,
    counts: { new: news.length, learn: learn.length + interday.length, review: reviews.length } };
}

// 取下一张要学的卡。规则（近似 Anki 默认）：
//   1) 到期的学习卡 → 2) 跨天学习卡 → 3) 复习卡与新卡均匀穿插 → 4) 20 分钟内到期的学习卡（提前学）
export function nextCard(q, shownNew = 0, shownRev = 0) {
  if (q.learnDue.length) return q.learnDue[0];
  if (q.interday.length) return q.interday[0];
  const nR = q.reviews.length, nN = q.news.length;
  if (nR && nN) {
    // 新卡均匀穿插在复习卡里：谁的完成比例更低，先出谁
    const newProg = shownNew / (shownNew + nN), revProg = shownRev / (shownRev + nR);
    return newProg <= revProg ? q.news[0] : q.reviews[0];
  }
  if (nR) return q.reviews[0];
  if (nN) return q.news[0];
  if (q.learnAhead.length) return q.learnAhead[0];
  return null;
}
