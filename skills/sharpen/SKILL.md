---
name: sharpen
description: Fix skill routing in Claude Code — one owner per job, specific "Use when" descriptions, no PROACTIVELY/MUST BE USED pressure, duplicates resolved. Use when the wrong skill or agent gets picked, nothing gets picked, or several compete for the same job.
user-invocable: true
argument-hint: "[job: review | plan | test | deploy | debug | ui | all]"
---

## MANDATORY PREPARATION

Invoke `/context-doctor:context-doctor` and run its Context Gathering Protocol. Pull `report.topics`, `report.duplicates`, and items with `aggressive: true` or empty `description`.

---

## 1. Map jobs to owners

List the jobs this project really does (from CLAUDE.md workflow, project skills, and `--usage`). For each job build a row: **job · candidates (enabled) · aggressive ones · used recently · proposed owner**.

Choose the owner by: project skill > skill the user actually used > built-in > plugin. A job with no good candidate gets "none — handle inline", which is a valid answer.

## 2. Propose changes

For each job:
- **Owner line** for project CLAUDE.md, under one heading such as `## Routing` (create it once): `- <job>: <owner> (not <others>)`. Short — this is always-loaded.
- **Disable** competing aggressive items (`skillOverrides` or plugin off for this project).
- **Rewrite descriptions** only for files the user owns (`~/.claude/skills`, `<project>/.claude/skills`, `.claude/agents`). Template: `<What it does, concrete nouns>. Use when <trigger phrased as the user would say it>.` Keep under ~250 chars. Remove PROACTIVELY / MUST BE USED / ALWAYS.
- **Missing descriptions** (CL-03) on owned files: write one.
- **Broken frontmatter** (CL-17, `items[].problems`) on owned files: fix the YAML (usually quote a description containing `: `), add the missing agent `description`, rename colliding agents. A broken skill has lost its description *and* its `allowed-tools`/`disable-model-invocation`, so it routes on its first body line.
- **Duplicates** (CL-12): keep the owner, override the rest.

For plugin-owned items you want to keep but reword: copy the skill folder into the project and edit the copy, then override the original.

## 3. Confirm → apply → verify

Change table (file · before → after), AskUserQuestion, back up, apply with Edit. Re-scan and show: competing owners per job before → after, aggressive items enabled before → after. Note settings apply next session; description edits to owned skills apply after the skill list reloads.

**NEVER** rewrite descriptions inside `~/.claude/plugins/cache/`, or add more than one routing line per job.
