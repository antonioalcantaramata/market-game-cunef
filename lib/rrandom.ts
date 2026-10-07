// R's default random number generator, reproduced bit for bit: Mersenne-Twister
// seeded like set.seed(), and sample() with the "Rejection" method (R >= 3.6).
// With it, the Part 3 analysis gives exactly the same permutations, and so the
// same p-values, as Elena's R script with set.seed(123).
// Sources: R's src/main/RNG.c (RNG_Init, MT_genrand, fixup, rbits, R_unif_index)
// and src/main/random.c (do_sample without replacement).

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;
const I2_32M1 = 2.328306437080797e-10; // 1 / (2^32 - 1)

export class RRandom {
  private mt = new Uint32Array(N);
  private mti = N + 1;

  /** Same state as set.seed(seed) with R's default "Mersenne-Twister". */
  constructor(seed: number) {
    let s = seed >>> 0;
    const next = () => (s = (Math.imul(69069, s) + 1) >>> 0);
    for (let j = 0; j < 50; j++) next(); // initial scrambling
    next(); // dummy[0], the position, which FixupSeeds then sets to 624
    for (let j = 0; j < N; j++) this.mt[j] = next();
    this.mti = N;
  }

  private genrand(): number {
    const mt = this.mt;
    let y: number;
    if (this.mti >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        y = (mt[kk] & UPPER_MASK) | (mt[kk + 1] & LOWER_MASK);
        mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      for (; kk < N - 1; kk++) {
        y = (mt[kk] & UPPER_MASK) | (mt[kk + 1] & LOWER_MASK);
        mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      y = (mt[N - 1] & UPPER_MASK) | (mt[0] & LOWER_MASK);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      this.mti = 0;
    }
    y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return (y >>> 0) * 2.3283064365386963e-10;
  }

  /** runif(1): a number in (0, 1). */
  unif(): number {
    const x = this.genrand();
    if (x <= 0) return 0.5 * I2_32M1;
    if (1 - x <= 0) return 1 - 0.5 * I2_32M1;
    return x;
  }

  private rbits(bits: number): number {
    // v stays below 2^53, so plain numbers are exact; the modulo is R's bit mask.
    let v = 0;
    for (let n = 0; n <= bits; n += 16) v = 65536 * v + Math.floor(this.unif() * 65536);
    return v % 2 ** bits;
  }

  /** A uniform integer in [0, n), as R_unif_index with rejection sampling. */
  unifIndex(n: number): number {
    if (n <= 0) return 0;
    const bits = Math.ceil(Math.log2(n));
    let dv: number;
    do dv = this.rbits(bits);
    while (n <= dv);
    return dv;
  }

  /** sample(x): a random permutation of x, exactly as R draws it. */
  sample<T>(x: readonly T[]): T[] {
    let n = x.length;
    const pool = x.map((_, i) => i);
    const out: T[] = [];
    for (let i = 0; i < x.length; i++) {
      const j = this.unifIndex(n);
      out.push(x[pool[j]]);
      pool[j] = pool[--n];
    }
    return out;
  }
}
