---
name: delete-comment
description: Clear code comments from a file, a folder or a whole repo, in any programming language. Each one is sorted as a tautology, stale, an excuse or a decision; decisions move into ADRs, excuses become issues, and the rest are deleted. Use when the user runs /delete-comment, asks to remove or audit code comments, or when a no-comments lint rule fires.
---

# Delete comments

This skill clears code comments: it reads each one, saves what is worth keeping where it belongs (decisions in ADRs, hacks in issues), and deletes the comment. Its argument is the scope: files or folders, or the whole repo when there is none.

`comments.mjs`, next to this file, does the mechanical parts: `list` finds the comments, `delete` removes them, `verify` checks that nothing but comments changed. You do the reading and the writing. Below, `$SKILL` is this skill's folder and `$SCRATCH` a scratch folder outside the repo. Run every command from inside the repo; paths are relative to the current folder.

The script needs only Node 18+ and git, never the project's dependencies. It reads comments with a lexer driven by a table of each language's comment markers and string forms (raw strings, heredocs, template literals, JSX text, `<script>` and `<style>` inside markup). `node "$SKILL/comments.mjs" languages` prints the table. For a language it lacks, write a module whose default export maps a language id to an entry shaped like those in `LANGUAGES` in the script, and pass `--syntax <module.mjs>` to every command.

## 0. Learn the project's rules

Read the agent instructions (`AGENTS.md`, `CLAUDE.md`), the glossary or domain docs if any, and look for:

- **The comment policy**: an ADR, a section of the agent instructions, or a lint rule banning comments. If the project allows some comments (license headers, public API docs), keep those out of scope and say so.
- **The languages in scope**: the code languages by default. Config files (YAML, TOML, JSON, INI, XML, ignore files) are in scope only when the policy says so.
- **Where decisions live**: `docs/adr/`, `docs/decisions/`, `adr/` or similar, and its format. When the project has none, ask the user before creating `docs/adr/`.
- **The issue tracker** and its conventions: title format, labels, projects, parent issues. Look for a doc describing it. With none, use `gh issue` on the repo's GitHub.
- **Commit conventions**, the formatter and the lint, typecheck and test scripts.

## 1. List

```sh
node "$SKILL/comments.mjs" list [--lang <names>] [--skip <regex>] <paths…> > "$SCRATCH/blocks.json"
```

It prints every comment in the git-tracked files under the paths as `{ id, file, lang, start, end, col, endCol, text }`. Consecutive standalone comments are one block. Left out:

- comments a tool reads: lint and formatter suppressions, type-checker ignores, coverage pragmas, encoding lines and modelines, build tags, cgo preambles, Haskell pragmas, LuaLS annotations, `/// <reference>`, bundler magic comments…;
- legal notices: a header that reads as a copyright or license, `SPDX-…`, `@license`, `/*! … */`;
- files marked generated (`@generated`, `DO NOT EDIT`) and generated or vendored folders (`node_modules`, `vendor`, `dist`, `build`, `target`, minified files, lockfiles, `.agents/`, `.claude/`…); add more with `--skip <regex>`, matched against the repo-relative path, on `list` and `verify` alike;
- docstrings and doc attributes (Python `"""…"""`, Elixir `@doc`): they are string values, not comments.

`--lang` takes comma-separated language names from `languages`, or a group: `code` (the default), `config`, `all`. The summary on stderr names the languages scanned, those left out of scope, the files skipped as generated, and the extensions with no syntax: when one of those is in scope, add its syntax and list again. If the project bulk-suppresses a no-comments rule (ESLint's `eslint-suppressions.json`, another linter's baseline), that file names the files that still have comments.

The lexer knows strings and comments, not grammar. When a listed block is not a comment (a string or code it misread), leave it out of the deletion and name it in your report.

## 2. Sort each block

Skim the titles of the ADRs and read the ones of the area. Then read each file whole, and judge each comment against the code around it.

| Kind | It is… | Action |
| --- | --- | --- |
| **Tautology** | what the code, its names, its types or its tests already say. A doc comment paraphrasing a signature; a section label. | Delete. |
| **Stale** | about code or a reason that no longer holds (grep the names it mentions), or already written in the agent instructions, the docs, an ADR or a lint message. | Delete. |
| **Excuse** | a hacky or provisional implementation let off the hook: "for now", "until", "workaround", "kept in step by hand", a fallback for old data, a field kept for old clients, a test-only seam. The test: a better implementation exists, and we chose not to write it yet. | Delete, and file an issue to fix the hack. |
| **Decision** | an important, non-obvious decision: someone who did not know it would "fix" the code and break something (a business rule, a trade-off, a tool's constraint, an order that matters). An unavoidable constraint of a tool is a decision, not an excuse. | Move it into an ADR, then delete. |
| **Directive** | read by a tool that `list` did not recognize: a doc annotation a type checker, framework or ORM reads (PHPDoc `@var` for PHPStan, Doctrine or route annotations, JSDoc types in a checked JS file), a comment a lint rule requires. | Keep, and name it in your report. |

When a block mixes kinds, sort it by its most valuable part and make sure that part is saved. When a comment turns out to be wrong about the code, say so in your report: that is a finding, not something to save.

## 3. Save what is worth keeping

**Decisions.** Gather them by topic: an ADR is a decision area, never one comment. Before writing a new one, look for an ADR that already covers the area:

- It says the same thing: nothing to write, the comment was stale.
- It lacks the detail: write a new ADR that amends it (an `- Amends: NNNN` line, or whatever the project's ADRs use). Edit an existing ADR in place only to fix a pointer that leads nowhere once the comment is gone.
- Nothing covers it: a new ADR, numbered after the highest one.

Follow the existing ADRs' format and voice. With no ADRs yet, use `# NNNN. <the decision, stated>`, then `Status`, `Date`, `## Context`, `## Decision`, and `## Consequences` only when it adds something. Name code by file path and function, never by line number. Check each claim against the code: comments go out of date, and the ADR states what the code does.

**Excuses.** One issue per hack, gathering every comment that excuses it, after checking the open issues for one that already covers it (then comment on that one instead). Follow the tracker's conventions found in step 0. When there are several, make them sub-issues of one parent issue if the tracker supports it. The body has `## What` (files, functions, what the code does now), `## Why it is a hack`, `## Proper fix` (concrete, with any migration or release order it needs) and `## The comments that excused it`, quoting each comment verbatim with its file path: once deleted, the issue is its only record.

Also check the agent instructions and the docs for sentences that point at a comment you are deleting ("its header explains…"), and move what they point at.

## 4. Delete

Write the blocks to delete to a JSON file, as `list` printed them, and run:

```sh
node "$SKILL/comments.mjs" delete "$SCRATCH/to-delete.json"
<the project's formatters> <the files it printed>
node "$SKILL/comments.mjs" verify
```

`delete` refuses a block whose lines changed since `list`. It removes a JSX comment with its `{}`, a comment's line when nothing else is on it, and a blank line the removal doubles. `verify` compares each changed file with `HEAD` (or the base given as its argument), comments removed, whitespace collapsed and strings kept verbatim, and names any file whose code changed. A formatter dropping the parentheses around JSX, joining lines a trailing comment kept apart, or changing quotes also shows up there: look at those with `git diff` and move on. Any other file it names was changed by more than the deletion, which is fine only when you meant it. Because `verify` ignores whitespace, it does not see indentation: in whitespace-sensitive languages (Python, YAML, Haskell, Makefiles) read the `git diff` of the files a formatter touched. And because it shares the lexer with `list`, it cannot catch a misread; the build and tests below can.

If the project bulk-suppresses its no-comments rule, lower the counts now (`eslint --prune-suppressions`, or the project's script for it): the linter fails until it runs.

Then run the project's lint, typecheck, build and test scripts for every language you touched. A failure that was not there before the deletion means a deleted comment was holding something up: a directive `list` did not recognize, a doc annotation a tool reads, or an empty block that now trips a no-empty rule. Restore that comment and name it in your report.

## Many comments

Beyond a few hundred comments, split the scope into folders of similar size, and give each folder to a subagent that only sorts: it reads the files and writes one JSON line per block (`{ id, category, reason, adr?, issue? }`) plus its ADR and issue drafts in a scratch folder, editing nothing in the repo. Then merge the drafts across folders (the same decision is often drafted from the client and the server, or from several modules), number the ADRs, file the issues and run one `delete` over everything. Sorting in parallel and deleting once keeps the agents from editing the same file.

## Commit

One commit, following the project's conventions, holding the deletions, the new ADRs, the edited docs and any suppressions file. List the issues it filed in the PR body.
