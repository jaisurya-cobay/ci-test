import assert from 'node:assert/strict';

import { createTask, startTestServer } from './helpers.js';

let request;
let close;

beforeAll(async () => {
  ({ request, close } = await startTestServer());
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  const { body } = await request('GET', '/api/tasks');
  await Promise.all(body.data.map((t) => request('DELETE', `/api/tasks/${t.id}`)));
});

describe('GET /health', () => {
  it('reports ok', async () => {
    const res = await request('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });
});

describe('POST /api/tasks', () => {
  it('creates a task and returns 201 with a Location header', async () => {
    const res = await request('POST', '/api/tasks', {
      title: 'Write the docs',
      description: 'Cover every endpoint',
    });

    assert.equal(res.status, 201);
    assert.match(res.body.data.id, /^[0-9a-f-]{36}$/);
    assert.equal(res.body.data.title, 'Write the docs');
    assert.equal(res.body.data.description, 'Cover every endpoint');
    assert.equal(res.body.data.completed, false);
    assert.equal(res.headers.get('location'), `/api/tasks/${res.body.data.id}`);
  });

  it('defaults description to null and completed to false', async () => {
    const task = await createTask(request, { title: 'Minimal' });
    assert.equal(task.description, null);
    assert.equal(task.completed, false);
  });

  it('trims whitespace from the title', async () => {
    const task = await createTask(request, { title: '  padded  ' });
    assert.equal(task.title, 'padded');
  });

  it('rejects a missing title', async () => {
    const res = await request('POST', '/api/tasks', { description: 'no title' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'bad_request');
    assert.deepEqual(res.body.error.details, [
      { field: 'title', message: 'is required' },
    ]);
  });

  it('rejects a whitespace-only title', async () => {
    const res = await request('POST', '/api/tasks', { title: '   ' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].message, 'must not be empty');
  });

  it('rejects a title over 200 characters', async () => {
    const res = await request('POST', '/api/tasks', { title: 'x'.repeat(201) });
    assert.equal(res.status, 400);
  });

  it('rejects wrong types with per-field details', async () => {
    const res = await request('POST', '/api/tasks', { title: 42, completed: 'yes' });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.error.details, [
      { field: 'title', message: 'must be a string' },
      { field: 'completed', message: 'must be a boolean' },
    ]);
  });

  it('rejects malformed JSON', async () => {
    const res = await request('POST', '/api/tasks', '{"title": ');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_json');
  });

  it('rejects an array body', async () => {
    const res = await request('POST', '/api/tasks', [{ title: 'a' }]);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.message, 'Request body must be a JSON object');
  });

  it('rejects a bare scalar body', async () => {
    // express.json() runs in strict mode, so this never reaches the validator.
    const res = await request('POST', '/api/tasks', '"just a string"');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_json');
  });
});

describe('GET /api/tasks', () => {
  it('returns an empty list initially', async () => {
    const res = await request('GET', '/api/tasks');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: [], total: 0, limit: null, offset: 0 });
  });

  it('returns newest tasks first', async () => {
    await createTask(request, { title: 'first' });
    await createTask(request, { title: 'second' });
    await createTask(request, { title: 'third' });

    const res = await request('GET', '/api/tasks');
    assert.deepEqual(
      res.body.data.map((t) => t.title),
      ['third', 'second', 'first'],
    );
    assert.equal(res.body.total, 3);
  });

  it('filters by completed', async () => {
    await createTask(request, { title: 'open' });
    await createTask(request, { title: 'done', completed: true });

    const done = await request('GET', '/api/tasks?completed=true');
    assert.equal(done.body.total, 1);
    assert.equal(done.body.data[0].title, 'done');

    const open = await request('GET', '/api/tasks?completed=false');
    assert.equal(open.body.total, 1);
    assert.equal(open.body.data[0].title, 'open');
  });

  it('paginates with limit and offset, reporting the pre-pagination total', async () => {
    for (const title of ['a', 'b', 'c']) await createTask(request, { title });

    const res = await request('GET', '/api/tasks?limit=2&offset=1');
    assert.equal(res.body.total, 3);
    assert.equal(res.body.limit, 2);
    assert.equal(res.body.offset, 1);
    assert.deepEqual(
      res.body.data.map((t) => t.title),
      ['b', 'a'],
    );
  });

  it('rejects invalid query parameters', async () => {
    for (const query of [
      '?completed=maybe',
      '?limit=-1',
      '?limit=abc',
      '?limit=101',
      '?offset=1.5',
      '?limit=',
    ]) {
      const res = await request('GET', `/api/tasks${query}`);
      assert.equal(res.status, 400, `expected 400 for ${query}`);
    }
  });
});

describe('GET /api/tasks/:id', () => {
  it('returns the task', async () => {
    const created = await createTask(request, { title: 'Find me' });
    const res = await request('GET', `/api/tasks/${created.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, created);
  });

  it('404s for an unknown id', async () => {
    const res = await request('GET', '/api/tasks/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
  });
});

describe('PATCH /api/tasks/:id', () => {
  it('updates only the supplied fields', async () => {
    const created = await createTask(request, {
      title: 'Before',
      description: 'keep me',
    });
    const res = await request('PATCH', `/api/tasks/${created.id}`, { completed: true });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.completed, true);
    assert.equal(res.body.data.title, 'Before');
    assert.equal(res.body.data.description, 'keep me');
  });

  it('allows clearing the description with null', async () => {
    const created = await createTask(request, { description: 'temporary' });
    const res = await request('PATCH', `/api/tasks/${created.id}`, { description: null });
    assert.equal(res.body.data.description, null);
  });

  it('preserves id and createdAt, and advances updatedAt', async () => {
    const created = await createTask(request);
    const res = await request('PATCH', `/api/tasks/${created.id}`, {
      title: 'Renamed',
      id: 'attacker-supplied',
      createdAt: '1999-01-01T00:00:00.000Z',
    });

    assert.equal(res.body.data.id, created.id);
    assert.equal(res.body.data.createdAt, created.createdAt);
    assert.ok(res.body.data.updatedAt >= created.updatedAt);
  });

  it('rejects an empty patch', async () => {
    const created = await createTask(request);
    const res = await request('PATCH', `/api/tasks/${created.id}`, {});
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /at least one of/);
  });

  it('404s for an unknown id', async () => {
    const res = await request('PATCH', '/api/tasks/nope', { completed: true });
    assert.equal(res.status, 404);
  });
});

describe('DELETE /api/tasks/:id', () => {
  it('deletes the task and returns 204', async () => {
    const created = await createTask(request);
    const res = await request('DELETE', `/api/tasks/${created.id}`);
    assert.equal(res.status, 204);
    assert.equal(res.body, null);

    const after = await request('GET', `/api/tasks/${created.id}`);
    assert.equal(after.status, 404);
  });

  it('404s when deleting twice', async () => {
    const created = await createTask(request);
    await request('DELETE', `/api/tasks/${created.id}`);
    const res = await request('DELETE', `/api/tasks/${created.id}`);
    assert.equal(res.status, 404);
  });
});

describe('unknown routes', () => {
  it('404s with a JSON error envelope', async () => {
    const res = await request('GET', '/api/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
    assert.match(res.body.error.message, /Cannot GET \/api\/nope/);
  });
});
