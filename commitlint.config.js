/**
 * Conventional Commits, e.g.
 *   feat(api): add task filtering
 *   fix: reject empty ?limit=
 *   chore(ci): pin node version
 *
 * Enforced locally by .husky/commit-msg and again in CI, since a local hook
 * can always be skipped with --no-verify.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [1, 'always', 100],
  },
};
