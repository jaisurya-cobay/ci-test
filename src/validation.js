import { badRequest } from './errors.js';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function validateTitle(value, errors) {
  if (typeof value !== 'string') {
    errors.push({ field: 'title', message: 'must be a string' });
    return undefined;
  }
  const title = value.trim();
  if (title.length === 0) {
    errors.push({ field: 'title', message: 'must not be empty' });
  } else if (title.length > TITLE_MAX) {
    errors.push({ field: 'title', message: `must be at most ${TITLE_MAX} characters` });
  }
  return title;
}

function validateDescription(value, errors) {
  if (value === null) return null;
  if (typeof value !== 'string') {
    errors.push({ field: 'description', message: 'must be a string or null' });
    return undefined;
  }
  if (value.length > DESCRIPTION_MAX) {
    errors.push({
      field: 'description',
      message: `must be at most ${DESCRIPTION_MAX} characters`,
    });
  }
  return value;
}

function validateCompleted(value, errors) {
  if (typeof value !== 'boolean') {
    errors.push({ field: 'completed', message: 'must be a boolean' });
    return undefined;
  }
  return value;
}

/** Body for POST /tasks — title required, everything else optional. */
export function parseCreateBody(body) {
  if (!isPlainObject(body)) {
    throw badRequest('Request body must be a JSON object');
  }

  const errors = [];
  const task = {};

  if (body.title === undefined) {
    errors.push({ field: 'title', message: 'is required' });
  } else {
    task.title = validateTitle(body.title, errors);
  }
  if (body.description !== undefined) {
    task.description = validateDescription(body.description, errors);
  }
  if (body.completed !== undefined) {
    task.completed = validateCompleted(body.completed, errors);
  }

  if (errors.length > 0) throw badRequest('Validation failed', errors);
  return task;
}

/** Body for PATCH /tasks/:id — every field optional, but at least one required. */
export function parseUpdateBody(body) {
  if (!isPlainObject(body)) {
    throw badRequest('Request body must be a JSON object');
  }

  const errors = [];
  const patch = {};

  if (body.title !== undefined) patch.title = validateTitle(body.title, errors);
  if (body.description !== undefined) {
    patch.description = validateDescription(body.description, errors);
  }
  if (body.completed !== undefined) {
    patch.completed = validateCompleted(body.completed, errors);
  }

  if (errors.length > 0) throw badRequest('Validation failed', errors);
  if (Object.keys(patch).length === 0) {
    throw badRequest('Provide at least one of: title, description, completed');
  }
  return patch;
}

/** Query string for GET /tasks. */
export function parseListQuery(query) {
  const errors = [];
  const parsed = {};

  if (query.completed !== undefined) {
    if (query.completed === 'true' || query.completed === 'false') {
      parsed.completed = query.completed === 'true';
    } else {
      errors.push({ field: 'completed', message: "must be 'true' or 'false'" });
    }
  }

  for (const [field, max] of [['limit', 100], ['offset', Infinity]]) {
    if (query[field] === undefined) continue;
    const raw = query[field];
    // Number('') and Number('  ') are both 0, so an empty ?limit= would
    // silently mean "return nothing". Reject it instead.
    const value = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > max) {
      errors.push({
        field,
        message: Number.isFinite(max)
          ? `must be an integer between 0 and ${max}`
          : 'must be a non-negative integer',
      });
    } else {
      parsed[field] = value;
    }
  }

  if (errors.length > 0) throw badRequest('Invalid query parameters', errors);
  return parsed;
}
