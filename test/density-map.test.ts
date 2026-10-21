import { describe, expect, it } from 'vitest'
import { getOneCount, grayEncode } from '../src/lib/bigint-utils'
import { X_MAX, X_PIXEL_COUNT, X_RES, Y_RES } from '../src/lib/constants'
import { computeDensityMap, DENSITY_MAP_SIZE, getCoarseResolution } from '../src/lib/density-map'

const TOTAL_PIXEL_COUNT = X_RES * Y_RES

/** Gray level of sample (i, j) in a map of the given resolution. */
function grayAt(data: Uint8ClampedArray, resolution: number, i: number, j: number): number {
	return data[(j * resolution + i) * 4] ?? -1
}

describe('computeDensityMap', () => {
	it('returns opaque RGBA data of resolution squared', () => {
		const resolution = 7
		const data = computeDensityMap(resolution, 'binary')
		expect(data.length).toBe(resolution * resolution * 4)
		for (let p = 0; p < resolution * resolution; p++) {
			const [r, g, b, a] = [data[p * 4], data[p * 4 + 1], data[p * 4 + 2], data[p * 4 + 3]]
			expect(r).toBe(g)
			expect(g).toBe(b)
			expect(a).toBe(255)
		}
	})

	it('runs from black at the top-left to white at the bottom-right', () => {
		const data = computeDensityMap(DENSITY_MAP_SIZE, 'binary')
		const last = DENSITY_MAP_SIZE - 1
		expect(grayAt(data, DENSITY_MAP_SIZE, 0, 0)).toBe(0)
		expect(grayAt(data, DENSITY_MAP_SIZE, last, last)).toBe(255)
		// Opposite corners are half white (one coordinate all ones, the other all zeros)
		expect(grayAt(data, DENSITY_MAP_SIZE, last, 0)).toBe(Math.round(255 / 2))
		expect(grayAt(data, DENSITY_MAP_SIZE, 0, last)).toBe(Math.round(255 / 2))
	})

	it('is symmetric across the diagonal', () => {
		const resolution = 24
		const data = computeDensityMap(resolution, 'binary')
		for (let i = 0; i < resolution; i++) {
			for (let j = 0; j < resolution; j++) {
				expect(grayAt(data, resolution, i, j)).toBe(grayAt(data, resolution, j, i))
			}
		}
	})

	it('matches one-counts of evenly spaced samples at a small resolution', () => {
		// Resolution 3 samples 0, X_MAX / 2, and X_MAX on each axis
		const samples = [0n, X_MAX / 2n, X_MAX]
		const data = computeDensityMap(3, 'binary')
		for (const [i, x] of samples.entries()) {
			for (const [j, y] of samples.entries()) {
				const ones = getOneCount(x) + getOneCount(y)
				const expected = Math.round((ones / TOTAL_PIXEL_COUNT) * 255)
				expect(grayAt(data, 3, i, j)).toBe(expected)
			}
		}

		// Sanity-check the hand-computed sample counts themselves
		expect(getOneCount(samples[1] ?? 0n)).toBe(X_PIXEL_COUNT - 1)
		expect(getOneCount(samples[2] ?? 0n)).toBe(X_PIXEL_COUNT)
	})

	it('changes with gray encoding', () => {
		const resolution = 16
		const binary = computeDensityMap(resolution, 'binary')
		const gray = computeDensityMap(resolution, 'gray')
		expect(gray).not.toEqual(binary)

		// The all-ones corner Gray-encodes to a single set bit, so it goes dark
		const last = resolution - 1
		expect(getOneCount(grayEncode(X_MAX))).toBe(1)
		expect(grayAt(gray, resolution, last, last)).toBe(Math.round((2 / TOTAL_PIXEL_COUNT) * 255))
	})

	it('handles a single sample without dividing by zero', () => {
		expect(computeDensityMap(1, 'binary')).toEqual(new Uint8ClampedArray([0, 0, 0, 255]))
	})
})

describe('getCoarseResolution', () => {
	it('uses one sample per reachable cell for large deltas', () => {
		expect(getCoarseResolution(X_MAX)).toBe(2)
		expect(getCoarseResolution(X_MAX / 3n)).toBe(4)
	})

	it('caps at the full map size for small deltas', () => {
		expect(getCoarseResolution(1n)).toBe(DENSITY_MAP_SIZE)
		expect(getCoarseResolution(X_MAX / BigInt(DENSITY_MAP_SIZE))).toBe(DENSITY_MAP_SIZE)
	})
})
