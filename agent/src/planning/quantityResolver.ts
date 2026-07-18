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
  entityAliases?: readonly string[]
  platformType: string
  role: string
  evidence: EvidenceIR
  userValue?: number
  packRoleDefault?: { value: number; policyId: string }
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

function requestedEntities(input: Pick<ResolveQuantityInput, 'entityName' | 'entityAliases'>): string[] {
  return [...new Set([input.entityName, ...(input.entityAliases ?? [])].map(normalized))]
}

function entityOccursInClaim(record: EvidenceRecord, input: ResolveQuantityInput): boolean {
  const claim = normalized(record.claim)
  return requestedEntities(input).some(entity => claim.includes(entity))
}

type EntityKind = 'aircraft' | 'weapon' | 'node' | 'generic'
type QuantityUnit = '架' | '枚' | '个'

function entityKind(value: string): EntityKind {
  const candidate = normalized(value)
  if (/导弹|missile|weapon|rocket|bomb|pl\d/u.test(candidate)) return 'weapon'
  if (/战斗机|飞机|预警机|fighter|aircraft|aew|rafale|阵风|jf\d|j\d|su\d|苏\d|mig\d/u.test(candidate)) return 'aircraft'
  if (/雷达|节点|指挥|radar|node|command/u.test(candidate)) return 'node'
  return 'generic'
}

function requestedEntityKind(input: Pick<ResolveQuantityInput, 'entityName' | 'platformType' | 'role'>): EntityKind {
  return entityKind(`${input.entityName}:${input.platformType}:${input.role}`)
}

function isCompatibleUnit(unit: QuantityUnit, kind: EntityKind): boolean {
  if (unit === '架') return kind === 'aircraft'
  if (unit === '枚') return kind === 'weapon'
  return kind === 'node' || kind === 'generic'
}

function occurrenceDistances(claim: string, entity: string, phraseStart: number, phraseEnd: number): number[] {
  const distances: number[] = []
  let entityStart = claim.indexOf(entity)
  while (entityStart >= 0) {
    const entityEnd = entityStart + entity.length
    if (phraseEnd <= entityStart) distances.push(entityStart - phraseEnd)
    else if (entityEnd <= phraseStart) distances.push(phraseStart - entityEnd)
    else distances.push(0)
    entityStart = claim.indexOf(entity, entityStart + 1)
  }
  return distances
}

function belongsToRequestedEntity(
  record: EvidenceRecord,
  claim: string,
  entities: readonly string[],
  unit: QuantityUnit,
  phraseStart: number,
  phraseEnd: number,
): boolean {
  const requestedDistance = Math.min(...entities.flatMap(entity => occurrenceDistances(claim, entity, phraseStart, phraseEnd)))
  const compatibleDistances = record.entities.flatMap(entity => {
    if (!isCompatibleUnit(unit, entityKind(entity))) return []
    return occurrenceDistances(claim, normalized(entity), phraseStart, phraseEnd)
  })
  const nearestCompatibleDistance = Math.min(requestedDistance, ...compatibleDistances)
  return requestedDistance === nearestCompatibleDistance
}

function exactQuantity(record: EvidenceRecord, input: ResolveQuantityInput): number | undefined {
  const claim = normalized(record.claim)
  const kind = requestedEntityKind(input)
  const entities = requestedEntities(input)
  const englishUnitMatches = [...claim.matchAll(/\b(\d+)\s+(?:(?:[a-z0-9-]+)\s+){0,3}(aircraft|fighters?|missiles?|weapons?|vehicles?)\b/gu)]
    .filter(match => {
      const unitKind: EntityKind = /aircraft|fighter/u.test(match[2]!) ? 'aircraft' : /missile|weapon/u.test(match[2]!) ? 'weapon' : 'generic'
      return unitKind === kind || (unitKind === 'generic' && kind === 'generic')
    })
    .filter(match => {
      const start = match.index ?? 0
      const end = start + match[0].length
      return Math.min(...entities.flatMap(entity => occurrenceDistances(claim, entity, start, end))) <= 8
    })
  if (englishUnitMatches[0] !== undefined) return Number(englishUnitMatches[0]![1])
  const matches = [...claim.matchAll(/(?<![0-9〇零一二两兩三四五六七八九十百千万萬亿億兆廿卄廾卅卌皕壹贰貳弐叁參肆伍陆陸柒捌玖拾佰仟点.,，．])(\d+|[一二三四五六七八九十])([架枚个])/gu)]
    .filter(match => isCompatibleUnit(match[2] as QuantityUnit, kind))
    .filter(match => belongsToRequestedEntity(
      record,
      claim,
      entities,
      match[2] as QuantityUnit,
      match.index ?? 0,
      (match.index ?? 0) + match[0].length,
    ))
  const match = matches.sort((left, right) => {
    const distance = (candidate: RegExpMatchArray): number => {
      const start = candidate.index ?? 0
      const end = start + candidate[0].length
      return Math.min(...entities.flatMap(entity => occurrenceDistances(claim, entity, start, end)))
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
    if (!isFactual(record) || !entityOccursInClaim(record, input)) return []
    const value = exactQuantity(record, input)
    return value === undefined ? [] : [{ value, evidenceId: record.evidenceId, claim: record.claim }]
  })

  // A singular aircraft performing an action or suffering an outcome is not
  // a formation-size claim. Explicit formation/flight/squadron wording still
  // makes the quantity authoritative.
  const formationMatches = input.role === 'formation'
    ? exactMatches.filter(match => !(
      match.value === 1
      && /launch|fire|attack|intercept|destroy|shoot\s*down|hit|damage|crash|emergency\s*land|发射|攻击|拦截|击毁|命中|受损|坠毁|迫降/iu.test(match.claim)
      && !/formation|flight|squadron|group|编队|机群|批次/iu.test(match.claim)
    ))
    : exactMatches

  if (formationMatches.length > 0) {
    const values = new Set(formationMatches.map(match => match.value))
    if (values.size > 1) {
      throw new Error(`FACTUAL_QUANTITY_CONFLICT: conflicting evidence quantities for ${input.entityName}`)
    }
    const value = formationMatches[0]!.value
    return quantityDecisionSchema.parse({
      value,
      constraint: 'exact',
      source: 'evidence',
      evidenceRefs: formationMatches.map(match => match.evidenceId),
      reason: input.userValue !== undefined && input.userValue !== value
        ? `Explicit quantity adjacent to entity; User quantity ${input.userValue} conflicts and evidence takes precedence`
        : 'Explicit quantity adjacent to entity',
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

  if (input.packRoleDefault !== undefined) {
    return quantityDecisionSchema.parse({
      value: input.packRoleDefault.value,
      constraint: 'unknown',
      source: 'default',
      evidenceRefs: [],
      defaultPolicyId: input.packRoleDefault.policyId,
      reason: `No explicit quantity; applied ${input.packRoleDefault.policyId}`,
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
