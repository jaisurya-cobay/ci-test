import { randomUUID } from 'node:crypto';

/**
 * In-memory task store. Swap this module for a database-backed one and the
 * route layer stays unchanged — every method is async on purpose.
 */
export class TaskStore {
  #tasks = new Map();
  // Insertion counter: createdAt alone can't order tasks created in the saame
  // millisecond, so ordering keys off this instead. Never exposed in responses.
  #seq = 0;
  #order = new Map();

  async list({ completed, limit, offset } = {}) {
    let tasks = [...this.#tasks.values()];
    if (completed !== undefined) {
      tasks = tasks.filter((task) => task.completed === completed);
    }
    tasks.sort((a, b) => this.#order.get(b.id) - this.#order.get(a.id));

    const total = tasks.length;
    const start = offset ?? 0;
    const end = limit === undefined ? undefined : start + limit;
    return { tasks: tasks.slice(start, end), total };
  }

  async get(id) {
    return this.#tasks.get(id) ?? null;
  }

  async create({ title, description = null, completed = false }) {
    const now = new Date().toISOString();
    const task = {
      id: randomUUID(),
      title,
      description,
      completed,
      createdAt: now,
      updatedAt: now,
    };
    this.#tasks.set(task.id, task);
    this.#order.set(task.id, this.#seq++);
    return task;
  }

  async update(id, patch) {
    const existing = this.#tasks.get(id);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.#tasks.set(id, updated);
    return updated;
  }

  async remove(id) {
    this.#order.delete(id);
    return this.#tasks.delete(id);
  }

  async clear() {
    this.#tasks.clear();
    this.#order.clear();
  }
}
