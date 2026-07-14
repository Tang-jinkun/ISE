import assert from 'node:assert/strict'
import test from 'node:test'
import { documentIrSchema } from '../src/contracts/document.ts'
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

test('contracts reject unknown keys at the root and nested record levels', () => {
  assert.equal(eventPlanSchema.safeParse({
    ...validEventPlan(),
    unknownRoot: true,
  }).success, false)
  const plan = validEventPlan()
  assert.equal(eventPlanSchema.safeParse({
    ...plan,
    eventUnits: [{ ...plan.eventUnits[0], unknownUnit: true }],
  }).success, false)
})

test('EventPlan accepts at most ten EventUnits', () => {
  const plan = validEventPlan()
  const units = Array.from({ length: 10 }, (_, index) => ({
    ...plan.eventUnits[0],
    eventUnitId: `eu-${index + 1}`,
  }))

  assert.equal(eventPlanSchema.safeParse({ ...plan, eventUnits: units }).success, true)
  assert.equal(eventPlanSchema.safeParse({
    ...plan,
    eventUnits: [...units, { ...units[0], eventUnitId: 'eu-11' }],
  }).success, false)
})

test('DocumentIR enforces SHA-256 format and section level boundaries', () => {
  const document = validDocumentIr()

  assert.equal(documentIrSchema.safeParse(document).success, true)
  assert.equal(documentIrSchema.safeParse({
    ...document,
    sections: [{ ...document.sections[0], level: 6 }],
  }).success, true)
  for (const sourceHash of [`sha256:${'a'.repeat(63)}`, `sha256:${'A'.repeat(64)}`]) {
    assert.equal(documentIrSchema.safeParse({ ...document, sourceHash }).success, false)
  }
  for (const level of [0, 7]) {
    assert.equal(documentIrSchema.safeParse({
      ...document,
      sections: [{ ...document.sections[0], level }],
    }).success, false)
  }
})

test('EvidenceIR confidence includes zero and one but rejects values outside them', () => {
  const evidence = validEvidenceIr()

  for (const confidence of [0, 1]) {
    assert.equal(evidenceIrSchema.safeParse({
      ...evidence,
      records: [{ ...evidence.records[0], confidence }],
    }).success, true)
  }
  for (const confidence of [-0.01, 1.01]) {
    assert.equal(evidenceIrSchema.safeParse({
      ...evidence,
      records: [{ ...evidence.records[0], confidence }],
    }).success, false)
  }
})

function validEventPlan() {
  return {
    schemaVersion: 'event-plan/v1' as const,
    planId: 'plan-contract',
    documentId: 'doc-contract',
    version: 1,
    eventUnits: [{
      eventUnitId: 'eu-1',
      title: 'Opening engagement',
      worldStateChange: 'The forces enter active engagement.',
      participants: ['Blue force'],
      locationRefs: ['border'],
      evidenceRefs: ['ev-1'],
      inferenceRefs: [],
      uncertainties: [],
      narrativePurpose: 'Establish the conflict.',
      importance: 'high' as const,
    }],
    omittedEvidence: [],
    warnings: [],
  }
}

function validDocumentIr() {
  return {
    schemaVersion: 'document-ir/v1' as const,
    documentId: 'doc-contract',
    title: 'Battle report',
    sourceHash: `sha256:${'a'.repeat(64)}`,
    sections: [{
      sectionId: 'section-1',
      level: 1,
      title: 'Summary',
      sourceRef: 'doc:doc-contract:section:1',
    }],
    paragraphs: [],
    tables: [],
    warnings: [],
  }
}

function validEvidenceIr() {
  return {
    schemaVersion: 'evidence-ir/v1' as const,
    documentId: 'doc-contract',
    records: [{
      evidenceId: 'ev-1',
      sourceRef: 'doc:doc-contract:paragraph:1',
      claim: 'A grounded claim.',
      kind: 'explicit_fact' as const,
      entities: [],
      confidence: 1,
      ambiguities: [],
    }],
  }
}
