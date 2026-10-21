/* eslint-disable no-bitwise -- Bit manipulation is the subject under test */
import { describe, expect, it } from 'vitest'
import {
	bigintToBits,
	bigMap,
	distance,
	formatNumber,
	getOneCount,
	getSelectedIndex,
	grayDecode,
	grayEncode,
	indexToCoordinates,
	mapRange,
} from '../src/lib/bigint-utils'
import { X_MAX, X_PIXEL_COUNT, Y_MAX, Y_PIXEL_COUNT } from '../src/lib/constants'

// Deterministic sample coordinates spanning the full 1152-bit range
const SAMPLE_VALUES: bigint[] = [
	0n,
	1n,
	2n,
	255n,
	2n ** 100n,
	2n ** 1151n,
	X_MAX / 3n,
	X_MAX - 1n,
	X_MAX,
]

describe('bigintToBits', () => {
	it('expands bits most-significant first, left-padded', () => {
		expect([...bigintToBits(0b101n, 4)]).toEqual([0, 1, 0, 1])
		expect([...bigintToBits(0n, 3)]).toEqual([0, 0, 0])
		expect([...bigintToBits(255n, 8)]).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
	})

	it('covers the full coordinate width', () => {
		const bits = bigintToBits(2n ** 1151n, X_PIXEL_COUNT)
		expect(bits.length).toBe(X_PIXEL_COUNT)
		expect(bits[0]).toBe(1)
		expect(bits.filter((bit) => bit === 1).length).toBe(1)
	})
})

describe('getOneCount', () => {
	it('counts set bits', () => {
		expect(getOneCount(0n)).toBe(0)
		expect(getOneCount(1n)).toBe(1)
		expect(getOneCount(255n)).toBe(8)
		expect(getOneCount(2n ** 1151n)).toBe(1)
		expect(getOneCount(X_MAX)).toBe(X_PIXEL_COUNT)
	})
})

describe('bigMap', () => {
	it('maps endpoints and midpoints between ranges', () => {
		expect(bigMap(0n, 0n, 10n, 0n, 100n)).toBe(0n)
		expect(bigMap(10n, 0n, 10n, 0n, 100n)).toBe(100n)
		expect(bigMap(5n, 0n, 10n, 0n, 100n)).toBe(50n)
	})

	it('maps the full coordinate range down to minimap space and back', () => {
		expect(bigMap(X_MAX, 0n, X_MAX, 0n, 10_000n)).toBe(10_000n)
		expect(bigMap(0n, 0n, X_MAX, 0n, 10_000n)).toBe(0n)
	})
})

describe('formatNumber', () => {
	it('adds comma separators', () => {
		expect(formatNumber('1234567')).toBe('1,234,567')
		expect(formatNumber('1000')).toBe('1,000')
	})

	it('leaves short strings alone', () => {
		expect(formatNumber('0')).toBe('0')
		expect(formatNumber('123')).toBe('123')
		expect(formatNumber('')).toBe('')
	})
})

describe('possibility index round trip', () => {
	it('concatenates X bits above Y bits', () => {
		expect(getSelectedIndex(0n, 0n)).toBe(0n)
		expect(getSelectedIndex(0n, 1n)).toBe(1n)
		expect(getSelectedIndex(1n, 0n)).toBe(2n ** BigInt(Y_PIXEL_COUNT))
		expect(getSelectedIndex(X_MAX, Y_MAX)).toBe(2n ** BigInt(X_PIXEL_COUNT + Y_PIXEL_COUNT) - 1n)
	})

	it('indexToCoordinates inverts getSelectedIndex', () => {
		for (const x of SAMPLE_VALUES) {
			for (const y of SAMPLE_VALUES) {
				expect(indexToCoordinates(getSelectedIndex(x, y))).toEqual({ x, y })
			}
		}
	})

	it('clamps out-of-range indices', () => {
		expect(indexToCoordinates(-5n)).toEqual({ x: 0n, y: 0n })
		const max = 2n ** BigInt(X_PIXEL_COUNT + Y_PIXEL_COUNT) - 1n
		expect(indexToCoordinates(max + 100n)).toEqual({ x: X_MAX, y: Y_MAX })
	})
})

describe('gray code', () => {
	it('round-trips through encode/decode', () => {
		for (const value of SAMPLE_VALUES) {
			expect(grayDecode(grayEncode(value))).toBe(value)
		}
	})

	it('adjacent values differ by exactly one bit', () => {
		for (const value of SAMPLE_VALUES) {
			if (value >= X_MAX) {
				continue
			}

			const difference = grayEncode(value) ^ grayEncode(value + 1n)
			expect(getOneCount(difference)).toBe(1)
		}
	})
})

describe('geometry helpers', () => {
	it('computes euclidean distance', () => {
		expect(distance(0, 0, 3, 4)).toBe(5)
		expect(distance(1, 1, 1, 1)).toBe(0)
	})

	it('maps number ranges linearly', () => {
		expect(mapRange(5, 0, 10, 0, 100)).toBe(50)
		expect(mapRange(0, 0, 2304, 0, 255)).toBe(0)
		expect(mapRange(2304, 0, 2304, 0, 255)).toBe(255)
	})
})
