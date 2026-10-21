<script lang="ts">
	import { onMount } from 'svelte'
	import { on } from 'svelte/events'
	import { SvelteMap } from 'svelte/reactivity'
	import type { EncodingMode } from '../pane-renderer'
	import type { MappingMode } from '../pixel-mappings'
	import type { WheelAction } from '../state.svelte'
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
		ZOOM_MAX,
		ZOOM_MIN,
	} from '../constants'
	import { ViewportEngine } from '../viewport-engine'

	type Props = {
		accentColor: string
		backgroundColor: string
		delta: bigint
		dynamicReticle: boolean
		encodingMode: EncodingMode
		fixedReticle: boolean
		inertia: boolean
		lineWidth: number
		mappingMode: MappingMode
		onready?: () => void
		onselectionchange: (x: bigint, y: bigint) => void
		onzoomchange?: (zoom: number) => void
		placeholderColor: string
		wheelAction: WheelAction
		zoom: number
	}

	let {
		accentColor,
		backgroundColor,
		delta,
		dynamicReticle,
		encodingMode,
		fixedReticle,
		inertia,
		lineWidth,
		mappingMode,
		onready,
		onselectionchange,
		onzoomchange,
		placeholderColor,
		wheelAction,
		zoom,
	}: Props = $props()

	// Zooming out past this many panes would take seconds to render, so the zoom
	// floor rises with the window size instead
	const MAX_PANES = 6000
	/**
	 * Ratio between zoom levels below 1x, where levels aren't tied to device
	 * pixels
	 */
	const ZOOM_STEP_FACTOR = 1.25
	// Chrome reports a trackpad pinch as ctrl+wheel with deltaY near -100 per
	// doubling, so this maps the gesture onto zoom about 1:1
	const PINCH_WHEEL_SPEED = 0.01
	// Wheel events further apart than this start a new gesture
	const WHEEL_GESTURE_GAP_MS = 100
	// A wheel event with no follow-up within this time is a single mouse notch
	const WHEEL_NOTCH_HOLD_MS = 40
	// Scroll travel in a stream of events that amounts to one zoom level
	const WHEEL_TRAVEL_PER_LEVEL = 50
	/** Idle time before a non-integer zoom snaps to whole device pixels */
	const ZOOM_SETTLE_MS = 150
	const FRICTION = 0.97
	const MIN_VELOCITY = 0.1
	const FADE_SPEED = 0.16
	// Placeholders outline individual cells only while they're at least this
	// wide in device pixels and there aren't too many panes to draw; otherwise
	// each pane is one block
	const PLACEHOLDER_CELL_MIN_PX = 4
	const PLACEHOLDER_CELL_MAX_PANES = 150
	const RETICLE_DECAY = 0.93
	const DOUBLE_CLICK_SCROLL_MS = 400
	const KEY_SCROLL_MS = 200

	let containerElement: HTMLDivElement
	let canvasElement: HTMLCanvasElement
	let context: CanvasRenderingContext2D | undefined
	let engine: undefined | ViewportEngine = $state(undefined)
	let containerWidth = $state(0)
	let containerHeight = $state(0)
	let dpr = $state(globalThis.devicePixelRatio)
	let animFrameId: number
	let needsRedraw = true

	// The zoom actually rendered: the prop clamped to range and, above 1x, snapped
	// to whole device pixels. The stored zoom follows once zooming pauses.
	const zoomMin = $derived(
		Math.max(
			ZOOM_MIN,
			Math.sqrt((containerWidth * containerHeight) / (MAX_PANES * PANE_WIDTH * PANE_HEIGHT)),
		),
	)
	const effectiveZoom = $derived(snapZoom(clampZoom(zoom)))
	/** Device pixels per logical (image) pixel */
	const scale = $derived(effectiveZoom * dpr)
	// Pane bitmaps are held at the power-of-two fraction of full size that still
	// covers the device pixels they land on
	const detailScale = $derived(scale >= 1 ? 1 : 2 ** Math.ceil(Math.log2(scale)))
	// The engine works in logical pixels: the viewport as seen at the current zoom
	const logicalWidth = $derived(Math.max(1, Math.round(containerWidth / effectiveZoom)))
	const logicalHeight = $derived(Math.max(1, Math.round(containerHeight / effectiveZoom)))
	let lastLogical = { width: 0, height: 0 }

	// Sub-pixel remainder of motion not yet handed to the engine, so panning
	// and animation move at device-pixel resolution rather than in whole
	// logical pixels
	let subX = 0
	let subY = 0

	// Pointer state (drag with one pointer, pinch with two)
	const pointers = new SvelteMap<number, { x: number; y: number }>()
	let isDragging = $state(false)
	let dragPointerId: number | undefined
	let lastPointerX = 0
	let lastPointerY = 0
	let lastDragTime = 0
	let pinch:
		undefined | { lastCenter: { x: number; y: number }; startDistance: number; startZoom: number }

	// Inertia state (logical pixels per frame)
	let velocityX = 0
	let velocityY = 0

	// Smooth scroll animation state
	let scrollAnim:
		| undefined
		| {
				duration: number
				movedX: number
				movedY: number
				startTime: number
				totalX: number
				totalY: number
		  }

	function clampZoom(value: number): number {
		return Math.min(ZOOM_MAX, Math.max(zoomMin, value))
	}

	// Above 1x, snap so each image pixel covers a whole number of device pixels;
	// below 1x the canvas is downsampled with smoothing, so any value is fine
	function snapZoom(value: number): number {
		const deviceScale = value * dpr
		if (deviceScale < 1) {
			return value
		}

		const snapped = Math.round(deviceScale) / dpr
		return snapped < zoomMin ? Math.ceil(deviceScale) / dpr : snapped
	}

	// Rubber-band overscroll at the edges of the possibility space: dragging
	// past an edge meets growing resistance, and letting go (or coasting into
	// an edge) springs the content back
	const OVERSCROLL_RESISTANCE = 0.55
	// Spring constants per second; critically damped so it settles without
	// wobbling, in roughly 400 ms
	const OVERSCROLL_STIFFNESS = 120
	const OVERSCROLL_DAMPING = 2 * Math.sqrt(OVERSCROLL_STIFFNESS)
	type Axis = 'x' | 'y'
	// How far past the edge the content has been pulled, in logical pixels
	const overscroll = { x: 0, y: 0 }
	// Spring velocity in logical pixels per second
	const overscrollVelocity = { x: 0, y: 0 }
	let overscrollTime = 0

	// How far past the edge the content is drawn for a given pull: diminishing,
	// never reaching the viewport dimension
	function rubberBand(pull: number, dimension: number): number {
		const resisted = 1 - 1 / ((Math.abs(pull) * OVERSCROLL_RESISTANCE) / dimension + 1)
		return Math.sign(pull) * resisted * dimension
	}

	// Movement toward the content first unwinds any pull on that axis; returns
	// what's left for the engine
	function unwindOverscroll(amount: number, axis: Axis): number {
		const pull = overscroll[axis]
		if (pull === 0) {
			return amount
		}

		const remaining = pull + amount
		if (Math.sign(remaining) === Math.sign(pull)) {
			overscroll[axis] = remaining
			return 0
		}

		overscroll[axis] = 0
		return remaining
	}

	// An edge stopped part of a move. With overscroll allowed, the blocked
	// amount pulls the rubber band and any coasting velocity goes to the
	// spring; otherwise the momentum is simply dropped
	function blockedBy(amount: number, axis: Axis, allowOverscroll: boolean): void {
		const velocity = axis === 'x' ? velocityX : velocityY
		if (allowOverscroll) {
			overscroll[axis] += amount
			if (!isDragging) {
				// Inertia velocity is per frame; the spring runs per second
				overscrollVelocity[axis] = velocity * 60
			}
		}

		if (axis === 'x') {
			velocityX = 0
		} else {
			velocityY = 0
		}
	}

	// Spring any pull back to the edge once nothing is holding it
	function updateOverscroll(): boolean {
		const now = performance.now()
		const dt = Math.min(0.05, (now - overscrollTime) / 1000)
		overscrollTime = now

		const idle =
			overscroll.x === 0 &&
			overscroll.y === 0 &&
			overscrollVelocity.x === 0 &&
			overscrollVelocity.y === 0
		if (idle || isDragging || pinch !== undefined) {
			return false
		}

		for (const axis of ['x', 'y'] as const) {
			const acceleration =
				-OVERSCROLL_STIFFNESS * overscroll[axis] - OVERSCROLL_DAMPING * overscrollVelocity[axis]
			overscrollVelocity[axis] += acceleration * dt
			overscroll[axis] += overscrollVelocity[axis] * dt
			if (!(Math.abs(overscroll[axis]) < 0.5) || !(Math.abs(overscrollVelocity[axis]) < 20)) {
				continue
			}

			overscroll[axis] = 0
			overscrollVelocity[axis] = 0
		}

		return true
	}

	// Move the content by a fractional logical-pixel delta. Whole pixels go to
	// the engine, which clamps at the space's edges; the remainder is applied
	// when drawing. With `allowOverscroll`, movement an edge blocks pulls the
	// rubber band instead of vanishing
	function moveBy(dx: number, dy: number, allowOverscroll = false): void {
		if (!engine) {
			return
		}

		let moveX = dx
		let moveY = dy
		if (allowOverscroll) {
			moveX = unwindOverscroll(moveX, 'x')
			moveY = unwindOverscroll(moveY, 'y')
		}

		subX += moveX
		subY += moveY
		const wholeX = Math.round(subX)
		const wholeY = Math.round(subY)
		if (wholeX !== 0 || wholeY !== 0) {
			const applied = engine.movePanes(wholeX, wholeY)
			subX -= wholeX
			subY -= wholeY
			if (applied.x !== wholeX) {
				subX = 0
				blockedBy(wholeX - applied.x, 'x', allowOverscroll)
			}

			if (applied.y !== wholeY) {
				subY = 0
				blockedBy(wholeY - applied.y, 'y', allowOverscroll)
			}
		}

		needsRedraw = true
	}

	// Step to the next zoom level: whole device pixels per image pixel above 1x,
	// a fixed ratio below it
	function stepZoom(direction: -1 | 1): void {
		const deviceScale = effectiveZoom * dpr
		let next: number
		if (direction === 1) {
			next =
				deviceScale >= 1 ? Math.round(deviceScale) + 1 : Math.min(1, deviceScale * ZOOM_STEP_FACTOR)
		} else {
			next = deviceScale > 1 ? Math.round(deviceScale) - 1 : deviceScale / ZOOM_STEP_FACTOR
		}

		const newZoom = clampZoom(next / dpr)
		if (newZoom !== zoom) {
			onzoomchange?.(newZoom)
		}
	}

	// When scrolling zooms, an isolated wheel event is a mouse notch and steps
	// one level, while a stream of events (a trackpad, or a fast flick)
	// accumulates travel into levels. The first event of a gesture is held
	// briefly to see which it is. Events further apart than
	// WHEEL_GESTURE_GAP_MS belong to separate gestures.
	let wheelLastTime = 0
	let wheelStreaming = false
	let wheelTravel = 0
	let heldWheelDelta: number | undefined
	let wheelHoldTimer: ReturnType<typeof setTimeout> | undefined

	function zoomByTravel(deltaY: number): void {
		// A direction change starts a fresh count
		if (Math.sign(deltaY) !== Math.sign(wheelTravel)) {
			wheelTravel = 0
		}

		wheelTravel += Math.sign(deltaY) * Math.min(Math.abs(deltaY), WHEEL_TRAVEL_PER_LEVEL)
		while (Math.abs(wheelTravel) >= WHEEL_TRAVEL_PER_LEVEL) {
			stepZoom(wheelTravel < 0 ? 1 : -1)
			wheelTravel -= Math.sign(wheelTravel) * WHEEL_TRAVEL_PER_LEVEL
		}
	}

	function onWheel(event: WheelEvent): void {
		event.preventDefault()

		// A trackpad pinch arrives as ctrl+wheel and zooms continuously
		if (event.ctrlKey || event.metaKey) {
			const newZoom = clampZoom(zoom * Math.exp(-event.deltaY * PINCH_WHEEL_SPEED))
			if (newZoom !== zoom) {
				onzoomchange?.(newZoom)
			}

			return
		}

		if (wheelAction === 'pan') {
			cancelScrollAnim()
			cancelInertia()
			moveBy(-event.deltaX / effectiveZoom, -event.deltaY / effectiveZoom)
			return
		}

		const now = performance.now()
		if (now - wheelLastTime > WHEEL_GESTURE_GAP_MS) {
			clearTimeout(wheelHoldTimer)
			heldWheelDelta = undefined
			wheelStreaming = false
			wheelTravel = 0
		}

		wheelLastTime = now

		if (!wheelStreaming) {
			if (heldWheelDelta === undefined) {
				// First event of a gesture: wait to see whether more follow
				heldWheelDelta = event.deltaY
				wheelHoldTimer = setTimeout(() => {
					const held = heldWheelDelta ?? 0
					heldWheelDelta = undefined
					if (held !== 0) {
						stepZoom(held < 0 ? 1 : -1)
					}
				}, WHEEL_NOTCH_HOLD_MS)
				return
			}

			// A second event arrived during the hold, so this is a stream
			clearTimeout(wheelHoldTimer)
			wheelStreaming = true
			zoomByTravel(heldWheelDelta)
			heldWheelDelta = undefined
		}

		zoomByTravel(event.deltaY)
	}

	onMount(() => {
		context = canvasElement.getContext('2d') ?? undefined

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				containerWidth = entry.contentRect.width
				containerHeight = entry.contentRect.height
			}

			dpr = globalThis.devicePixelRatio
		})
		resizeObserver.observe(containerElement)

		// Re-arm a media query for the current ratio so moving the window to a
		// display with a different density is noticed
		let stopWatchingDensity: (() => void) | undefined

		function watchDensity(): void {
			stopWatchingDensity?.()
			const densityQuery = globalThis.matchMedia(`(resolution: ${globalThis.devicePixelRatio}dppx)`)
			stopWatchingDensity = on(densityQuery, 'change', onDensityChange)
		}

		function onDensityChange(): void {
			dpr = globalThis.devicePixelRatio
			watchDensity()
		}

		watchDensity()

		// Safari reports trackpad pinches as gesture events instead of ctrl+wheel,
		// and zooms the page unless they are cancelled
		let gestureStartZoom = 1
		const stopGestureStart = on(canvasElement, 'gesturestart', (event) => {
			event.preventDefault()
			gestureStartZoom = effectiveZoom
		})
		const stopGestureChange = on(canvasElement, 'gesturechange', (event) => {
			event.preventDefault()
			const { scale: gestureScale } = event as Event & { scale?: number }
			if (gestureScale === undefined || gestureScale <= 0) {
				return
			}

			const newZoom = clampZoom(gestureStartZoom * gestureScale)
			if (newZoom !== zoom) {
				onzoomchange?.(newZoom)
			}
		})

		return () => {
			resizeObserver.disconnect()
			stopWatchingDensity?.()
			stopGestureStart()
			stopGestureChange()
			clearTimeout(wheelHoldTimer)
			cancelAnimationFrame(animFrameId)
		}
	})

	// Create the engine once the container has a size
	$effect(() => {
		if (engine !== undefined || containerWidth <= 0 || containerHeight <= 0) {
			return
		}

		engine = new ViewportEngine({
			onNeedRedraw() {
				needsRedraw = true
			},
			onSelectionChange: onselectionchange,
			viewportHeight: logicalHeight,
			viewportWidth: logicalWidth,
		})
		lastLogical = { width: logicalWidth, height: logicalHeight }
		engine.init()
		startRenderLoop()
		onready?.()
	})

	// Resize the logical viewport when the container or zoom changes, shifting
	// the content so whatever was under the center stays there
	$effect(() => {
		const width = logicalWidth
		const height = logicalHeight
		if (!engine || (width === lastLogical.width && height === lastLogical.height)) {
			return
		}

		engine.setViewportSize(width, height)
		moveBy((width - lastLogical.width) / 2, (height - lastLogical.height) / 2)
		lastLogical = { width, height }
	})

	// Once zooming pauses, settle on whole device pixels (and within range)
	$effect(() => {
		const settled = effectiveZoom
		if (settled === zoom) {
			return
		}

		const timer = setTimeout(() => {
			onzoomchange?.(settled)
		}, ZOOM_SETTLE_MS)
		return () => clearTimeout(timer)
	})

	// React to delta changes (debounced to avoid expensive rebuilds while scrubbing)
	$effect(() => {
		const d = delta
		const timer = setTimeout(() => {
			engine?.setDelta(d)
		}, 50)
		return () => clearTimeout(timer)
	})

	$effect(() => {
		engine?.setMappingMode(mappingMode)
	})

	$effect(() => {
		engine?.setEncodingMode(encodingMode)
	})

	$effect(() => {
		engine?.setDetailScale(detailScale)
	})

	// Redraw when visual props change
	$effect(() => {
		accentColor
		backgroundColor
		placeholderColor
		lineWidth
		fixedReticle
		dynamicReticle
		scale
		needsRedraw = true
	})

	function startRenderLoop(): void {
		function frame(): void {
			if (context && engine) {
				const scrolling = updateScrollAnim()
				const coasting = updateInertia()
				const bouncing = updateOverscroll()
				const fading = updateFades()
				if (needsRedraw || fading || coasting || bouncing || scrolling) {
					draw()
					needsRedraw = false
				}
			}

			animFrameId = requestAnimationFrame(frame)
		}

		animFrameId = requestAnimationFrame(frame)
	}

	function updateInertia(): boolean {
		if (isDragging || pinch !== undefined || !inertia || !engine) {
			return false
		}

		if (Math.hypot(velocityX, velocityY) < MIN_VELOCITY) {
			velocityX = 0
			velocityY = 0
			return false
		}

		moveBy(velocityX, velocityY, true)
		velocityX *= FRICTION
		velocityY *= FRICTION
		return true
	}

	function updateFades(): boolean {
		if (!engine) {
			return false
		}

		let anyFading = false

		// Stale layer: hold at full opacity until new content renders, then snap away
		if (engine.stalePanes) {
			if (engine.panes.some((p) => p.imageBitmap)) {
				engine.disposeStale()
				// Snap all rendered new panes to full opacity (no ghost overlap)
				for (const pane of engine.panes) {
					if (pane.rendered) {
						pane.opacity = 1
					}
				}
			} else {
				anyFading = true
			}
		}

		// Fade in new panes (only during normal scroll/init, not during stale transition)
		for (const pane of engine.panes) {
			if (!pane.rendered || pane.opacity >= 1) {
				continue
			}

			pane.opacity = Math.min(1, pane.opacity + FADE_SPEED)
			if (pane.opacity < 1) {
				anyFading = true
			}
		}

		// Fade out inactive dynamic reticles
		for (let i = engine.reticles.length - 1; i >= 0; i--) {
			const r = engine.reticles[i]
			if (!r || r.active) {
				continue
			}

			r.opacity *= RETICLE_DECAY
			if (r.opacity < 0.01) {
				engine.reticles.splice(i, 1)
			} else {
				anyFading = true
			}
		}

		return anyFading
	}

	function draw(): void {
		if (!context || !engine) {
			return
		}

		// Back the canvas at device resolution so image pixels land on whole
		// device pixels; the 2D transform handles zoom
		const deviceWidth = Math.max(1, Math.round(containerWidth * dpr))
		const deviceHeight = Math.max(1, Math.round(containerHeight * dpr))
		if (canvasElement.width !== deviceWidth || canvasElement.height !== deviceHeight) {
			canvasElement.width = deviceWidth
			canvasElement.height = deviceHeight
		}

		// Above 1x the scale is a whole number of device pixels per image pixel, so
		// draw nearest-neighbor; below 1x smooth the downscale
		context.setTransform(scale, 0, 0, scale, 0, 0)
		context.imageSmoothingEnabled = scale < 1
		context.imageSmoothingQuality = 'high'

		const w = deviceWidth / scale
		const h = deviceHeight / scale
		context.fillStyle = backgroundColor
		context.fillRect(0, 0, w, h)

		// Snap a logical position to the device pixel grid
		const snap = (value: number) => Math.round(value * scale) / scale
		// Content offset: sub-pixel remainder plus any rubber-band pull
		const offsetX = subX + rubberBand(overscroll.x, logicalWidth)
		const offsetY = subY + rubberBand(overscroll.y, logicalHeight)

		// Draw stale panes (behind new panes, until the first new one renders)
		if (engine.stalePanes) {
			context.globalAlpha = engine.stalePanes.opacity
			for (const pane of engine.stalePanes.panes) {
				if (pane.imageBitmap) {
					context.drawImage(pane.imageBitmap, snap(pane.x), snap(pane.y), PANE_WIDTH, PANE_HEIGHT)
				}
			}
		}

		const visiblePanes = engine.getVisiblePanes()

		// Block in the cells of panes that haven't rendered yet, except during a
		// rebuild, when the stale layer stands in for them
		if (!engine.stalePanes) {
			drawPlaceholders(visiblePanes, offsetX, offsetY, snap)
		}

		// Draw current panes
		for (const pane of visiblePanes) {
			if (!pane.imageBitmap) {
				continue
			}

			context.globalAlpha = pane.opacity
			context.drawImage(
				pane.imageBitmap,
				snap(pane.x + offsetX),
				snap(pane.y + offsetY),
				PANE_WIDTH,
				PANE_HEIGHT,
			)
		}

		context.globalAlpha = 1

		// Keep reticles at least as thick on screen when zoomed out
		const strokeWidth = lineWidth / Math.min(1, effectiveZoom)

		// Dynamic reticles (in viewport space, move with content)
		if (dynamicReticle) {
			context.strokeStyle = accentColor
			context.lineWidth = strokeWidth
			for (const r of engine.reticles) {
				context.globalAlpha = r.opacity
				context.strokeRect(
					snap(r.x + offsetX) - 2.5,
					snap(r.y + offsetY) - 2.5,
					X_RES + 5,
					Y_RES + 5,
				)
			}

			context.globalAlpha = 1
		}

		// Fixed reticle (always at viewport center)
		if (!fixedReticle) {
			return
		}

		const imgLeft = Math.floor(logicalWidth / 2 - X_RES / 2)
		const imgTop = Math.floor(logicalHeight / 2 - Y_RES / 2)
		context.strokeStyle = accentColor
		context.lineWidth = strokeWidth
		context.strokeRect(imgLeft - 2.5, imgTop - 2.5, X_RES + 5, Y_RES + 5)
	}

	// Fill the cells of every pane in `panes` without a bitmap, trimmed to the
	// cells that exist in the space, as one path
	function drawPlaceholders(
		panes: ViewportEngine['panes'],
		offsetX: number,
		offsetY: number,
		snap: (value: number) => number,
	): void {
		if (!context || !engine) {
			return
		}

		const pending = panes.filter((pane) => !pane.imageBitmap)
		const perCell =
			CELL_WIDTH * scale >= PLACEHOLDER_CELL_MIN_PX && pending.length <= PLACEHOLDER_CELL_MAX_PANES
		const path = new Path2D()
		for (const pane of pending) {
			const cols = Math.min(PANE_X_COUNT, Number((X_MAX - pane.xPos) / engine.xDelta) + 1)
			const rows = Math.min(PANE_Y_COUNT, Number((Y_MAX - pane.yPos) / engine.yDelta) + 1)
			const left = snap(pane.x + offsetX)
			const top = snap(pane.y + offsetY)
			if (perCell) {
				for (let row = 0; row < rows; row++) {
					for (let col = 0; col < cols; col++) {
						path.rect(left + col * CELL_WIDTH, top + row * CELL_HEIGHT, X_RES, Y_RES)
					}
				}
			} else {
				path.rect(left, top, (cols - 1) * CELL_WIDTH + X_RES, (rows - 1) * CELL_HEIGHT + Y_RES)
			}
		}

		context.fillStyle = placeholderColor
		context.fill(path)
	}

	function pointerPair(): [{ x: number; y: number }, { x: number; y: number }] | undefined {
		const [a, b] = pointers.values()
		return a && b ? [a, b] : undefined
	}

	function beginPinch(): void {
		const pair = pointerPair()
		if (!pair) {
			return
		}

		const [a, b] = pair
		pinch = {
			lastCenter: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
			startDistance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
			startZoom: effectiveZoom,
		}
		isDragging = false
		dragPointerId = undefined
		velocityX = 0
		velocityY = 0
	}

	function updatePinch(): void {
		const pair = pointerPair()
		if (!pinch || !pair) {
			return
		}

		const [a, b] = pair
		const newZoom = clampZoom(
			(pinch.startZoom * Math.hypot(b.x - a.x, b.y - a.y)) / pinch.startDistance,
		)
		if (newZoom !== zoom) {
			onzoomchange?.(newZoom)
		}

		const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
		moveBy(
			(center.x - pinch.lastCenter.x) / effectiveZoom,
			(center.y - pinch.lastCenter.y) / effectiveZoom,
		)
		pinch.lastCenter = center
	}

	function onPointerDown(event: PointerEvent): void {
		if (event.pointerType === 'mouse' && event.button !== 0) {
			return
		}

		event.stopPropagation()
		canvasElement.setPointerCapture(event.pointerId)
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

		if (pointers.size >= 2) {
			beginPinch()
			return
		}

		cancelScrollAnim()
		isDragging = true
		dragPointerId = event.pointerId
		velocityX = 0
		velocityY = 0
		lastPointerX = event.clientX
		lastPointerY = event.clientY
		lastDragTime = performance.now()
	}

	function onPointerMove(event: PointerEvent): void {
		if (!pointers.has(event.pointerId)) {
			return
		}

		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
		event.stopPropagation()

		if (pinch) {
			updatePinch()
			return
		}

		if (!isDragging || event.pointerId !== dragPointerId) {
			return
		}

		// Screen movement to logical pixels so content tracks the pointer 1:1 at any zoom
		const dx = (event.clientX - lastPointerX) / effectiveZoom
		const dy = (event.clientY - lastPointerY) / effectiveZoom
		lastPointerX = event.clientX
		lastPointerY = event.clientY

		const now = performance.now()
		const dt = now - lastDragTime
		lastDragTime = now
		if (dt > 0 && dt < 100) {
			velocityX = 0.8 * dx + 0.2 * velocityX
			velocityY = 0.8 * dy + 0.2 * velocityY
		}

		moveBy(dx, dy, true)
	}

	function onPointerUp(event: PointerEvent): void {
		pointers.delete(event.pointerId)
		if (canvasElement.hasPointerCapture(event.pointerId)) {
			canvasElement.releasePointerCapture(event.pointerId)
		}

		if (pinch) {
			if (pointers.size < 2) {
				pinch = undefined
			}

			return
		}

		if (event.pointerId !== dragPointerId) {
			return
		}

		isDragging = false
		dragPointerId = undefined

		// Keep coasting only if the pointer was still moving when released
		if (inertia && !(performance.now() - lastDragTime > 100)) {
			return
		}

		velocityX = 0
		velocityY = 0
	}

	function cancelInertia(): void {
		velocityX = 0
		velocityY = 0
	}

	function cancelScrollAnim(): void {
		scrollAnim = undefined
	}

	// Animate the content by a logical-pixel offset, folding in any animation
	// still in flight
	function startScrollAnim(dx: number, dy: number, duration: number): void {
		const remainingX = scrollAnim ? scrollAnim.totalX - scrollAnim.movedX : 0
		const remainingY = scrollAnim ? scrollAnim.totalY - scrollAnim.movedY : 0
		cancelInertia()
		scrollAnim = {
			duration,
			movedX: 0,
			movedY: 0,
			startTime: performance.now(),
			totalX: dx + remainingX,
			totalY: dy + remainingY,
		}
		needsRedraw = true
	}

	function easeInOutCubic(t: number): number {
		return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
	}

	function updateScrollAnim(): boolean {
		if (!scrollAnim || !engine) {
			return false
		}

		const elapsed = performance.now() - scrollAnim.startTime
		const t = Math.min(elapsed / scrollAnim.duration, 1)
		const eased = easeInOutCubic(t)

		const targetX = scrollAnim.totalX * eased
		const targetY = scrollAnim.totalY * eased
		moveBy(targetX - scrollAnim.movedX, targetY - scrollAnim.movedY)
		scrollAnim.movedX = targetX
		scrollAnim.movedY = targetY

		if (t >= 1) {
			scrollAnim = undefined
			return false
		}

		return true
	}

	function onDblClick(event: MouseEvent): void {
		if (!engine) {
			return
		}

		const rect = canvasElement.getBoundingClientRect()
		const offsetX = subX + rubberBand(overscroll.x, logicalWidth)
		const offsetY = subY + rubberBand(overscroll.y, logicalHeight)
		const clickX = (event.clientX - rect.left) / effectiveZoom - offsetX
		const clickY = (event.clientY - rect.top) / effectiveZoom - offsetY

		// Find which pane contains the click
		for (const pane of engine.panes) {
			if (
				clickX >= pane.x &&
				clickX < pane.x + PANE_WIDTH &&
				clickY >= pane.y &&
				clickY < pane.y + PANE_HEIGHT
			) {
				// Find cell within pane
				const cellX = Math.floor((clickX - pane.x) / CELL_WIDTH)
				const cellY = Math.floor((clickY - pane.y) / CELL_HEIGHT)

				// Cell center in viewport coords
				const cellCenterX = pane.x + cellX * CELL_WIDTH + X_RES / 2 + offsetX
				const cellCenterY = pane.y + cellY * CELL_HEIGHT + Y_RES / 2 + offsetY

				const center = engine.viewportCenter()
				cancelScrollAnim()
				startScrollAnim(center.x - cellCenterX, center.y - cellCenterY, DOUBLE_CLICK_SCROLL_MS)
				return
			}
		}
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (event.altKey || event.ctrlKey || event.metaKey) {
			return
		}

		// Arrow keys step one cell; shift steps a whole pane
		const step = event.shiftKey ? PANE_WIDTH : CELL_WIDTH
		switch (event.key) {
			case '+':
			case '=': {
				stepZoom(1)
				break
			}

			case '-':
			case '_': {
				stepZoom(-1)
				break
			}

			case 'ArrowDown': {
				startScrollAnim(0, -step, KEY_SCROLL_MS)
				break
			}

			case 'ArrowLeft': {
				startScrollAnim(step, 0, KEY_SCROLL_MS)
				break
			}

			case 'ArrowRight': {
				startScrollAnim(-step, 0, KEY_SCROLL_MS)
				break
			}

			case 'ArrowUp': {
				startScrollAnim(0, step, KEY_SCROLL_MS)
				break
			}

			default: {
				return
			}
		}

		event.preventDefault()
	}

	/**
	 * Navigate the viewport so the given coordinate sits under the reticle.
	 *
	 * @param x - Coordinate encoded in the top half of the cell
	 * @param y - Coordinate encoded in the bottom half of the cell
	 */
	export function centerOn(x: bigint, y: bigint): void {
		cancelInertia()
		cancelScrollAnim()
		subX = 0
		subY = 0
		overscroll.x = 0
		overscroll.y = 0
		overscrollVelocity.x = 0
		overscrollVelocity.y = 0
		engine?.centerOn(x, y)
	}
</script>

<div bind:this={containerElement} class="viewport-frame">
	<canvas
		bind:this={canvasElement}
		class:dragging={isDragging}
		aria-label="Map of every 48 by 48 pixel image. Drag or use the arrow keys to pan, scroll or pinch to zoom, double-click an image to center it."
		ondblclick={onDblClick}
		onkeydown={onKeyDown}
		onpointercancel={onPointerUp}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onwheel={onWheel}
		tabindex="0"
	></canvas>
</div>

<style>
	.viewport-frame {
		position: absolute;
		inset: 0;
	}

	canvas {
		touch-action: none;
		cursor: grab;
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
	}

	/* The canvas is focusable for keyboard panning, but a focus ring around the
	   whole viewport only looks like a glitch; the reticle shows where focus is */
	canvas:focus-visible {
		outline: none;
	}

	canvas.dragging {
		cursor: grabbing;
	}
</style>
