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
const run = (...a) => execFileSync('node', [SCAN, '--project', fx.project, '--out', out, ...a], { env: { ...process.env, HOME: fx.home, CONTEXT_DOCTOR_LANG: '' }, encoding: 'utf8' })
const report = () => JSON.parse(run('--json'))

test('finds memory, @imports and items', () => {
  const r = report()
  assert.equal(r.lang, 'en')
  assert.ok(r.memory.some(m => m.file.endsWith('GUIDE.md') && m.via.endsWith('.claude/CLAUDE.md')))
  assert.ok(r.items.some(i => i.name === 'megapack:helper-0'))
  assert.ok(r.items.some(i => i.name === 'deploy' && i.kind === 'skill'))
  assert.deepEqual(r.noDescription, ['scratch'])
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

test('usage counts exact names only', () => {
  run('--usage')
  const u = JSON.parse(fs.readFileSync(path.join(out, 'usage.json'), 'utf8'))
  assert.ok(u.used.includes('research'))
  assert.ok(!u.used.includes('megapack:plan'), 'built-in /plan must not count for megapack:plan')
  assert.equal(u.byPlugin.megapack.used, 0)
})

test('thai output and --print-lang', () => {
  assert.equal(run('--lang', 'th', '--print-lang').trim(), 'th')
  assert.match(run('--lang', 'th', '--summary'), /ปัญหาที่เจอ/)
})

test('--set-plugin writes project settings; --diff sees it', () => {
  run('--summary')
  run('--set-plugin', 'megapack@market', 'off')
  const s = JSON.parse(fs.readFileSync(path.join(fx.project, '.claude/settings.json'), 'utf8'))
  assert.equal(s.enabledPlugins['megapack@market'], false)
  assert.match(run('--diff'), /➖ megapack@market@1\.0\.0/)
  run('--set-plugin', 'megapack@market', 'on')
})

test('--find traces a rule to its source line', () => {
  assert.match(run('--find', 'deploy'), /deploy \(skill\)/)
})
