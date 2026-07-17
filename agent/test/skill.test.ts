import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { SkillLoader } from '@ise/skills-core'

const projectSkillsDir = fileURLToPath(new URL('../skills/', import.meta.url))

test('loads the generate-battle-replay project skill with its bounded tool surface', async () => {
  const loader = new SkillLoader({ projectSkillsDir })
  const loaded = await loader.load()
  const skill = loaded.skills.find(item => item.name === 'generate-battle-replay')

  assert.deepEqual(loaded.diagnostics, [])
  assert.ok(skill)
  assert.equal(skill.name, 'generate-battle-replay')
  assert.equal(skill.execution, 'inline')
  assert.equal(skill.version, '1.0.0')
  assert.equal(skill.userInvocable, true)
  assert.equal(skill.modelInvocable, true)
  assert.deepEqual(skill.allowedTools, [
    'parse_battle_report',
    'inspect_report_evidence',
    'propose_event_plan',
    'accept_event_plan',
    'inspect_replay_assets',
    'propose_scene_plan',
    'compile_replay_runtime',
    'validate_replay_runtime',
  ])
  assert.match(skill.instructions, /EventUnit/)
  assert.match(skill.instructions, /NarrativePlan/)
  assert.match(skill.instructions, /never invent asset IDs/i)
  assert.match(skill.instructions, /without an attachment/i)
  assert.match(skill.instructions, /user-provided text brief/i)
  assert.match(skill.instructions, /inspect_report_evidence`? exactly once with the returned `?documentId`? and `?limit: 50`?/i)
  assert.match(skill.instructions, /when `?inspectionComplete`? is true, do not inspect again and immediately draft and propose the EventPlan/i)
  assert.match(skill.instructions, /Do not inspect records one by one/i)
  assert.match(skill.instructions, /Filtered follow-up is permitted only when the first response explicitly has `?inspectionComplete: false`?/i)
})

test('documents all evidence classes and rejects the known unsupported SRT claims', async () => {
  const loader = new SkillLoader({ projectSkillsDir })
  const loaded = await loader.load()
  const skill = loaded.skills.find(item => item.name === 'generate-battle-replay')

  assert.ok(skill)
  const policy = await loader.readResource(skill, 'references/evidence-policy.md')
  assert.match(policy.content, /Explicit fact/)
  assert.match(policy.content, /Deterministic derivation/)
  assert.match(policy.content, /Model inference/)
  assert.match(policy.content, /Illustrative expression/)
  assert.match(policy.content, /invented pilot dialogue/)
  assert.match(policy.content, /`XX` quantities/)
  assert.match(policy.content, /“准确命中”/)
  assert.match(policy.content, /“全面溃败”/)
  assert.match(policy.content, /registered assets/)
  assert.match(policy.content, /Quoted claim: “行动开始后，印方多个航空兵基地先后进入出动状态。”/)
  assert.match(policy.content, /sourceRef: `doc:doc-943504a71482656a:paragraph:11`/)
  assert.match(policy.content, /Input source refs:[\s\S]*paragraph:11[\s\S]*paragraph:12/)
  assert.match(policy.content, /Derived normalization: “印方进入出动状态后，巴方组织前线航空兵升空。”/)
  assert.match(policy.content, /inferenceRefs: `inference:tracking-recovery-cause`/)
  assert.match(policy.content, /uncertainties: “报告未说明目标跟踪恢复的具体技术原因。”/)
  assert.match(policy.content, /Illustrative route:[\s\S]*must not be written as the aircraft's actual route/)
  assert.match(policy.content, /Camera choice:[\s\S]*not a report fact/)
})
