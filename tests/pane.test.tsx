import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'context-doctor',
  component: 'Pane',
  requestId: 'context-doctor',
  props: {
    title: 'Context Doctor',
    isFocused: false,
    bodyColumns: 120,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const PLUGINS = [
  { id: 'ecc@ecc', name: 'ecc', enabled: true, isToggleable: true, isProjectOverride: false, skills: 286, commands: 94, agents: 68, hooks: 23, listingTokens: 40543 },
]

test('live view shows skills, agents and hook injections; plugins view lists toggles', async ($, on) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    const cmd = e.argv.join(' ')
    if (cmd.includes('--plugins')) return { value: { exitCode: 0, stdout: JSON.stringify(PLUGINS), stderr: '' } }
    return { value: { exitCode: 0, stdout: '# ok', stderr: '' } }
  })
  on('tool.call', (_, e) => (e.tool === 'Bash' ? { result: {}, context: ['COST WARNING: over $10'] } : { result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Skill', skill: 'deploy' })
  await $.tool.call({ tool: 'Agent', subagent_type: 'Explore', description: 'find files', prompt: 'x' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-live' })
  expect(await ui.find({ type: 'Text', text: /deploy/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /COST WARNING/ })).toBeDefined()

  await ui.press({ key: 'tab-plugins' })
  expect(await ui.find({ key: 'tg-ecc@ecc' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /40,543/ })).toBeDefined()
  await ui.unmount()
})
