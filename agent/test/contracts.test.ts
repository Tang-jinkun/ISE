import assert from 'node:assert/strict'
import test from 'node:test'
import { evidenceIrSchema } from '../src/contracts/evidence.ts'
import { eventPlanSchema } from '../src/contracts/eventPlan.ts'

test('EventPlan requires evidence or inference on every EventUnit', () => {
  const result = eventPlanSchema.safeParse({
    schemaVersion: 'event-plan/v1',
    planId: 'plan-1',
    documentId: 'doc-1',
    version: 1,
    eventUnits: [{
      eventUnitId: 'eu-1',
      title: '首轮攻击',
      worldStateChange: '双方由对峙进入实质性交锋。',
      participants: ['印度空军'],
      locationRefs: [],
      evidenceRefs: [],
      inferenceRefs: [],
      uncertainties: [],
      narrativePurpose: '说明交锋开始',
      importance: 'high',
    }],
    omittedEvidence: [],
    warnings: [],
  })
  assert.equal(result.success, false)
})

test('EvidenceIR keeps exact source references and fact kind', () => {
  const value = evidenceIrSchema.parse({
    schemaVersion: 'evidence-ir/v1',
    documentId: 'doc-1',
    records: [{
      evidenceId: 'ev-1',
      sourceRef: 'doc:doc-1:paragraph:3',
      claim: '印方预警机建立目标跟踪。',
      kind: 'explicit_fact',
      entities: ['印方预警机'],
      confidence: 1,
      ambiguities: [],
    }],
  })
  assert.equal(value.records[0]?.sourceRef, 'doc:doc-1:paragraph:3')
})
