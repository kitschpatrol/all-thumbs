import type { MappingMode } from './pixel-mappings'
import { bigintToBits, getOneCount, grayEncode } from './bigint-utils'
import {
	CELL_HEIGHT,
	CELL_WIDTH,
	PANE_HEIGHT,
	PANE_WIDTH,
	PANE_X_COUNT,
	PANE_Y_COUNT,
	X_MAX,
	X_PIXEL_COUNT,
	X_RES,
	Y_MAX,
	Y_PIXEL_COUNT,
	Y_RES,
} from './constants'
import { getPixelMapping } from './pixel-mappings'

/** How coordinate values are encoded into bits: plain binary or Gray code. */
export const ENCODING_MODES = ['binary', 'gray'] as const

export type EncodingMode = (typeof ENCODING_MODES)[number]

// Pixels are written as whole 32-bit RGBA values; every platform this runs on
// is little-endian, so the bytes land in R, G, B, A order. Everything that
// isn't an image pixel stays transparent so the canvas background shows
// through and can change without re-rendering.
function packPixel(r: number, g: number, b: number): number {
	return 0xff * 2 ** 24 + b * 2 ** 16 + g * 2 ** 8 + r
}

const BLACK = packPixel(0, 0, 0)
const WHITE = packPixel(255, 255, 255)

type TypedMapping = {
	/** Bit index (0 = MSB) within the source coordinate, per pixel */
	bitIndex: Uint16Array
	/** 1 when the pixel comes from the X coordinate, 0 for Y */
	fromX: Uint8Array
}

const typedMappings = new Map<MappingMode, TypedMapping>()

/** The pixel mapping as flat typed arrays, which the hot loop reads fastest. */
function getTypedMapping(mode: MappingMode): TypedMapping {
	let typed = typedMappings.get(mode)
	if (typed === undefined) {
		const mapping = getPixelMapping(mode)
		typed = {
			bitIndex: Uint16Array.from(mapping, (entry) => entry.bitIndex),
			fromX: Uint8Array.from(mapping, (entry) => (entry.source === 'x' ? 1 : 0)),
		}
		typedMappings.set(mode, typed)
	}

	return typed
}

/**
 * Render a pane: an 8x8 grid of 48x48 cells into a single ImageData.
 *
 * Each cell at grid position (col, row) visualizes the X coordinate for that
 * column and the Y coordinate for that row, laid out according to the pixel
 * mapping. Cells whose coordinate falls outside the possibility space are left
 * transparent, as is the padding between cells.
 */
export function renderPane(
	xPos: bigint,
	yPos: bigint,
	xDelta: bigint,
	yDelta: bigint,
	mappingMode: MappingMode = 'original',
	encodingMode: EncodingMode = 'binary',
): ImageData {
	const imageData = new ImageData(PANE_WIDTH, PANE_HEIGHT)
	const { data } = imageData
	const pixels = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4)

	const mapping = getTypedMapping(mappingMode)
	const encode = encodingMode === 'gray' ? grayEncode : (v: bigint) => v

	// Precompute X bits (one per column), stopping at the space's edge
	const xBitArrays: Uint8Array[] = []
	let xValue = xPos
	for (let col = 0; col < PANE_X_COUNT && xValue >= 0n && xValue <= X_MAX; col++) {
		xBitArrays.push(bigintToBits(encode(xValue), X_PIXEL_COUNT))
		xValue += xDelta
	}

	// Precompute Y bits (one per row)
	const yBitArrays: Uint8Array[] = []
	let yValue = yPos
	for (let row = 0; row < PANE_Y_COUNT && yValue >= 0n && yValue <= Y_MAX; row++) {
		yBitArrays.push(bigintToBits(encode(yValue), Y_PIXEL_COUNT))
		yValue += yDelta
	}

	for (const [col, xBits] of xBitArrays.entries()) {
		for (const [row, yBits] of yBitArrays.entries()) {
			renderCell(pixels, col * CELL_WIDTH, row * CELL_HEIGHT, xBits, yBits, mapping)
		}
	}

	return imageData
}

/** Render a single 48x48 cell using the pixel mapping. */
function renderCell(
	pixels: Uint32Array,
	cellX: number,
	cellY: number,
	xBits: Uint8Array,
	yBits: Uint8Array,
	mapping: TypedMapping,
): void {
	const { bitIndex, fromX } = mapping
	for (let py = 0; py < Y_RES; py++) {
		const rowStart = (cellY + py) * PANE_WIDTH + cellX
		const mapRow = py * X_RES
		for (let px = 0; px < X_RES; px++) {
			const index = mapRow + px
			const bits = fromX[index] === 1 ? xBits : yBits
			pixels[rowStart + px] = bits[bitIndex[index]!] === 1 ? WHITE : BLACK
		}
	}
}

/**
 * Render a pane at `size` × `size` pixels with each cell filled by its average
 * brightness, the fraction of 1-bits across both of its coordinates, instead of
 * its pixels. When zoomed out so far that a cell is only a few device pixels
 * wide, that average is all that would survive downscaling, and it costs
 * sixteen bit counts per pane instead of a full render.
 */
export function renderPaneCoarse(
	xPos: bigint,
	yPos: bigint,
	xDelta: bigint,
	yDelta: bigint,
	encodingMode: EncodingMode,
	size: number,
): ImageData {
	const imageData = new ImageData(size, size)
	const { data } = imageData
	const pixels = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4)
	const encode = encodingMode === 'gray' ? grayEncode : (v: bigint) => v

	const xCounts: number[] = []
	let xValue = xPos
	for (let col = 0; col < PANE_X_COUNT && xValue >= 0n && xValue <= X_MAX; col++) {
		xCounts.push(getOneCount(encode(xValue)))
		xValue += xDelta
	}

	const yCounts: number[] = []
	let yValue = yPos
	for (let row = 0; row < PANE_Y_COUNT && yValue >= 0n && yValue <= Y_MAX; row++) {
		yCounts.push(getOneCount(encode(yValue)))
		yValue += yDelta
	}

	// Cells keep their proportions: `pitch` per cell, of which `span` is image
	const pitch = size / PANE_X_COUNT
	const span = (pitch * X_RES) / CELL_WIDTH
	const totalBits = X_PIXEL_COUNT + Y_PIXEL_COUNT
	for (const [row, yCount] of yCounts.entries()) {
		const top = Math.round(row * pitch)
		const bottom = Math.max(top + 1, Math.round(row * pitch + span))
		for (const [col, xCount] of xCounts.entries()) {
			const gray = Math.round((255 * (xCount + yCount)) / totalBits)
			const value = packPixel(gray, gray, gray)
			const left = Math.round(col * pitch)
			const right = Math.max(left + 1, Math.round(col * pitch + span))
			for (let y = top; y < bottom; y++) {
				pixels.fill(value, y * size + left, y * size + right)
			}
		}
	}

	return imageData
}
