import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { prepareTeachingImport, readTeachingNote } from '../teaching-import.mjs';
import { COURSES, parseFilename, checkTags, mergeImport, matches, matchesWord, wordCefr, wordTiers, UNMARKED } from '../../lib/library-rules.js';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const work = path.join(project, 'import-work'); fs.mkdirSync(work, { recursive: true });
const tmp = fs.mkdtempSync(path.join(work, 'teaching-qa-'));
after(() => { if (process.env.TEACHING_KEEP_FIXTURES === '1') console.log('QA fixtures: ' + tmp); else { assert.ok(tmp.startsWith(work + path.sep)); fs.rmSync(tmp, { recursive: true, force: true }); } });
const filename = '演示教材-Reading-6__P004-Yakyuu__阅读词__B001__v01.apkg';
const options = { courses: [COURSES[1]], sourceType: '教材／书籍', edition: '', supplement: false };
execFileSync('python', ['-c', `
import sqlite3,json,zipfile,sys,pathlib,io,wave
root=pathlib.Path(sys.argv[1]); db=sqlite3.connect(root/'collection.sqlite')
db.executescript('CREATE TABLE col(crt integer,models text,decks text); CREATE TABLE notes(id integer,guid text,mid integer,tags text,flds text); CREATE TABLE cards(id integer,nid integer,did integer,ord integer,type integer,queue integer,due integer,ivl integer,factor integer,reps integer,lapses integer,left integer,odid integer,odue integer,flags integer); CREATE TABLE revlog(id integer,cid integer,ease integer,ivl integer,lastIvl integer,factor integer,time integer,type integer);')
model={'1':{'name':'Word reading','type':0,'css':'','flds':[{'name':s,'ord':i} for i,s in enumerate(['Word','Meaning','Audio','Example'])],'tmpls':[{'name':'Read','ord':0,'qfmt':'{{Word}}','afmt':'{{Meaning}}'}]}}
db.execute('INSERT INTO col VALUES(?,?,?)',(1716148800,json.dumps(model),json.dumps({'1':{'name':'阅读词'}})))
tags=' 课程::MAP 用途::阅读词 材料::演示教材-Reading-6 篇章::P004 '
for i,(word,meaning) in enumerate([('baseball','棒球'),('team','队伍')],1):
 db.execute('INSERT INTO notes VALUES(?,?,?,?,?)',(i,'fixed-guid-'+str(i),1,tags,'\\x1f'.join([word,meaning,'[sound:read.wav]','A '+word+'.'])))
 db.execute('INSERT INTO cards VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(i,i,1,0,0,0,i,0,0,0,0,0,0,0,0))
db.commit(); db.close()
buf=io.BytesIO()
with wave.open(buf,'wb') as wav: wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(8000); wav.writeframes(b'\\0'*1600)
with zipfile.ZipFile(root/sys.argv[2],'w',zipfile.ZIP_DEFLATED) as z:
 z.write(root/'collection.sqlite','collection.anki2'); z.writestr('media',json.dumps({'0':'read.wav'})); z.writestr('0',buf.getvalue())
`, tmp, filename]);
let plan;
test('APKG filename validates identity and rejects missing batches or invalid versions', () => {
  assert.equal(parseFilename(filename).locator, 'P004');
  for (const name of ['阅读词.apkg', filename.replace('B001', 'B000'), filename.replace('v01', 'v00')]) assert.throws(() => parseFilename(name));
});
test('Optional A2/B1+ suffix preserves the old five fields and does not accept B1 as a package tier', () => {
  const original = parseFilename(filename);
  for (const tier of ['A2', 'B1+']) {
    const parsed = parseFilename(filename.replace('.apkg', `__${tier}.apkg`));
    assert.deepEqual({ ...parsed, tier: '' }, original);
    assert.equal(parsed.tier, tier);
  }
  for (const tier of ['B1', 'C1', 'unknown', 'A2__B1+']) assert.throws(() => parseFilename(filename.replace('.apkg', `__${tier}.apkg`)));
  assert.ok(checkTags(['难度_B1+'], { ...original, ...options, tier: 'A2' }, true).errors.some((s) => s.includes('档位')));
});
test('Exact word CEFR and vocabulary tier are independent, support OR within each dimension and preserve unmarked words', () => {
  const rows = [
    { data: { cefr: 'CEFR：B1', tiers: ['B1+'] } },
    { data: { cefr: 'B2', tiers: ['B1+'] } },
    { data: { cefr: 'A2', tiers: ['A2'] } },
    { data: { cefr: '', tiers: ['B1+'] } },
    { data: { tiers: [] } },
  ];
  const matching = (f) => rows.map((c, i) => matchesWord(c, null, null, f) ? i : -1).filter((i) => i >= 0);
  assert.deepEqual(matching({ tiers: ['B1+'] }), [0, 1, 3]);
  assert.deepEqual(matching({ cefrs: ['B1'] }), [0]);
  assert.deepEqual(matching({ cefrs: ['A2', 'B1'] }), [0, 2]);
  assert.deepEqual(matching({ tiers: ['A2', 'B1+'] }), [0, 1, 2, 3]);
  assert.deepEqual(matching({ tiers: ['B1+'], cefrs: ['B1'] }), [0]);
  assert.deepEqual(matching({ cefrs: [UNMARKED] }), [3, 4]);
  assert.deepEqual(matching({ tiers: [UNMARKED] }), [4]);
  assert.equal(wordCefr(rows[3]), '');
  assert.deepEqual(wordTiers(rows[4], { source: { tiers: ['B1+'] } }, { tiers: ['B1+'], level: 'B1+' }), []);
  assert.deepEqual(wordTiers({ data: {} }, null, { level: 'B1+' }), ['B1+']);
  assert.equal(wordCefr({ data: {} }), '');
});
test('Missing tags require an explicit repair; conflicting material tags cannot be overridden', () => {
  const meta = { ...parseFilename(filename), ...options };
  assert.equal(checkTags([], meta).errors.length, 4);
  assert.equal(checkTags([], meta, true).errors.length, 0);
  assert.ok(checkTags(['篇章::P005'], meta, true).errors.length);
});
test('MAP course aliases are equivalent; extra source labels require explicit confirmation', () => {
  const meta = { ...parseFilename(filename), ...options };
  const base = ['课程::MAP阅读和语言运用', '用途::阅读词', '材料::演示教材-Reading-6', '篇章::P004'];
  assert.deepEqual(checkTags(base, meta).errors, []);
  const extra = [...base, '课程::补充阅读'];
  assert.ok(checkTags(extra, meta).errors.length);
  const accepted = checkTags(extra, meta, true);
  assert.deepEqual(accepted.errors, []);
  assert.ok(accepted.tags.includes('课程::补充阅读'));
  assert.equal(accepted.warnings.length, 1);
  assert.ok(checkTags([...extra, '课程::CET-6'], meta, true).errors.length);
  assert.ok(checkTags([...base, '材料::另一本书'], meta, true).errors.length);
});
const table = (rows) => '<table style="width:100%">' + rows.map((row) => '<tr><td>' + row + '</td></tr>').join('') + '</table>';
test('CEFR tool table cards preserve vocabulary, meaning, pronunciation, level, examples and sound', () => {
  const note = { guid: 'stable-table-guid', fields: [
    table(['nearly', 'adv.', '[sound:nearly.mp3]']),
    table(['nearly', '/ˈnɪəli/ adv.', 'CEFR: A2', '几乎', 'But they have played for <b>nearly</b> as long.', '时间也<b>几乎</b>一样长。']),
  ] };
  const data = readTeachingNote(note, { fields: ['Front', 'Back'] });
  assert.deepEqual(data, { w: 'nearly', mean: '几乎', pos: 'adv.', ipa: '/ˈnɪəli/', cefr: 'A2',
    en: 'But they have played for nearly as long.', cn: '时间也几乎一样长。', audio: '', guid: note.guid, sound: 'nearly.mp3' });
  const noMeaning = structuredClone(note); noMeaning.fields[1] = noMeaning.fields[1].replace('几乎', '');
  assert.equal(readTeachingNote(noMeaning, { fields: ['Front', 'Back'] }).mean, '');
  const arbitrary = { ...note, fields: [note.fields[0], note.fields[1].replace('CEFR: A2', 'Other info')] };
  assert.equal(readTeachingNote(arbitrary, { fields: ['Front', 'Back'] }).w, '');
  const unmarked = { ...note, fields: [note.fields[0], note.fields[1].replace('CEFR: A2', 'CEFR:')] };
  const noLevel = readTeachingNote(unmarked, { fields: ['Front', 'Back'] });
  assert.equal(noLevel.w, 'nearly'); assert.equal(noLevel.mean, '几乎'); assert.equal(noLevel.cefr, '');
});
test('Class-based cards and explicit fields remain supported', () => {
  const data = readTeachingNote({ guid: 'class-guid', fields: [
    '<div class="word">can&#39;t</div><span class="pos">v.</span>',
    '<p class="meaning">不能</p><span class="cefr">CEFR: A2</span><p class="example-en">I <b>can&#39;t</b>.</p>',
  ] }, { fields: ['Front', 'Back'] });
  assert.equal(data.w, "can't"); assert.equal(data.mean, '不能'); assert.equal(data.en, "I can't.");
  assert.equal(readTeachingNote({ guid: 'fields-guid', fields: ['word', '含义'] }, { fields: ['Word', 'Meaning'] }).mean, '含义');
});

test('Exam vocabulary reads nested word spans without an outer div consuming them', () => {
  const data = readTeachingNote({ guid: 'nested-exam-guid', fields: [
    '<div class="source">模拟卷</div><div class="word-line"><span class="word">habit</span><span class="audio">[sound:habit.mp3]</span></div><div class="pos">n.</div><div class="ipa">/ˈhæbɪt/</div>',
    '<div class="meaning"><div>习惯</div></div><div class="cefr">CEFR：B1</div><div class="example example-en">A good <b>habit</b>.</div><div class="example example-cn">一个好习惯。</div>',
  ] }, { fields: ['Front', 'Back'] });
  assert.equal(data.w, 'habit'); assert.equal(data.mean, '习惯');
  assert.equal(data.pos, 'n.'); assert.equal(data.ipa, '/ˈhæbɪt/'); assert.equal(data.cefr, 'B1');
  assert.equal(data.en, 'A good habit.'); assert.equal(data.cn, '一个好习惯。');
  assert.equal(data.sound, 'habit.mp3');
  const missing = readTeachingNote({ guid: 'missing-nested-word', fields: ['<div class="word-line"><span>no word class</span></div>', '<div class="meaning">含义</div>'] }, { fields: ['Front', 'Back'] });
  assert.equal(missing.w, '');
});
test('Real SQLite/ZIP APKG is decoded, tags checked and audio extracted inside the project', async () => {
  plan = await prepareTeachingImport(path.join(tmp, filename), filename, options, tmp);
  assert.equal(plan.cards.length, 2); assert.equal(plan.cards[0].data.w, 'baseball');
  assert.equal(plan.media.length, 1); assert.ok(fs.existsSync(path.join(tmp, 'media', plan.media[0])));
  const again = await prepareTeachingImport(path.join(tmp, filename), filename, options, tmp);
  assert.deepEqual(again.cards.map((c) => c.card_key), plan.cards.map((c) => c.card_key));
  await assert.rejects(prepareTeachingImport(path.join(tmp, filename), filename.replace('P004', 'P005'), options, tmp), /冲突/);
});
test('A tier suffix changes membership, not card identity or a missing word CEFR; both memberships survive merging', async () => {
  const file = path.join(tmp, filename);
  const a2 = await prepareTeachingImport(file, filename.replace('.apkg', '__A2.apkg'), options, tmp);
  const b1plus = await prepareTeachingImport(file, filename.replace('.apkg', '__B1+.apkg'), options, tmp);
  assert.deepEqual(a2.cards.map((c) => c.card_key), b1plus.cards.map((c) => c.card_key));
  assert.deepEqual(a2.cards.map((c) => c.card_key), plan.cards.map((c) => c.card_key));
  assert.ok(b1plus.cards.every((c) => c.data.cefr === '' && c.data.tiers.includes('B1+')));
  const first = mergeImport(null, [], a2);
  const both = mergeImport(first.paper, first.rows, b1plus);
  assert.equal(both.changes.added, 0);
  assert.equal(both.paper.sections[0].count, 2);
  assert.deepEqual(both.paper.sections[0].tiers, ['A2', 'B1+']);
  assert.ok(both.rows.every((c) => c.data.tiers.includes('A2') && c.data.tiers.includes('B1+')));
});
test('Incremental batches preserve previous sections, count unique words and distinguish updates', () => {
  const first = mergeImport(null, [], structuredClone(plan));
  const next = structuredClone(plan); next.file = next.file.replace('B001','B002'); next.cards = [{ ...next.cards[0], card_key: 'yd:new', data: { ...next.cards[0].data, w: 'new', guid: 'guid-new' } }];
  const second = mergeImport(first.paper, first.rows, next);
  assert.equal(second.paper.sections[0].count, 3); assert.equal(second.changes.added, 1);
  const same = mergeImport(first.paper, first.rows, structuredClone(plan)); assert.equal(same.changes.same, 2); assert.equal(same.changes.added, 0);
  const changed = structuredClone(plan); changed.cards[0].data.mean = '新释义';
  assert.equal(mergeImport(first.paper, first.rows, changed).changes.changed, 1);
  assert.ok(matches(first.paper, first.paper.sections[0], { course: COURSES[1], query: 'P004' }));
  assert.ok(!matches(first.paper, first.paper.sections[0], { course: 'CET-6' }));
});
test('Selected words reach only the intended learner; reimport and reassignment preserve progress', async () => {
  const storage = new Map(); globalThis.localStorage = { getItem: (k) => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: (k) => storage.delete(k) };
  globalThis.location = new URL('http://127.0.0.1/?mock=1');
  const { createMockTeacherApi, createMockStudentApi } = await import('../../lib/yuedu-api.js');
  let teacher = await createMockTeacherApi(); const preview = await teacher.previewImport(structuredClone(plan)); await teacher.importPrepared(preview);
  await teacher.assignSelection('mock-yd-1', [preview.rows[0]]);
  let student = await createMockStudentApi('MOCKMOCKMOCKMOCK'); let state = await student.getState(); assert.equal(state.cards.length, 1);
  const card = state.cards[0]; const progress = { ...card, type: 2, queue: 2, due: 5000, ivl: 5, reps: 3, factor: 2500 };
  await student.answer(card.key, progress, { uid: 'qa-answer-1', ts: Date.now(), prev_type: 0, type: 1 });
  teacher = await createMockTeacherApi(); const repeated = await teacher.previewImport(structuredClone(plan)); await teacher.importPrepared(repeated);
  await teacher.assignSelection('mock-yd-1', repeated.rows);
  student = await createMockStudentApi('MOCKMOCKMOCKMOCK'); state = await student.getState(); assert.equal(state.cards.length, 2); assert.equal(state.cards.find((c) => c.key === card.key).reps, 3);
  assert.equal((await teacher.getCards('mock-augie')).length, 0);
  await assert.rejects(teacher.assignSelection('mock-augie', preview.rows), /学生版/);
  await teacher.unassign('mock-yd-1', preview.paper.paper_id, [preview.paper.sections[0].id]);
  student = await createMockStudentApi('MOCKMOCKMOCKMOCK'); assert.equal((await student.getState()).cards.length, 0);
  teacher = await createMockTeacherApi(); await teacher.assignSelection('mock-yd-1', preview.rows);
  student = await createMockStudentApi('MOCKMOCKMOCKMOCK'); assert.equal((await student.getState()).cards.find((c) => c.key === card.key).reps, 3);
});
test('Cloud API contract inserts only missing selected states and does not overwrite learned cards', async () => {
  const { createTeacherApi } = await import('../../lib/yuedu-api.js');
  const fetch0 = globalThis.fetch, writes = [], rows = plan.cards.map((c) => ({ ...c, paper_id: plan.paper.paper_id }));
  globalThis.fetch = async (url, init) => {
    const method = init?.method || 'GET', pathname = new URL(url).pathname;
    if (method === 'POST') { writes.push({ pathname, body: JSON.parse(init.body) }); return new Response('', { status: 201 }); }
    let body;
    if (pathname.endsWith('/anki_test_learners')) body = [{ id: 'learner-a', kind: 'yuedu', status: 'active' }];
    else if (pathname.endsWith('/anki_test_bank_cards')) body = rows;
    else if (pathname.endsWith('/anki_test_card_state')) body = [{ card_key: rows[0].card_key, type: 2, queue: 2, due: 5000, reps: 10, ivl: 7 }];
    else throw new Error('Unexpected endpoint: ' + pathname);
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    assert.equal(await createTeacherApi('synthetic-test-token').assignSelection('learner-a', rows), 1);
    const stateWrite = writes.find((x) => x.pathname.endsWith('/anki_test_card_state'));
    assert.equal(stateWrite.body.length, 1); assert.equal(stateWrite.body[0].card_key, rows[1].card_key);
    assert.ok(!writes.some((x) => x.pathname.endsWith('/anki_test_revlog')));
    assert.equal(writes.at(-1).body[0].learner_id, 'learner-a');
  } finally { globalThis.fetch = fetch0; }
});
test('Real user APKG imports all 66 words and audio without modifying the original', { skip: !process.env.TEACHING_TEST_APKG }, async () => {
  const source = process.env.TEACHING_TEST_APKG;
  const digest = () => crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const before = digest();
  const realOptions = { ...options, supplement: true };
  const actual = await prepareTeachingImport(source, path.basename(source), realOptions, tmp);
  assert.equal(actual.cards.length, 66); assert.equal(actual.media.length, 65); // Two originals contain identical audio.
  assert.ok(actual.cards.every((c) => c.data.w && c.data.mean && c.data.audio && c.data.guid));
  assert.equal(new Set(actual.cards.map((c) => c.card_key)).size, 66);
  const nearly = actual.cards.find((c) => c.data.w === 'nearly').data;
  assert.equal(nearly.mean, '几乎'); assert.equal(nearly.pos, 'adv.'); assert.equal(nearly.ipa, '/ˈnɪəli/'); assert.equal(nearly.cefr, 'A2');
  assert.equal(nearly.en, 'But the Japanese have been playing for nearly as long.');
  assert.equal(nearly.cn, '但是日本人打棒球的时间也几乎一样长。');
  assert.ok(nearly.tags.includes('课程::补充阅读')); assert.ok(nearly.tags.includes('材料::Spectrum-Reading-6'));
  assert.equal(actual.warnings.length, 1);
  assert.ok(actual.media.every((name) => fs.existsSync(path.join(tmp, 'media', name))));
  const repeated = await prepareTeachingImport(source, path.basename(source), realOptions, tmp);
  assert.deepEqual(repeated.cards.map((c) => c.card_key), actual.cards.map((c) => c.card_key));
  assert.equal(digest(), before);
});
test('2018 paper preserves all 483 real notes, exact CEFR distribution and original APKG bytes across both tiers', { skip: !process.env.TEACHING_TEST_2018_DIR }, async () => {
  const bundle = path.resolve(process.env.TEACHING_TEST_2018_DIR);
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, '配套清单.json'), 'utf8'));
  const labels = new Map(manifest.sections.map((s) => [s.id, s.label]));
  const levels = {}, tiers = {}, keys = new Set();
  for (const part of manifest.parts.filter((p) => p.files?.apkg)) {
    const source = path.join(bundle, part.files.apkg);
    const before = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const virtualName = `2018-全国2卷__${labels.get(part.source_id)}__阅读词__B001__v01__${part.tier}.apkg`;
    const actual = await prepareTeachingImport(source, virtualName, { courses: [COURSES[0]], sourceType: '真题', edition: '', supplement: true }, tmp);
    assert.equal(actual.cards.length, part.count);
    for (const card of actual.cards) {
      assert.ok(card.data.w && card.data.mean && card.data.guid);
      assert.deepEqual(card.data.tiers, [part.tier]);
      const level = wordCefr(card) || UNMARKED;
      levels[level] = (levels[level] || 0) + 1;
      tiers[part.tier] = (tiers[part.tier] || 0) + 1;
      assert.ok(!keys.has(card.card_key)); keys.add(card.card_key);
    }
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'), before);
  }
  assert.equal(keys.size, 483);
  assert.deepEqual(tiers, { A2: 201, 'B1+': 282 });
  assert.deepEqual(levels, { A2: 201, B1: 149, B2: 106, C1: 26, C2: 1 });
});
