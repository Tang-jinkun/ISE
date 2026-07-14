import { createHash } from 'node:crypto'

export function sha256(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

export function fingerprint(value: unknown): string {
  return sha256(canonicalJson(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]),
  )
}
