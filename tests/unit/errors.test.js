import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiError, badRequest, notFound } from '../../src/errors.js';

describe('ApiError', () => {
  it('is a real Error carrying status, code, and details', () => {
    const err = new ApiError(418, 'teapot', 'Short and stout', [{ field: 'spout' }]);

    assert.ok(err instanceof Error);
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 418);
    assert.equal(err.code, 'teapot');
    assert.equal(err.message, 'Short and stout');
    assert.deepEqual(err.details, [{ field: 'spout' }]);
  });

  it('leaves details undefined when omitted, so it stays out of JSON output', () => {
    const err = new ApiError(500, 'internal_error', 'Boom');
    assert.equal(err.details, undefined);
    assert.equal(JSON.stringify({ ...(err.details && { details: err.details }) }), '{}');
  });

  it('has a usable stack trace', () => {
    assert.match(new ApiError(400, 'x', 'y').stack, /ApiError/);
  });
});

describe('notFound', () => {
  it('builds a 404 with a default message', () => {
    const err = notFound();
    assert.equal(err.status, 404);
    assert.equal(err.code, 'not_found');
    assert.equal(err.message, 'Resource not found');
  });

  it('accepts a custom message', () => {
    assert.equal(notFound('No task with id 7').message, 'No task with id 7');
  });
});

describe('badRequest', () => {
  it('builds a 400 with the given message', () => {
    const err = badRequest('Validation failed');
    assert.equal(err.status, 400);
    assert.equal(err.code, 'bad_request');
    assert.equal(err.details, undefined);
  });

  it('carries validation details when supplied', () => {
    const details = [{ field: 'title', message: 'is required' }];
    assert.deepEqual(badRequest('Validation failed', details).details, details);
  });
});
