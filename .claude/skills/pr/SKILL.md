---
name: pr
description: Raise a pull request for the current work. Commits any pending changes with a Conventional Commit message, pushes the branch, and opens a PR into qa with the Jira issue linked. Use when the user says /pr, "raise a PR", "open a PR", or "put this up for review".
---

# /pr — raise a pull request

Takes whatever is in the working tree and turns it into a reviewable PR, with
the Jira issue key threaded through the branch, the commit and the PR so the
board updates itself.

Never push to `qa`, `develop` or `master` directly. Repository rulesets block
it with no bypass actors, so an attempt fails — and it would skip review
anyway. Every change reaches an environment through a PR.

## The flow this fits into

```
feature/TEST-123-slug ──PR──► qa ──PR──► develop ──PR──► master
     In Progress      In Review   QA      Staging    Production
```

`/pr` covers the first arrow. Promotions between environment branches are
separate PRs, and `ci.yml` enforces that `develop` only ever comes from `qa`
and `master` only from `develop` or a `hotfix/*` branch.

## Steps

### 1. Establish the Jira key

Read the current branch: `git rev-parse --abbrev-ref HEAD`.

- If it matches `*TEST-<number>*`, that's the key — use it.
- If it doesn't, or the branch is `qa`/`develop`/`master`, **stop and ask**
  which Jira issue this is for. Do not guess, and do not proceed keyless: a
  change with no key is invisible to the board and to every metric built on
  it.
- Given a key on a non-feature branch, create one first:
  `git checkout -b feature/TEST-123-short-slug`

Confirm the issue exists and show the user its summary before continuing:

```bash
curl -sS -u "$JIRA_USER_EMAIL:$JIRA_API_TOKEN" \
  "$JIRA_BASE_URL/rest/api/3/issue/TEST-123?fields=summary,status" |
  jq -r '.key + ": " + .fields.summary + "  [" + .fields.status.name + "]"'
```

If those variables aren't set locally, skip this check rather than failing —
the workflows will still do the transition server-side.

### 2. Commit what's pending

Check `git status --short`. If nothing is staged or modified, skip to step 3.

Review the diff before writing the message — the message should describe the
change's intent, not list the files. Then commit with a **Conventional Commit**
subject carrying the key:

```
<type>(<scope>): TEST-123 <what changed>
```

`commitlint` runs on `commit-msg` and rejects anything else; `lint` and
`prettier --check .` run on `pre-commit`. If a hook fails, fix the underlying
problem — never reach for `--no-verify`. A local hook can be skipped but CI
runs the same checks and cannot.

Valid: `feat(api): TEST-123 add task filtering`
Invalid: `updates`, `fix stuff`, `TEST-123`

### 3. Push the branch

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
```

This is what fires the `create` event on a new branch, moving the issue to
**In Progress**.

### 4. Open the PR into `qa`

```bash
gh pr create --base qa \
  --title "TEST-123: <summary of the change>" \
  --body "<body>"
```

The body should state what changed and why, and link the issue:

```markdown
<one or two sentences on what this does and why>

Jira: https://cobay.atlassian.net/browse/TEST-123
```

Don't add a checklist — `pr-checklist.yml` appends the right one for the
target branch automatically, and a hand-written one will be duplicated.

### 5. Report back

Print the PR URL and what the automation will now do:

- The `Jira Lifecycle` workflow moves **TEST-123 → In Review**
- CI runs lint, unit and integration tiers
- On merge to `qa` the issue moves to **QA**, then **Staging** on `develop`,
  then **Production** on `master`
- **Done stays manual** — close it yourself once you've verified in production

## Notes

- One issue per PR where you can manage it. Several keys in one PR all get
  transitioned together, which makes lead-time metrics meaningless for each.
- If the PR is a draft, the issue moves to In Review when it's marked ready,
  not when it's opened.
- Reopening a PR re-runs the transition, which is harmless — the script skips
  an issue that's already in the target status.
