/**
 * Deterministic pseudo-random number generator using Mulberry32 algorithm.
 * Enables 100% reproducible test suite generation from a seed string or number.
 */
export class SeededPRNG {
  private state: number;

  constructor(seed: string | number) {
    if (typeof seed === "number") {
      this.state = seed >>> 0;
    } else {
      this.state = SeededPRNG.hashString(seed);
    }
  }

  private static hashString(str: string): number {
    let hash = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      hash = Math.imul(hash ^ str.charCodeAt(i), 3432918353);
      hash = (hash << 13) | (hash >>> 19);
    }
    return hash >>> 0;
  }

  /**
   * Returns a float in [0, 1)
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns an integer in [min, max] inclusive
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Returns a boolean
   */
  nextBoolean(): boolean {
    return this.next() >= 0.5;
  }

  /**
   * Picks a random element from an array
   */
  pick<T>(items: T[]): T {
    if (items.length === 0) {
      throw new Error("Cannot pick from empty array");
    }
    const idx = this.nextInt(0, items.length - 1);
    return items[idx];
  }
}
