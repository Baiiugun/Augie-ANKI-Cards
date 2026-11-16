// Shared original-card viewer: iframe isolates model CSS from the application's UI.
import { verifyPresentation } from './card-presentation.js';
export function bindCardInteractions(root, { answers = {}, play = () => {}, onSubmit } = {}) {
  root.querySelectorAll('.snd-btn').forEach((button) => button.onclick = (event) => { event.preventDefault(); play(button.dataset.src); });
  root.querySelectorAll('.hint-trigger').forEach((button) => button.onclick = (event) => { event.preventDefault(); button.style.display = 'none'; button.nextElementSibling.style.display = 'inline'; });
  root.querySelectorAll('[data-type-field].type-answer-input').forEach((input) => {
    input.value = answers[input.dataset.typeField] || '';
    input.oninput = () => { answers[input.dataset.typeField] = input.value; };
    input.onkeydown = (event) => { if (event.key === 'Enter' && onSubmit) { event.preventDefault(); onSubmit(); } };
  });
  root.querySelectorAll('.type-answer-result').forEach((result) => {
    const wanted = result.dataset.typeAnswer, actual = answers[result.dataset.typeField] || '';
    result.classList.add(actual.normalize('NFC').trim() === wanted.normalize('NFC').trim() ? 'type-correct' : 'type-wrong');
    result.textContent = actual ? actual + (actual.normalize('NFC').trim() === wanted.normalize('NFC').trim() ? ' ✓' : ' → ' + wanted) : wanted;
  });
  return answers;
}
const BASE = `body{margin:0;padding:8px;font-family:Arial,sans-serif;font-size:20px;text-align:center;background:white;color:black}img,video{max-width:100%;height:auto}.snd-btn{display:inline-block;text-decoration:none;padding:6px 12px;cursor:pointer}.type-answer-input{font:inherit;max-width:90%;box-sizing:border-box}.type-correct{color:#16803b}.type-wrong{color:#c32929}`;
export function mountOriginalCard(host, presentation, { side = 'q', face = 0, mediaBase = '', answers = {}, play, onKey, onSubmit, autoplay = false, onError } = {}) {
  host.style.width = '100%';
  try { verifyPresentation(presentation); } catch (error) { host.textContent = error.message; onError?.(error); return () => {}; }
  const selected = presentation.faces[face];
  if (!selected) throw new Error('原卡卡面不存在');
  const frame = document.createElement('iframe');
  frame.title = '原卡卡面'; frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = 'display:block;width:100%;min-height:240px;border:0;background:white';
  // No card scripts, navigation or forms. The parent supplies playback and spelling.
  const rewrite = (value) => value.replace(/\/media\/(?=[a-zA-Z0-9_.-])/g, mediaBase);
  const html = rewrite(side === 'q' ? selected.front : selected.back), css = rewrite(presentation.css);
  let observer, disposed = false, resize;
  frame.onload = () => {
    if (disposed) return;
    const doc = frame.contentDocument;
    bindCardInteractions(doc, { answers, onSubmit, play: play || ((url) => { const player = new Audio(url); player.play().catch(() => {}); }) });
    resize = () => { if (disposed) return; const height = Math.max(240, Math.ceil(doc.body.getBoundingClientRect().height) + 16); if (frame.style.height !== height + 'px') frame.style.height = height + 'px'; };
    // Observe content changes, not dimensions: viewport-dependent card CSS must not
    // trigger a resize feedback loop between the frame and its own body.
    observer = new MutationObserver(resize); observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style','hidden','class'] });
    doc.addEventListener('load', resize, true); doc.fonts?.ready.then(resize); window.addEventListener('resize', resize); resize();
    doc.addEventListener('keydown', (event) => { if (!event.target.matches('input,textarea,[contenteditable]')) onKey?.(event); });
    doc.querySelectorAll('a[href^="http"]').forEach((link) => { link.target = '_blank'; link.rel = 'noopener noreferrer'; });
    if (autoplay) { const video = doc.querySelector(`video[data-side="${side}"]`); if (video) video.play().catch(() => {}); else { const button = doc.querySelector(`.snd-btn[data-side="${side}"]`); if (button) (play || ((url) => new Audio(url).play().catch(() => {})))(button.dataset.src); } }
  };
  const escapedCss = (BASE + '\n' + css).replace(/<\/style/gi, '<\\/style');
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: http: data:; media-src https: http: data:; font-src https: http: data:;"><style>${escapedCss}</style><body class="card card${selected.ord + 1}">${html}</body>`;
  host.replaceChildren(frame);
  return () => { disposed = true; observer?.disconnect(); if (resize) window.removeEventListener('resize', resize); frame.contentDocument?.querySelectorAll('audio,video').forEach((el) => el.pause()); frame.remove(); };
}
