export function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function createRandom(seed: string) {
  let state = hashString(seed)
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function noise1D(position: number, seed: number) {
  const left = Math.floor(position)
  const fraction = position - left
  const smooth = fraction * fraction * (3 - 2 * fraction)
  const sample = (index: number) => {
    let value = Math.imul(index + seed, 374761393)
    value = Math.imul(value ^ (value >>> 13), 1274126177)
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295
  }
  return sample(left) * (1 - smooth) + sample(left + 1) * smooth
}
