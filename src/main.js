import { marked } from 'marked';
import DOMPurify from 'dompurify';
import './style.css';
import config from './config.js';

const $ = id => document.getElementById(id);
const apiBase = (import.meta.env.VITE_API_URL || config.apiUrl || '').replace(/\/$/, '');
let id = '', token = '', role = 'edit', revision = 0;
let dirty = false, saving = false, conflict = null, timer, pollTimer, creating = null, generatedLink = '';
let disposed = false;
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'INPUT') { node.setAttribute('type', 'checkbox'); node.setAttribute('disabled', ''); }
});
function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
function localKey() { return id ? `lmv:draft:${id}:${token}` : 'lmv:new'; }
function values() { return { title: $('title').value, content: $('editor').value }; }
function notice(message, isConflict = false) { $('notice').hidden = !message; $('notice-text').textContent = message; $('conflict-actions').hidden = !isConflict; }
function status(message) { $('status').textContent = message; }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(timer); timer = setTimeout(() => $('toast').hidden = true, 2500); }
function render() {
  $('preview').innerHTML = DOMPurify.sanitize(marked.parse($('editor').value, { gfm: true, breaks: false }), { FORBID_TAGS: ['style', 'form', 'button', 'iframe'], ADD_ATTR: ['checked', 'disabled'] });
  $('preview').querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  document.title = `${$('title').value || '제목 없는 문서'} · Live Markdown`;
}
function apply(doc) { $('title').value = doc.title; $('editor').value = doc.content; revision = doc.revision || 0; render(); }
function setRole(next) {
  role = next;
  const viewer = role !== 'edit';
  document.body.classList.toggle('viewer', viewer);
  $('editor-pane').hidden = viewer; $('share').hidden = viewer;
  $('title').readOnly = viewer; $('editor').readOnly = viewer;
  $('title').placeholder = viewer ? '' : '제목';
}
async function api(path, method = 'GET', body) {
  if (!apiBase) throw new Error('공유 서버가 아직 연결되지 않았습니다. README의 배포 설정을 완료해주세요.');
  let response;
  try { response = await fetch(`${apiBase}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch { throw new Error('서버에 연결할 수 없어요. 연결을 확인해주세요.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('공유 서버 응답을 확인해주세요.'); }
  if (!response.ok) { const error = new Error(data.error || '요청을 처리하지 못했어요.'); error.status = response.status; error.data = data; throw error; }
  return data;
}
function draft() {
  const ok = storageSet(localKey(), JSON.stringify({ ...values(), revision, dirty }));
  if (!ok) notice('브라우저에 임시 저장할 수 없어요. 페이지를 닫기 전에 작성 내용을 복사해주세요.');
}
async function ensureCreated() {
  if (id) return;
  if (creating) return creating;
  creating = (async () => {
    const before = values();
    const data = await api('/documents', 'POST', before);
    id = data.id; token = data.token; revision = data.revision;
    history.replaceState(null, '', `#${new URLSearchParams({ doc: id, key: token })}`);
    dirty = JSON.stringify(before) !== JSON.stringify(values()); draft();
    if (!dirty) status('모든 변경사항 저장됨');
    startPolling();
  })();
  try { await creating; } finally { creating = null; }
}
async function save() {
  if (!dirty || saving || conflict || role !== 'edit') return;
  if (!id) { status('내 브라우저에 저장됨'); return; }
  saving = true; status('저장 중…');
  const sent = values(); const sentRevision = revision;
  try {
    const doc = await api(`/documents/${id}`, 'PUT', { ...sent, revision: sentRevision });
    revision = doc.revision;
    dirty = JSON.stringify(sent) !== JSON.stringify(values()); draft();
    status(dirty ? '저장 중…' : '모든 변경사항 저장됨');
    notice('');
  } catch (error) {
    if (error.status === 409) { conflict = error.data.document; notice('다른 편집자가 내용을 변경했어요. 내 작성 내용은 유지됩니다. 저장할 내용을 선택해주세요.', true); status('변경사항 확인 필요'); }
    else { notice(`${error.message} 작성 내용은 이 브라우저에 남아 있습니다.`); status('저장 대기 중'); }
  } finally { saving = false; }
}
async function poll() {
  if (disposed || !id || document.hidden || saving || conflict) return;
  if (dirty) { await save(); return; }
  const requestedRevision = revision;
  try {
    const doc = await api(`/documents/${id}`);
    // Never replace text typed while the request was in flight.
    if (!dirty && !saving && revision === requestedRevision && doc.revision > revision) { apply(doc); status('최신 내용으로 동기화됨'); }
    if (!dirty) notice('');
  } catch (error) { status('연결 확인 중…'); notice(error.message); }
}
function startPolling() { clearInterval(pollTimer); pollTimer = setInterval(poll, 1500); }
let saveTimer;
function changed() { if (role !== 'edit') return; dirty = true; render(); draft(); status(id ? '저장 대기 중…' : '내 브라우저에 저장됨'); clearTimeout(saveTimer); saveTimer = setTimeout(save, 500); }
$('title').addEventListener('input', changed); $('editor').addEventListener('input', changed);
$('editor').addEventListener('keydown', event => {
  if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); const el = event.target; el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end'); changed(); }
});
$('use-remote').onclick = () => { if (!conflict) return; storageSet(`${localKey()}:backup`, JSON.stringify(values())); apply(conflict); conflict = null; dirty = false; draft(); notice(''); status('최신 내용 불러옴'); };
$('keep-local').onclick = () => { if (!conflict) return; revision = conflict.revision; conflict = null; dirty = true; notice(''); save(); };
$('share').onclick = () => { $('share-error').hidden = true; $('share-dialog').showModal(); };
$('share-dialog').addEventListener('click', event => { if (event.target === $('share-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
document.querySelectorAll('[name=permission]').forEach(input => input.onchange = () => { generatedLink = ''; $('link-row').hidden = true; $('copy-link').setAttribute('aria-label', '링크 생성 및 복사'); });
$('copy-link').onclick = async () => {
  const button = $('copy-link'); button.disabled = true; $('share-error').hidden = true;
  try {
    if (conflict) throw new Error('먼저 변경사항을 확인하고 저장할 내용을 선택해주세요.');
    await ensureCreated();
    // Wait for any in-flight autosave, then flush the latest local input.
    while (saving) await new Promise(resolve => setTimeout(resolve, 50));
    await save();
    if (dirty || conflict) throw new Error('저장을 완료한 뒤 다시 공유해주세요.');
    const selected = document.querySelector('[name=permission]:checked').value;
    const result = await api(`/documents/${id}/share`, 'POST', { role: selected });
    const url = new URL(location.href); url.hash = new URLSearchParams({ doc: id, key: result.token }).toString();
    generatedLink = url.href; $('share-link').value = generatedLink; $('link-row').hidden = false; button.setAttribute('aria-label', '링크 다시 복사');
    try { await navigator.clipboard.writeText(generatedLink); toast('복사됨'); }
    catch { $('share-link').focus(); $('share-link').select(); toast('위 링크를 선택해 복사해주세요'); }
  } catch (error) { $('share-error').textContent = error.message; $('share-error').hidden = false; }
  finally { button.disabled = false; }
};
window.addEventListener('beforeunload', event => { if ((dirty && id) || creating) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('hashchange', () => { disposed = true; location.reload(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
window.addEventListener('online', poll);
async function init() {
  const params = new URLSearchParams(location.hash.slice(1));
  id = params.get('doc') || ''; token = params.get('key') || '';
  if (location.hash) {
    setRole('view'); status('문서 불러오는 중…');
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(token)) { notice('공유 링크가 올바르지 않습니다. 전체 링크를 다시 확인해주세요.'); status('열 수 없는 링크'); return; }
    try {
      const doc = await api(`/documents/${id}`); apply(doc); setRole(doc.role); status('최신 내용으로 연결됨');
      let cached; try { cached = JSON.parse(storageGet(localKey()) || 'null'); } catch { /* ignore invalid browser cache */ }
      if (doc.role === 'edit' && cached?.dirty) {
        apply(cached); dirty = true;
        if (cached.revision !== doc.revision) { conflict = doc; notice('이 브라우저에 저장되지 않은 작성 내용이 있어요. 사용할 내용을 선택해주세요.', true); }
        else await save();
      }
      startPolling();
    } catch (error) { notice(error.message); status('문서를 열 수 없음'); }
  } else {
    let cached; try { cached = JSON.parse(storageGet('lmv:new') || 'null'); } catch { /* recover from invalid local data */ }
    apply(cached && typeof cached.content === 'string' ? cached : { title: '', content: '' });
    setRole('edit');
    if (!apiBase) notice('현재는 브라우저에만 저장됩니다. 링크 공유는 저장 서버 연결 후 사용할 수 있어요.');
  }
}
init();
