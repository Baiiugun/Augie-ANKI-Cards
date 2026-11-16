import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHtml, formatCss, plainText } from '../../lib/card-format.js';
import { readTeachingNote } from '../../lib/teaching-note.js';
import { makePresentation, verifyPresentation, verifyImportCards } from '../../lib/card-presentation.js';
import { renderCard } from '../../lib/render.js';
const note = { guid: 'fixed-source-guid', fields: ['<b>guests</b>', '盘问<strong>嘉宾</strong>', '[sound:guest.mp3]'], tags: [] };
const model = { name: 'reading/listening/spelling', kind: 0, fields: ['Word','Meaning','Audio'], css: '.card{font-size:23px;color:#203848}.card b{color:red}', templates: [{ name: 'Read', qfmt: '<div>{{Word}}</div>{{Audio}}', afmt: '{{FrontSide}}<hr id=answer>{{Meaning}}' }] };
const media = new Map([['guest.mp3','aabb.mp3']]);
test('format contract preserves visual markup and entities without double decoding', () => {
  const html = '<p><b>bold</b><strong>strong</strong><i>italic</i><u>under</u><br><span style="color:red;font-size:24px">色</span></p><table><tr><td colspan=2>cell</td></tr></table>';
  const output = formatHtml(html);
  for (const text of ['<b>bold</b>','<strong>strong</strong>','<i>italic</i>','<u>under</u>','<br>','font-size:24px','<td colspan="2">']) assert.ok(output.includes(text));
  assert.equal(formatHtml('&lt;b&gt;literal&lt;/b&gt; &amp; x'), '&lt;b&gt;literal&lt;/b&gt; &amp; x');
  assert.equal(plainText('one<br>two&nbsp;&amp;&nbsp;three'), 'one two & three');
});
test('independent teaching fields keep both English and Chinese formatting', () => {
  const data = readTeachingNote({ guid: 'fixed', fields: ['guest','嘉宾','<b>guests</b>','<u>嘉宾</u>'] }, { fields: ['Word','Meaning','Example','ExampleCN'] });
  assert.equal(data.en,'<b>guests</b>'); assert.equal(data.cn,'<u>嘉宾</u>');
});
test('original fields, model CSS, FrontSide and audio are preserved together', () => {
  const p = makePresentation(note, model, [{ ord: 0 }], media);
  assert.deepEqual(p.source.fields, note.fields); assert.deepEqual(p.source.model, model);
  assert.ok(p.faces[0].front.includes('<b>guests</b>')); assert.ok(p.faces[0].back.includes('<strong>嘉宾</strong>'));
  assert.deepEqual(p.faces[0].frontAudio, ['/media/aabb.mp3']);
  assert.deepEqual(p.faces[0].backAudio, []); // FrontSide does not autoplay question audio again.
  assert.ok(verifyPresentation(p));
});
test('source-to-render comparison detects lost formatting and altered CSS before any upload', () => {
  const p = makePresentation(note, model, [{ ord: 0 }], media);
  for (const mutate of [x=>x.faces[0].front=x.faces[0].front.replace(/<\/?b>/g,''),x=>x.css=x.css.replace('23px','20px'),x=>x.source.fields[0]='changed']) {
    const changed=structuredClone(p); mutate(changed); assert.throws(()=>verifyPresentation(changed),/不一致/);
  }
  assert.throws(()=>verifyImportCards([{data:{w:'guest'}}]),/格式协议缺失/);
});
test('listening and spelling templates use the same source contract and retain input', () => {
  const typing = structuredClone(model); typing.templates = [{name:'Listen and spell',qfmt:'{{Audio}}<br>{{type:Word}}',afmt:'{{type:Word}}<hr>{{Meaning}}'}];
  const p = makePresentation(note, typing, [{ord:0}],media);
  assert.ok(p.faces[0].front.includes('type-answer-input')); assert.ok(p.faces[0].back.includes('data-type-answer="guests"'));
  assert.ok(!p.faces[0].front.includes('>guests<')); assert.ok(verifyPresentation(p));
});
test('multiple normal and cloze card faces survive without changing the note identity', () => {
  const multiple = structuredClone(model); multiple.templates.push({name:'Reverse',qfmt:'{{Meaning}}',afmt:'{{Word}}'});
  const p = makePresentation(note,multiple,[{ord:0},{ord:1}],media); assert.equal(p.faces.length,2); assert.ok(verifyPresentation(p));
  const cloze={name:'Cloze',kind:1,fields:['Text'],css:'',templates:[{name:'Cloze',qfmt:'{{cloze:Text}}',afmt:'{{cloze:Text}}'}]};
  const cp=makePresentation({fields:['The {{c1::<b>guest</b>}} reads {{c2::books}}.'],tags:[]},cloze,[{ord:0},{ord:1}],new Map());
  assert.ok(cp.faces[0].front.includes('[...]')); assert.ok(cp.faces[1].back.includes('>books<')); assert.ok(verifyPresentation(cp));
});
test('images, fonts and CSS background images are resolved and registered as required media', () => {
  const m={...model,css:'@font-face{font-family:Test;src:url(font.woff2)}.card{background-image:url(pic.png)}',templates:[{name:'Image',qfmt:'<img src="pic.png">',afmt:'{{Meaning}}'}]};
  const p=makePresentation(note,m,[{ord:0}],new Map([['font.woff2','font123.woff2'],['pic.png','pic123.png']]));
  assert.deepEqual(new Set(p.media),new Set(['font123.woff2','pic123.png'])); assert.ok(verifyPresentation(p));
});
test('Anki sound video references remain native video with controls', () => {
  const p=makePresentation({...note,fields:['guests','嘉宾','[sound:clip.mp4]']},model,[{ord:0}],new Map([['clip.mp4','clip123.mp4']]));
  assert.ok(p.faces[0].front.includes('<video'));assert.ok(p.faces[0].front.includes('controls'));assert.ok(verifyPresentation(p));
});
test('missing media, external resources, unsupported scripts and template features fail explicitly', () => {
  assert.throws(()=>makePresentation(note,model,[{ord:0}],new Map()),/音频文件缺失/);
  for(const html of ['<script>alert(1)</script>','<img src=x onerror=alert(1)>','<iframe src=x></iframe>','<a href="jav&#x61;script:alert(1)">x</a>']) assert.throws(()=>formatHtml(html));
  for(const css of ['@import "https://example.com/a.css";','a{background:url(https://example.com/x)}','a{behavior:url(x.htc)}']) assert.throws(()=>formatCss(css));
  for(const qfmt of ['{{tts en_US:Word}}','{{type:cloze:Word}}','{{text:FrontSide}}','{{unknown:Word}}','{{Missing}}','{{#Word}}broken','{{#Word}}x{{/Meaning}}']) assert.throws(()=>renderCard({...model,templates:[{name:'Unsupported',qfmt,afmt:''}]},{ord:0},{Word:'guest',Meaning:'嘉宾',Audio:''},{},media));
});
