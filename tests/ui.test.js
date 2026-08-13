import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { startTestServer } from './helpers.js';

let request;
let close;

before(async () => {
  ({ request, close } = await startTestServer());
});

after(async () => {
  await close();
});

// startTestServer parses bodies as JSON, so fetch the raw text directly.
async function raw(path) {
  const res = await fetch(`${request.base}${path}`);
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
}

describe('static UI', () => {
  it('serves index.html at the root', async () => {
    const res = await raw('/');
    assert.equal(res.status, 200);
    assert.match(res.type, /text\/html/);
    assert.match(res.text, /<title>Tasks<\/title>/);
    assert.match(res.text, /id="composer"/);
  });

  it('serves the stylesheet and script', async () => {
    const css = await raw('/styles.css');
    assert.equal(css.status, 200);
    assert.match(css.type, /text\/css/);

    const js = await raw('/app.js');
    assert.equal(js.status, 200);
    assert.match(js.type, /javascript/);
    assert.match(js.text, /const API = '\/api\/tasks'/);
  });

  it('still returns the JSON 404 envelope for unknown paths', async () => {
    const res = await raw('/not-a-page');
    assert.equal(res.status, 404);
    assert.match(res.type, /application\/json/);
    assert.match(res.text, /"code":"not_found"/);
  });
});
