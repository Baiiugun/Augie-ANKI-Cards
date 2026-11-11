import { COURSES, SOURCE_TYPES, parseFilename, requiredTags, canonical } from './library-rules.js';
import { escapeHtml as e } from './teaching-library.js';
export function mountUpload(root, { api, papers, onImported }) {
  const local = location.hostname === '127.0.0.1' && location.port === '8767';
  if (!local) {
    root.innerHTML = `<div class="card"><h2>导入教学词库</h2><p>在这台电脑上双击项目里的 <b>启动学生版词库导入.cmd</b>。在随后打开的窗口登录老师账号，就能选择 APKG、校验和导入。</p><p><a href="http://127.0.0.1:8767/阅读词-老师登录版本.html?import=1" target="_blank" rel="noopener">已启动，打开导入窗口 →</a></p><p class="faint">导入完成后刷新此页，再勾选词库布置给学生。</p><p>文件名示例：</p><code>Spectrum-Reading-6__P004-Yakyuu__阅读词__B001__v01.apkg</code></div>`; return;
  }
  let current = null;
  root.innerHTML = `<div class="card"><h2>导入教学词库</h2><p>① 选择 APKG → ② 确认课程和来源 → ③ 校验并预览 → ④ 确认导入。完成后再去“词库”给学生布置。</p>
    <p class="faint">文件名：材料简称__篇章编号-标题__阅读词__B001__v01.apkg。B002 表示补一批新词；B001 的 v02 表示修订第一批。</p><p><input type="file" id="upload-file" accept=".apkg"></p><div id="file-info" class="sub"></div>
    <h3>适用课程（可多选）</h3><div class="row">${COURSES.map((c) => `<label><input type="checkbox" name="upload-course" value="${e(c)}"> ${e(c)}</label>`).join('')}</div>
    <p><label>来源类型 <select id="upload-type"><option value="">请选择</option>${SOURCE_TYPES.map((x) => `<option>${e(x)}</option>`).join('')}</select></label></p>
    <p><label>教材版本／试卷补充说明 <input type="text" id="upload-edition" placeholder="同一本书各批次保持一致"></label></p>
    <p><label>并入材料 <select id="upload-target"><option value="">按材料名称自动识别／新建</option>${papers.map((p) => `<option value="${e(p.paper_id)}">${e(p.name)}</option>`).join('')}</select></label></p>
    <p><label>并入篇章 <select id="upload-section"><option value="">按篇章编号自动识别／新建</option></select></label></p>
    <p><label><input type="checkbox" id="upload-supplement"> 原包缺少分类标签时，确认给本包所有词补齐本次课程、用途、材料和篇章标签</label></p>
    <p class="faint">默认逐词检查原包标签。勾选补齐后，原 APKG 保持原样，补齐的标签存入教学词库；已有冲突标签仍会拦截。</p>
    <div id="expected-tags" class="faint"></div><p><button class="pri" id="upload-check">校验并预览</button></p>
    <div class="msg" id="upload-message" aria-live="polite" style="white-space:pre-wrap"></div><div id="upload-preview"></div></div>`;
  const q = (s) => root.querySelector(s);
  function invalidate() {
    current = null; q('#upload-preview').innerHTML = ''; q('#upload-message').textContent = '';
    try { const meta = parseFilename(q('#upload-file').files[0]?.name); q('#file-info').textContent = `材料：${meta.material}；篇章：${meta.locator} ${meta.title}；用途：${meta.use}；${meta.batch} ${meta.version}`;
      q('#expected-tags').textContent = '需要的标签：' + requiredTags({ ...meta, courses: [...root.querySelectorAll('[name=upload-course]:checked')].map((c) => c.value) }).join('、');
    } catch (err) { q('#file-info').textContent = q('#upload-file').files.length ? err.message : ''; q('#expected-tags').textContent = ''; }
  }
  root.querySelectorAll('input,select').forEach((x) => x.addEventListener('change', invalidate));
  q('#upload-target').addEventListener('change', () => {
    const target = papers.find((p) => p.paper_id === q('#upload-target').value);
    q('#upload-section').innerHTML = `<option value="">按篇章编号自动识别／新建</option>${(target?.sections || []).map((s) => `<option value="${e(s.id)}">${e(s.label || s.board)}</option>`).join('')}`;
  });
  q('#upload-check').onclick = async () => {
    current = null; q('#upload-preview').innerHTML = '';
    const file = q('#upload-file').files[0]; if (!file) { q('#upload-message').textContent = '请先选择 APKG 文件'; return; }
    const options = { courses: [...root.querySelectorAll('[name=upload-course]:checked')].map((c) => c.value), sourceType: q('#upload-type').value, edition: q('#upload-edition').value.trim(), supplement: q('#upload-supplement').checked };
    root.inert = true; q('#upload-message').textContent = '正在逐词校验…';
    try {
      parseFilename(file.name);
      const targetId = q('#upload-target').value, target = papers.find((p) => p.paper_id === targetId);
      if (target && canonical(target.name) !== canonical(parseFilename(file.name).material)) throw new Error('文件名中的材料名称与选定材料不一致，请核对；不会把不同材料合并');
      const r = await fetch('/_import/check?filename=' + encodeURIComponent(file.name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Import-Options': encodeURIComponent(JSON.stringify(options)) }, body: file });
      const result = await r.json(); if (!r.ok) throw new Error(result.error);
      const targetSectionId = q('#upload-section').value;
      const preview = await api.previewImport(result.plan, targetId, targetSectionId);
      current = { ...result, preview, targetSectionId };
      q('#upload-message').textContent = `校验通过：${result.plan.cards.length} 词，${result.plan.media.length} 段读音。${options.supplement ? '已按你的确认补齐分类标签。' : ''}`;
      q('#upload-preview').innerHTML = `<div class="card"><h3>请核对后导入</h3><p>${e(preview.paper.name)} · ${e(result.plan.paper.sections[0].label)}</p><p>${e(options.courses.join('、'))} · ${e(options.sourceType)} · ${e(result.plan.paper.bank)}</p><p><b>新增 ${preview.changes.added} 词 · 修正 ${preview.changes.changed} 词 · 不变 ${preview.changes.same} 词</b></p><div class="tbl-wrap"><table><thead><tr><th>单词</th><th>释义</th><th>标签</th></tr></thead><tbody>${result.plan.cards.slice(0, 12).map((c) => `<tr><td>${e(c.data.w)}</td><td>${e(c.data.mean)}</td><td class="faint">${e(c.data.tags.join(' · '))}</td></tr>`).join('')}</tbody></table></div><p class="faint">预览前 12 词。本次保存词库内容；学生已有的答题进度保留。导入后由你勾选布置。</p><button class="pri" id="upload-confirm">确认导入词库</button></div>`;
      q('#upload-confirm').onclick = commit;
    } catch (err) { q('#upload-message').textContent = err.message; }
    finally { root.inert = false; }
  };
  async function commit() {
    if (!current) return; root.inert = true;
    try {
      const media = [];
      for (const name of current.plan.media) {
        q('#upload-message').textContent = `准备读音 ${media.length + 1}/${current.plan.media.length}…`;
        const r = await fetch(`/_import/media/${current.id}/${name}`); if (!r.ok) throw new Error('读音预览已失效，请重新校验'); media.push({ name, blob: await r.blob() });
      }
      // Re-read cloud content just before writing; never merge against a stale preview.
      const fresh = await api.previewImport(current.plan, current.preview.paper.paper_id, current.targetSectionId);
      await api.importPrepared(fresh, media, (msg) => { q('#upload-message').textContent = msg; });
      q('#upload-preview').innerHTML = ''; q('#upload-message').textContent = '词库导入完成。请去“词库”选词并布置给学生。'; current = null; await onImported?.();
    } catch (err) { q('#upload-message').textContent = `导入未完成：${err.message}。已完成的部分可安全重试，重复卡片不会再次增加。`; }
    finally { root.inert = false; }
  }
}
