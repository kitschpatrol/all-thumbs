import { X_RES, Y_RES } from './constants'

const HALF_PIXELS = (X_RES * Y_RES) / 2 // 1152

export const MAPPING_MODES = [
	'checkerboard',
	'hilbert',
	'original',
	'radial',
	'scattered',
	'spiral',
	'triangle',
	'triangleAlt',
] as const

export type MappingMode = (typeof MAPPING_MODES)[number]

type PixelSource = {
	/** Which bit index (0 = MSB) from that coordinate */
	bitIndex: number
	/** Which coordinate this pixel comes from */
	source: 'x' | 'y'
}

/** Full mapping for a 48x48 cell: indexed by py * 48 + px */
export type PixelMapping = PixelSource[]

const cache = new Map<MappingMode, PixelMapping>()

/** Get or generate a cached pixel mapping for the given mode. */
export function getPixelMapping(mode: MappingMode): PixelMapping {
	let mapping = cache.get(mode)
	if (!mapping) {
		mapping = generateMapping(mode)
		cache.set(mode, mapping)
	}

	return mapping
}

function generateMapping(mode: MappingMode): PixelMapping {
	switch (mode) {
		case 'checkerboard': {
			return generateCheckerboard()
		}

		case 'hilbert': {
			return generateHilbert()
		}

		case 'original': {
			return generateOriginal()
		}

		case 'radial': {
			return generateRadial()
		}

		case 'scattered': {
			return generateScattered()
		}

		case 'spiral': {
			return generateSpiral()
		}

		case 'triangle': {
			return generateTriangle()
		}

		case 'triangleAlt': {
			return generateTriangleAlt()
		}
	}
}

/**
 * Original: top 24 rows = X (row-major), bottom 24 rows = Y (row-major).
 */
function generateOriginal(): PixelMapping {
	const mapping = Array.from<PixelSource>({ length: X_RES * Y_RES })
	const halfY = Y_RES / 2

	for (let py = 0; py < Y_RES; py++) {
		for (let px = 0; px < X_RES; px++) {
			const index = py * X_RES + px
			mapping[index] =
				py < halfY
					? { bitIndex: py * X_RES + px, source: 'x' }
					: { bitIndex: (py - halfY) * X_RES + px, source: 'y' }
		}
	}

	return mapping
}

/**
 * Spiral: bits spiral outward from center, alternating X/Y along the path. MSBs
 * at center, LSBs at edges. Creates mandala-like patterns.
 */
function generateSpiral(): PixelMapping {
	const mapping = Array.from<PixelSource>({ length: X_RES * Y_RES })
	const total = X_RES * Y_RES
	const cx = (X_RES - 1) / 2
	const cy = (Y_RES - 1) / 2

	// Sort all pixel positions by distance from center, then by angle
	const positions: Array<{ angle: number; dist: number; px: number; py: number }> = []
	for (let py = 0; py < Y_RES; py++) {
		for (let px = 0; px < X_RES; px++) {
			const dx = px - cx
			const dy = py - cy
			positions.push({
				angle: Math.atan2(dy, dx),
				dist: Math.hypot(dx, dy),
				px,
				py,
			})
		}
	}

	// Sort by distance first, then by angle for a spiral effect
	positions.sort((a, b) => {
		const distanceDifference = a.dist - b.dist
		return Math.abs(distanceDifference) > 0.01 ? distanceDifference : a.angle - b.angle
	})

	// Assign alternating X/Y bits along the spiral path
	let xBit = 0
	let yBit = 0
	for (let i = 0; i < total; i++) {
		const position = positions[i]
		if (position === undefined) {
			continue
		}

		const { px, py } = position
		const index = py * X_RES + px
		if (i % 2 === 0 && xBit < HALF_PIXELS) {
			mapping[index] = { bitIndex: xBit++, source: 'x' }
		} else if (yBit < HALF_PIXELS) {
			mapping[index] = { bitIndex: yBit++, source: 'y' }
		} else {
			mapping[index] = { bitIndex: xBit++, source: 'x' }
		}
	}

	return mapping
}

/**
 * Checkerboard: X bits on even squares, Y bits on odd squares. No visible
 * top/bottom split. Creates a woven textile pattern.
 */
function generateCheckerboard(): PixelMapping {
	const mapping = Array.from<PixelSource>({ length: X_RES * Y_RES })

	let xBit = 0
	let yBit = 0

	for (let py = 0; py < Y_RES; py++) {
		for (let px = 0; px < X_RES; px++) {
			const index = py * X_RES + px
			mapping[index] =
				(px + py) % 2 === 0 ? { bitIndex: xBit++, source: 'x' } : { bitIndex: yBit++, source: 'y' }
		}
	}

	return mapping
}

/**
 * Radial: pixels sorted by distance from center. Inner circle = X bits (MSB at
 * center), outer ring = Y bits. Creates cameo/portrait-like compositions.
 */
function generateRadial(): PixelMapping {
	const mapping = Array.from<PixelSource>({ length: X_RES * Y_RES })
	const cx = (X_RES - 1) / 2
	const cy = (Y_RES - 1) / 2

	// Sort all pixel positions by distance from center
	const positions: Array<{ dist: number; px: number; py: number }> = []
	for (let py = 0; py < Y_RES; py++) {
		for (let px = 0; px < X_RES; px++) {
			const dx = px - cx
			const dy = py - cy
			positions.push({ dist: Math.hypot(dx, dy), px, py })
		}
	}

	positions.sort((a, b) => a.dist - b.dist)

	// First half (closest to center) = X bits, second half = Y bits
	for (const [i, { px, py }] of positions.entries()) {
		const index = py * X_RES + px
		mapping[index] =
			i < HALF_PIXELS ? { bitIndex: i, source: 'x' } : { bitIndex: i - HALF_PIXELS, source: 'y' }
	}

	return mapping
}

/**
 * Convert (x, y) on an NxN grid to a 1D Hilbert curve index. N must be a power
 * of 2.
 */
/* eslint-disable no-bitwise -- The Hilbert curve transform is inherently bit-level */
function xy2d(n: number, x: number, y: number): number {
	let d = 0
	for (let s = n >> 1; s > 0; s >>= 1) {
		const rx = (x & s) > 0 ? 1 : 0
		const ry = (y & s) > 0 ? 1 : 0
		d += s * s * ((3 * rx) ^ ry)
		if (ry !== 0) {
			continue
		}

		// Rotate quadrant
		if (rx === 1) {
			x = s - 1 - x
			y = s - 1 - y
		}

		const t = x
		x = y
		y = t
	}

	return d
}
/* eslint-enable no-bitwise */

/**
 * Hilbert: bits assigned along a Hilbert space-filling curve. MSBs at the curve
 * start, LSBs at the curve end. Since the Hilbert curve preserves spatial
 * locality, bits of similar significance are spatially clustered. Adjacent
 * cells show changes that ripple along organic, fractal paths.
 */
function generateHilbert(): PixelMapping {
	const mapping = Array.from<PixelSource>({ length: X_RES * Y_RES })

	// Use a 64x64 Hilbert curve (order 6, power of 2) and keep only
	// positions that fall within our 48x48 grid
	const N = 64
	const positions: Array<{ hilbertIndex: number; px: number; py: number }> = []
	for (let py = 0; py < Y_RES; py++) {
		for (let px = 0; px < X_RES; px++) {
			positions.push({ hilbertIndex: xy2d(N, px, py), px, py })
		}
	}

	// Sort by Hilbert index to get the curve traversal order
	positions.sort((a, b) => a.hilbertIndex - b.hilbertIndex)

	// Assign bits along the curve: alternate X/Y
	let xBit = 0
	let yBit = 0
	for (const [i, { px, py }] of positions.entries()) {
		const index = py * X_RES + px
		if (i % 2 === 0 && xBit < HALF_PIXELS) {
			mapping[index] = { bitIndex: xBit++, source: 'x' }
		} else if (yBit < HALF_PIXELS) {
			mapping[index] = { bitIndex: yBit++, source: 'y' }
		} else {
			mapping[index] = { bitIndex: xBit++, source: 'x' }
		}
	}

	return mapping
}

/**
 * Scattered: LSBs are spread across the entire image using golden-ratio-based
 * distribution. When you move between adjacent cells (incrementing by delta),
 * only the low-order bits change — and since those bits are scattered evenly
 * across the whole image, the visual difference is minimized. Adjacent cells
 * look almost identical with fine, distributed pixel changes.
 */
function generateScattered(): PixelMapping {
	const mapping = Array.from<PixelSource>({ length: X_RES * Y_RES })
	const total = X_RES * Y_RES

	// Build raster-order position list
	const positions: Array<{ px: number; py: number }> = []
	for (let py = 0; py < Y_RES; py++) {
		for (let px = 0; px < X_RES; px++) {
			positions.push({ px, py })
		}
	}

	// Golden ratio scatter: for bit index i, place it at pixel position
	// floor(i * phi * total) % total. This creates maximal uniformity —
	// no two adjacent bit indices end up at nearby pixel positions.
	const PHI = (1 + Math.sqrt(5)) / 2
	const xPositionMap = Array.from<number>({ length: HALF_PIXELS })
	const yPositionMap = Array.from<number>({ length: HALF_PIXELS })

	// Track which pixel positions are used
	const used = new Set<number>()

	// Assign X bit positions using golden ratio spacing
	for (let i = 0; i < HALF_PIXELS; i++) {
		let pos = Math.floor(((i * PHI) % 1) * total) // Fractional part of i*phi, scaled
		// Linear probe for collisions
		while (used.has(pos)) {
			pos = (pos + 1) % total
		}

		used.add(pos)
		xPositionMap[i] = pos
	}

	// Assign Y bit positions to remaining positions
	for (let i = 0; i < HALF_PIXELS; i++) {
		let pos = Math.floor((((HALF_PIXELS + i) * PHI) % 1) * total)
		while (used.has(pos)) {
			pos = (pos + 1) % total
		}

		used.add(pos)
		yPositionMap[i] = pos
	}

	// Fill the mapping
	for (let i = 0; i < HALF_PIXELS; i++) {
		const xPos = xPositionMap[i]
		if (xPos === undefined) {
			continue
		}

		const xPosition = positions[xPos]
		if (xPosition === undefined) {
			continue
		}

		const { px: xPx, py: xPy } = xPosition
		mapping[xPy * X_RES + xPx] = { bitIndex: i, source: 'x' }
	}

	for (let i = 0; i < HALF_PIXELS; i++) {
		const yPos = yPositionMap[i]
		if (yPos === undefined) {
			continue
		}

		const yPosition = positions[yPos]
		if (yPosition === undefined) {
			continue
		}

		const { px: yPx, py: yPy } = yPosition
		mapping[yPy * X_RES + yPx] = { bitIndex: i, source: 'y' }
	}

	return mapping
}

/**
 * Triangle: the cell is split along the main diagonal (top-left →
 * bottom-right). Lower-left triangle (py > px) = X bits, upper-right triangle =
 * Y bits. Bits are ordered along anti-diagonal stripes so MSBs sit near the
 * top-left corner and LSBs near the bottom-right within each half.
 *
 * Corner behavior: (0, 0) → solid black (both halves 0) (X_MAX, Y_MAX) → solid
 * white (both halves 1) (X_MAX, 0) → white lower-left, black upper-right (0,
 * Y_MAX) → black lower-left, white upper-right
 */
function generateTriangle(): PixelMapping {
	const mapping = Array.from<PixelSource>({ length: X_RES * Y_RES })

	// Traverse pixels along anti-diagonals (zigzag for continuity)
	const positions: Array<{ px: number; py: number }> = []
	for (let sum = 0; sum < X_RES + Y_RES - 1; sum++) {
		if (sum % 2 === 0) {
			for (let py = Math.min(sum, Y_RES - 1); py >= Math.max(0, sum - X_RES + 1); py--) {
				positions.push({ px: sum - py, py })
			}
		} else {
			for (let py = Math.max(0, sum - X_RES + 1); py <= Math.min(sum, Y_RES - 1); py++) {
				positions.push({ px: sum - py, py })
			}
		}
	}

	// Split along the main diagonal: lower-left (py > px) → X,
	// upper-right (px > py) → Y.
	// The diagonal itself (px == py, 48 pixels) is split evenly:
	// first 24 → X, rest → Y.
	let xBit = 0
	let yBit = 0
	let diagCount = 0

	for (const { px, py } of positions) {
		const index = py * X_RES + px
		let useX: boolean
		if (py > px) {
			useX = true
		} else if (px > py) {
			useX = false
		} else {
			useX = diagCount++ < X_RES / 2
		}

		mapping[index] = useX ? { bitIndex: xBit++, source: 'x' } : { bitIndex: yBit++, source: 'y' }
	}

	return mapping
}

/**
 * Triangle Alt: the cell is split along the anti-diagonal (top-right →
 * bottom-left). Lower-right triangle (SW–NE–SE) = X bits, upper-left triangle =
 * Y bits. Bits are ordered along anti-diagonal stripes so MSBs sit near the
 * top-left corner and LSBs near the bottom-right within each half.
 *
 * Corner behavior: (0, 0) → solid black (both halves 0) (X_MAX, Y_MAX) → solid
 * white (both halves 1) (X_MAX, 0) → white lower-right, black upper-left (0,
 * Y_MAX) → black lower-right, white upper-left
 */
function generateTriangleAlt(): PixelMapping {
	const mapping = Array.from<PixelSource>({ length: X_RES * Y_RES })
	const antiDiag = X_RES - 1 // Px + py threshold (47 for 48×48)

	// Traverse pixels along anti-diagonals (zigzag for continuity)
	const positions: Array<{ px: number; py: number }> = []
	for (let sum = 0; sum < X_RES + Y_RES - 1; sum++) {
		if (sum % 2 === 0) {
			for (let py = Math.min(sum, Y_RES - 1); py >= Math.max(0, sum - X_RES + 1); py--) {
				positions.push({ px: sum - py, py })
			}
		} else {
			for (let py = Math.max(0, sum - X_RES + 1); py <= Math.min(sum, Y_RES - 1); py++) {
				positions.push({ px: sum - py, py })
			}
		}
	}

	// Split along the anti-diagonal: lower-right (px+py > antiDiag) → X,
	// upper-left (px+py < antiDiag) → Y.
	// The anti-diagonal itself (px+py == antiDiag, 48 pixels) is split
	// evenly: first 24 → X, rest → Y.
	let xBit = 0
	let yBit = 0
	let diagCount = 0

	for (const { px, py } of positions) {
		const index = py * X_RES + px
		const sum = px + py
		let useX: boolean
		if (sum > antiDiag) {
			useX = true
		} else if (sum < antiDiag) {
			useX = false
		} else {
			useX = diagCount++ < X_RES / 2
		}

		mapping[index] = useX ? { bitIndex: xBit++, source: 'x' } : { bitIndex: yBit++, source: 'y' }
	}

	return mapping
}
