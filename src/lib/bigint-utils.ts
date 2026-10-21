/* eslint-disable no-bitwise -- BigInt masks, shifts, and Gray-code XOR are the substance of this module */
import { X_PIXEL_COUNT, Y_PIXEL_COUNT } from './constants'

/**
 * Expand a BigInt into one byte per bit, 0 or 1, left-padded to `bitCount` so
 * high bits come first.
 */
export function bigintToBits(value: bigint, bitCount: number): Uint8Array {
	const binary = value.toString(2).padStart(bitCount, '0')
	const bits = new Uint8Array(bitCount)
	for (let i = 0; i < bitCount; i++) {
		if (binary.codePointAt(i) === 49) {
			bits[i] = 1
		}
	}

	return bits
}

/**
 * Count the 1-bits in a BigInt. Scanning its binary string is several times
 * faster on 1152-bit values than clearing one bit at a time.
 */
export function getOneCount(value: bigint): number {
	const binary = value.toString(2)
	let count = 0
	for (let i = 0; i < binary.length; i++) {
		if (binary.codePointAt(i) === 49) {
			count++
		}
	}

	return count
}

/**
 * Linear interpolation in BigInt space. Maps `value` from range [istart, istop]
 * to [ostart, ostop]. Uses integer division (truncates toward zero).
 */
export function bigMap(
	value: bigint,
	istart: bigint,
	istop: bigint,
	ostart: bigint,
	ostop: bigint,
): bigint {
	return ostart + ((ostop - ostart) * (value - istart)) / (istop - istart)
}

/**
 * Left-pad a string with zeros to a given width.
 */
function zeroPad(value: string, width: number): string {
	return value.padStart(width, '0')
}

/**
 * Add comma separators to a numeric string. "1234567" → "1,234,567"
 */
export function formatNumber(numberString: string): string {
	let remaining = numberString
	let result = ''

	while (remaining.length > 3) {
		const chunk = remaining.slice(-3)
		remaining = remaining.slice(0, -3)
		result = ',' + chunk + result
	}

	if (remaining.length > 0) {
		result = remaining + result
	}

	return result
}

/**
 * Compute the combined "possibility index" from separate X and Y coordinates.
 * The index is a single 2304-bit number: [X bits (1152)] [Y bits (1152)].
 */
export function getSelectedIndex(selectedX: bigint, selectedY: bigint): bigint {
	const xBinary = zeroPad(selectedX.toString(2), X_PIXEL_COUNT)
	const yBinary = zeroPad(selectedY.toString(2), Y_PIXEL_COUNT)
	return BigInt('0b' + xBinary + yBinary)
}

const MAX_INDEX = 2n ** BigInt(X_PIXEL_COUNT + Y_PIXEL_COUNT) - 1n
const COORDINATE_BITS = BigInt(X_PIXEL_COUNT)

/**
 * Inverse of getSelectedIndex: split a 2304-bit index back into X and Y
 * coordinates. Clamps to the valid range [0, maxIndex] before splitting.
 */
export function indexToCoordinates(index: bigint): { x: bigint; y: bigint } {
	const clamped = index < 0n ? 0n : index > MAX_INDEX ? MAX_INDEX : index
	const yMask = 2n ** BigInt(Y_PIXEL_COUNT) - 1n
	const xMask = 2n ** BigInt(X_PIXEL_COUNT) - 1n
	const y = clamped & yMask
	const x = (clamped >> BigInt(Y_PIXEL_COUNT)) & xMask
	return { x, y }
}

/**
 * Encode a BigInt value as Gray code. Adjacent values differ by exactly one
 * bit.
 */
export function grayEncode(value: bigint): bigint {
	return value ^ (value >> 1n)
}

/**
 * Decode a Gray code BigInt back to standard binary. Uses doubling shift for
 * O(log n) iterations.
 */
export function grayDecode(gray: bigint): bigint {
	let value = gray
	let shift = 1n
	while (shift < COORDINATE_BITS) {
		value ^= value >> shift
		shift <<= 1n
	}

	return value
}

/**
 * Euclidean distance between two points.
 */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
	return Math.hypot(x2 - x1, y2 - y1)
}

/**
 * Linear interpolation (number version, for MiniMap grayscale mapping).
 */
export function mapRange(
	value: number,
	istart: number,
	istop: number,
	ostart: number,
	ostop: number,
): number {
	return ostart + (ostop - ostart) * ((value - istart) / (istop - istart))
}
