import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SkillLoader, SkillRegistry } from '../src/index.ts'
import { writeSkill } from './helpers.ts'

test('loads skills and lets project skills override user skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skills-loader-'))
  const user = join(root, 'user')
  const project = join(root, 'project')
  await writeSkill(user, 'review', { description: 'user review' })
  await writeSkill(project, 'review', { description: 'project review' })
  await writeSkill(user, 'deploy', {
    extraFrontmatter: 'model-invocable: false\n',
  })
  await writeSkill(user, 'match-data', {
    extraFrontmatter: [
      'when_to_use: Match scene data to model inputs',
      'intent_tags:',
      '  - match-inputs',
      'trigger_examples:',
      '  - 帮我匹配 Carbon 模型输入',
      'allowed_tools:',
      '  - list_scene_data_cards',
      'argument_hint: "<model>"',
      'applicable_domains:',
      '  - invest',
      'applicable_actions:',
      '  - match_inputs',
      '',
    ].join('\n'),
  })

  const result = await new SkillLoader({
    userSkillsDir: user,
    projectSkillsDir: project,
  }).load()

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.skills.length, 3)
  assert.equal(
    result.skills.find(skill => skill.name === 'review')?.description,
    'project review',
  )
  const matchData = result.skills.find(skill => skill.name === 'match-data')
  assert.equal(matchData?.whenToUse, 'Match scene data to model inputs')
  assert.deepEqual(matchData?.intentTags, ['match-inputs'])
  assert.deepEqual(matchData?.triggerExamples, ['帮我匹配 Carbon 模型输入'])
  assert.deepEqual(matchData?.allowedTools, ['list_scene_data_cards'])
  assert.equal(matchData?.argumentHint, '<model>')
  assert.deepEqual(matchData?.applicableDomains, ['invest'])
  assert.deepEqual(matchData?.applicableActions, ['match_inputs'])
})

test('strictly validates frontmatter and directory names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skills-invalid-'))
  const user = join(root, 'user')
  await writeSkill(user, 'bad-name', { extraFrontmatter: 'unknown: value\n' })
  await mkdir(join(user, 'mismatch'), { recursive: true })
  await writeFile(
    join(user, 'mismatch', 'SKILL.md'),
    '---\nname: other\ndescription: mismatch\n---\nText',
  )
  await writeSkill(user, 'too-long', { description: 'x'.repeat(1_001) })

  const result = await new SkillLoader({
    userSkillsDir: user,
    projectSkillsDir: join(root, 'missing'),
  }).load()

  assert.equal(result.skills.length, 0)
  assert.equal(result.diagnostics.length, 3)
  assert.ok(result.diagnostics.every(item => item.severity === 'error'))
})

test('loader indexes examples and references as explicit resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skills-resources-'))
  const project = join(root, 'project')
  await writeSkill(project, 'prepare-inputs', {
    instructions: [
      'Use examples/readiness.md only when readiness output is needed.',
      'Use references/contracts.md only when contract details are needed.',
    ].join('\n'),
  })
  await mkdir(join(project, 'prepare-inputs', 'examples'), { recursive: true })
  await mkdir(join(project, 'prepare-inputs', 'references'), { recursive: true })
  await mkdir(join(project, 'prepare-inputs', 'notes'), { recursive: true })
  await writeFile(join(project, 'prepare-inputs', 'examples', 'readiness.md'), '# Readiness\n', 'utf8')
  await writeFile(join(project, 'prepare-inputs', 'references', 'contracts.md'), '# Contracts\n', 'utf8')
  await writeFile(join(project, 'prepare-inputs', 'notes', 'ignored.md'), '# Ignored\n', 'utf8')

  const loader = new SkillLoader({
    userSkillsDir: join(root, 'missing'),
    projectSkillsDir: project,
  })
  const result = await loader.load()
  const skill = result.skills.find(item => item.name === 'prepare-inputs')

  assert.deepEqual(result.diagnostics, [])
  assert.deepEqual(skill?.resources?.map(resource => ({
    kind: resource.kind,
    path: resource.path,
  })), [
    { kind: 'example', path: 'examples/readiness.md' },
    { kind: 'reference', path: 'references/contracts.md' },
  ])
  assert.doesNotMatch(skill?.instructions ?? '', /# Readiness/)

  const resource = await loader.readResource(skill!, 'examples/readiness.md')
  assert.equal(resource.kind, 'example')
  assert.equal(resource.path, 'examples/readiness.md')
  assert.equal(resource.content, '# Readiness\n')
  await assert.rejects(
    loader.readResource(skill!, 'notes/ignored.md'),
    /not registered/,
  )
})

test('registry exposes summaries within budget, not instructions', () => {
  const registry = new SkillRegistry()
  registry.replace([
    {
      name: 'review',
      description: 'A detailed description that should be shortened for discovery',
      instructions: 'SECRET FULL INSTRUCTIONS',
      source: 'user',
      userInvocable: true,
      modelInvocable: true,
      execution: 'inline',
    },
    {
      name: 'manual',
      description: 'User only',
      instructions: 'Manual',
      source: 'user',
      userInvocable: true,
      modelInvocable: false,
      execution: 'inline',
    },
  ])

  const listing = registry.formatForModel(45)
  assert.ok(listing.length <= 45)
  assert.match(listing, /review/)
  assert.doesNotMatch(listing, /SECRET/)
  assert.deepEqual(registry.listForModel().map(skill => skill.name), ['review'])
  assert.deepEqual(registry.listForUser().map(skill => skill.name), [
    'manual',
    'review',
  ])
  assert.deepEqual(registry.selectAvailable(['review', 'missing']).listForUser().map(skill => skill.name), ['review'])
  assert.throws(() => registry.select(['missing']), /Unknown skill configured/)
})
