---
name: delete-comment
description: Clear code comments from a file, a folder or the repo. Each one is sorted as a tautology, stale, an excuse or a decision; decisions move into ADRs, excuses become issues, and the rest are deleted. Use when the user runs /delete-comment, when ESLint's superkrono/no-comments rule fires, or when eslint-suppressions.json still lists comments.
---

# Delete comments

The code carries no comments (ADR 0076, AGENTS.md › Comments). This skill clears the ones that are still there: it reads each comment, saves what is worth keeping where it belongs, and deletes the comment. Its argument is the scope: files or folders, or the whole repo when there is none.

`comments.mjs`, next to this file, does the mechanical parts: `list` finds the comments, `delete` removes them, `verify` checks that nothing but comments changed. You do the reading and the writing.

## 1. List

```sh
node .agents/skills/delete-comment/comments.mjs list <paths…> > "$SCRATCH/blocks.json"
```

It prints every comment in the tracked JS, TS and CSS files under the paths as `{ id, file, start, end, text }`. Consecutive `//` lines are one block. Tool directives are left out, as the lint rule leaves them (`eslint-disable`, `@ts-expect-error`, `/// <reference>`, `prettier-ignore`…). `eslint-suppressions.json` names the files that still have comments.

## 2. Sort each block

Read `CONTEXT.md`, the titles in `docs/adr/` and the ADRs of the area, and skim `AGENTS.md`. Then read each file whole, and judge each comment against the code around it.

| Kind | It is… | Action |
| --- | --- | --- |
| **Tautology** | what the code, its names, its types or its tests already say. A doc comment paraphrasing a signature; a section label. | Delete. |
| **Stale** | about code or a reason that no longer holds (grep the names it mentions), or already written in `AGENTS.md`, `CONTEXT.md`, an ADR or a lint message. | Delete. |
| **Excuse** | a hacky or provisional implementation let off the hook: "for now", "until", "workaround", "kept in step by hand", a fallback for old data, a field kept for old pages, a test-only seam. The test: a better implementation exists, and we chose not to write it yet. | Delete, and file an issue to fix the hack. |
| **Decision** | an important, non-obvious decision: someone who did not know it would "fix" the code and break something (a club rule, a trade-off, a tool's constraint, an order that matters). An unavoidable constraint of a tool is a decision, not an excuse. | Move it into an ADR, then delete. |

When a block mixes kinds, sort it by its most valuable part and make sure that part is saved. When a comment turns out to be wrong about the code, say so in your report: that is a finding, not something to save.

## 3. Save what is worth keeping

**Decisions.** Gather them by topic: an ADR is a decision area, never one comment. Before writing a new one, look for an ADR that already covers the area:

- It says the same thing: nothing to write, the comment was stale.
- It lacks the detail: write a new ADR with an `- Amends: NNNN` line, as ADR 0025 does for 0022. Edit an existing ADR in place only to fix a pointer that leads nowhere once the comment is gone (as ADR 0021's list of writes was).
- Nothing covers it: a new ADR, numbered after the highest in `docs/adr/`.

Follow the existing ADRs' format and voice: `# NNNN. <the decision, stated>`, then `Status`, `Date`, `## Context`, `## Decision`, and `## Consequences` only when it adds something. Name code by file path and function, never by line number. Check each claim against the code: comments go out of date, and the ADR states what the code does.

**Excuses.** One issue per hack, gathering every comment that excuses it, after checking `gh issue list --state open` for one that already covers it (then comment on that one instead). Follow `docs/agents/issue-tracker.md`: title `<scope>: <imperative description>`, `needs-triage`, on the `superkrono` project with Status Todo. When there are several, make them sub-issues of one parent issue. The body has `## What` (files, functions, what the code does now), `## Why it is a hack`, `## Proper fix` (concrete, with the migration and release order AGENTS.md › Data access requires) and `## The comments that excused it`, quoting each comment verbatim with its file path: once deleted, the issue is its only record.

Also check `AGENTS.md` and the docs for sentences that point at a comment you are deleting ("its header shows…"), and move what they point at.

## 4. Delete

Write the blocks to delete to a JSON file, as `list` printed them, and run:

```sh
node .agents/skills/delete-comment/comments.mjs delete "$SCRATCH/to-delete.json"
pnpm exec prettier --write <the files it printed>
node .agents/skills/delete-comment/comments.mjs verify
pnpm lint:prune
```

`delete` refuses a block whose lines changed since `list`. It removes a JSX comment with its `{}`, and a comment's line when nothing else is on it. `verify` compares each changed file's tokens with `HEAD`, ignoring comments, and names any file whose code changed. Prettier dropping the parentheses around JSX, or joining lines a trailing comment kept apart, also shows up there: look at those with `git diff` and move on. Any other file it names was changed by more than the deletion, which is fine only when you meant it. `pnpm lint:prune` lowers the file counts in `eslint-suppressions.json`: ESLint fails until it runs.

Then run `pnpm lint`, `pnpm typecheck` and `pnpm test`. A lint error that was not there before the deletion means a deleted comment was holding something up: an `eslint-disable` written as a plain comment, or an empty block that now trips `no-empty`.

## Many comments

Beyond a few hundred comments, split the scope into folders of similar size, and give each folder to a subagent that only sorts: it reads the files and writes one JSON line per block (`{ id, category, reason, adr?, issue? }`) plus its ADR and issue drafts in a scratch folder, editing nothing in the repo. Then merge the drafts across folders (the same decision is often drafted from the client and the server, or from several modules), number the ADRs, file the issues and run one `delete` over everything. Sorting in parallel and deleting once keeps the agents from editing the same file.

## Commit

One commit, `docs: <what was cleared>` when it is mostly ADRs, or the domain's scope. It holds the deletions, the new ADRs, the edited docs and `eslint-suppressions.json`. List the issues it filed in the PR body.
