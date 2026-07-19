import assert from 'node:assert/strict'
import test from 'node:test'
import { solveInteractionGeometry } from '../src/compiler/interactionSolver.ts'

test('interaction solver propagates a producer weapon terminal point to a downstream interceptor', () => {
  const result = solveInteractionGeometry({
    intents: [
      { interactionId: 'interaction:first', weaponRef: 'weapon:first', targetRef: 'fighter:lead-target', interactionTimeMs: 10_000 },
      { interactionId: 'interaction:intercept', weaponRef: 'weapon:interceptor', targetRef: 'weapon:first', interactionTimeMs: 12_000 },
    ],
    directPoints: new Map([
      ['interaction:first', { longitudeDeg: 74.5, latitudeDeg: 31, altitudeM: 8_800 }],
      ['interaction:intercept', { longitudeDeg: 75.2, latitudeDeg: 30.4, altitudeM: 8_500 }],
    ]),
  })

  assert.deepEqual(result.get('interaction:intercept'), {
    interactionId: 'interaction:intercept',
    interactionTimeMs: 12_000,
    interactionPoint: { longitudeDeg: 74.5, latitudeDeg: 31, altitudeM: 8_800 },
    status: 'resolved',
    propagatedFromInteractionId: 'interaction:first',
  })
})

test('interaction solver marks cycles and ambiguous producers unresolved', () => {
  const cycle = solveInteractionGeometry({
    intents: [
      { interactionId: 'interaction:a', weaponRef: 'weapon:a', targetRef: 'weapon:b', interactionTimeMs: 1_000 },
      { interactionId: 'interaction:b', weaponRef: 'weapon:b', targetRef: 'weapon:a', interactionTimeMs: 1_000 },
    ],
    directPoints: new Map(),
  })
  assert.equal(cycle.get('interaction:a')?.status, 'unresolved')
  assert.equal(cycle.get('interaction:b')?.status, 'unresolved')

  const ambiguous = solveInteractionGeometry({
    intents: [
      { interactionId: 'interaction:producer-1', weaponRef: 'weapon:first', targetRef: 'fighter:a', interactionTimeMs: 1_000 },
      { interactionId: 'interaction:producer-2', weaponRef: 'weapon:first', targetRef: 'fighter:b', interactionTimeMs: 2_000 },
      { interactionId: 'interaction:downstream', weaponRef: 'weapon:interceptor', targetRef: 'weapon:first', interactionTimeMs: 3_000 },
    ],
    directPoints: new Map([
      ['interaction:producer-1', { longitudeDeg: 1, latitudeDeg: 1, altitudeM: 1 }],
      ['interaction:producer-2', { longitudeDeg: 2, latitudeDeg: 2, altitudeM: 2 }],
      ['interaction:downstream', { longitudeDeg: 3, latitudeDeg: 3, altitudeM: 3 }],
    ]),
  })
  assert.equal(ambiguous.get('interaction:downstream')?.status, 'unresolved')
  assert.equal(ambiguous.get('interaction:downstream')?.reason, 'ambiguous-target-chain')
})
