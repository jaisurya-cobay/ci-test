import { Router } from 'express';

import { notFound } from '../errors.js';
import { parseCreateBody, parseListQuery, parseUpdateBody } from '../validation.js';

export function createTaskRouter(store) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { completed, limit, offset } = parseListQuery(req.query);
    const { tasks, total } = await store.list({ completed, limit, offset });
    res.json({ data: tasks, total, limit: limit ?? null, offset: offset ?? 0 });
  });

  router.post('/', async (req, res) => {
    const task = await store.create(parseCreateBody(req.body));
    res.status(201).location(`/api/tasks/${task.id}`).json({ data: task });
  });

  router.get('/:id', async (req, res) => {
    const task = await store.get(req.params.id);
    if (!task) throw notFound(`No task with id ${req.params.id}`);
    res.json({ data: task });
  });

  router.patch('/:id', async (req, res) => {
    const task = await store.update(req.params.id, parseUpdateBody(req.body));
    if (!task) throw notFound(`No task with id ${req.params.id}`);
    res.json({ data: task });
  });

  router.delete('/:id', async (req, res) => {
    const deleted = await store.remove(req.params.id);
    if (!deleted) throw notFound(`No task with id ${req.params.id}`);
    res.status(204).end();
  });

  return router;
}
