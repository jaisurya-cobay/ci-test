#!/usr/bin/env bash
#
# Move Jira issues to a target status and record why.
#
# One implementation, three callers (branch-created, PR-opened, merged-to-env)
# plus the /pr skill. Keeping the logic here rather than inline in the workflow
# means a fix lands everywhere at once.
#
# Interface is environment variables, not flags, because every caller is either
# a GitHub Actions step or an agent shelling out -- both of which set env
# naturally and quote flags badly.
#
#   Required
#     JIRA_BASE_URL     https://your-org.atlassian.net
#     JIRA_USER_EMAIL   Atlassian account that owns the token
#     JIRA_API_TOKEN    id.atlassian.com/manage-profile/security/api-tokens
#     TARGET_STATUS     status NAME to move to, e.g. "In Review"
#
#   Where to find issue keys (at least one)
#     KEY_TEXT          free text to scan (branch name, PR title, PR body)
#     KEY_RANGE         a git range to scan commit messages in, e.g. abc123..HEAD
#
#   Optional
#     JIRA_PROJECT_KEYS  space/comma list, e.g. "TEST" -- ignore all other keys
#     CONTEXT_LABEL      bolded lead-in for the Jira comment, e.g. "Merged to staging"
#     CONTEXT_URL        URL the comment links to
#     CONTEXT_URL_TEXT   link text (default "details")
#     ACTOR              who caused this (default: $USER)
#     DRY_RUN            "true" = report what would happen, change nothing
#     SUMMARY_FILE       markdown summary destination (default $GITHUB_STEP_SUMMARY)
#
# Never exits non-zero for a Jira-side problem. Bookkeeping must not break the
# pipeline it is reporting on; unreachable Jira, a typo'd key, or a status with
# no legal transition are all warnings. Only a usage error fails.

set -uo pipefail

TARGET_STATUS="${TARGET_STATUS:-}"
KEY_TEXT="${KEY_TEXT:-}"
KEY_RANGE="${KEY_RANGE:-}"
JIRA_PROJECT_KEYS="${JIRA_PROJECT_KEYS:-}"
CONTEXT_LABEL="${CONTEXT_LABEL:-Updated}"
CONTEXT_URL="${CONTEXT_URL:-}"
CONTEXT_URL_TEXT="${CONTEXT_URL_TEXT:-details}"
ACTOR="${ACTOR:-${USER:-unknown}}"
DRY_RUN="${DRY_RUN:-false}"
SUMMARY_FILE="${SUMMARY_FILE:-${GITHUB_STEP_SUMMARY:-/dev/null}}"

if [ -z "$TARGET_STATUS" ]; then
  echo "usage error: TARGET_STATUS is required" >&2
  exit 2
fi

note() { echo "$*"; }
warn() {
  # ::warning:: renders in the Actions UI; harmless noise in a plain terminal.
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning::$*"; else echo "WARNING: $*" >&2; fi
}
summary() { printf '%s\n' "$*" >> "$SUMMARY_FILE"; }

# ---------------------------------------------------------------- credentials

if [ -z "${JIRA_BASE_URL:-}" ] || [ -z "${JIRA_USER_EMAIL:-}" ] || [ -z "${JIRA_API_TOKEN:-}" ]; then
  warn "Jira is not configured -- need JIRA_BASE_URL, JIRA_USER_EMAIL and JIRA_API_TOKEN. Skipping."
  note "  JIRA_BASE_URL:   ${JIRA_BASE_URL:-MISSING}"
  note "  JIRA_USER_EMAIL: ${JIRA_USER_EMAIL:+set}${JIRA_USER_EMAIL:-MISSING}"
  note "  JIRA_API_TOKEN:  ${JIRA_API_TOKEN:+set}${JIRA_API_TOKEN:-MISSING}"
  summary "### Jira — not configured"
  summary ""
  summary "Set \`JIRA_BASE_URL\` (variable) and \`JIRA_USER_EMAIL\` / \`JIRA_API_TOKEN\` (secrets)."
  exit 0
fi

BASE_URL="${JIRA_BASE_URL%/}"
AUTH=$(printf '%s:%s' "$JIRA_USER_EMAIL" "$JIRA_API_TOKEN" | base64 -w0 2>/dev/null || printf '%s:%s' "$JIRA_USER_EMAIL" "$JIRA_API_TOKEN" | base64 | tr -d '\n')

JIRA_HTTP=""
JIRA_BODY=""
jira_api() {
  # jira_api <method> <path> [body-file]
  #   -> response body in $JIRA_BODY, status code in $JIRA_HTTP
  #
  # Deliberately returns through globals rather than stdout. Calling this as
  # BODY=$(jira_api ...) would run it in a subshell, and the status code it
  # assigns would be discarded the moment that subshell exited -- leaving
  # every caller comparing against an empty string and concluding failure.
  local method="$1" path="$2" body_file="${3:-}"
  local args=(-sS -w '\n%{http_code}' -X "$method"
    -H "Authorization: Basic ${AUTH}"
    -H 'Accept: application/json'
    -H 'Content-Type: application/json')
  [ -n "$body_file" ] && args+=(--data @"$body_file")
  local out
  out=$(curl "${args[@]}" "${BASE_URL}${path}" 2>/dev/null)
  JIRA_HTTP="${out##*$'\n'}"
  JIRA_BODY="${out%$'\n'*}"
  # curl never ran or never connected -- report 000 rather than an empty
  # string, so "host unreachable" cannot be misread as a real status code.
  [ -z "$JIRA_HTTP" ] && JIRA_HTTP="000"
}

# Fail fast and legibly on bad credentials -- this is the most common problem,
# and "which account am I acting as" is the answer that actually resolves it.
jira_api GET "/rest/api/3/myself"
ME="$JIRA_BODY"
if [ "$JIRA_HTTP" != "200" ]; then
  warn "Jira authentication failed (HTTP ${JIRA_HTTP}) for ${JIRA_USER_EMAIL} at ${BASE_URL}. Nothing was changed."
  summary "### Jira — authentication FAILED"
  summary ""
  summary "\`GET /rest/api/3/myself\` returned **HTTP ${JIRA_HTTP}** for \`${JIRA_USER_EMAIL}\` at \`${BASE_URL}\`."
  summary "An empty or mismatched \`JIRA_API_TOKEN\` is the usual cause."
  exit 0
fi
ACCOUNT=$(printf '%s' "$ME" | jq -r '.displayName // "unknown"')
note "Authenticated with Jira as ${ACCOUNT}."

# ------------------------------------------------------------------ issue keys

# A Jira key is a letter, 1+ more letters/digits, a hyphen, then digits. Keys
# inside URLs (.../browse/TEST-42) match too, which is intentional -- a PR body
# that links the issue counts as referencing it.
collect_keys() {
  {
    [ -n "$KEY_TEXT" ] && printf '%s\n' "$KEY_TEXT"
    if [ -n "$KEY_RANGE" ]; then
      git log --format='%s%n%b' "$KEY_RANGE" 2>/dev/null || true
    fi
  } | grep -oE '\b[A-Z][A-Z0-9]{1,9}-[0-9]+\b' | sort -u
}

KEYS=$(collect_keys || true)

# Optional narrowing, so a stray reference to another project's board is ignored.
if [ -n "$JIRA_PROJECT_KEYS" ] && [ -n "$KEYS" ]; then
  FILTER=$(printf '%s' "$JIRA_PROJECT_KEYS" | tr ',' ' ' | tr -s ' ')
  SELECTED=""
  for key in $KEYS; do
    prefix="${key%%-*}"
    for allowed in $FILTER; do
      if [ "$prefix" = "$allowed" ]; then
        SELECTED="${SELECTED}${key}"$'\n'
        break
      fi
    done
  done
  KEYS=$(printf '%s' "$SELECTED" | sed '/^$/d')
  note "Restricted to project key(s): ${FILTER}"
fi

if [ -z "${KEYS// /}" ]; then
  note "No Jira issue keys found -- nothing to do."
  summary "### Jira — nothing to sync"
  summary ""
  summary "Authenticated as **${ACCOUNT}**, but no issue keys were found to act on."
  exit 0
fi

note "Issue key(s): $(echo $KEYS)"
[ "$DRY_RUN" = "true" ] && note "DRY RUN -- no issue will be modified."

# ----------------------------------------------------------------- transitions

MOVED=""
SKIPPED=""
FAILED=""

for KEY in $KEYS; do
  jira_api GET "/rest/api/3/issue/${KEY}?fields=status,summary"
  ISSUE="$JIRA_BODY"
  if [ "$JIRA_HTTP" != "200" ]; then
    # A commit or branch can name a key that never existed. That is a typo,
    # not a pipeline failure.
    warn "${KEY}: not found in Jira (HTTP ${JIRA_HTTP}) -- skipped."
    SKIPPED="${SKIPPED}${KEY} (not found)\n"
    continue
  fi

  CURRENT=$(printf '%s' "$ISSUE" | jq -r '.fields.status.name // ""')
  ISSUE_SUMMARY=$(printf '%s' "$ISSUE" | jq -r '.fields.summary // ""')
  note "${KEY}: \"${ISSUE_SUMMARY}\" is in '${CURRENT}'."

  if [ "$CURRENT" = "$TARGET_STATUS" ]; then
    note "${KEY}: already in '${TARGET_STATUS}'."
    SKIPPED="${SKIPPED}${KEY} (already ${TARGET_STATUS})\n"
  else
    jira_api GET "/rest/api/3/issue/${KEY}/transitions"
    TRANSITIONS="$JIRA_BODY"
    # Match the transition's DESTINATION status first, then its own name --
    # boards often label the button differently from the column it lands in.
    # Resolving by name means board edits never require a code change, unlike
    # the hardcoded transition IDs this replaces.
    TID=$(printf '%s' "$TRANSITIONS" | jq -r --arg s "$TARGET_STATUS" '
      ([.transitions[]? | select((.to.name // "") | ascii_downcase == ($s | ascii_downcase)) | .id]
       + [.transitions[]? | select((.name   // "") | ascii_downcase == ($s | ascii_downcase)) | .id]
      )[0] // ""')

    if [ -z "$TID" ]; then
      AVAILABLE=$(printf '%s' "$TRANSITIONS" | jq -r '[.transitions[]?.to.name] | join(", ")')
      warn "${KEY}: no transition '${CURRENT}' -> '${TARGET_STATUS}' (available: ${AVAILABLE:-none})."
      SKIPPED="${SKIPPED}${KEY} (no path ${CURRENT} -> ${TARGET_STATUS})\n"
      continue
    fi

    if [ "$DRY_RUN" = "true" ]; then
      note "${KEY}: WOULD move ${CURRENT} -> ${TARGET_STATUS}."
      MOVED="${MOVED}${KEY} (would: ${CURRENT} -> ${TARGET_STATUS})\n"
      continue
    fi

    jq -n --arg id "$TID" '{transition:{id:$id}}' > /tmp/jira-transition.json
    jira_api POST "/rest/api/3/issue/${KEY}/transitions" /tmp/jira-transition.json
    if [ "$JIRA_HTTP" != "204" ]; then
      warn "${KEY}: transition to '${TARGET_STATUS}' failed (HTTP ${JIRA_HTTP})."
      FAILED="${FAILED}${KEY} (HTTP ${JIRA_HTTP})\n"
      continue
    fi
    note "${KEY}: ${CURRENT} -> ${TARGET_STATUS}"
    MOVED="${MOVED}${KEY} (${CURRENT} -> ${TARGET_STATUS})\n"
  fi

  [ "$DRY_RUN" = "true" ] && continue

  # Comment even when no transition was needed: the issue was still part of
  # this event, and that trail is what makes the board auditable later.
  jq -n \
    --arg label "$CONTEXT_LABEL" \
    --arg actor "$ACTOR" \
    --arg url "$CONTEXT_URL" \
    --arg url_text "$CONTEXT_URL_TEXT" \
    '{body:{type:"doc",version:1,content:[{type:"paragraph",content:(
       [{type:"text",text:$label,marks:[{type:"strong"}]},
        {type:"text",text:(" by " + $actor)}]
       + (if $url == "" then []
          else [{type:"text",text:" — "},
                {type:"text",text:$url_text,marks:[{type:"link",attrs:{href:$url}}]}]
          end)
     )}]}}' > /tmp/jira-comment.json

  jira_api POST "/rest/api/3/issue/${KEY}/comment" /tmp/jira-comment.json
  [ "$JIRA_HTTP" != "201" ] && warn "${KEY}: could not add comment (HTTP ${JIRA_HTTP})."
done

# -------------------------------------------------------------------- summary

if [ "$DRY_RUN" = "true" ]; then
  summary "### Jira — DRY RUN → ${TARGET_STATUS}"
else
  summary "### Jira — ${CONTEXT_LABEL}"
fi
summary ""
summary "Acting as **${ACCOUNT}**"
summary ""
summary "| Result | Issues |"
summary "| ------ | ------ |"
summary "$(printf '| Moved to `%s` | %s |' "$TARGET_STATUS" "$(printf '%b' "${MOVED:-—}" | paste -sd' ' -)")"
summary "$(printf '| Skipped | %s |' "$(printf '%b' "${SKIPPED:-—}" | paste -sd' ' -)")"
summary "$(printf '| Failed | %s |' "$(printf '%b' "${FAILED:-—}" | paste -sd' ' -)")"

exit 0
