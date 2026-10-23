# Context Doctor

See, score and fix what feeds Claude Code's context.

Claude Code's context is assembled from many places you rarely see together: the CLAUDE.md chain and its `@imports`, auto-memory, hundreds of skill and agent descriptions from plugins, hooks that rewrite commands or inject text, and instructions from MCP servers. When they pile up, skills lose their descriptions, rules contradict each other, and the model starts doing things nobody asked for. Context Doctor makes that visible and helps you clean it up.

![Context Doctor dashboard](docs/screenshot.png)

## What you get

**Skills** — the model does the judgment; a bundled scanner supplies the facts.

| Command | What it does |
|---|---|
| `/context-doctor:view` | Open the dashboard: health score, context stack, plugin weight vs real usage, findings, hooks across the session lifecycle, competing owners, rule conflicts, searchable explorer. Changes nothing. |
| `/context-doctor:audit` | Scored health check (budget, routing, consistency, transparency, safety — 0–4 each, /20), P0–P3 findings verified at file:line, and what to run next. |
| `/context-doctor:distill` | Cut weight: disable plugins and skills your transcripts show you never use, shrink always-loaded memory. |
| `/context-doctor:sharpen` | Fix routing: one owner per job, specific "Use when" descriptions, no PROACTIVELY / MUST BE USED pressure. |
| `/context-doctor:harmonize` | Resolve contradictions and stale facts between CLAUDE.md, memory, skills and MCP instructions. |
| `/context-doctor:annotate` | Document hooks that rewrite, compress, inject, format or deny, so the model knows about them. |
| `/context-doctor:secure` | Plaintext secrets, auto deploy/push wording, risky hooks, untrusted third-party instructions. |
| `/context-doctor:trace <behavior>` | Find which line, skill, hook or MCP instruction caused a specific behavior. |

Every command that changes files shows a change table and asks first, backs files up, and never edits the plugin cache (it disables instead).

**Side pane** (terminal; needs a Claude Code build with plugin function hooks): `/context-doctor`, `/context-doctor-prompt` (the real system prompt sections, with sizes), `/context-doctor-live` (skills, agents, MCP calls and hook injections as they happen), `/context-doctor-usage`, `/context-doctor-diff`, `/context-doctor-plugins` (toggle plugins per project). The skills work without the pane.

## Install

```
/plugin marketplace add <owner>/context-doctor
/plugin install context-doctor@context-doctor
/reload-plugins
```

Then run `/context-doctor:view`, followed by `/context-doctor:audit`.

Requirements: Node.js 18+ on PATH. The pane uses a POSIX shell (macOS/Linux).

## Privacy

Everything runs locally. The scanner reads your Claude Code config (`~/.claude`, `~/.claude.json`, the project's `.claude/` and CLAUDE.md files) and, for usage stats, your local transcripts under `~/.claude/projects/`. It writes only to `~/.claude/context-doctor/` — except `--set-plugin`, which you trigger, and which writes the project's `.claude/settings.json`. Nothing is sent anywhere.

Reports contain file paths, MCP hosts and the **names** of keys that look like secrets — never their values. Keep `report.html` to yourself unless you have checked it. The dashboard loads a web font from Google Fonts; it falls back to system fonts offline.

## Scanner

The skills call `scanner/scan.mjs` (no dependencies). You can run it yourself:

```
node scanner/scan.mjs --summary            # findings in the terminal; writes report.json + report.html
node scanner/scan.mjs --usage              # real usage from transcripts (--all-projects for everything)
node scanner/scan.mjs --diff               # changes since the last scan
node scanner/scan.mjs --find "deploy|push" # every rule, description and hook mentioning it, with file:line
node scanner/scan.mjs --plugins            # per-plugin counts as JSON
node scanner/scan.mjs --set-plugin <id> off
```

Options: `--project <dir>` (default: current directory), `--out <dir>` (default `~/.claude/context-doctor`), `--lang en|th` (default: from `settings.language`).

### Tuning

`~/.claude/context-doctor/` may hold:

- `config.json` — `{ "lang": "en", "listingBudget": 10000, "thaiTokensPerChar": 1.44, "otherCharsPerToken": 2.46 }`. Token counts are estimates calibrated against `/context`; the listing budget is observed, not documented, so adjust it if your `/context` shows otherwise.
- `curated.json` — your own hand-verified checks, same shape as `scanner/rules.json`; shown while their `requires` condition holds.
- `dismissed.json` — `["<subject>::<source>", …]` rule-conflict candidates you ruled out.
- `audit.json` — written by `/context-doctor:audit`; the dashboard shows it instead of the automatic estimate.

## How it scores

Anti-patterns CL-01…CL-16 are catalogued in [skills/context-doctor/reference/anti-patterns.md](skills/context-doctor/reference/anti-patterns.md). The automatic score is a rough estimate from scanner signals; `/context-doctor:audit` reads each source and gives the score you should trust. Rule-conflict detection is keyword-based and flags candidates for a human, not verdicts.

Harness rules (from Claude Code's own system prompt) are not on disk; the scanner carries a short paraphrase of the ones that matter for conflicts, and the skills read the live prompt.

## Development

```
node --test scanner/test/scan.test.mjs   # scanner tests on a synthetic ~/.claude
claude plugin test .                     # pane tests
claude plugin validate .
node scanner/test/demo.mjs               # renders docs/demo-out/report.html from the fixture
```

## ภาษาไทย

Context Doctor แสดงให้เห็นว่ามีอะไรถูกป้อนเข้า context ของ Claude Code บ้าง ได้แก่ CLAUDE.md, memory, skill/agent จาก plugin, hook ที่ทำงานเงียบ ๆ และคำสั่งจาก MCP ให้คะแนน ชี้ข้อขัดแย้ง และช่วยแก้ ทุกอย่างทำงานในเครื่อง ไม่ส่งข้อมูลออกไปไหน

เริ่มด้วย `/context-doctor:view` แล้วตามด้วย `/context-doctor:audit` ภาษาของรายงานจะตาม `settings.language` (ถ้าตั้งเป็นไทย รายงานจะเป็นภาษาไทย) หรือกำหนดเองด้วย `--lang th`

## License

MIT
