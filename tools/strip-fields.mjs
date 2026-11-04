// 一次性工具（2026-11-04）：把网页里「英语教材词汇及用法」Deck 的卡片换成新版卡面——去掉 Hint、Source 字段和卡面上的提示/来源文字。
// 卡片编号（card_key）不变，所以学生已有的学习进度不受影响。笔记类型的字段、模板、样式以新版 .apkg 为准。
// 用法（不联网）：node strip-fields.mjs <slug> "<新版 .apkg>" ["<新版 .apkg>" …]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readApkg } from './apkg.js';
import { REPO } from './config.mjs';
import { rerender } from '../lib/edits.js';

const [slug, ...apkgs] = process.argv.slice(2);
if (!slug || !apkgs.length) { console.error('用法：node strip-fields.mjs <slug> "<新版 .apkg>" …'); process.exit(1); }
const file = path.join(REPO, 'data', `${slug}.json`);
const raw = fs.readFileSync(file, 'utf8'), data = JSON.parse(raw);
if (JSON.stringify(data) !== raw) { console.error('!! data 文件读出再写回不一致，停止'); process.exit(1); }

// 新版笔记类型（按名字对应）
const fresh = new Map();
for (const a of apkgs) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-'));
  const r = await readApkg(a, tmp);
  for (const m of r.models.values()) fresh.set(m.name, { name: m.name, css: m.css, fields: m.fields, kind: m.kind, tpl: m.templates.map((t) => t.name), tm: m.templates.map((t) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })) });
  r.cleanup(); fs.rmSync(tmp, { recursive: true, force: true });
}

const keysBefore = data.cards.map((c) => c.k).join('\n');
const newModels = data.models.map((old) => {
  const nm = fresh.get(old.name);
  if (!nm) { console.error(`!! 新版包里没有笔记类型「${old.name}」`); process.exit(1); }
  const keep = nm.fields.map((f) => old.fields.indexOf(f));
  if (keep.some((i) => i < 0)) { console.error(`!! 「${old.name}」新字段 ${nm.fields} 在旧字段 ${old.fields} 里找不到`); process.exit(1); }
  return { nm, keep, dropped: old.fields.filter((f) => !nm.fields.includes(f)) };
});
data.models = newModels.map((x) => x.nm);
for (const c of data.cards) {
  const { keep } = newModels[c.m];
  c.r = keep.map((i) => c.r[i]);
  c.v = keep.map((i) => c.v[i]);
  delete c.r0; delete c.ed;
  rerender(data, c);
}
if (data.cards.map((c) => c.k).join('\n') !== keysBefore) { console.error('!! 卡片编号变了，停止（未写文件）'); process.exit(1); }
const bad = data.cards.filter((c) => /class="hint"|Unit \d/.test(c.f + c.b));
if (bad.length) { console.error('!! 还有卡面带提示/来源：', bad.slice(0, 3).map((c) => c.k)); process.exit(1); }
fs.writeFileSync(file, JSON.stringify(data));
console.log(`✔ ${slug}：${data.cards.length} 张卡已换成新版卡面；删掉的字段：${[...new Set(newModels.flatMap((x) => x.dropped))].join('、')}；卡片编号不变`);
process.exit(0);
