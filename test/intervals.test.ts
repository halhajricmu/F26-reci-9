import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mergeIntervals, type Interval } from '../src/intervals';

// Valid intervals by construction: pick a start and a non-negative length, so
// start <= end always holds. Small ranges (including negatives and values >= 10)
// make overlaps, shared endpoints, and duplicates common.
const interval: fc.Arbitrary<Interval> = fc
  .tuple(fc.integer({ min: -20, max: 20 }), fc.nat(10))
  .map(([start, len]): Interval => [start, start + len]);
const intervalList = fc.array(interval, { maxLength: 10 });

// Intervals that neither overlap nor touch: each one starts at least 1 past the
// previous end. Shuffled afterwards so the input is not already sorted.
const disjointSorted: fc.Arbitrary<Interval[]> = fc
  .tuple(
    fc.integer({ min: -20, max: 20 }),
    fc.array(fc.tuple(fc.integer({ min: 1, max: 5 }), fc.nat(5)), { maxLength: 8 }),
  )
  .map(([first, steps]) => {
    const out: Interval[] = [];
    let cursor = first;
    for (const [gap, len] of steps) {
      const start = cursor + gap;
      out.push([start, start + len]);
      cursor = start + len;
    }
    return out;
  });

// Obviously correct reference: is point p covered by any interval?
const covers = (xs: readonly Interval[], p: number) => xs.some(([s, e]) => s <= p && p <= e);

// Every integer and half-integer in a range around the input, so gaps
// strictly between integers (e.g. 2 < x < 3) are checked too.
const samplePoints = (xs: readonly Interval[]) => {
  const ends = xs.flat();
  const lo = Math.min(0, ...ends) - 1;
  const hi = Math.max(0, ...ends) + 1;
  const pts: number[] = [];
  for (let p = lo; p <= hi; p += 0.5) pts.push(p);
  return pts;
};

const clone = (xs: readonly Interval[]) => xs.map(([s, e]): Interval => [s, e]);

describe('mergeIntervals', () => {
  // Pattern: invariant. Every input interval lies inside some output interval.
  it('every input interval lies inside some output interval', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        const uncovered = xs.filter(([s, e]) => !out.some(([a, b]) => a <= s && e <= b));
        expect(uncovered).toEqual([]);
      }),
    );
  });

  // Pattern: invariant. Output is valid, sorted, and consecutive intervals neither overlap nor touch.
  it('output is sorted with strict gaps between consecutive intervals', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        for (const [s, e] of out) expect(s).toBeLessThanOrEqual(e);
        for (let i = 0; i + 1 < out.length; i++) {
          expect(out[i][1]).toBeLessThan(out[i + 1][0]);
        }
      }),
    );
  });

  // Pattern: invariant. The input array and its intervals are not modified.
  it('does not modify the input', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const before = clone(xs);
        const out = mergeIntervals(xs);
        expect(xs).toEqual(before);
        // Mutating the result must not reach back into the input either.
        for (const iv of out) iv[1] += 1000;
        expect(xs).toEqual(before);
      }),
    );
  });

  // Pattern: differential. Input and output cover exactly the same points (integers and half-integers).
  it('covers exactly the same points as the input', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        for (const p of samplePoints(xs)) {
          expect(covers(out, p), `point ${p}`).toBe(covers(xs, p));
        }
      }),
    );
  });

  // Pattern: metamorphic. Reordering the input does not change the output.
  it('is independent of input order', () => {
    fc.assert(
      fc.property(
        intervalList.chain(xs =>
          fc.tuple(fc.constant(xs), fc.shuffledSubarray(xs, { minLength: xs.length, maxLength: xs.length })),
        ),
        ([xs, shuffled]) => {
          expect(mergeIntervals(shuffled)).toEqual(mergeIntervals(xs));
        },
      ),
    );
  });

  // Pattern: algebraic. Merging is idempotent: merging an already-merged list changes nothing.
  it('is idempotent', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const once = mergeIntervals(xs);
        expect(mergeIntervals(once)).toEqual(once);
      }),
    );
  });

  // Pattern: conditional. If no intervals overlap or touch, the output is just the input sorted.
  it('returns disjoint, non-touching input sorted and unchanged', () => {
    fc.assert(
      fc.property(
        disjointSorted.chain(sorted =>
          fc.tuple(
            fc.constant(sorted),
            fc.shuffledSubarray(sorted, { minLength: sorted.length, maxLength: sorted.length }),
          ),
        ),
        ([sorted, shuffled]) => {
          expect(mergeIntervals(shuffled)).toEqual(sorted);
        },
      ),
    );
  });
});
