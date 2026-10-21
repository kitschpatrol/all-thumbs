import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	CELL_HEIGHT,
	CELL_WIDTH,
	PANE_HEIGHT,
	PANE_WIDTH,
	X_MAX,
	X_RES,
	Y_MAX,
	Y_RES,
} from '../src/lib/constants'
import { renderPane, renderPaneCoarse } from '../src/lib/pane-renderer'
import { ViewportEngine } from '../src/lib/viewport-engine'

// Pane rendering needs ImageData, which Node lacks; the engine only passes the
// result through to createImageBitmap
vi.mock('../src/lib/pane-renderer', () => ({
	renderPane: vi.fn(() => ({ width: 424 })),
	renderPaneCoarse: vi.fn(() => ({ width: 53 })),
}))

class FakeBitmap {
	closed = false
	width: number

	constructor(width: number) {
		this.width = width
	}

	close(): void {
		this.closed = true
	}
}

type PendingBitmap = {
	bitmap: FakeBitmap
	options: ImageBitmapOptions | undefined
	resolve: () => void
}

let pending: PendingBitmap[] = []

/** Resolve the oldest pending bitmap and let its continuation run. */
async function settleNextBitmap(): Promise<FakeBitmap> {
	const next = pending.shift()
	if (next === undefined) {
		throw new Error('No bitmap is pending')
	}

	next.resolve()
	await new Promise((resolve) => {
		setTimeout(resolve, 0)
	})
	return next.bitmap
}

function createEngine() {
	const selections: Array<[bigint, bigint]> = []
	const engine = new ViewportEngine({
		onNeedRedraw() {
			// Drawing belongs to the component; nothing to observe here
		},
		onSelectionChange(x, y) {
			selections.push([x, y])
		},
		// One pane per turn keeps the bitmap bookkeeping predictable
		renderBudgetMs: 0,
		viewportHeight: 600,
		viewportWidth: 800,
	})
	engine.init()
	return { engine, selections }
}

/** Whether any live pane holds the given bitmap. */
function holdsBitmap(engine: ViewportEngine, bitmap: FakeBitmap): boolean {
	return engine.panes.some((pane) => (pane.imageBitmap as unknown) === bitmap)
}

function paneContaining(engine: ViewportEngine, x: bigint, y: bigint) {
	return engine.panes.find(
		(pane) => x >= pane.xPos && x < pane.xPosMax && y >= pane.yPos && y < pane.yPosMax,
	)
}

/** Pixel center of a cell's image inside the viewport. */
function cellCenter(engine: ViewportEngine, x: bigint, y: bigint): { x: number; y: number } {
	const pane = paneContaining(engine, x, y)
	if (pane === undefined) {
		throw new Error('Coordinate is not loaded')
	}

	const col = Number((x - pane.xPos) / engine.xDelta)
	const row = Number((y - pane.yPos) / engine.yDelta)
	return {
		x: pane.x + col * CELL_WIDTH + X_RES / 2,
		y: pane.y + row * CELL_HEIGHT + Y_RES / 2,
	}
}

beforeEach(() => {
	pending = []
	vi.stubGlobal(
		'createImageBitmap',
		async (_image: ImageData, options?: ImageBitmapOptions) =>
			new Promise<FakeBitmap>((resolve) => {
				const bitmap = new FakeBitmap(options?.resizeWidth ?? PANE_WIDTH)
				pending.push({
					bitmap,
					options,
					resolve() {
						resolve(bitmap)
					},
				})
			}),
	)
})

describe('initial layout', () => {
	it('centers the origin cell and selects it', () => {
		const { engine, selections } = createEngine()
		expect(engine.selectedX).toBe(0n)
		expect(engine.selectedY).toBe(0n)
		expect(selections.at(-1)).toEqual([0n, 0n])

		const center = engine.viewportCenter()
		expect(cellCenter(engine, 0n, 0n)).toEqual(center)
	})

	it('tiles panes on a single grid and never outside the space', () => {
		const { engine } = createEngine()
		const [reference] = engine.panes
		expect(reference).toBeDefined()

		for (const pane of engine.panes) {
			expect((pane.x - reference!.x) % PANE_WIDTH).toBe(0)
			expect((pane.y - reference!.y) % PANE_HEIGHT).toBe(0)
			expect(pane.xPos >= 0n && pane.xPos <= X_MAX).toBe(true)
			expect(pane.yPos >= 0n && pane.yPos <= Y_MAX).toBe(true)
		}

		// Everything right of and below the origin cell is covered by a pane
		const origin = paneContaining(engine, 0n, 0n)!
		for (let { x } = origin; x < engine.viewportWidth; x += 100) {
			for (let { y } = origin; y < engine.viewportHeight; y += 100) {
				const covered = engine.panes.some(
					(pane) =>
						x >= pane.x && x < pane.x + PANE_WIDTH && y >= pane.y && y < pane.y + PANE_HEIGHT,
				)
				expect(covered).toBe(true)
			}
		}
	})

	it('reports the applied move and selects the cell under the center', () => {
		const { engine } = createEngine()
		engine.centerOn(X_MAX / 2n, Y_MAX / 2n)
		const applied = engine.movePanes(-30, 17)
		expect(applied).toEqual({ x: -30, y: 17 })
		expect(engine.selectedX).toBe(X_MAX / 2n + 1n)
		expect(engine.selectedY).toBe(Y_MAX / 2n)
	})
})

describe('centerOn', () => {
	it('pans within loaded panes without rebuilding them', () => {
		const { engine } = createEngine()
		const before = engine.panes
		engine.centerOn(5n, 3n)
		expect(engine.panes).toBe(before)
		expect(engine.selectedX).toBe(5n)
		expect(engine.selectedY).toBe(3n)
		expect(cellCenter(engine, 5n, 3n)).toEqual(engine.viewportCenter())
	})

	it('warps to a distant coordinate and discards in-flight bitmaps', async () => {
		const { engine } = createEngine()
		expect(pending).toHaveLength(1)

		engine.centerOn(X_MAX / 2n, Y_MAX / 2n)
		expect(engine.selectedX).toBe(X_MAX / 2n)
		expect(engine.selectedY).toBe(Y_MAX / 2n)
		expect(cellCenter(engine, X_MAX / 2n, Y_MAX / 2n)).toEqual(engine.viewportCenter())

		// The bitmap from before the warp belongs to a dead generation
		const stale = await settleNextBitmap()
		expect(stale.closed).toBe(true)
		expect(holdsBitmap(engine, stale)).toBe(false)

		// The new generation keeps rendering on its own
		const fresh = await settleNextBitmap()
		expect(fresh.closed).toBe(false)
		expect(holdsBitmap(engine, fresh)).toBe(true)
	})
})

describe('mode changes', () => {
	it('rebuilds panes for a new layout and discards in-flight bitmaps', async () => {
		const { engine } = createEngine()
		engine.setMappingMode('spiral')
		expect(engine.mappingMode).toBe('spiral')
		expect(engine.selectedX).toBe(0n)

		const stale = await settleNextBitmap()
		expect(stale.closed).toBe(true)

		const fresh = await settleNextBitmap()
		expect(fresh.closed).toBe(false)
		expect(engine.panes.filter((pane) => pane.imageBitmap).length).toBe(1)
	})

	it('snaps the selection to the new delta grid and keeps a stale layer', async () => {
		const { engine } = createEngine()
		const rendered = await settleNextBitmap()
		engine.centerOn(7n, 11n)

		const delta = 4n
		engine.setDelta(delta)
		expect(engine.xDelta).toBe(delta)
		expect(engine.selectedX).toBe(4n)
		expect(engine.selectedY).toBe(8n)
		expect(cellCenter(engine, 4n, 8n)).toEqual(engine.viewportCenter())

		expect(
			engine.stalePanes?.panes.some((pane) => (pane.imageBitmap as unknown) === rendered),
		).toBe(true)
		engine.disposeStale()
		expect(rendered.closed).toBe(true)
		expect(engine.stalePanes).toBeUndefined()
	})
})

describe('bounds', () => {
	it('stops with the first cell centered when panning toward the start', () => {
		const { engine } = createEngine()
		const center = engine.viewportCenter()

		// The origin cell is already centered, so there is nowhere further to go
		expect(engine.movePanes(500, 500)).toEqual({ x: 0, y: 0 })
		expect(cellCenter(engine, 0n, 0n)).toEqual(center)
		expect(engine.selectedX).toBe(0n)
		expect(engine.selectedY).toBe(0n)

		// Moving away from the edge is free
		expect(engine.movePanes(-10, -10)).toEqual({ x: -10, y: -10 })
	})

	it('stops with the last cell centered when panning toward the end', () => {
		const { engine } = createEngine()
		engine.centerOn(X_MAX, Y_MAX)
		const center = engine.viewportCenter()

		expect(engine.movePanes(-500, -500)).toEqual({ x: 0, y: 0 })
		expect(cellCenter(engine, X_MAX, Y_MAX)).toEqual(center)
		expect(engine.selectedX).toBe(X_MAX)
		expect(engine.selectedY).toBe(Y_MAX)

		// A pull that overshoots is cut to exactly what reaches the limit
		expect(engine.movePanes(10, 10)).toEqual({ x: 10, y: 10 })
		expect(engine.movePanes(-500, -500)).toEqual({ x: -10, y: -10 })
	})

	it('leaves panning free in the middle of the space', () => {
		const { engine } = createEngine()
		engine.centerOn(X_MAX / 2n, Y_MAX / 2n)
		expect(engine.movePanes(-500, 500)).toEqual({ x: -500, y: 500 })
	})

	it('does not create panes past the end of the space', () => {
		const { engine } = createEngine()
		engine.setDelta(X_MAX)
		expect(engine.panes).toHaveLength(1)
		expect(engine.panes[0]!.xPos).toBe(0n)
	})
})

describe('resize', () => {
	it('keeps pane positions and fills the new area', () => {
		const { engine } = createEngine()
		const origin = paneContaining(engine, 0n, 0n)!
		const position = { x: origin.x, y: origin.y }
		const before = engine.panes.length

		engine.setViewportSize(1600, 1200)
		expect(origin.x).toBe(position.x)
		expect(origin.y).toBe(position.y)
		expect(engine.panes.length).toBeGreaterThan(before)
	})

	it('releases bitmaps that resolve after their pane was pruned', async () => {
		const { engine } = createEngine()
		const [first] = engine.panes
		engine.centerOn(X_MAX / 2n, Y_MAX / 2n)
		engine.movePanes(-5 * PANE_WIDTH, 0)
		expect(engine.panes.includes(first!)).toBe(false)

		const bitmap = await settleNextBitmap()
		expect(bitmap.closed).toBe(true)
	})
})

describe('detail scale', () => {
	it('renders full-size bitmaps by default', () => {
		createEngine()
		expect(pending[0]?.options).toBeUndefined()
	})

	it('shrinks new bitmaps and keeps the old panes as a stale layer', async () => {
		const { engine } = createEngine()
		const fullSize = await settleNextBitmap()

		engine.setDetailScale(0.25)
		expect(
			engine.stalePanes?.panes.some((pane) => (pane.imageBitmap as unknown) === fullSize),
		).toBe(true)
		expect(engine.selectedX).toBe(0n)

		const next = pending.at(-1)
		expect(next?.options).toEqual({
			resizeHeight: Math.ceil(PANE_HEIGHT / 4),
			resizeQuality: 'high',
			resizeWidth: Math.ceil(PANE_WIDTH / 4),
		})
	})

	it('renders several panes per turn when given a time budget', () => {
		const engine = new ViewportEngine({
			onNeedRedraw() {
				// Nothing to draw in tests
			},
			onSelectionChange() {
				// Selection is covered elsewhere
			},
			renderBudgetMs: 1000,
			viewportHeight: 600,
			viewportWidth: 800,
		})
		engine.init()
		expect(pending.length).toBeGreaterThan(1)
	})
})

describe('coarse detail', () => {
	it('renders cells as their average brightness at an eighth scale or below', () => {
		const { engine } = createEngine()
		vi.mocked(renderPane).mockClear()
		vi.mocked(renderPaneCoarse).mockClear()

		engine.setDetailScale(0.125)
		expect(renderPaneCoarse).toHaveBeenCalled()
		expect(renderPane).not.toHaveBeenCalled()
		const size = vi.mocked(renderPaneCoarse).mock.calls.at(-1)?.[5]
		expect(size).toBe(Math.ceil(PANE_WIDTH / 8))

		// The coarse image is already small, so no resize is requested
		expect(pending.at(-1)?.options).toBeUndefined()
	})

	it('keeps lookups by grid cell consistent across pans and pruning', () => {
		const { engine } = createEngine()
		engine.centerOn(X_MAX / 2n, Y_MAX / 2n)
		for (let i = 0; i < 12; i++) {
			engine.movePanes(-PANE_WIDTH, -PANE_HEIGHT)
		}

		// No two panes share a position, and every position in range has one
		const positions = new Set(engine.panes.map((pane) => `${pane.x},${pane.y}`))
		expect(positions.size).toBe(engine.panes.length)
		const [reference] = engine.panes
		for (let x = reference!.x % PANE_WIDTH; x < engine.viewportWidth; x += PANE_WIDTH) {
			for (let y = reference!.y % PANE_HEIGHT; y < engine.viewportHeight; y += PANE_HEIGHT) {
				expect(positions.has(`${x},${y}`)).toBe(true)
			}
		}
	})
})
