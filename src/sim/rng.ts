/**
 * Deterministic PRNG (sfc32). All simulation randomness must flow through a
 * single Rng instance owned by the World so that identical seeds + identical
 * interventions replay identically.
 */

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string | number) {
    const s = typeof seed === "number" ? String(seed) : seed;
    let h1 = 1779033703;
    let h2 = 3144134277;
    let h3 = 1013904242;
    let h4 = 2773480762;
    for (let i = 0; i < s.length; i++) {
      const k = s.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    this.a = h1 >>> 0;
    this.b = h2 >>> 0;
    this.c = h3 >>> 0;
    this.d = h4 >>> 0;
    // Warm up so short seeds diverge.
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Approximate gaussian via central limit (deterministic, cheap). */
  gaussian(mean = 0, std = 1): number {
    const n =
      this.next() + this.next() + this.next() + this.next() + this.next() + this.next() - 3;
    return mean + (n / Math.sqrt(0.5)) * std * 0.5;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Serializable internal state, for exact save/load resume. */
  getState(): [number, number, number, number] {
    // Normalize to unsigned 32-bit: internal ops use raw JS bitwise
    // operators, which return signed results, so this.a/b/c/d can hold
    // negative representations of what are conceptually unsigned words.
    // setState() already normalizes on the way in; normalizing here too
    // keeps saved state consistently non-negative and makes getState()
    // idempotent under a save/load round trip.
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  setState(s: [number, number, number, number]): void {
    this.a = s[0] >>> 0;
    this.b = s[1] >>> 0;
    this.c = s[2] >>> 0;
    this.d = s[3] >>> 0;
  }
}
