import type { EncodingMode } from './pane-renderer'
import type { MappingMode } from './pixel-mappings'
import { distance } from './bigint-utils'
import {
	CELL_HEIGHT,
	CELL_WIDTH,
	PANE_HEIGHT,
	PANE_WIDTH,
	PANE_X_COUNT,
	PANE_Y_COUNT,
	X_MAX,
	X_RES,
	Y_MAX,
	Y_RES,
} from './constants'
import { renderPane, renderPaneCoarse } from './pane-renderer'

/**
 * Panning is clamped so the viewport center never leaves the possibility space.
 * An edge further away than this many cells can't be reached in a single move,
 * so the clamp is skipped there and the cell count stays within safe Number
 * range.
 */
const CLAMP_RANGE_CELLS = 1_000_000n

// Frame times that shrink or grow the per-frame render budget
const LONG_FRAME_MS = 24
const SHORT_FRAME_MS = 18
const MIN_RENDER_BUDGET_MS = 0.5

// At this detail scale or below, cells are a few device pixels wide and are
// rendered as their average brightness instead of their pixels
const COARSE_DETAIL_SCALE = 0.125

type PaneData = {
	/** Distance from viewport center, for render queue sorting */
	distanceFromCenter: number
	/** Cached ImageBitmap for fast canvas drawing */
	imageBitmap: ImageBitmap | undefined
	/** Cached rendered image (undefined until rendered) */
	imageData: ImageData | undefined
	/** Grid cell this pane occupies; stable while all panes shift together */
	key: string
	/** Opacity for fade-in (0 to 1) */
	opacity: number
	/** Whether this pane has been rendered */
	rendered: boolean
	/** Screen x position (pixels) */
	x: number
	/** BigInt coordinate of the top-left cell's X value */
	xPos: bigint
	/** Right-most X coordinate in this pane */
	xPosMax: bigint
	/** Screen y position (pixels) */
	y: number
	/** BigInt coordinate of the top-left cell's Y value */
	yPos: bigint
	/** Bottom-most Y coordinate in this pane */
	yPosMax: bigint
}

type DynamicReticle = {
	/** True = current selection, don't fade */
	active: boolean
	/** 1 = full, fades toward 0 */
	opacity: number
	/** Viewport pixel x (top-left of cell) */
	x: number
	/** Viewport pixel y */
	y: number
}

type ViewportEngineOptions = {
	onNeedRedraw: () => void
	onSelectionChange: (x: bigint, y: bigint) => void
	/** Most main-thread time to spend rendering panes per frame (default 8 ms) */
	renderBudgetMs?: number
	viewportHeight: number
	viewportWidth: number
}

/** One axis of the viewport and pane grid, as `clampAxis` needs it. */
type AxisGeometry = {
	/** Cell pitch in pixels */
	cellSize: number
	/** Viewport center along this axis */
	center: number
	/** Image size within a cell */
	imageSize: number
	/** Largest coordinate in the space */
	max: bigint
	/** A reference pane's pixel position */
	referencePixel: number
	/** That pane's first coordinate */
	referencePos: bigint
	/** Coordinate step between cells */
	step: bigint
}

/**
 * Clamp a one-axis pan so the viewport center stays between the first cell's
 * center and the last cell's center: the edge-most image can be dragged exactly
 * under the reticle but no further. Edges beyond `CLAMP_RANGE_CELLS` are left
 * unclamped.
 */
function clampAxis(delta: number, axis: AxisGeometry): number {
	const { cellSize, center, imageSize, max, referencePixel, referencePos, step } = axis
	let lower = -Infinity
	let upper = Infinity

	const cellsFromStart = referencePos / step
	if (cellsFromStart <= CLAMP_RANGE_CELLS) {
		const firstCenter = referencePixel - Number(cellsFromStart) * cellSize + imageSize / 2
		upper = center - firstCenter
	}

	const cellsToEnd = max / step - cellsFromStart
	if (cellsToEnd <= CLAMP_RANGE_CELLS) {
		const lastCenter = referencePixel + Number(cellsToEnd) * cellSize + imageSize / 2
		lower = center - lastCenter
	}

	return Math.round(Math.min(upper, Math.max(lower, delta)))
}

export class ViewportEngine {
	/**
	 * Fraction of full resolution for pane bitmaps, a power of two no larger than
	 *
	 * 1. When zoomed out there is no point holding more pixels than the screen
	 *    shows, so bitmaps shrink with the zoom.
	 */
	detailScale = 1
	encodingMode: EncodingMode = 'binary'
	mappingMode: MappingMode = 'original'
	onNeedRedraw: () => void
	onSelectionChange: (x: bigint, y: bigint) => void

	panes: PaneData[] = []
	renderQueue: PaneData[] = []
	reticles: DynamicReticle[] = []
	selectedX = 0n
	selectedY = 0n
	stalePanes: undefined | { opacity: number; panes: PaneData[] } = undefined
	viewportHeight: number
	viewportWidth: number

	xDelta = 1n

	xStart = 0n
	yDelta = 1n
	yStart = 0n

	private isRendering = false
	private lastTurnTime: number | undefined = undefined
	private readonly maxRenderBudgetMs: number
	// Pixel position of the pane grid's origin, shifted with every pan
	private originX = 0
	private originY = 0

	private readonly overdrawX = PANE_WIDTH
	private readonly overdrawY = PANE_HEIGHT
	// Panes by grid cell, for constant-time lookups however many there are
	private readonly paneGrid = new Map<string, PaneData>()
	private renderBudgetMs: number
	private renderGeneration = 0
	private resizeSupport: 'canvas' | 'native' | 'unknown' = 'unknown'

	constructor(options: ViewportEngineOptions) {
		this.maxRenderBudgetMs = options.renderBudgetMs ?? 8
		this.renderBudgetMs = this.maxRenderBudgetMs
		this.viewportWidth = options.viewportWidth
		this.viewportHeight = options.viewportHeight
		this.onSelectionChange = options.onSelectionChange
		this.onNeedRedraw = options.onNeedRedraw
	}

	/** Navigate to a specific coordinate. (Ports Window.centerOn) */
	centerOn(xCenter: bigint, yCenter: bigint): void {
		// Search existing panes for this coordinate
		for (const pane of this.panes) {
			if (
				xCenter >= pane.xPos &&
				xCenter <= pane.xPosMax &&
				yCenter >= pane.yPos &&
				yCenter <= pane.yPosMax
			) {
				// Found locally — compute offset to center this coordinate
				const xCellIndex = Number((xCenter - pane.xPos) / this.xDelta)
				const yCellIndex = Number((yCenter - pane.yPos) / this.yDelta)
				const center = this.viewportCenter()

				const xMove = Math.round(center.x - pane.x - xCellIndex * CELL_WIDTH - X_RES / 2)
				const yMove = Math.round(center.y - pane.y - yCellIndex * CELL_HEIGHT - Y_RES / 2)

				this.movePanes(xMove, yMove)
				return
			}
		}

		// Not found locally — warp (destroy all panes, rebuild)
		this.destroyAllPanes()

		this.selectedX = xCenter
		this.selectedY = yCenter
		this.computeStart(xCenter, yCenter)

		this.fillView()
		this.manageView()
		this.centerOn(xCenter, yCenter)
	}

	/** Dispose the stale pane snapshot, releasing its bitmaps. */
	disposeStale(): void {
		if (!this.stalePanes) {
			return
		}

		for (const pane of this.stalePanes.panes) {
			pane.imageBitmap?.close()
		}

		this.stalePanes = undefined
	}

	/** Return panes that are within the visible viewport area. */
	getVisiblePanes(): PaneData[] {
		return this.panes.filter(
			(p) =>
				p.x + PANE_WIDTH > 0 &&
				p.x < this.viewportWidth &&
				p.y + PANE_HEIGHT > 0 &&
				p.y < this.viewportHeight,
		)
	}

	/** Initialize the viewport with starting coordinates. */
	init(): void {
		this.fillView()
		this.manageView()
		this.centerOn(this.xStart, this.yStart)
	}

	/**
	 * Move all panes by a whole-pixel delta, clamped so the viewport center stays
	 * inside the possibility space. Returns the delta actually applied. (Ports
	 * Window.movePanes)
	 */
	movePanes(deltaX: number, deltaY: number): { x: number; y: number } {
		const applied = this.clampMove(deltaX, deltaY)

		this.originX += applied.x
		this.originY += applied.y

		// Shift all panes
		for (const pane of this.panes) {
			pane.x += applied.x
			pane.y += applied.y
		}

		// Shift dynamic reticles with panes
		for (const r of this.reticles) {
			r.x += applied.x
			r.y += applied.y
		}

		// Create new panes at edges, hide off-screen panes
		this.fillView()
		this.manageView()

		// Update selection to whichever cell the viewport center is over
		this.handleSelectionChange()

		this.onNeedRedraw()
		return applied
	}

	/**
	 * Render panes from the queue until the frame's budget is spent, then turn
	 * them into bitmaps. The budget adapts to the measured frame time, so a
	 * slower browser renders fewer panes per frame rather than dropping frames.
	 * Returns true if work was done.
	 */
	processRenderQueue(): boolean {
		if (this.renderQueue.length === 0) {
			this.isRendering = false
			this.lastTurnTime = undefined
			return false
		}

		this.isRendering = true
		const gen = this.renderGeneration
		const start = performance.now()
		this.adaptRenderBudget(start)

		const rendered: PaneData[] = []
		const size = Math.ceil(PANE_WIDTH * this.detailScale)
		const coarse = this.detailScale <= COARSE_DETAIL_SCALE
		do {
			const pane = this.renderQueue.shift()!
			pane.imageData = coarse
				? renderPaneCoarse(pane.xPos, pane.yPos, this.xDelta, this.yDelta, this.encodingMode, size)
				: renderPane(
						pane.xPos,
						pane.yPos,
						this.xDelta,
						this.yDelta,
						this.mappingMode,
						this.encodingMode,
					)
			pane.rendered = true
			rendered.push(pane)
		} while (this.renderQueue.length > 0 && performance.now() - start < this.renderBudgetMs)

		void Promise.all(
			rendered.map(async (pane) => {
				const bitmap = await this.createPaneBitmap(pane.imageData!)
				// Discard if the panes were rebuilt or this one was pruned meanwhile
				if (gen !== this.renderGeneration || this.paneGrid.get(pane.key) !== pane) {
					bitmap.close()
					return
				}

				pane.imageBitmap = bitmap
				// Free the CPU-side pixels; the bitmap is the only draw source
				pane.imageData = undefined
			}),
		).then(() => {
			if (gen !== this.renderGeneration) {
				return
			}

			this.onNeedRedraw()
			if (this.renderQueue.length > 0) {
				// Continue next frame: timers get clamped to 4 ms gaps when nested, and
				// one turn per frame keeps input responsive
				const next = () => {
					this.processRenderQueue()
				}

				if (typeof requestAnimationFrame === 'function') {
					requestAnimationFrame(next)
				} else {
					setTimeout(next, 0)
				}
			} else {
				this.isRendering = false
				this.lastTurnTime = undefined
			}
		})

		return true
	}

	/** Change the step size between cells. (Ports Window.setDelta) */
	setDelta(newDelta: bigint): void {
		if (newDelta === this.xDelta) {
			return
		}

		this.rebuildPanes()

		this.xDelta = newDelta
		this.yDelta = newDelta

		// Snap selected coordinates to nearest delta-aligned value
		// (for po2 deltas this just clears the low bits)
		if (newDelta > 1n) {
			this.selectedX = (this.selectedX / newDelta) * newDelta
			this.selectedY = (this.selectedY / newDelta) * newDelta
			if (this.selectedX > X_MAX) {
				this.selectedX = X_MAX
			}

			if (this.selectedY > Y_MAX) {
				this.selectedY = Y_MAX
			}
		}

		this.computeStart(this.selectedX, this.selectedY)

		this.fillView()
		this.manageView()
		this.centerOn(this.selectedX, this.selectedY)
	}

	/**
	 * Change the bitmap detail scale. Rebuilds all panes, keeping the current
	 * ones on screen until the first new bitmap is ready.
	 */
	setDetailScale(scale: number): void {
		if (scale === this.detailScale) {
			return
		}

		this.rebuildPanes()
		this.detailScale = scale
		this.computeStart(this.selectedX, this.selectedY)

		this.fillView()
		this.manageView()
		this.centerOn(this.selectedX, this.selectedY)
	}

	/** Change the bit encoding mode. Rebuilds all panes. */
	setEncodingMode(mode: EncodingMode): void {
		if (mode === this.encodingMode) {
			return
		}

		this.handleSelectionChange()
		this.encodingMode = mode
		this.destroyAllPanes()
		this.computeStart(this.selectedX, this.selectedY)

		this.fillView()
		this.manageView()
		this.centerOn(this.selectedX, this.selectedY)
	}

	/** Change the pixel mapping mode. Rebuilds all panes. */
	setMappingMode(mode: MappingMode): void {
		if (mode === this.mappingMode) {
			return
		}

		this.handleSelectionChange()
		this.mappingMode = mode
		this.destroyAllPanes()
		this.computeStart(this.selectedX, this.selectedY)

		this.fillView()
		this.manageView()
		this.centerOn(this.selectedX, this.selectedY)
	}

	/**
	 * Update viewport dimensions (on resize or zoom). Panes keep their positions,
	 * so the caller shifts them by half the size change to keep the content under
	 * the center fixed.
	 */
	setViewportSize(width: number, height: number): void {
		this.viewportWidth = width
		this.viewportHeight = height
		this.fillView()
		this.manageView()
		this.handleSelectionChange()
		this.onNeedRedraw()
	}

	/** Get the center point of the viewport in pixel coordinates. */
	viewportCenter(): { x: number; y: number } {
		return {
			x: this.viewportWidth / 2,
			y: this.viewportHeight / 2,
		}
	}

	/**
	 * Shrink or grow the per-frame render budget from the time since the last
	 * turn, which is the frame time while rendering is in progress.
	 */
	private adaptRenderBudget(now: number): void {
		if (this.lastTurnTime !== undefined) {
			const frame = now - this.lastTurnTime
			if (frame > LONG_FRAME_MS) {
				const floor = Math.min(MIN_RENDER_BUDGET_MS, this.maxRenderBudgetMs)
				this.renderBudgetMs = Math.max(floor, this.renderBudgetMs * 0.6)
			} else if (frame < SHORT_FRAME_MS) {
				this.renderBudgetMs = Math.min(this.maxRenderBudgetMs, this.renderBudgetMs * 1.25 + 0.25)
			}
		}

		this.lastTurnTime = now
	}

	/** Clamp a pan at the edges of the possibility space. */
	private clampMove(deltaX: number, deltaY: number): { x: number; y: number } {
		const reference = this.panes[0]
		if (reference === undefined) {
			return { x: deltaX, y: deltaY }
		}

		const center = this.viewportCenter()
		return {
			x: clampAxis(deltaX, {
				cellSize: CELL_WIDTH,
				center: center.x,
				imageSize: X_RES,
				max: X_MAX,
				referencePixel: reference.x,
				referencePos: reference.xPos,
				step: this.xDelta,
			}),
			y: clampAxis(deltaY, {
				cellSize: CELL_HEIGHT,
				center: center.y,
				imageSize: Y_RES,
				max: Y_MAX,
				referencePixel: reference.y,
				referencePos: reference.yPos,
				step: this.yDelta,
			}),
		}
	}

	/**
	 * Compute xStart/yStart so that the target coordinate falls near the center
	 * of the seed pane rather than at its top-left corner. This ensures panes
	 * tile symmetrically and the seed pane is always full.
	 */
	private computeStart(x: bigint, y: bigint): void {
		const paneSpanX = this.xDelta * BigInt(PANE_X_COUNT)

		// If the full range fits in one pane, start at 0 to show everything
		if (paneSpanX >= X_MAX) {
			this.xStart = 0n
			this.yStart = 0n
			return
		}

		const paneSpanY = this.yDelta * BigInt(PANE_Y_COUNT)
		const halfCells = BigInt(PANE_X_COUNT / 2)
		let xs = x - this.xDelta * halfCells
		let ys = y - this.yDelta * halfCells
		if (xs < 0n) {
			xs = 0n
		}

		if (ys < 0n) {
			ys = 0n
		}

		// Align to pane grid so tiling always covers 0…X_MAX
		this.xStart = (xs / paneSpanX) * paneSpanX
		this.yStart = (ys / paneSpanY) * paneSpanY
	}

	/**
	 * Create a pane's bitmap at the detail scale. Browsers that ignore the resize
	 * options get the downscale done through a canvas instead, so a zoomed-out
	 * view never composites hundreds of full-size bitmaps.
	 */
	private async createPaneBitmap(imageData: ImageData): Promise<ImageBitmap> {
		const size = Math.ceil(PANE_WIDTH * this.detailScale)
		// Full-size at full detail, or already rendered small by the coarse path
		if (size >= PANE_WIDTH || imageData.width !== PANE_WIDTH) {
			return createImageBitmap(imageData)
		}

		if (this.resizeSupport !== 'canvas') {
			const bitmap = await createImageBitmap(imageData, {
				resizeHeight: size,
				resizeQuality: 'high',
				resizeWidth: size,
			})
			if (bitmap.width === size) {
				this.resizeSupport = 'native'
				return bitmap
			}

			bitmap.close()
			this.resizeSupport = 'canvas'
		}

		const canvas = new OffscreenCanvas(size, size)
		const context = canvas.getContext('2d')!
		context.imageSmoothingQuality = 'high'
		const full = await createImageBitmap(imageData)
		context.drawImage(full, 0, 0, size, size)
		full.close()
		return canvas.transferToImageBitmap()
	}

	/** Release every pane's bitmap and start a fresh render generation. */
	private destroyAllPanes(): void {
		for (const pane of this.panes) {
			pane.imageBitmap?.close()
		}

		this.resetPaneState()
	}

	/**
	 * Create panes to cover the visible area plus overdraw. (Ports
	 * Window.fillView)
	 */
	private fillView(): void {
		const wasIdle = !this.isRendering

		// Walk the grid positions that cover the viewport plus overdraw
		const offsetX = this.originX % PANE_WIDTH
		const offsetY = this.originY % PANE_HEIGHT
		for (
			let i = offsetX - this.overdrawX;
			i < this.viewportWidth + offsetX + this.overdrawX;
			i += PANE_WIDTH
		) {
			for (
				let j = offsetY - this.overdrawY;
				j < this.viewportHeight + offsetY + this.overdrawY;
				j += PANE_HEIGHT
			) {
				const gridX = Math.round((i - this.originX) / PANE_WIDTH)
				const gridY = Math.round((j - this.originY) / PANE_HEIGHT)
				const key = `${gridX},${gridY}`
				if (this.paneGrid.has(key)) {
					continue
				}

				const referencePane = this.panes[0]
				let xTemp: bigint
				let yTemp: bigint
				let inBounds = true

				if (referencePane === undefined) {
					// Seed pane
					xTemp = this.xStart
					yTemp = this.yStart
				} else {
					// Calculate coordinate based on grid distance from any surviving
					// pane (pruning may have removed the original seed)
					xTemp =
						referencePane.xPos +
						this.xDelta * BigInt(((i - referencePane.x) / PANE_WIDTH) * PANE_X_COUNT)
					yTemp =
						referencePane.yPos +
						this.yDelta * BigInt(((j - referencePane.y) / PANE_HEIGHT) * PANE_Y_COUNT)

					// Bounds check
					inBounds = xTemp >= 0n && yTemp >= 0n && xTemp <= X_MAX && yTemp <= Y_MAX
				}

				if (!inBounds) {
					continue
				}

				const pane: PaneData = {
					distanceFromCenter: 0,
					imageBitmap: undefined,
					imageData: undefined,
					key,
					opacity: 0,
					rendered: false,
					x: i,
					xPos: xTemp,
					xPosMax: xTemp + this.xDelta * BigInt(PANE_X_COUNT),
					y: j,
					yPos: yTemp,
					yPosMax: yTemp + this.yDelta * BigInt(PANE_Y_COUNT),
				}

				this.panes.push(pane)
				this.paneGrid.set(key, pane)
				this.renderQueue.push(pane)
			}
		}

		this.sortRenderQueue()

		// Kick off rendering if engine was idle
		if (wasIdle && this.renderQueue.length > 0) {
			this.processRenderQueue()
		}
	}

	/**
	 * Determine which coordinate is nearest to the viewport center and update
	 * selection.
	 */
	private handleSelectionChange(): void {
		const firstPane = this.panes[0]
		if (firstPane === undefined) {
			return
		}

		const center = this.viewportCenter()

		// Find the nearest pane to the center (clamped distance)
		let bestPane = firstPane
		let bestDistance = Infinity
		for (const pane of this.panes) {
			const cx = Math.max(pane.x, Math.min(center.x, pane.x + PANE_WIDTH - 1))
			const cy = Math.max(pane.y, Math.min(center.y, pane.y + PANE_HEIGHT - 1))
			const d = (cx - center.x) ** 2 + (cy - center.y) ** 2
			if (!(d < bestDistance)) {
				continue
			}

			bestDistance = d
			bestPane = pane
		}

		// Pick the cell the viewport center is over (clamp when center is outside pane)
		const clampedX = Math.max(bestPane.x, Math.min(center.x, bestPane.x + PANE_WIDTH - 1))
		const clampedY = Math.max(bestPane.y, Math.min(center.y, bestPane.y + PANE_HEIGHT - 1))
		const xCell = Math.floor((clampedX - bestPane.x) / CELL_WIDTH)
		const yCell = Math.floor((clampedY - bestPane.y) / CELL_HEIGHT)

		this.selectedX = bestPane.xPos + this.xDelta * BigInt(xCell)
		this.selectedY = bestPane.yPos + this.yDelta * BigInt(yCell)

		// Update dynamic reticles
		const rx = bestPane.x + xCell * CELL_WIDTH
		const ry = bestPane.y + yCell * CELL_HEIGHT

		// Skip if there's already an active reticle at this position
		if (this.reticles.every((r) => !r.active || r.x !== rx || r.y !== ry)) {
			// Mark all existing reticles as inactive (start fading)
			for (const r of this.reticles) {
				r.active = false
			}

			this.reticles.push({ active: true, opacity: 1, x: rx, y: ry })
		}

		this.onSelectionChange(this.selectedX, this.selectedY)
	}

	/**
	 * Prune panes that drift far outside the viewport, bounding memory. (Ports
	 * Window.manageView)
	 */
	private manageView(): void {
		const marginX = this.overdrawX + PANE_WIDTH
		const marginY = this.overdrawY + PANE_HEIGHT
		const kept: PaneData[] = []
		let pruned = false

		for (const pane of this.panes) {
			const inRange =
				pane.x + PANE_WIDTH > -marginX &&
				pane.x < this.viewportWidth + marginX &&
				pane.y + PANE_HEIGHT > -marginY &&
				pane.y < this.viewportHeight + marginY
			if (inRange) {
				kept.push(pane)
			} else {
				pane.imageBitmap?.close()
				this.paneGrid.delete(pane.key)
				pruned = true
			}
		}

		if (!pruned) {
			return
		}

		this.panes = kept
		const keptSet = new Set(kept)
		this.renderQueue = this.renderQueue.filter((pane) => keptSet.has(pane))
	}

	/**
	 * Start over from the current selection, keeping any rendered panes as a
	 * stale layer so the screen doesn't go blank while the new ones render.
	 */
	private rebuildPanes(): void {
		this.handleSelectionChange()

		const hasRendered = this.panes.some((p) => p.imageBitmap)
		if (hasRendered) {
			this.disposeStale()
			this.stalePanes = { opacity: 1, panes: this.panes }
		} else {
			// Nothing rendered yet: release these and keep any existing stale layer
			for (const pane of this.panes) {
				pane.imageBitmap?.close()
			}
		}

		this.resetPaneState()
	}

	/**
	 * Forget all panes, queued work, and reticles. Bumping the render generation
	 * makes any in-flight bitmap from the old panes discard itself.
	 */
	private resetPaneState(): void {
		this.panes = []
		this.renderQueue = []
		this.reticles = []
		this.isRendering = false
		this.renderGeneration++
		this.originX = 0
		this.originY = 0
		this.paneGrid.clear()
	}

	/**
	 * Sort the render queue so the pane under the viewport center comes first,
	 * then its neighbors by how far their nearest edge is from the center.
	 */
	private sortRenderQueue(): void {
		const center = this.viewportCenter()
		for (const pane of this.renderQueue) {
			const nearestX = Math.max(pane.x, Math.min(center.x, pane.x + PANE_WIDTH))
			const nearestY = Math.max(pane.y, Math.min(center.y, pane.y + PANE_HEIGHT))
			pane.distanceFromCenter = distance(center.x, center.y, nearestX, nearestY)
		}

		this.renderQueue.sort((a, b) => a.distanceFromCenter - b.distanceFromCenter)
	}
}
