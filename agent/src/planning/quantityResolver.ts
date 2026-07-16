import type { EvidenceIR, EvidenceRecord } from '../contracts/evidence.ts'
import {
  quantityDecisionSchema,
  type QuantityDecision,
} from '../contracts/sceneBlueprint.ts'

export const defaultQuantityPolicies = {
  'fighter-formation/v1': 4,
  'single-node/v1': 1,
  'single-launch/v1': 1,
} as const

export interface ResolveQuantityInput {
  entityName: string
  platformType: string
  role: string
  evidence: EvidenceIR
  userValue?: number
}

const chineseIntegers: Readonly<Record<string, number>> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/[\s‐‑‒–—―_-]+/g, '').toLocaleLowerCase('en-US')
}

function isFactual(record: EvidenceRecord): boolean {
  return record.kind === 'explicit_fact' || record.kind === 'deterministic_derivation'
}

function entityOccursInClaim(record: EvidenceRecord, entityName: string): boolean {
  return normalized(record.claim).includes(normalized(entityName))
}

function exactQuantity(record: EvidenceRecord, entityName: string): number | undefined {
  const claim = normalized(record.claim)
  const entity = normalized(entityName)
  const entityStart = claim.indexOf(entity)
  if (entityStart < 0) return undefined
  const entityEnd = entityStart + entity.length
  const matches = [...claim.matchAll(/(\d+|[一二三四五六七八九十])[架枚个]/gu)]
  const match = matches.sort((left, right) => {
    const distance = (candidate: RegExpMatchArray): number => {
      const start = candidate.index ?? 0
      const end = start + candidate[0].length
      if (end <= entityStart) return entityStart - end
      if (entityEnd <= start) return start - entityEnd
      return 0
    }
    return distance(left) - distance(right)
  })[0]
  if (!match) return undefined
  const token = match[1]!
  const value = /^\d+$/.test(token) ? Number(token) : chineseIntegers[token]
  return value && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function defaultPolicy(input: Pick<ResolveQuantityInput, 'platformType' | 'role'>): keyof typeof defaultQuantityPolicies {
  const platform = normalized(input.platformType)
  const role = normalized(input.role)
  if (/launch|weapon|missile|发射|导弹/u.test(`${platform}:${role}`)) return 'single-launch/v1'
  if (/fighter|aircraft|战斗机|飞机/u.test(platform) || /formation|编队/u.test(role)) return 'fighter-formation/v1'
  return 'single-node/v1'
}

function validateUserValue(userValue: number | undefined): void {
  if (userValue === undefined) return
  if (!Number.isSafeInteger(userValue) || userValue <= 0) {
    throw new Error('INVALID_USER_QUANTITY: userValue must be a positive integer')
  }
}

export function resolveQuantity(input: ResolveQuantityInput): QuantityDecision {
  validateUserValue(input.userValue)
  const exactMatches = input.evidence.records.flatMap(record => {
    if (!isFactual(record) || !entityOccursInClaim(record, input.entityName)) return []
    const value = exactQuantity(record, input.entityName)
    return value === undefined ? [] : [{ value, evidenceId: record.evidenceId }]
  })

  if (exactMatches.length > 0) {
    const values = new Set(exactMatches.map(match => match.value))
    if (values.size > 1) {
      throw new Error(`FACTUAL_QUANTITY_CONFLICT: conflicting evidence quantities for ${input.entityName}`)
    }
    const value = exactMatches[0]!.value
    if (input.userValue !== undefined && input.userValue !== value) {
      throw new Error(`FACTUAL_QUANTITY_CONFLICT: ${input.entityName} evidence=${value} user=${input.userValue}`)
    }
    return quantityDecisionSchema.parse({
      value,
      constraint: 'exact',
      source: 'evidence',
      evidenceRefs: exactMatches.map(match => match.evidenceId),
      reason: 'Explicit quantity adjacent to entity',
    })
  }

  if (input.userValue !== undefined) {
    return quantityDecisionSchema.parse({
      value: input.userValue,
      constraint: 'exact',
      source: 'user',
      evidenceRefs: [],
      reason: 'User quantity overrides default policy',
    })
  }

  const defaultPolicyId = defaultPolicy(input)
  return quantityDecisionSchema.parse({
    value: defaultQuantityPolicies[defaultPolicyId],
    constraint: 'unknown',
    source: 'default',
    evidenceRefs: [],
    defaultPolicyId,
    reason: `No explicit quantity; applied ${defaultPolicyId}`,
  })
}
