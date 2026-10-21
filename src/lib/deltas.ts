import { X_MAX } from './constants'

const DIVISORS_OF_1152 = [
	1152, 576, 384, 288, 192, 144, 128, 96, 72, 64, 48, 36, 32, 24, 18, 16, 12, 9, 8, 6, 4, 3, 2, 1,
]

/**
 * Step sizes for the delta slider. Each is X_MAX divided by a Mersenne number
 * 2^k - 1 where k divides 1152, so every delta divides the space exactly:
 * stepping n times from zero yields n's bit pattern repeated across the
 * coordinate, and the last step lands on X_MAX. Slider 0 is a single step; the
 * top of the slider is the whole space.
 */
const MERSENNE_DELTAS = DIVISORS_OF_1152.map((k) => X_MAX / (2n ** BigInt(k) - 1n))

export const SLIDER_MAX = MERSENNE_DELTAS.length - 1

/** Delta for a slider position, clamped to the slider's range. */
export function sliderToDelta(sliderValue: number): bigint {
	return MERSENNE_DELTAS[Math.max(0, Math.min(sliderValue, SLIDER_MAX))] ?? 1n
}
