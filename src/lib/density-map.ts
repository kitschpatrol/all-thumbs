import type { EncodingMode } from './pane-renderer'
import { getOneCount, grayEncode, mapRange } from './bigint-utils'
import { X_MAX, X_RES, Y_MAX, Y_RES } from './constants'

/** Side length of the full-resolution density map, in samples. */
export const DENSITY_MAP_SIZE = 120

const TOTAL_PIXEL_COUNT = X_RES * Y_RES

/**
 * Resolution for a coarse density map: one sample per cell reachable at the
 * given delta, capped at the full map size. Mersenne deltas divide the space
 * evenly, so every sample lands exactly on a reachable coordinate.
 */
export function getCoarseResolution(delta: bigint): number {
	const stepsAcross = X_MAX / delta + 1n
	return stepsAcross > BigInt(DENSITY_MAP_SIZE) ? DENSITY_MAP_SIZE : Number(stepsAcross)
}

/**
 * Sample `resolution` coordinates evenly from 0 to `max` inclusive and count
 * the 1-bits of each after encoding. Caching these per axis turns the map
 * computation from O(n²) big-integer bit counts into O(n).
 */
function sampleOneCounts(
	max: bigint,
	resolution: number,
	encode: (value: bigint) => bigint,
): number[] {
	const lastIndex = BigInt(Math.max(1, resolution - 1))
	const counts: number[] = []
	for (let i = 0; i < resolution; i++) {
		const sample = (max * BigInt(i)) / lastIndex
		counts.push(getOneCount(encode(sample)))
	}

	return counts
}

/**
 * Render the possibility space as a square grayscale density map. Sample (i, j)
 * is the image whose X coordinate is i/(resolution-1) of the way across the
 * space and whose Y coordinate is j/(resolution-1) of the way down; its gray
 * level is that image's fraction of white pixels, so the map runs from black at
 * the top-left to white at the bottom-right for binary encoding.
 *
 * @returns RGBA pixel data, `resolution` × `resolution`, row-major
 */
export function computeDensityMap(
	resolution: number,
	encodingMode: EncodingMode,
): Uint8ClampedArray<ArrayBuffer> {
	const encode = encodingMode === 'gray' ? grayEncode : (value: bigint) => value
	const xOneCounts = sampleOneCounts(X_MAX, resolution, encode)
	const yOneCounts = sampleOneCounts(Y_MAX, resolution, encode)

	const data = new Uint8ClampedArray(resolution * resolution * 4)
	for (let j = 0; j < resolution; j++) {
		const yOneCount = yOneCounts[j] ?? 0
		for (let i = 0; i < resolution; i++) {
			const totalOneCount = (xOneCounts[i] ?? 0) + yOneCount
			const gray = Math.round(mapRange(totalOneCount, 0, TOTAL_PIXEL_COUNT, 0, 255))
			const index = (j * resolution + i) * 4
			data[index] = gray
			data[index + 1] = gray
			data[index + 2] = gray
			data[index + 3] = 255
		}
	}

	return data
}
