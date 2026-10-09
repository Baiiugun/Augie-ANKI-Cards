// Read an .apkg (legacy anki2 / anki21 and the newer anki21b zstd+protobuf format).
// Extracts everything to a temp dir, then reads the SQLite collection.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import yauzl from 'yauzl';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const maybeZstd = (buf) => (buf.length > 4 && buf.subarray(0, 4).equals(ZSTD_MAGIC) ? zlib.zstdDecompressSync(buf) : buf);

// ---- minimal protobuf reader ----
function pbRead(buf) {
  const fields = [];
  let i = 0;
  const varint = () => {
    let r = 0n, shift = 0n;
    for (;;) {
      const b = buf[i++];
      r |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7n;
    }
    return r;
  };
  while (i < buf.length) {
    const tag = Number(varint());
    const field = tag >>> 3, wt = tag & 7;
    if (wt === 0) fields.push([field, varint()]);
    else if (wt === 2) { const len = Number(varint()); fields.push([field, buf.subarray(i, i + len)]); i += len; }
    else if (wt === 1) { fields.push([field, buf.subarray(i, i + 8)]); i += 8; }
    else if (wt === 5) { fields.push([field, buf.subarray(i, i + 4)]); i += 4; }
    else break;
  }
  return fields;
}
const pbStr = (fields, n) => { const f = fields.find((x) => x[0] === n); return f ? f[1].toString('utf8') : ''; };
const pbNum = (fields, n) => { const f = fields.find((x) => x[0] === n); return f ? Number(f[1]) : 0; };

function extractZip(file, dir) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.readEntry();
      zip.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName) || entry.fileName.includes('..') || entry.fileName.includes('/')) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const out = fs.createWriteStream(path.join(dir, entry.fileName));
          stream.pipe(out);
          out.on('finish', () => zip.readEntry());
          out.on('error', reject);
        });
      });
    });
  });
}

function readCollection(dir) {
  const name = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].find((n) => fs.existsSync(path.join(dir, n)));
  if (!name) throw new Error('这不是有效的 .apkg 文件（找不到 collection）');
  let dbPath = path.join(dir, name);
  if (name.endsWith('b')) { // zstd-compressed sqlite
    const raw = zlib.zstdDecompressSync(fs.readFileSync(dbPath));
    dbPath = path.join(dir, 'collection.sqlite');
    fs.writeFileSync(dbPath, raw);
  }
  return new DatabaseSync(dbPath, { readOnly: true });
}

// Anki ids can exceed 2^53 (e.g. notetype ids), so read integers as BigInt and stringify
const allBig = (db, sql) => { const st = db.prepare(sql); st.setReadBigInts(true); return st.all(); };
const hasTable = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

function readModelsAndDecks(db) {
  const models = new Map(); // id -> {name, kind, css, fields:[name], templates:[{name,qfmt,afmt}]}
  const decks = new Map(); // id -> name  ("A::B")
  if (hasTable(db, 'notetypes')) {
    for (const nt of allBig(db, 'SELECT id, name, config FROM notetypes')) {
      const cfg = pbRead(Buffer.from(nt.config));
      models.set(String(nt.id), { name: nt.name, kind: pbNum(cfg, 1), css: pbStr(cfg, 3), fields: [], templates: [] });
    }
    for (const f of allBig(db, 'SELECT ntid, ord, name FROM fields ORDER BY ntid, ord')) models.get(String(f.ntid))?.fields.push(f.name);
    for (const t of allBig(db, 'SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord')) {
      const cfg = pbRead(Buffer.from(t.config));
      models.get(String(t.ntid))?.templates.push({ name: t.name, qfmt: pbStr(cfg, 1), afmt: pbStr(cfg, 2) });
    }
    for (const d of allBig(db, 'SELECT id, name FROM decks')) decks.set(String(d.id), d.name.replace(/\x1f/g, '::'));
  } else {
    const col = db.prepare('SELECT models, decks FROM col').get();
    for (const [id, m] of Object.entries(JSON.parse(col.models))) {
      models.set(id, {
        name: m.name, kind: m.type === 1 ? 1 : 0, css: m.css || '',
        fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
        templates: [...m.tmpls].sort((a, b) => a.ord - b.ord).map((t) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })),
      });
    }
    for (const [id, d] of Object.entries(JSON.parse(col.decks))) decks.set(id, d.name);
  }
  return { models, decks };
}

/**
 * Parse an .apkg.
 * @param file path to the uploaded file
 * @param mediaDir directory (will be created) where media files are stored as <sha1-16>.<ext>
 * @returns { models, decks, notes:[{id, mid, fields:[], tags:[]}], cards:[{id,nid,did,ord,sched}], revlog:[], crt, mediaMap: Map<name,file>, cleanup }
 */
export async function readApkg(file, mediaDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apkg-'));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    await extractZip(file, tmp);
    // media index
    const mediaMap = new Map();
    const mediaFile = path.join(tmp, 'media');
    const files = []; // [zipName, originalName]
    if (fs.existsSync(mediaFile)) {
      const raw = maybeZstd(fs.readFileSync(mediaFile));
      if (raw[0] === 0x7b /* { */) {
        for (const [k, v] of Object.entries(JSON.parse(raw.toString('utf8')))) files.push([k, v]);
      } else {
        pbRead(raw).filter((f) => f[0] === 1).forEach((f, idx) => {
          const e = pbRead(f[1]);
          files.push([String(idx), pbStr(e, 1)]);
        });
      }
    }
    fs.mkdirSync(mediaDir, { recursive: true });
    for (const [zipName, original] of files) {
      const src = path.join(tmp, zipName);
      if (!original || !fs.existsSync(src)) continue;
      const data = maybeZstd(fs.readFileSync(src));
      const ext = (path.extname(original).slice(1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin').slice(0, 6);
      const stored = `${crypto.createHash('sha1').update(data).digest('hex').slice(0, 20)}.${ext}`;
      const dest = path.join(mediaDir, stored);
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, data);
      mediaMap.set(original, stored);
    }

    const db = readCollection(tmp);
    try {
      const { models, decks } = readModelsAndDecks(db);
      const notes = allBig(db, 'SELECT id, mid, tags, flds FROM notes ORDER BY id').map((n) => ({
        id: String(n.id), mid: String(n.mid),
        fields: n.flds.split('\x1f'),
        tags: n.tags.trim().split(/\s+/).filter(Boolean),
      }));
      const cards = allBig(db, 'SELECT id, nid, CASE WHEN odid != 0 THEN odid ELSE did END AS did, ord, type, queue, due, ivl, factor, reps, lapses, left, odid, odue FROM cards ORDER BY id').map((c) => ({
        id: String(c.id), nid: String(c.nid), did: String(c.did), ord: Number(c.ord),
        // Anki 调度字段（原样带出；筛选牌组里的卡 due 取 odue）
        sched: { type: Number(c.type), queue: Number(c.queue), due: Number(c.odid ? c.odue : c.due), ivl: Number(c.ivl), factor: Number(c.factor),
                 reps: Number(c.reps), lapses: Number(c.lapses), left: Number(c.left) },
      }));
      // 答题历史（含手动改期 type=4，由调用方决定是否忽略）
      const revlog = hasTable(db, 'revlog') ? allBig(db, 'SELECT id, cid, ease, ivl, lastIvl, factor, time, type FROM revlog ORDER BY id').map((r) => ({
        id: Number(r.id), cid: String(r.cid), ease: Number(r.ease), ivl: Number(r.ivl), lastIvl: Number(r.lastIvl),
        factor: Number(r.factor), time: Number(r.time), type: Number(r.type),
      })) : [];
      const crt = hasTable(db, 'col') ? Number(allBig(db, 'SELECT crt FROM col')[0].crt) : null;
      return { models, decks, notes, cards, revlog, crt, mediaMap, cleanup };
    } finally { db.close(); }
  } catch (e) { cleanup(); throw e; }
}
