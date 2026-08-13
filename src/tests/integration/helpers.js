import { createApp } from '../../app.js';

/**
 * Boots the app on an ephemeral port and returns a `request` helper plus a
 * `close` function. Keeps tests dependency-free — no supertest needed.
 */
export async function startTestServer() {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  async function request(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      body: text ? JSON.parse(text) : null,
    };
  }

  // Exposed for tests that need the raw response rather than parsed JSON.
  request.base = base;

  return {
    request,
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export const createTask = async (request, overrides = {}) => {
  const res = await request('POST', '/api/tasks', { title: 'Test task', ...overrides });
  return res.body.data;
};
