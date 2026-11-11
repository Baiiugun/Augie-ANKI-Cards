import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { prepareTeachingImport } from '../teaching-import.mjs';
import { COURSES, parseFilename, checkTags, mergeImport, matches } from '../../lib/library-rules.js';
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
test('Missing tags require an explicit repair; conflicting material tags cannot be overridden', () => {
  const meta = { ...parseFilename(filename), ...options };
  assert.equal(checkTags([], meta).errors.length, 4);
  assert.equal(checkTags([], meta, true).errors.length, 0);
  assert.ok(checkTags(['篇章::P005'], meta, true).errors.length);
});
test('Real SQLite/ZIP APKG is decoded, tags checked and audio extracted inside the project', async () => {
  plan = await prepareTeachingImport(path.join(tmp, filename), filename, options, tmp);
  assert.equal(plan.cards.length, 2); assert.equal(plan.cards[0].data.w, 'baseball');
  assert.equal(plan.media.length, 1); assert.ok(fs.existsSync(path.join(tmp, 'media', plan.media[0])));
  const again = await prepareTeachingImport(path.join(tmp, filename), filename, options, tmp);
  assert.deepEqual(again.cards.map((c) => c.card_key), plan.cards.map((c) => c.card_key));
  await assert.rejects(prepareTeachingImport(path.join(tmp, filename), filename.replace('P004', 'P005'), options, tmp), /冲突/);
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
