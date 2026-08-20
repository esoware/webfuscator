import { shuffleInPlace } from 'src/utils/random'

/**
 * Identifier styles supported by `StringGenerator`. An array chooses a style
 * for each emission with the seeded random source.
 *
 *   - `mangled` emits bijective base-N names, shortest first
 *   - `hexadecimal` emits `_0x` plus 4-7 hexadecimal digits
 *   - `randomized` emits 4-7 random identifier characters
 *   - `zeroWidth` pads a reserved word with U+200C
 *   - `number` emits monotonic names such as `var_1` and `var_2`
 */
export type StringGeneratorMode = 'mangled' | 'hexadecimal' | 'randomized' | 'zeroWidth' | 'number'

/** A single style, or an array of styles to mix uniformly per emission. */
export type StringGeneratorModeOption = StringGeneratorMode | readonly StringGeneratorMode[]

// Reserved words and sensitive globals cannot be emitted bare. Zero-width mode
// makes entries from this same pool legal with ZWNJ padding.
const RESERVED = new Set<string>([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'async',
  'of',
  'arguments',
  'eval',
  'undefined',
  'NaN',
  'Infinity',
])

const MANGLED_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$'
const HEX_ALPHABET = '0123456789abcdef'
const IDENT_START = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$'
const IDENT_CONT = `${IDENT_START}0123456789`
// U+200C is legal after the first identifier character and pads a keyword.
const ZWNJ = '\u200C'

// Each index is stable per instance, allowing scopes to reuse short names.
export class StringGenerator {
  private counter = 0
  private cache: string[] = []
  private emitted = new Set<string>()
  private readonly modes: readonly StringGeneratorMode[]
  private readonly rng: () => number

  private mangledAlphabet: string
  private mangledCursor = 0
  private zeroWidthSize = 0
  private zeroWidthPool: string[] = []
  private numberCursor = 0

  constructor(option: StringGeneratorModeOption, rng: () => number) {
    this.rng = rng

    const modeList = Array.isArray(option) ? [...option] : [option as StringGeneratorMode]
    if (modeList.length === 0) {
      throw new Error('StringGenerator requires at least one mode')
    }
    this.modes = modeList

    const alphabet = [...MANGLED_ALPHABET]
    shuffleInPlace(alphabet, rng)
    this.mangledAlphabet = alphabet.join('')
  }

  next(): string {
    return this.at(this.counter++)
  }

  at(index: number): string {
    while (this.cache.length <= index) {
      this.cache.push(this.compute())
    }
    return this.cache[index]!
  }

  private compute(): string {
    let candidate: string
    do {
      candidate = this.advance(this.pickMode())
    } while (RESERVED.has(candidate) || this.emitted.has(candidate))
    this.emitted.add(candidate)
    return candidate
  }

  private pickMode(): StringGeneratorMode {
    if (this.modes.length === 1) {
      return this.modes[0]!
    }
    return this.modes[Math.floor(this.rng() * this.modes.length)]!
  }

  private advance(mode: StringGeneratorMode): string {
    switch (mode) {
      case 'mangled':
        return this.advanceMangled()
      case 'hexadecimal':
        return this.advanceHexadecimal()
      case 'randomized':
        return this.advanceRandomized()
      case 'zeroWidth':
        return this.advanceZeroWidth()
      case 'number':
        return this.advanceNumber()
    }
  }

  // Bijective base-N yields unique names in shortest-first order.
  private advanceMangled(): string {
    let cursor = ++this.mangledCursor
    const len = this.mangledAlphabet.length
    let name = ''
    while (cursor > 0) {
      const remainder = (cursor - 1) % len
      name = this.mangledAlphabet[remainder]! + name
      cursor = ((cursor - remainder) / len) | 0
    }
    return name
  }

  private advanceHexadecimal(): string {
    const len = 4 + Math.floor(this.rng() * 4)
    let hex = ''
    for (let index = 0; index < len; index++) {
      hex += HEX_ALPHABET[Math.floor(this.rng() * HEX_ALPHABET.length)]
    }
    return `_0x${hex}`
  }

  private advanceRandomized(): string {
    const len = 4 + Math.floor(this.rng() * 4)
    let result = IDENT_START[Math.floor(this.rng() * IDENT_START.length)]!
    for (let index = 1; index < len; index++) {
      result += IDENT_CONT[Math.floor(this.rng() * IDENT_CONT.length)]!
    }
    return result
  }

  // ZWNJ padding makes reserved words legal. Exhausting one size grows all
  // entries for the next round.
  private advanceZeroWidth(): string {
    while (this.zeroWidthPool.length === 0) {
      this.zeroWidthSize++
      const built: string[] = []
      for (const word of RESERVED) {
        const padding = Math.max(this.zeroWidthSize - word.length, 1)
        const candidate = word + ZWNJ.repeat(padding)
        if (candidate.length === this.zeroWidthSize) {
          built.push(candidate)
        }
      }
      shuffleInPlace(built, this.rng)
      this.zeroWidthPool = built
    }
    return this.zeroWidthPool.pop()!
  }

  private advanceNumber(): string {
    return `var_${++this.numberCursor}`
  }
}
