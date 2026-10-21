import { describe, expect, it } from 'vitest'
import { X_RES, Y_RES } from '../src/lib/constants'
import { getPixelMapping, MAPPING_MODES } from '../src/lib/pixel-mappings'

const TOTAL_PIXELS = X_RES * Y_RES // 2304
const HALF_PIXELS = TOTAL_PIXELS / 2 // 1152

describe.each(MAPPING_MODES)('mapping mode "%s"', (mode) => {
	const mapping = getPixelMapping(mode)

	it('covers every pixel exactly once', () => {
		expect(mapping.length).toBe(TOTAL_PIXELS)
		for (const entry of mapping) {
			expect(entry).toBeDefined()
		}
	})

	it('splits pixels evenly between X and Y sources', () => {
		const xCount = mapping.filter((entry) => entry.source === 'x').length
		const yCount = mapping.filter((entry) => entry.source === 'y').length
		expect(xCount).toBe(HALF_PIXELS)
		expect(yCount).toBe(HALF_PIXELS)
	})

	it('uses each bit index exactly once per source', () => {
		const xBits = new Set<number>()
		const yBits = new Set<number>()

		for (const entry of mapping) {
			const bits = entry.source === 'x' ? xBits : yBits
			expect(bits.has(entry.bitIndex)).toBe(false)
			bits.add(entry.bitIndex)
			expect(entry.bitIndex).toBeGreaterThanOrEqual(0)
			expect(entry.bitIndex).toBeLessThan(HALF_PIXELS)
		}

		expect(xBits.size).toBe(HALF_PIXELS)
		expect(yBits.size).toBe(HALF_PIXELS)
	})

	it('returns a cached instance on repeat calls', () => {
		expect(getPixelMapping(mode)).toBe(mapping)
	})
})

describe('original mapping layout', () => {
	it('places X bits in the top half and Y bits in the bottom half, row-major', () => {
		const mapping = getPixelMapping('original')

		// Top-left pixel is the X MSB
		expect(mapping[0]).toEqual({ bitIndex: 0, source: 'x' })

		// First pixel of the bottom half is the Y MSB
		const bottomStart = (Y_RES / 2) * X_RES
		expect(mapping[bottomStart]).toEqual({ bitIndex: 0, source: 'y' })

		// Bottom-right pixel is the Y LSB
		expect(mapping[TOTAL_PIXELS - 1]).toEqual({
			bitIndex: HALF_PIXELS - 1,
			source: 'y',
		})
	})
})
