import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.TEST_API_URL || 'http://localhost:8787';
async function request(path, { method = 'GET', token, body, origin } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
}
test('live document permissions, persistence, and simultaneous-edit protection', async () => {
  const created = await request('/documents', { method: 'POST', body: { title: '권한 테스트', content: '# 시작' } });
  assert.equal(created.status, 201);
  const { id, token } = created.data;
  const path = `/documents/${id}`;
  assert.equal((await request(path)).status, 404);
  assert.equal((await request(path, { token: 'a'.repeat(64) })).status, 404);
  const share = await request(`${path}/share`, { method: 'POST', token, body: { role: 'view' } });
  assert.equal(share.status, 200);
  const viewer = share.data.token;
  const view = await request(path, { token: viewer });
  assert.equal(view.data.role, 'view');
  assert.equal(view.data.content, '# 시작');
  assert.equal(view.data.editToken, undefined);
  assert.equal(view.data.viewToken, undefined);
  assert.equal((await request(path, { method: 'PUT', token: viewer, body: { title: '공격', content: '변경', revision: 1 } })).status, 403);
  assert.equal((await request(`${path}/share`, { method: 'POST', token: viewer, body: { role: 'edit' } })).status, 403);
  const editShare = await request(`${path}/share`, { method: 'POST', token, body: { role: 'edit' } });
  assert.equal(editShare.data.token, token);
  const changes = await Promise.all(['첫 편집', '둘째 편집'].map(content => request(path, { method: 'PUT', token, body: { title: '수정됨', content, revision: 1 } })));
  assert.deepEqual(changes.map(r => r.status).sort(), [200, 409]);
  const latest = await request(path, { token: viewer });
  assert.equal(latest.data.revision, 2);
  assert.equal(latest.data.content, changes.find(r => r.status === 200).data.content);
  assert.equal((await request(path, { token, origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/documents', { method: 'POST', body: { title: '큼', content: '가'.repeat(34000) } })).status, 400);
  assert.equal((await request(path, { method: 'PUT', token, body: { title: 'x'.repeat(121), content: '', revision: 2 } })).status, 400);
  assert.equal((await request(path, { token: viewer })).data.revision, 2);
});
