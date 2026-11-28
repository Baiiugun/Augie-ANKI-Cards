import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { prepareTeachingImport, readTeachingNote } from '../teaching-import.mjs';
import { COURSES, mapOfficialVocabulary, parseFilename, checkTags, wordCefr, wordTiers } from '../../lib/library-rules.js';
import { verifyPresentation } from '../../lib/card-presentation.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const work = process.env.TEACHING_TEST_WORK || path.join(project, 'import-work');
fs.mkdirSync(work, { recursive: true });
const tmp = fs.mkdtempSync(path.join(work, 'map-official-qa-'));
after(() => {
  const resolved = path.resolve(tmp), root = path.resolve(work);
  assert.ok(resolved.startsWith(root + path.sep) && path.basename(resolved).startsWith('map-official-qa-'));
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const fields = ['Term', 'PartOfSpeech', 'Audio', 'Concept', 'Examples', '序号'];
const css = '.card{font-family:Arial;font-size:20px}.translation{font-weight:bold}.sentence strong{color:#285a49}';
const templates = [{
  name: 'Official vocabulary',
  qfmt: '<div class="term">{{Term}}</div><div class="pos">{{PartOfSpeech}}</div>{{Audio}}',
  afmt: '{{FrontSide}}<hr><section>{{Concept}}</section><section>{{Examples}}</section><small>{{序号}}</small>',
}];
const filenames = {
  Reading: 'MAP-Reading-官方词汇__BOOK-全书词库__阅读词__B001__v01.apkg',
  LanguageUse: 'MAP-LanguageUse-官方词汇__BOOK-全书词库__阅读词__B001__v01.apkg',
};
const concept = '<p class="translation">顺序</p><p class="definition" lang="en">The order in which things happen.</p><p>留意先后顺序。</p>';
const examples = '<p class="sentence" lang="en">Explain the <strong>sequence</strong> of events.</p><p class="gloss">解释事件的<strong>顺序</strong>。</p><p class="clue"><strong>判断线索</strong>先后发生。</p>';
const directNote = { guid: 'shared-sequence', fields: ['sequence', 'n.', '[sound:read.wav]', concept, examples, 'R002'] };
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Real SQLite and ZIP fixtures use only invented data. No teacher login, network,
// source vocabulary files or production database is involved.
const fixtureSpecs = [
  { subject: 'Reading', filename: filenames.Reading, word: 'beginning sound', rit: '141-150' },
  { subject: 'LanguageUse', filename: filenames.LanguageUse, word: 'capital letter', rit: '161-170' },
  { subject: 'Reading', filename: 'ordinary-fixture.apkg', word: 'beginning sound', rit: '141-150' },
  { subject: 'Reading', filename: 'conflicting-tags.apkg', word: 'beginning sound', rit: '141-150', extraTags: ['材料::另一本材料'] },
  { subject: 'Reading', filename: 'missing-translation.apkg', word: 'beginning sound', rit: '141-150', missingTranslation: true },
  { subject: 'Reading', filename: 'wrong-subject.apkg', word: 'beginning sound', rit: '141-150', extraTags: ['Language_Usage', 'Language_Usage::RIT_161-170'] },
  { subject: 'Reading', filename: 'missing-rit.apkg', word: 'beginning sound', rit: '141-150', missingRit: true },
  { subject: 'Reading', filename: 'multiple-rit.apkg', word: 'beginning sound', rit: '141-150', extraTags: ['Reading::RIT_181-190'] },
];
execFileSync(process.env.PYTHON || 'python', ['-X', 'utf8', '-c', `
import sqlite3,json,zipfile,sys,pathlib,io,wave
root=pathlib.Path(sys.argv[1]); config=json.loads(sys.argv[2])
model={'1':{'name':'MAP official fixture','type':0,'css':config['css'],
 'flds':[{'name':s,'ord':i} for i,s in enumerate(config['fields'])],
 'tmpls':[dict(t,ord=i) for i,t in enumerate(config['templates'])]}}
buf=io.BytesIO()
with wave.open(buf,'wb') as wav:
 wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(8000); wav.writeframes(b'\\0'*1600)
for spec in config['specs']:
 db=sqlite3.connect(':memory:')
 db.executescript('CREATE TABLE col(crt integer,models text,decks text); CREATE TABLE notes(id integer,guid text,mid integer,tags text,flds text); CREATE TABLE cards(id integer,nid integer,did integer,ord integer,type integer,queue integer,due integer,ivl integer,factor integer,reps integer,lapses integer,left integer,odid integer,odue integer,flags integer); CREATE TABLE revlog(id integer,cid integer,ease integer,ivl integer,lastIvl integer,factor integer,time integer,type integer);')
 db.execute('INSERT INTO col VALUES(?,?,?)',(1716148800,json.dumps(model,ensure_ascii=False),json.dumps({'1':{'name':'MAP::'+spec['subject']+'::官方词汇'}},ensure_ascii=False)))
 tagSubject='Reading' if spec['subject']=='Reading' else 'Language_Usage'
 notes=[]
 for i,(word,rit) in enumerate([(spec['word'],spec['rit']),('sequence','171-180')],1):
  tags=['MAP_DesCartes_2013',tagSubject]+([] if spec.get('missingRit') else [tagSubject+'::RIT_'+rit])+spec.get('extraTags',[])
  cn=config['concept'] if not spec.get('missingTranslation') else '<p class="definition">A definition is not a Chinese translation.</p>'
  values=[word,'n.','[sound:read.wav]',cn,config['examples'],('R' if spec['subject']=='Reading' else 'LU')+str(i).zfill(3)]
  guid='shared-sequence' if word=='sequence' else 'fixture-'+word
  db.execute('INSERT INTO notes VALUES(?,?,?,?,?)',(i,guid,1,' '+' '.join(tags)+' ','\\x1f'.join(values)))
  db.execute('INSERT INTO cards VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(i,i,1,0,0,0,i,0,0,0,0,0,0,0,0))
  notes.append({'guid':guid,'fields':values,'tags':tags})
 db.commit()
 with zipfile.ZipFile(root/spec['filename'],'w',zipfile.ZIP_DEFLATED) as z:
  z.writestr('collection.anki2',db.serialize()); z.writestr('media',json.dumps({'0':'read.wav'})); z.writestr('0',buf.getvalue())
 db.close()
 (root/(spec['filename']+'.json')).write_text(json.dumps(notes,ensure_ascii=False),encoding='utf-8')
`, tmp, JSON.stringify({ fields, css, templates, concept, examples, specs: fixtureSpecs })]);

test('Only the two registered BOOK reading vocabularies receive official defaults', () => {
  for (const subject of ['Reading', 'LanguageUse']) {
    const meta = parseFilename(filenames[subject]);
    assert.deepEqual(mapOfficialVocabulary(meta), { subject, courses: [COURSES[1]], sourceType: '教材／书籍' });
    for (const change of [
      { material: meta.material + '-副本' }, { material: meta.material.toLowerCase() },
      { material: 'MAP-Reading-G06' }, { use: '语法词' }, { locator: 'P002' },
      { locator: 'book' }, { tier: 'A2' }, { tier: 'B1+' },
    ]) assert.equal(mapOfficialVocabulary({ ...meta, ...change }), null);
  }
});

test('Term/Concept/Examples supply indexes without changing rich source fields or inferring CEFR', () => {
  const note = structuredClone(directNote), before = structuredClone(note);
  const data = readTeachingNote(note, { fields });
  assert.equal(data.w, 'sequence');
  assert.equal(data.mean, '顺序');
  assert.equal(data.pos, 'n.');
  assert.equal(data.en, 'Explain the <strong>sequence</strong> of events.');
  assert.equal(data.cn, '解释事件的<strong>顺序</strong>。');
  assert.equal(data.sound, 'read.wav');
  assert.equal(data.cefr, '');
  assert.deepEqual(note, before);
  const noTranslation = structuredClone(note);
  noTranslation.fields[3] = '<p class="definition">English definition only.</p><p>其他说明</p>';
  assert.equal(readTeachingNote(noTranslation, { fields }).mean, '');
  const incomplete = { guid: 'unregistered-shape', fields: ['sequence', concept] };
  assert.equal(readTeachingNote(incomplete, { fields: ['Term', 'Concept'] }).w, '');
});

test('Both official subjects import with safe defaults, preserved RIT tags and one BOOK section', async () => {
  const plans = [];
  for (const subject of ['Reading', 'LanguageUse']) {
    const file = path.join(tmp, filenames[subject]), before = digest(file);
    const plan = await prepareTeachingImport(file, filenames[subject], {}, tmp);
    plans.push(plan);
    const ritRanges = subject === 'Reading' ? ['141-150', '171-180'] : ['161-170', '171-180'];
    assert.equal(plan.cards.length, 2);
    assert.equal(plan.paper.bank, '阅读词');
    assert.deepEqual(plan.paper.source.courses, [COURSES[1]]);
    assert.equal(plan.paper.source.sourceType, '教材／书籍');
    assert.deepEqual(plan.paper.source.officialVocabulary, { schema: 'map-official-vocab-v1', subject, ritRanges });
    assert.equal(plan.paper.sections.length, 1);
    assert.equal(plan.paper.sections[0].label, 'BOOK · 全书词库');
    assert.equal(plan.paper.sections[0].board, 'BOOK');
    assert.equal(plan.paper.sections[0].count, 2);
    assert.deepEqual(plan.paper.source.tiers, []);
    assert.equal(plan.paper.source.map_schema, undefined);
    assert.deepEqual(plan.paper.sections[0].tiers, []);
    for (const card of plan.cards) {
      for (const tag of ['课程::MAP', '用途::阅读词', '材料::' + parseFilename(filenames[subject]).material, '篇章::BOOK']) assert.ok(card.data.tags.includes(tag));
      assert.ok(card.data.tags.includes('MAP_DesCartes_2013'));
      assert.equal(card.data.tags.filter((t) => t.includes('::RIT_')).length, 1);
      assert.equal(wordCefr(card), '');
      assert.deepEqual(wordTiers(card, plan.paper, plan.paper.sections[0]), []);
      assert.ok(!card.data.tags.some((t) => t.startsWith('档位::')));
    }
    assert.equal(digest(file), before);
  }
  assert.notEqual(plans[0].paper.paper_id, plans[1].paper.paper_id);
  const shared = plans.map((plan) => plan.cards.find((c) => c.data.w === 'sequence'));
  assert.equal(shared[0].data.guid, shared[1].data.guid);
  assert.notEqual(shared[0].card_key, shared[1].card_key);
});

test('Official import keeps original templates, CSS, note fields and all media', async () => {
  const file = path.join(tmp, filenames.Reading);
  const raw = JSON.parse(fs.readFileSync(file + '.json', 'utf8'));
  const before = digest(file), plan = await prepareTeachingImport(file, filenames.Reading, {}, tmp);
  assert.equal(plan.media.length, 1);
  assert.ok(fs.existsSync(path.join(tmp, 'media', plan.media[0])));
  for (const card of plan.cards) {
    const source = raw.find((note) => note.guid === card.data.guid);
    const presentation = card.data.presentation;
    assert.deepEqual(presentation.source.fields, source.fields);
    assert.deepEqual(presentation.source.model.fields, fields);
    assert.deepEqual(presentation.source.model.templates, templates);
    assert.equal(presentation.source.model.css, css);
    assert.ok(presentation.faces[0].back.includes('<strong>sequence</strong>'));
    assert.ok(presentation.faces[0].back.includes('判断线索'));
    assert.ok(verifyPresentation(presentation));
    assert.ok(card.data.audio);
  }
  assert.equal(digest(file), before);
});

test('Reimport and filename batch/version changes preserve official material and card identities', async () => {
  const file = path.join(tmp, filenames.Reading);
  const first = await prepareTeachingImport(file, filenames.Reading, {}, tmp);
  for (const filename of [filenames.Reading, filenames.Reading.replace('B001__v01', 'B002__v01'), filenames.Reading.replace('v01', 'v02')]) {
    const again = await prepareTeachingImport(file, filename, {}, tmp);
    assert.equal(again.paper.paper_id, first.paper.paper_id);
    assert.deepEqual(again.cards.map((card) => card.card_key), first.cards.map((card) => card.card_key));
  }
});

test('Official defaults reject explicit conflicting courses, source types and original material tags', async () => {
  const file = path.join(tmp, filenames.Reading);
  for (const options of [
    { courses: [COURSES[0]], supplement: true },
    { courses: [COURSES[1], COURSES[0]], supplement: true },
    { sourceType: '真题', supplement: true },
  ]) await assert.rejects(prepareTeachingImport(file, filenames.Reading, options, tmp), /课程|来源|冲突/);
  await assert.rejects(prepareTeachingImport(file, filenames.Reading, { vocabularyType: '写作词' }, tmp), /用途|词汇类型/);
  await assert.rejects(prepareTeachingImport(file, filenames.Reading, { courses: 'MAP' }, tmp), /课程/);
  await assert.rejects(prepareTeachingImport(path.join(tmp, 'conflicting-tags.apkg'), filenames.Reading, {}, tmp), /冲突/);
  await assert.rejects(prepareTeachingImport(path.join(tmp, 'missing-translation.apkg'), filenames.Reading, {}, tmp), /缺少单词或释义|缺少.*释义/);
});

test('Ordinary vocabulary still requires chosen classification and explicit tag supplementation', async () => {
  const file = path.join(tmp, 'ordinary-fixture.apkg');
  const filename = '普通教材__BOOK-全书词库__阅读词__B001__v01.apkg';
  await assert.rejects(prepareTeachingImport(file, filename, {}, tmp), /课程|来源/);
  const options = { courses: [COURSES[1]], sourceType: '教材／书籍' };
  await assert.rejects(prepareTeachingImport(file, filename, options, tmp), /缺少标签/);
  const plan = await prepareTeachingImport(file, filename, { ...options, supplement: true }, tmp);
  assert.equal(plan.paper.source.officialVocabulary, undefined);
  assert.equal(plan.paper.source.map_schema, undefined);
  const meta = { ...parseFilename(filename), ...options };
  assert.ok(checkTags(['材料::另一本材料'], meta, true).errors.length);
  assert.ok(checkTags(['课程::CET-6'], meta, true).errors.length);
});

test('Official import rejects another subject, missing RIT and ambiguous RIT tags', async () => {
  for (const file of ['wrong-subject.apkg', 'missing-rit.apkg', 'multiple-rit.apkg']) {
    await assert.rejects(prepareTeachingImport(path.join(tmp, file), filenames.Reading, {}, tmp), /科目|RIT|标签/);
  }
});
