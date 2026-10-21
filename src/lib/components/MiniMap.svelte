<script lang="ts">
	import type { EncodingMode } from '../pane-renderer'
	import { bigMap } from '../bigint-utils'
	import { X_MAX, Y_MAX } from '../constants'
	import { computeDensityMap, DENSITY_MAP_SIZE, getCoarseResolution } from '../density-map'

	type Props = {
		coarse: boolean
		color: string
		delta: bigint
		encodingMode: EncodingMode
		gap: number
		lineWidth: number
		onNavigate: (x: bigint, y: bigint) => void
		selectedX: bigint
		selectedY: bigint
	}

	let {
		coarse,
		color,
		delta,
		encodingMode,
		gap,
		lineWidth,
		onNavigate,
		selectedX,
		selectedY,
	}: Props = $props()

	let canvasElement: HTMLCanvasElement
	let isDragging = false

	// Crosshair position tracks the selection (as a percentage)
	const crosshairPct = $derived({
		x: Number(bigMap(selectedX, 0n, X_MAX, 0n, 10_000n)) / 100,
		y: Number(bigMap(selectedY, 0n, Y_MAX, 0n, 10_000n)) / 100,
	})

	// Re-render on encoding or coarseness changes. Delta is only read (and so
	// only tracked) in coarse mode, where it sets the sample resolution;
	// otherwise scrubbing the delta slider would redraw an identical map.
	$effect(() => {
		const resolution = coarse ? getCoarseResolution(delta) : DENSITY_MAP_SIZE
		drawDensityMap(computeDensityMap(resolution, encodingMode), resolution)
	})

	function drawDensityMap(pixels: Uint8ClampedArray<ArrayBuffer>, resolution: number): void {
		const context = canvasElement.getContext('2d')!

		// Draw at sample resolution then scale up to canvas size
		const temp = new OffscreenCanvas(resolution, resolution)
		const tempContext = temp.getContext('2d')!
		tempContext.putImageData(new ImageData(pixels, resolution, resolution), 0, 0)
		context.clearRect(0, 0, DENSITY_MAP_SIZE, DENSITY_MAP_SIZE)
		context.imageSmoothingEnabled = false
		context.drawImage(temp, 0, 0, DENSITY_MAP_SIZE, DENSITY_MAP_SIZE)
	}

	function navigateToPointer(event: PointerEvent): void {
		const rect = canvasElement.getBoundingClientRect()
		const normX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
		const normY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))

		const bigX = bigMap(BigInt(Math.round(normX * 10_000)), 0n, 10_000n, 0n, X_MAX)
		const bigY = bigMap(BigInt(Math.round(normY * 10_000)), 0n, 10_000n, 0n, Y_MAX)

		onNavigate(bigX, bigY)
	}

	function onPointerDown(event: PointerEvent): void {
		event.stopPropagation()
		isDragging = true
		canvasElement.setPointerCapture(event.pointerId)
		navigateToPointer(event)
	}

	function onPointerMove(event: PointerEvent): void {
		if (!isDragging) {
			return
		}

		event.stopPropagation()
		navigateToPointer(event)
	}

	function onPointerUp(event: PointerEvent): void {
		isDragging = false
		canvasElement.releasePointerCapture(event.pointerId)
	}
</script>

<div style:--ch-color={color} style:--ch-w="{lineWidth}px" class="minimap">
	<canvas
		bind:this={canvasElement}
		height={DENSITY_MAP_SIZE}
		onpointercancel={onPointerUp}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		width={DENSITY_MAP_SIZE}
	></canvas>
	<!-- Crosshair lines with center gap -->
	<div
		style:top="0"
		style:left="{crosshairPct.x}%"
		style:height="calc({crosshairPct.y}% - {gap}px)"
		class="ch ch-v"
	></div>
	<div
		style:bottom="0"
		style:left="{crosshairPct.x}%"
		style:height="calc({100 - crosshairPct.y}% - {gap}px)"
		class="ch ch-v"
	></div>
	<div
		style:top="{crosshairPct.y}%"
		style:left="0"
		style:width="calc({crosshairPct.x}% - {gap}px)"
		class="ch ch-h"
	></div>
	<div
		style:top="{crosshairPct.y}%"
		style:right="0"
		style:width="calc({100 - crosshairPct.x}% - {gap}px)"
		class="ch ch-h"
	></div>
	<div style:top="{crosshairPct.y}%" style:left="{crosshairPct.x}%" class="ch-dot"></div>
</div>

<style>
	.minimap {
		cursor: crosshair;
		position: relative;
		aspect-ratio: 1;
		width: 100%;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
	}

	.ch {
		pointer-events: none;
		position: absolute;
	}

	.ch-v {
		transform: translateX(calc(var(--ch-w) / -2));
		width: var(--ch-w);
		background: var(--ch-color);
	}

	.ch-h {
		transform: translateY(calc(var(--ch-w) / -2));
		height: var(--ch-w);
		background: var(--ch-color);
	}

	.ch-dot {
		pointer-events: none;
		position: absolute;
		transform: translate(calc(var(--ch-w) / -2), calc(var(--ch-w) / -2));
		width: var(--ch-w);
		height: var(--ch-w);
		background: var(--ch-color);
	}
</style>
