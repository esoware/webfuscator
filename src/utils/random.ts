// Mulberry32 is deterministic per seed and is not cryptographic.
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

// Fisher-Yates shuffle, in place.
export function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
  for (let index = items.length - 1; index > 0; index--) {
    const pick = Math.floor(rng() * (index + 1))
    const swapped = items[index]!
    items[index] = items[pick]!
    items[pick] = swapped
  }
  return items
}
