# Tasks API

A small REST API for managing tasks, with a browser UI served from the same
process. Built with Node.js and Express 5. Data is held in memory, so it resets
on restart.

## Requirements

Node.js 20 or newer. The repo pins **24.19.0** in [.nvmrc](.nvmrc), and
[.npmrc](.npmrc) sets `engine-strict=true`, so `npm install` refuses to run on a
Node that violates `engines` rather than failing later at runtime.

```bash
nvm use    # picks up .nvmrc
```

## Getting started

```bash
npm install
npm start                 # UI + API at http://localhost:3000
npm run dev               # same, with auto-reload on file changes
```

Set `PORT` to listen elsewhere: `PORT=8080 npm start`.

## Checks

Every one of these runs in CI; run them locally in the same order to see what CI
will see.

```bash
npm run lint              # ESLint
npm run format:check      # Prettier, verify only
npm run format            # Prettier, write
npm audit --audit-level=high
npm test                  # both tiers, 100 tests
npm run test:unit         # unit tier only     (src/tests/unit)
npm run test:integration  # integration tier   (src/tests/integration)
npm run test:coverage
```

Tests run on Jest. The project is native ESM, so the scripts set
`NODE_OPTIONS=--experimental-vm-modules` via `cross-env` — invoke Jest through
npm rather than calling `npx jest` bare, or module loading will fail.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org),
enforced by commitlint through [.husky/commit-msg](.husky/commit-msg) locally and
again in CI (a local hook can be skipped with `--no-verify`; CI cannot).

```
feat(api): add task filtering
fix: reject empty ?limit=
chore(ci): pin node version
```

## The UI

Open <http://localhost:3000> in a browser. It's a single page — plain HTML, CSS,
and ES modules, no build step and no framework — that talks to the same public
API described below.

- Type a title (notes optional) and press **Add**
- Click a checkbox to toggle done
- Click **×** to delete
- Filter by **All / Open / Done**; the header counts open vs. total
- Failed requests surface the server's validation message in a banner
- Follows your system light/dark preference

Files live in [public/](public/) and are served by `express.static`, mounted
_after_ the API router so a stray file can never shadow a route.

## Endpoints

| Method   | Path             | Description                    |
| -------- | ---------------- | ------------------------------ |
| `GET`    | `/health`        | Liveness check                 |
| `GET`    | `/api/tasks`     | List tasks, newest first       |
| `POST`   | `/api/tasks`     | Create a task                  |
| `GET`    | `/api/tasks/:id` | Fetch one task                 |
| `PATCH`  | `/api/tasks/:id` | Update one or more fields      |
| `DELETE` | `/api/tasks/:id` | Delete a task (`204`, no body) |

### Task shape

```json
{
  "id": "2cd6693e-2aec-40d0-a347-94f89f40e95a",
  "title": "Ship the API",
  "description": null,
  "completed": false,
  "createdAt": "2026-08-13T05:32:38.960Z",
  "updatedAt": "2026-08-13T05:32:38.960Z"
}
```

`title` is required (1–200 characters, trimmed). `description` is a string up to
2000 characters or `null`. `completed` defaults to `false`. `id`, `createdAt`,
and `updatedAt` are server-managed and ignored if sent by a client.

### List query parameters

- `completed` — `true` or `false`, filters by status
- `limit` — integer 0–100
- `offset` — non-negative integer

`total` in the response is the count _before_ pagination is applied.

```bash
curl "http://localhost:3000/api/tasks?completed=false&limit=10"
```

```json
{ "data": [], "total": 0, "limit": 10, "offset": 0 }
```

### Examples

```bash
# Create — responds 201 with a Location header
curl -X POST http://localhost:3000/api/tasks \
  -H 'content-type: application/json' \
  -d '{"title":"Ship the API","description":"Cover every endpoint"}'

# Mark complete
curl -X PATCH http://localhost:3000/api/tasks/<id> \
  -H 'content-type: application/json' \
  -d '{"completed":true}'

# Delete
curl -X DELETE http://localhost:3000/api/tasks/<id>
```

On Windows PowerShell, `curl` is an alias for `Invoke-WebRequest`. Use the
native cmdlet instead:

```powershell
$body = @{ title = "Buy milk"; description = "2%" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/tasks `
  -ContentType 'application/json' -Body $body
```

## Errors

Every error uses the same envelope, with `details` present on validation
failures:

```json
{
  "error": {
    "code": "bad_request",
    "message": "Validation failed",
    "details": [{ "field": "title", "message": "is required" }]
  }
}
```

Codes: `bad_request` (400), `invalid_json` (400), `not_found` (404),
`payload_too_large` (413), `internal_error` (500).

## Layout

```
src/
  server.js        entry point, port binding, graceful shutdown
  app.js           app assembly, JSON parsing, static mount, error handling
  routes/tasks.js  the /api/tasks endpoints
  store.js         in-memory persistence
  validation.js    request body and query validation
  errors.js        ApiError type and helpers
  tests/
    unit/                 modules in isolation — no server, no sockets
      store.test.js         TaskStore
      validation.test.js    the parsers
      errors.test.js        ApiError and its helpers
    integration/          the same code over real HTTP
      tasks.test.js         every endpoint
      ui.test.js            static asset serving
      helpers.js            ephemeral-port test server
public/
  index.html       the UI
  styles.css       styling, light and dark
  app.js           fetch calls and DOM rendering
```

The two tiers exist so failures point somewhere. A unit failure names the broken
function; an integration failure means the wiring between them is wrong.

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on push and PR against
`develop`, `qa`, and `master`, in three gated stages:

| Stage             | Checks                                                            |
| ----------------- | ----------------------------------------------------------------- |
| Code quality      | engine pin, `npm ci`, lint, format check, `npm audit`, commitlint |
| Unit tests        | `npm run test:unit`                                               |
| Integration tests | `npm run test:integration`                                        |

Each stage gates the next, so a formatting slip reports in seconds instead of
waiting on the socket-binding suite, and the expensive tier never runs against
code that already failed static analysis. A final summary job writes a result
table to the run summary.

[.github/workflows/pr-checklist.yml](.github/workflows/pr-checklist.yml) appends
a checklist to each PR based on its target branch — `qa`, `develop`, or `master`.
Templates live in [.github/PULL_REQUEST_TEMPLATE/](.github/PULL_REQUEST_TEMPLATE/)
on the default branch, which is the single source of truth the workflow reads
from.

## Swapping the storage layer

`TaskStore` in [src/store.js](src/store.js) is the only module that touches
data, and every method is async. Implement the same interface (`list`, `get`,
`create`, `update`, `remove`) against a database and pass it in:

```js
createApp({ store: new PostgresTaskStore(pool) });
```


<!-- test -->