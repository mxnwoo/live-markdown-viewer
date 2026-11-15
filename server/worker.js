const MAX_BYTES = 100_000;
const tokenPattern = /^[a-f0-9]{64}$/;
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
export async function hashToken(token) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), n => n.toString(16).padStart(2, '0')).join('');
}
export function validDocument(data) {
  return data && typeof data.title === 'string' && data.title.length <= 120 && typeof data.content === 'string' && new TextEncoder().encode(data.content).length <= MAX_BYTES;
}
async function readBody(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_BYTES + 4096) { await reader.cancel(); throw new Error('too-large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    if (origin && !allowed.includes(origin)) return json({ error: '허용되지 않은 출처입니다.' }, 403);
    const headers = { 'Access-Control-Allow-Origin': origin || allowed[0] || '', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    let response;
    try {
      const url = new URL(request.url);
      if (url.pathname === '/documents' && request.method === 'POST') {
        const id = crypto.randomUUID();
        response = await env.DOCUMENTS.get(env.DOCUMENTS.idFromName(id)).fetch(new Request('https://internal/create', { method: 'POST', body: request.body, duplex: 'half' }));
        if (response.ok) response = json({ id, ...await response.json() }, 201);
      } else {
        const match = url.pathname.match(/^\/documents\/([a-f0-9-]{36})(\/share)?$/);
        if (!match) response = json({ error: '문서를 찾을 수 없습니다.' }, 404);
        else response = await env.DOCUMENTS.get(env.DOCUMENTS.idFromName(match[1])).fetch(new Request(`https://internal${match[2] || '/'}`, request));
      }
    } catch { response = json({ error: '요청을 처리하지 못했습니다.' }, 400); }
    return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...headers } });
  },
};

export class Document {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    let body;
    try { if (request.method === 'POST' || request.method === 'PUT') body = await readBody(request); }
    catch { return json({ error: '문서가 너무 크거나 요청 형식이 잘못되었습니다.' }, 400); }
    const path = new URL(request.url).pathname;
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    const tokenHash = tokenPattern.test(token) ? await hashToken(token) : '';
    // Every read/compare/write runs in one transaction, including simultaneous requests.
    return this.ctx.storage.transaction(async storage => {
      const doc = await storage.get('document');
      if (path === '/create' && request.method === 'POST') {
        if (doc) return json({ error: '이미 존재하는 문서입니다.' }, 409);
        if (!validDocument(body)) return json({ error: '제목은 120자, 본문은 100KB 이내로 작성해주세요.' }, 400);
        const editToken = randomToken(); const viewToken = randomToken();
        await storage.put('document', { title: body.title, content: body.content, revision: 1, updatedAt: Date.now(), editHash: await hashToken(editToken), viewHash: await hashToken(viewToken), editToken, viewToken });
        return json({ token: editToken, role: 'edit', revision: 1 }, 201);
      }
      // Use the same response for a nonexistent document and an invalid link.
      if (!doc || !tokenHash || (tokenHash !== doc.editHash && tokenHash !== doc.viewHash)) return json({ error: '유효하지 않은 공유 링크입니다.' }, 404);
      const role = tokenHash === doc.editHash ? 'edit' : 'view';
      const snapshot = () => ({ title: doc.title, content: doc.content, revision: doc.revision, updatedAt: doc.updatedAt, role });
      if (path === '/' && request.method === 'GET') return json(snapshot());
      if (role !== 'edit') return json({ error: '편집 권한이 필요합니다.' }, 403);
      if (path === '/share' && request.method === 'POST') {
        if (!['view', 'edit'].includes(body?.role)) return json({ error: '공유 권한을 선택해주세요.' }, 400);
        return json({ token: body.role === 'edit' ? doc.editToken : doc.viewToken, role: body.role });
      }
      if (path === '/' && request.method === 'PUT') {
        if (!validDocument(body) || !Number.isSafeInteger(body.revision)) return json({ error: '문서 형식 또는 크기를 확인해주세요. 최대 100KB입니다.' }, 400);
        if (body.revision !== doc.revision) return json({ error: '다른 편집자가 문서를 변경했습니다.', document: snapshot() }, 409);
        doc.title = body.title; doc.content = body.content; doc.revision++; doc.updatedAt = Date.now();
        await storage.put('document', doc);
        return json(snapshot());
      }
      return json({ error: '지원하지 않는 요청입니다.' }, 405);
    });
  }
}
