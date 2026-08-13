import assert from 'node:assert/strict';

import { TaskStore } from '../../store.js';

let store;

beforeEach(() => {
  store = new TaskStore();
});

const seed = async (...titles) => {
  const created = [];
  for (const title of titles) created.push(await store.create({ title }));
  return created;
};

describe('TaskStore.create', () => {
  it('assigns a uuid, timestamps, and defaults', async () => {
    const task = await store.create({ title: 'Write tests' });

    assert.match(
      task.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    assert.equal(task.title, 'Write tests');
    assert.equal(task.description, null);
    assert.equal(task.completed, true); // DRILL: deliberate failure
    assert.equal(task.createdAt, task.updatedAt);
    assert.ok(!Number.isNaN(Date.parse(task.createdAt)));
  });

  it('honours supplied description and completed', async () => {
    const task = await store.create({ title: 'a', description: 'b', completed: true });
    assert.equal(task.description, 'b');
    assert.equal(task.completed, true);
  });

  it('gives every task a distinct id', async () => {
    const tasks = await seed('a', 'b', 'c', 'd', 'e');
    assert.equal(new Set(tasks.map((t) => t.id)).size, 5);
  });

  it('does not expose the internal ordering key on the task', async () => {
    const task = await store.create({ title: 'a' });
    assert.deepEqual(Object.keys(task).sort(), [
      'completed',
      'createdAt',
      'description',
      'id',
      'title',
      'updatedAt',
    ]);
  });
});

describe('TaskStore.get', () => {
  it('returns the stored task', async () => {
    const created = await store.create({ title: 'Find me' });
    assert.deepEqual(await store.get(created.id), created);
  });

  it('returns null for an unknown id', async () => {
    assert.equal(await store.get('missing'), null);
  });
});

describe('TaskStore.list', () => {
  it('returns an empty result for an empty store', async () => {
    assert.deepEqual(await store.list(), { tasks: [], total: 0 });
  });

  it('orders newest first', async () => {
    await seed('first', 'second', 'third');
    const { tasks } = await store.list();
    assert.deepEqual(
      tasks.map((t) => t.title),
      ['third', 'second', 'first'],
    );
  });

  it('orders by insertion, not by createdAt, when timestamps collide', async () => {
    // Created in a tight loop, so several share a millisecond — insertion
    // order must still decide.
    const created = await seed(...Array.from({ length: 25 }, (_, i) => `task-${i}`));
    const sharedTimestamps =
      new Set(created.map((t) => t.createdAt)).size < created.length;

    const { tasks } = await store.list();
    assert.deepEqual(
      tasks.map((t) => t.title),
      created.map((t) => t.title).reverse(),
      sharedTimestamps
        ? 'ordering must survive same-millisecond creates'
        : 'ordering wrong (timestamps happened not to collide this run)',
    );
  });

  it('filters by completed', async () => {
    await store.create({ title: 'open' });
    await store.create({ title: 'done', completed: true });

    const done = await store.list({ completed: true });
    assert.equal(done.total, 1);
    assert.equal(done.tasks[0].title, 'done');

    const open = await store.list({ completed: false });
    assert.equal(open.total, 1);
    assert.equal(open.tasks[0].title, 'open');
  });

  it('treats an undefined filter as no filter', async () => {
    await seed('a', 'b');
    assert.equal((await store.list({ completed: undefined })).total, 2);
  });

  it('applies limit and offset', async () => {
    await seed('a', 'b', 'c', 'd'); // listed as d, c, b, a
    const { tasks } = await store.list({ limit: 2, offset: 1 });
    assert.deepEqual(
      tasks.map((t) => t.title),
      ['c', 'b'],
    );
  });

  it('reports total before pagination', async () => {
    await seed('a', 'b', 'c');
    const { tasks, total } = await store.list({ limit: 1 });
    assert.equal(tasks.length, 1);
    assert.equal(total, 3);
  });

  it('counts the filter but not the page in total', async () => {
    await store.create({ title: 'x', completed: true });
    await store.create({ title: 'y', completed: true });
    await store.create({ title: 'z' });

    const { tasks, total } = await store.list({ completed: true, limit: 1 });
    assert.equal(total, 2, 'total reflects the filter');
    assert.equal(tasks.length, 1, 'page reflects the limit');
  });

  it('returns an empty page for an offset past the end', async () => {
    await seed('a');
    const { tasks, total } = await store.list({ offset: 10 });
    assert.deepEqual(tasks, []);
    assert.equal(total, 1);
  });

  it('returns nothing for limit 0', async () => {
    await seed('a', 'b');
    const { tasks, total } = await store.list({ limit: 0 });
    assert.deepEqual(tasks, []);
    assert.equal(total, 2);
  });

  it('does not let callers mutate the store through the returned array', async () => {
    await seed('a');
    const { tasks } = await store.list();
    tasks.pop();
    assert.equal((await store.list()).total, 1);
  });
});

describe('TaskStore.update', () => {
  it('changes only the supplied fields', async () => {
    const created = await store.create({ title: 'Before', description: 'keep' });
    const updated = await store.update(created.id, { completed: true });

    assert.equal(updated.completed, true);
    assert.equal(updated.title, 'Before');
    assert.equal(updated.description, 'keep');
  });

  it('preserves id and createdAt even when the patch tries to change them', async () => {
    const created = await store.create({ title: 'a' });
    const updated = await store.update(created.id, {
      id: 'spoofed',
      createdAt: '1999-01-01T00:00:00.000Z',
      title: 'b',
    });

    assert.equal(updated.id, created.id);
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal(updated.title, 'b');
  });

  it('advances updatedAt', async () => {
    const created = await store.create({ title: 'a' });
    const updated = await store.update(created.id, { title: 'b' });
    assert.ok(
      Date.parse(updated.updatedAt) >= Date.parse(created.updatedAt),
      'updatedAt must not go backwards',
    );
  });

  it('persists the change for later reads', async () => {
    const created = await store.create({ title: 'a' });
    await store.update(created.id, { title: 'b' });
    assert.equal((await store.get(created.id)).title, 'b');
  });

  it('returns null for an unknown id and creates nothing', async () => {
    assert.equal(await store.update('missing', { title: 'x' }), null);
    assert.equal((await store.list()).total, 0);
  });

  it('keeps the task in its original list position', async () => {
    const [a] = await seed('a', 'b', 'c');
    await store.update(a.id, { title: 'a-updated' });

    const { tasks } = await store.list();
    assert.deepEqual(
      tasks.map((t) => t.title),
      ['c', 'b', 'a-updated'],
    );
  });

  it('does not mutate the previously returned object', async () => {
    const created = await store.create({ title: 'a' });
    await store.update(created.id, { title: 'b' });
    assert.equal(created.title, 'a', 'the earlier snapshot should be untouched');
  });
});

describe('TaskStore.remove', () => {
  it('deletes and reports true', async () => {
    const created = await store.create({ title: 'a' });
    assert.equal(await store.remove(created.id), true);
    assert.equal(await store.get(created.id), null);
    assert.equal((await store.list()).total, 0);
  });

  it('reports false for an unknown id', async () => {
    assert.equal(await store.remove('missing'), false);
  });

  it('reports false on a second delete', async () => {
    const created = await store.create({ title: 'a' });
    await store.remove(created.id);
    assert.equal(await store.remove(created.id), false);
  });

  it('leaves the remaining tasks in order', async () => {
    const [, b] = await seed('a', 'b', 'c');
    await store.remove(b.id);
    assert.deepEqual(
      (await store.list()).tasks.map((t) => t.title),
      ['c', 'a'],
    );
  });

  it('does not reuse the ordering slot of a deleted task', async () => {
    const [a] = await seed('a', 'b');
    await store.remove(a.id);
    await store.create({ title: 'c' });

    assert.deepEqual(
      (await store.list()).tasks.map((t) => t.title),
      ['c', 'b'],
    );
  });
});

describe('TaskStore.clear', () => {
  it('empties the store', async () => {
    await seed('a', 'b');
    await store.clear();
    assert.deepEqual(await store.list(), { tasks: [], total: 0 });
  });

  it('leaves the store usable, with ordering intact', async () => {
    await seed('a', 'b');
    await store.clear();
    await seed('c', 'd');
    assert.deepEqual(
      (await store.list()).tasks.map((t) => t.title),
      ['d', 'c'],
    );
  });
});

describe('TaskStore isolation', () => {
  it('keeps instances independent', async () => {
    const other = new TaskStore();
    await store.create({ title: 'mine' });

    assert.equal((await other.list()).total, 0);
    assert.equal((await store.list()).total, 1);
  });
});
