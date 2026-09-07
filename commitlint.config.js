/**
 * Conventional Commits, e.g.
 *   feat(api): add task filtering (TEST-123)
 *   fix: reject empty ?limit= (TEST-456)
 *   chore(ci): pin node version
 *
 * Enforced locally by .husky/commit-msg and again in CI, since a local hook
 * can always be skipped with --no-verify.
 */

// The only thing linking a commit to Jira is this literal string. Without it
// the commit is invisible on the issue's development panel, and Jira's cycle
// time -- measured from FIRST COMMIT to deployment -- has no start point.
//
// The key goes at the END of the subject, not the start. config-conventional's
// `subject-case` rule forbids a subject beginning with upper-case, so
// "feat: TEST-123 add filtering" is rejected by the inherited rules. Jira
// scans the whole message, so position is irrelevant to the integration.
const JIRA_KEY = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/;

// Required for the types that represent delivered work, since those are what
// the DORA reports measure. Housekeeping types are exempt: a lint fix or a
// dependency bump rarely has a ticket, and forcing one would just train
// people to invent keys, which corrupts the metric it was meant to protect.
const TYPES_NEEDING_A_KEY = ['feat', 'fix'];

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'jira-key-in-subject': ({ type, subject }) => {
          if (!TYPES_NEEDING_A_KEY.includes(type)) return [true];
          return [
            JIRA_KEY.test(subject ?? ''),
            `subject must contain a Jira issue key for "${type}" commits, e.g. "${type}(api): add filtering (TEST-123)"`,
          ];
        },
      },
    },
  ],
  rules: {
    'body-max-line-length': [1, 'always', 100],
    // Drop to 1 to warn instead of block while the team adjusts.
    'jira-key-in-subject': [2, 'always'],
  },
};
