// node scanner/test/demo.mjs → builds the fixture and renders docs/demo-out/report.html (for screenshots)
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFixture } from './fixture.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fx = buildFixture()
const out = path.join(here, '..', '..', 'docs', 'demo-out')
const run = (...a) => execFileSync('node', [path.join(here, '..', 'scan.mjs'), '--project', fx.project, '--out', out, ...a], { env: { ...process.env, HOME: fx.home }, encoding: 'utf8' })
run('--usage')
console.log(run('--summary'))
