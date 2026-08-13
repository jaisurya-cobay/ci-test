import assert from 'node:assert/strict';

import { ApiError } from '../../errors.js';
import { parseCreateBody, parseListQuery, parseUpdateBody } from '../../validation.js';

/** Asserts fn throws an ApiError, and returns it for further checks. */
function throws(fn, { status = 400, code = 'bad_request' } = {}) {
  let error;
  assert.throws(fn, (err) => {
    assert.ok(
      err instanceof ApiError,
      `expected ApiError, got ${err?.constructor?.name}`,
    );
    error = err;
    return true;
  });
  assert.equal(error.status, status);
  assert.equal(error.code, code);
  return error;
}

describe('parseCreateBody', () => {
  it('accepts a title alone and omits absent optional fields', () => {
    const result = parseCreateBody({ title: 'Write tests' });
    assert.deepEqual(result, { title: 'Write tests' });
    assert.ok(
      !('description' in result),
      'description should stay absent, not become undefined',
    );
    assert.ok(!('completed' in result));
  });

  it('passes through description and completed when supplied', () => {
    assert.deepEqual(parseCreateBody({ title: 'a', description: 'b', completed: true }), {
      title: 'a',
      description: 'b',
      completed: true,
    });
  });

  it('trims surrounding whitespace from the title', () => {
    assert.equal(parseCreateBody({ title: '\t  spaced  \n' }).title, 'spaced');
  });

  it('accepts an explicit null description', () => {
    assert.equal(parseCreateBody({ title: 'a', description: null }).description, null);
  });

  it('accepts a title of exactly 200 characters', () => {
    const title = 'x'.repeat(200);
    assert.equal(parseCreateBody({ title }).title, title);
  });

  it('accepts a description of exactly 2000 characters', () => {
    const description = 'y'.repeat(2000);
    assert.equal(parseCreateBody({ title: 'a', description }).description, description);
  });

  it('ignores unknown fields rather than rejecting them', () => {
    const result = parseCreateBody({ title: 'a', id: 'spoofed', createdAt: 'nope' });
    assert.deepEqual(result, { title: 'a' });
  });

  it('requires a title', () => {
    const err = throws(() => parseCreateBody({}));
    assert.deepEqual(err.details, [{ field: 'title', message: 'is required' }]);
  });

  it('rejects an empty or whitespace-only title', () => {
    for (const title of ['', '   ', '\n\t']) {
      const err = throws(() => parseCreateBody({ title }));
      assert.equal(err.details[0].message, 'must not be empty');
    }
  });

  it('rejects a title over 200 characters, counted after trimming', () => {
    const err = throws(() => parseCreateBody({ title: `  ${'x'.repeat(201)}  ` }));
    assert.equal(err.details[0].message, 'must be at most 200 characters');
  });

  it('rejects a description over 2000 characters', () => {
    const err = throws(() =>
      parseCreateBody({ title: 'a', description: 'y'.repeat(2001) }),
    );
    assert.equal(err.details[0].message, 'must be at most 2000 characters');
  });

  it('rejects wrong types per field', () => {
    assert.equal(
      throws(() => parseCreateBody({ title: 42 })).details[0].message,
      'must be a string',
    );
    assert.equal(
      throws(() => parseCreateBody({ title: 'a', description: 7 })).details[0].message,
      'must be a string or null',
    );
    assert.equal(
      throws(() => parseCreateBody({ title: 'a', completed: 'yes' })).details[0].message,
      'must be a boolean',
    );
  });

  it('collects every field error in one response', () => {
    const err = throws(() =>
      parseCreateBody({ title: '', description: 1, completed: 'x' }),
    );
    assert.deepEqual(
      err.details.map((d) => d.field),
      ['title', 'description', 'completed'],
    );
  });

  it('rejects non-object bodies', () => {
    for (const body of [null, undefined, 'string', 42, true, [], [{ title: 'a' }]]) {
      const err = throws(() => parseCreateBody(body));
      assert.equal(err.message, 'Request body must be a JSON object');
    }
  });
});

describe('parseUpdateBody', () => {
  it('returns only the fields that were supplied', () => {
    assert.deepEqual(parseUpdateBody({ completed: true }), { completed: true });
    assert.deepEqual(parseUpdateBody({ title: 'new' }), { title: 'new' });
  });

  it('accepts all three fields together', () => {
    assert.deepEqual(
      parseUpdateBody({ title: 'a', description: 'b', completed: false }),
      { title: 'a', description: 'b', completed: false },
    );
  });

  it('allows clearing the description with null', () => {
    assert.deepEqual(parseUpdateBody({ description: null }), { description: null });
  });

  it('treats completed:false as a real change, not an empty patch', () => {
    assert.deepEqual(parseUpdateBody({ completed: false }), { completed: false });
  });

  it('drops unknown fields, so id and createdAt cannot be overwritten', () => {
    assert.deepEqual(
      parseUpdateBody({ completed: true, id: 'spoofed', createdAt: '1999-01-01' }),
      { completed: true },
    );
  });

  it('rejects an empty patch', () => {
    const err = throws(() => parseUpdateBody({}));
    assert.match(err.message, /at least one of: title, description, completed/);
    assert.equal(err.details, undefined);
  });

  it('rejects a patch of only unknown fields', () => {
    throws(() => parseUpdateBody({ id: 'spoofed' }));
  });

  it('applies the same field rules as create', () => {
    assert.equal(parseUpdateBody({ title: '  trimmed  ' }).title, 'trimmed');
    throws(() => parseUpdateBody({ title: '   ' }));
    throws(() => parseUpdateBody({ title: 'x'.repeat(201) }));
    throws(() => parseUpdateBody({ completed: 1 }));
  });

  it('rejects non-object bodies', () => {
    for (const body of [null, 'string', []]) {
      assert.equal(
        throws(() => parseUpdateBody(body)).message,
        'Request body must be a JSON object',
      );
    }
  });
});

describe('parseListQuery', () => {
  it('returns an empty object for no parameters', () => {
    assert.deepEqual(parseListQuery({}), {});
  });

  it('coerces completed to a boolean', () => {
    assert.deepEqual(parseListQuery({ completed: 'true' }), { completed: true });
    assert.deepEqual(parseListQuery({ completed: 'false' }), { completed: false });
  });

  it('coerces limit and offset to numbers', () => {
    assert.deepEqual(parseListQuery({ limit: '10', offset: '5' }), {
      limit: 10,
      offset: 5,
    });
  });

  it('accepts the boundary values 0 and 100', () => {
    assert.deepEqual(parseListQuery({ limit: '0', offset: '0' }), {
      limit: 0,
      offset: 0,
    });
    assert.deepEqual(parseListQuery({ limit: '100' }), { limit: 100 });
  });

  it('accepts a large offset, which has no upper bound', () => {
    assert.deepEqual(parseListQuery({ offset: '99999' }), { offset: 99999 });
  });

  it('rejects a completed value other than true or false', () => {
    for (const completed of ['maybe', 'TRUE', '1', '']) {
      const err = throws(() => parseListQuery({ completed }));
      assert.equal(err.details[0].field, 'completed');
    }
  });

  it('rejects a non-integer, negative, or oversized limit', () => {
    for (const limit of ['abc', '-1', '1.5', '101', '']) {
      const err = throws(() => parseListQuery({ limit }));
      assert.equal(err.details[0].field, 'limit');
    }
  });

  it('rejects a non-integer or negative offset', () => {
    for (const offset of ['abc', '-1', '2.5']) {
      const err = throws(() => parseListQuery({ offset }));
      assert.equal(err.details[0].field, 'offset');
    }
  });

  it('reports limit and offset errors together', () => {
    const err = throws(() => parseListQuery({ limit: '-1', offset: 'abc' }));
    assert.deepEqual(
      err.details.map((d) => d.field),
      ['limit', 'offset'],
    );
    assert.equal(err.message, 'Invalid query parameters');
  });
});
