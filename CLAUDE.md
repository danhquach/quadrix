# Workflow rules (mandatory)

- **Check the ticket is still free before starting.** Local and cloud sessions cannot see each other's worktrees, so before any work confirm the issue is open and nobody has a PR or branch for it: `gh issue view <n> --json state`, `gh pr list --state all --search "<n> in:body"`, `git ls-remote --heads origin '*issue-<n>-*'`. Closed issue, open or merged PR, or an existing branch → stop and report; don't rebuild it.
- **One branch per ticket.** Never commit work directly to `main`. For each GitHub issue, create a branch first: `issue-<n>-<short-slug>` (e.g. `issue-1-ci`).
- **One worktree per ticket.** Every ticket is worked in its own git worktree on its own branch, never in the shared main checkout, so parallel sessions never share a working tree or a branch: `git fetch && git worktree add .claude/worktrees/issue-<n> -b issue-<n>-<short-slug> origin/main`. Run `git worktree list` first; a worktree or branch that already exists for another ticket belongs to another session, so leave it alone. The main checkout stays on `main` with a clean tree. Remove the worktree after the PR merges (`git worktree remove .claude/worktrees/issue-<n>`).
- **Always merge via a GitHub pull request.** Every branch lands on `main` through a PR — never a local `git merge` pushed to `main`. The PR is the merge record.
- **QA before commit.** Run the full suites from a clean install (`npm ci && npm run lint && npm test && npm run build && npm run check:version`; every PR raises the version over main's, and the pre-push hook refuses a push that doesn't) and verify the ticket's acceptance criteria. All green before any commit. Until the CI ticket lands, `check:version` and the pre-push hook don't exist yet; run the rest.
- **Senior-dev code review before commit.** Run a senior-level code review of the working-tree diff (correctness, tests, spec acceptance criteria, conventions). Findings must be resolved (see the next rule).
- **Fix what you find in the ticket itself.** Anything found while working a ticket (review findings, edge cases, robustness gaps) is fixed on that ticket's branch, then QA and the review run again. No "accepted, not fixed" leftovers in the final report or PR body. The only exception is work an open ticket already covers: link it, or add it to that ticket's description and acceptance criteria.
- **Injection security check before commit.** Any change that adds or touches data the code does not control (player-typed text, save or `localStorage` parsing, URL params, network responses, and any future database or API) gets a `security-devops` audit of the working-tree diff before commit, next to the senior review. The audit covers every path that data travels:
  - SQL/NoSQL injection: parameterised queries only, never queries built from strings.
  - HTML injection/XSS: no `innerHTML`, `eval` or similar sinks; render as text.
  - Validation: an allow-list at every boundary, applied again to data read back from storage or a database.
  - Prototype pollution from parsed JSON.
  - Oversized input and ReDoS.
  - Unicode tricks: bidi overrides, zero-width characters, look-alikes.
  - Leaks: the data must not reach a URL, a log line, the page title or a network call it was not meant for.

  Add unit tests that push hostile payloads through each path. Findings must be resolved, and the PR body says the check passed.

- **MUST wait for approval before commit.** After QA and review pass, present the results and the proposed changes, then STOP and wait for the PM's explicit approval before committing (and before pushing). No exceptions — a green suite is not approval.
- **Branch review before merge.** When pushing a branch, run a code review of the full branch diff (`main..HEAD`) — correctness, tests, and the spec's acceptance criteria for that ticket.
- **Close the ticket when done.** After the work is merged, close the GitHub issue with a closing comment linking the PR.
- **Merge only when all green.** Merge to `main` only when: review findings are resolved, all tests/CI pass, and the ticket's acceptance criteria are met. No self-merge over open findings.

# Public repo — no sensitive data

This repository is public. Nothing committed, pushed, or posted (code, docs, fixtures, commit messages, PR bodies, issue comments) may contain:

- Local usernames, hostnames, or absolute paths from any machine (`/Users/<name>/...`, `*.local`).
- Real email addresses other than the commit identity below, phone numbers, or account identifiers.
- API keys, tokens, deploy secrets, or internal URLs. Secrets live in `.env` (git-ignored) or GitHub Actions secrets only.
- Per-agent memory or scratch files (`.claude/agent-memory/`, `.claude/worktrees/`) — git-ignored; never force-add.
- Names of existing commercial games, studios, or their trademarked terms — no "inspired by X" comparisons anywhere in the repo, issues, or PRs (trademark / takedown risk). Describe the genre generically ("falling-block puzzle", "tetromino").

Before pushing any branch, audit `main..HEAD` plus the PR description against this list. Findings → redact before push; if already pushed, rewrite history and re-audit.

# Communication

- Default reply style: brief. Lead with the recommendation, a few bullets max, no walls of text; detail goes in docs, not chat.
- Wait for explicit confirmation before committing/pushing work (see the QA/review/approval gate above).

# Identity

- Commit as `Daniel Quach <danielq.engineer@gmail.com>` (repo-local git config, already set). Never commit with a machine-generated identity.

# Project docs

- Tickets: GitHub issues on this repo (`gh issue view <n>`).
- Stack: Vite + TypeScript, plain DOM + canvas (no game engine). Unit tests Vitest (`src/core/**`).
- Layering: `src/core/**` is the pure engine (board, pieces, modes): no DOM, no storage, no UI imports. The UI imports core, never the reverse. (ESLint enforcement lands with the CI ticket.)
- Modes plug in through the `Mode` interface in `src/core/modes/`; Classic is the baseline, Override is a placeholder.
- RNG only via the seeded generator in `src/core/pieces.ts` (no `Math.random` in core).
- Text reaches the page only through `textContent` / DOM nodes; no `innerHTML` or other HTML sinks.
