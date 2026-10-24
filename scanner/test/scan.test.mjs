// node --test scanner/test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFixture } from './fixture.mjs'

const SCAN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scan.mjs')
const fx = buildFixture()
const out = path.join(fx.root, 'out')
const runIn = (project, ...a) => execFileSync('node', [SCAN, '--project', project, '--out', out, ...a], { env: { ...process.env, HOME: fx.home, CONTEXT_DOCTOR_LANG: '', CLAUDE_CONFIG_DIR: '', ANTHROPIC_MODEL: '' }, encoding: 'utf8' })
const run = (...a) => runIn(fx.project, ...a)
const pdir = () => run('--print-dir').trim()
const report = () => JSON.parse(run('--json'))

test('finds memory, @imports and items', () => {
  const r = report()
  assert.equal(r.lang, 'en')
  assert.ok(r.memory.some(m => m.file.endsWith('GUIDE.md') && m.via.endsWith('.claude/CLAUDE.md')))
  assert.ok(r.items.some(i => i.name === 'megapack:helper-0'))
  assert.ok(r.items.some(i => i.name === 'deploy' && i.kind === 'skill'))
  assert.deepEqual(r.noDescription.filter(x => x !== 'silent'), ['scratch'])
})

test('pressure wording is flagged, but describing it is not', () => {
  const r = report()
  assert.equal(r.items.find(i => i.name === 'megapack:code-reviewer').aggressive, true)
  assert.equal(r.items.find(i => i.name === 'tiny:tidy').aggressive, false)
})

test('findings cover secrets, auto-push, overflow, user @import, shipped rules', () => {
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({ listingBudget: 500 }))
  const codes = report().findings.map(f => f.code)
  for (const c of ['CL-10', 'CL-07', 'CL-02', 'CL-01', 'CL-08', 'CL-13']) assert.ok(codes.includes(c), `missing ${c}: ${codes}`)
  const f = report().findings.find(x => x.code === 'CL-10')
  assert.match(f.detail, /DB_PASSWORD/)
  assert.doesNotMatch(JSON.stringify(report()), /hunter2/, 'secret values never reach the report')
  assert.ok(report().findings.some(x => x.verified && /stop:format-typecheck/.test(x.title)), 'rules.json applied')
  fs.rmSync(path.join(out, 'config.json'))
})

test('usage: exact names, any key order, MCP calls, hook timing, denials, lifetime counters', () => {
  const text = run('--usage')
  const u = JSON.parse(fs.readFileSync(path.join(pdir(), 'usage.json'), 'utf8'))
  assert.ok(u.used.includes('research'))
  assert.ok(u.used.includes('Explore'), 'Agent input parsed regardless of key order')
  assert.ok(!u.used.includes('megapack:plan'), 'built-in /plan must not count for megapack:plan')
  assert.equal(u.byPlugin.megapack.used, 0)
  assert.deepEqual(u.mcp, [['warehouse', 1]])
  const office = u.hooks.find(h => h.command === 'office-hook pre')
  assert.equal(office.timeouts, 3)
  assert.equal(office.avgMs, 2100)
  assert.deepEqual(u.denials, [{ tool: 'Bash', kind: 'permission-rule', n: 1 }])
  assert.equal(u.lifetime.scratch, 7)
  assert.match(text, /claude\.ai Notion \(claude\.ai connector\) — never called/)
  const codes = report().findings.map(f => f.code)
  assert.ok(codes.includes('CL-18'), 'slow hook finding')
  assert.ok(report().findings.some(f => f.code === 'CL-13' && /claude\.ai Notion/.test(f.detail)), 'idle MCP finding')
})

test('listing budget follows the context window', () => {
  assert.equal(report().listingBudget, 2000)
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({ contextWindow: 1000000 }))
  assert.equal(report().listingBudget, 10000)
  fs.rmSync(path.join(out, 'config.json'))
})

test('rules with paths frontmatter are not always loaded', () => {
  const r = report()
  const lazy = r.memory.find(m => m.file.endsWith('rules/api/routes.md'))
  assert.equal(lazy.lazy, true)
  assert.ok(r.memory.find(m => m.file.endsWith('rules/style.md')).lazy === false)
  assert.equal(r.stats.alwaysTokens, r.memory.filter(m => !m.lazy).reduce((a, m) => a + m.tokens, 0))
  assert.equal(r.stats.lazyMemoryFiles, 1)
})

test('secrets in hooks, settings env and memory are found and never printed', () => {
  const r = report(), all = JSON.stringify(r) + run('--summary') + run('--find', 'login|tests|Authorization')
  for (const v of ['tok_live_9f8e7d6c5b4a', 'plain-value-123', 's3cretpw9', 'hunter2']) assert.ok(!all.includes(v), `${v} leaked`)
  const cl10 = r.findings.filter(f => f.code === 'CL-10').map(f => f.detail).join(' ')
  assert.match(cl10, /env\.SERVICE_API_KEY/)
  assert.doesNotMatch(cl10, /MAX_THINKING_TOKENS/)
  assert.ok(r.findings.some(f => f.code === 'CL-10' && /hook/.test(f.title)))
  assert.ok(r.memoryCredentials.some(c => c.file.endsWith('shop-app/CLAUDE.md') && c.line === 5))
  assert.match(r.hooks.find(h => h.event === 'PostToolUse').command, /Authorization: Bearer «redacted»/)
})

test('broken frontmatter, silent agents and name collisions', () => {
  const f = report().findings.filter(f => f.code === 'CL-17')
  assert.ok(f.some(x => /broken\/SKILL\.md:3/.test(x.detail)), 'unquoted ": " in a skill')
  assert.ok(f.some(x => /silent\.md/.test(x.detail)), 'agent without description')
  assert.ok(f.some(x => /helper: .*helper-a\.md.*helper-b\.md|helper: .*helper-b\.md.*helper-a\.md/.test(x.detail)), 'collision')
})

test('personal memory that repeats a checked-in file', () => {
  const d = report().localDuplicates
  assert.equal(d.length, 1)
  assert.match(d[0].local, /\.claude\/CLAUDE\.md:4$/)
  assert.match(d[0].checked, /shop-app\/CLAUDE\.md:4$/)
})

test('state is kept per project', () => {
  run('--summary')
  runIn(fx.other, '--summary')
  assert.doesNotMatch(run('--diff'), /No previous scan/, 'scanning another project must not erase this one')
  assert.notEqual(pdir(), runIn(fx.other, '--print-dir').trim())
})

test('--dismiss hides a conflict candidate', () => {
  const before = report().ruleConflicts
  const key = before.flatMap(c => c.pairs.flatMap(p => p.opposite)).find(Boolean)?.dismissKey
  assert.equal(key, 'commit / push::deploy')
  run('--dismiss', key)
  const after = report().ruleConflicts.flatMap(c => c.pairs.flatMap(p => p.opposite)).map(r => r.dismissKey)
  assert.ok(!after.includes(key))
  fs.rmSync(path.join(out, 'dismissed.json'))
})

test('thai output and --print-lang', () => {
  assert.equal(run('--lang', 'th', '--print-lang').trim(), 'th')
  assert.match(run('--lang', 'th', '--summary'), /ปัญหาที่เจอ/)
})

test('--set-plugin writes personal local settings, not the checked-in file; --diff sees it', () => {
  run('--summary')
  run('--set-plugin', 'megapack@market', 'off')
  const s = JSON.parse(fs.readFileSync(path.join(fx.project, '.claude/settings.local.json'), 'utf8'))
  assert.equal(s.enabledPlugins['megapack@market'], false)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fx.project, '.claude/settings.json'), 'utf8')), {})
  assert.throws(() => run('--set-plugin', 'x;rm -rf /@m', 'off'))
  assert.match(run('--diff'), /➖ megapack@market@1\.0\.0/)
  run('--set-plugin', 'megapack@market', 'on')
})

test('--find traces a rule to its source line', () => {
  assert.match(run('--find', 'deploy'), /deploy \(skill\)/)
})
