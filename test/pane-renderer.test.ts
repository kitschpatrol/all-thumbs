import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CELL_HEIGHT, CELL_WIDTH, PANE_WIDTH, X_MAX, X_RES, Y_MAX } from '../src/lib/constants'
import { renderPane, renderPaneCoarse } from '../src/lib/pane-renderer'

/** Minimal stand-in for the browser's ImageData, which Node lacks. */
class FakeImageData {
	data: Uint8ClampedArray
	height: number
	width: number

	constructor(width: number, height: number) {
		this.width = width
		this.height = height
		this.data = new Uint8ClampedArray(width * height * 4)
	}
}

const BLACK = [0, 0, 0, 255]
const WHITE = [255, 255, 255, 255]
const TRANSPARENT = [0, 0, 0, 0]

function pixelAt(imageData: ImageData, x: number, y: number): number[] {
	const index = (y * PANE_WIDTH + x) * 4
	return [...imageData.data.slice(index, index + 4)]
}

beforeAll(() => {
	vi.stubGlobal('ImageData', FakeImageData)
})

describe('renderPane', () => {
	it('renders the origin cell solid black with transparent padding around it', () => {
		const pane = renderPane(0n, 0n, 1n, 1n)
		expect(pixelAt(pane, 0, 0)).toEqual(BLACK)
		expect(pixelAt(pane, X_RES - 1, X_RES - 1)).toEqual(BLACK)
		expect(pixelAt(pane, X_RES, 0)).toEqual(TRANSPARENT)
		expect(pixelAt(pane, 0, X_RES)).toEqual(TRANSPARENT)
	})

	it('steps X across columns and Y down rows by the delta', () => {
		const pane = renderPane(0n, 0n, 1n, 1n)

		// Column 1 has X = 1: only the X LSB (row 23, col 47 in the original layout) is white
		expect(pixelAt(pane, CELL_WIDTH + X_RES - 1, X_RES / 2 - 1)).toEqual(WHITE)
		expect(pixelAt(pane, CELL_WIDTH + X_RES - 2, X_RES / 2 - 1)).toEqual(BLACK)
		expect(pixelAt(pane, CELL_WIDTH + X_RES - 1, X_RES - 1)).toEqual(BLACK)

		// Row 1 has Y = 1: only the Y LSB (bottom-right pixel) is white
		expect(pixelAt(pane, X_RES - 1, CELL_HEIGHT + X_RES - 1)).toEqual(WHITE)
		expect(pixelAt(pane, X_RES - 1, CELL_HEIGHT + X_RES / 2 - 1)).toEqual(BLACK)
	})

	it('leaves cells past the end of the space transparent', () => {
		const pane = renderPane(X_MAX, Y_MAX, 1n, 1n)
		expect(pixelAt(pane, 0, 0)).toEqual(WHITE)
		expect(pixelAt(pane, X_RES - 1, X_RES - 1)).toEqual(WHITE)
		expect(pixelAt(pane, CELL_WIDTH, 0)).toEqual(TRANSPARENT)
		expect(pixelAt(pane, 0, CELL_HEIGHT)).toEqual(TRANSPARENT)
	})

	it('applies Gray code encoding', () => {
		// X = 2 is 0b11 in Gray code, so the two lowest X bits light up
		const pane = renderPane(2n, 0n, 1n, 1n, 'original', 'gray')
		expect(pixelAt(pane, X_RES - 1, X_RES / 2 - 1)).toEqual(WHITE)
		expect(pixelAt(pane, X_RES - 2, X_RES / 2 - 1)).toEqual(WHITE)
		expect(pixelAt(pane, X_RES - 3, X_RES / 2 - 1)).toEqual(BLACK)
	})

	it('applies the pixel mapping', () => {
		// Checkerboard puts the X MSB at (0, 0) and the Y MSB at (1, 0)
		const msb = 2n ** 1151n
		const pane = renderPane(msb, 0n, 1n, 1n, 'checkerboard')
		expect(pixelAt(pane, 0, 0)).toEqual(WHITE)
		expect(pixelAt(pane, 1, 0)).toEqual(BLACK)
	})
})

describe('renderPaneCoarse', () => {
	const SIZE = 53
	const PITCH = SIZE / 8

	function coarsePixelAt(imageData: ImageData, x: number, y: number): number[] {
		const index = (y * SIZE + x) * 4
		return [...imageData.data.slice(index, index + 4)]
	}

	it('fills each cell with its average brightness and leaves the gaps transparent', () => {
		const pane = renderPaneCoarse(0n, 0n, 1n, 1n, 'binary', SIZE)
		expect(pane.width).toBe(SIZE)
		expect(coarsePixelAt(pane, 0, 0)).toEqual(BLACK)

		// The gap after the first cell, before the next one starts
		const nextCell = Math.round(PITCH)
		expect(coarsePixelAt(pane, nextCell - 1, 0)).toEqual(TRANSPARENT)
		expect(coarsePixelAt(pane, nextCell, 0)).toEqual(BLACK)
	})

	it('shades by the share of set bits across both coordinates', () => {
		const white = renderPaneCoarse(X_MAX, Y_MAX, 1n, 1n, 'binary', SIZE)
		expect(coarsePixelAt(white, 0, 0)).toEqual(WHITE)

		const half = renderPaneCoarse(X_MAX, 0n, 1n, 1n, 'binary', SIZE)
		expect(coarsePixelAt(half, 0, 0)).toEqual([128, 128, 128, 255])
	})

	it('leaves cells past the end of the space transparent', () => {
		const pane = renderPaneCoarse(X_MAX, Y_MAX, 1n, 1n, 'binary', SIZE)
		const nextCell = Math.round(PITCH)
		expect(coarsePixelAt(pane, nextCell, 0)).toEqual(TRANSPARENT)
		expect(coarsePixelAt(pane, 0, nextCell)).toEqual(TRANSPARENT)
	})
})
