<script lang="ts">
	import type { ButtonGridClickEvent, TextareaChangeEvent } from 'svelte-tweakpane-ui'
	import {
		Button,
		ButtonGrid,
		Checkbox,
		Color,
		Element,
		Folder,
		List,
		Pane,
		Slider,
		Textarea,
	} from 'svelte-tweakpane-ui'
	import { on } from 'svelte/events'
	import CameraFeed from './components/CameraFeed.svelte'
	import MiniMap from './components/MiniMap.svelte'
	import Viewport from './components/Viewport.svelte'
	import { X_MAX, Y_MAX, ZOOM_MAX, ZOOM_MIN } from './constants'
	import { SLIDER_MAX } from './deltas'
	import { app } from './state.svelte'
	import { parseViewState, serializeViewState } from './url-state'

	const encodingOptions = [
		{ text: 'Binary', value: 'binary' },
		{ text: 'Gray Code', value: 'gray' },
	]
	const PANEL_WIDTH = 250
	const PANEL_INSET = 10
	const paneTheme = {
		baseFontFamily: 'system-ui, sans-serif',
		bladeValueWidth: 'calc(100% - 6rem)',
	}

	// The advanced pane sits in the top-right corner, following window resizes
	let windowWidth = $state(0)
	const advancedX = $derived(Math.max(0, windowWidth - PANEL_WIDTH - PANEL_INSET))

	const wheelActionOptions = [
		{ text: 'Zooms', value: 'zoom' },
		{ text: 'Pans', value: 'pan' },
	]
	const mappingOptions = [
		{ text: 'Original', value: 'original' },
		{ text: 'Spiral', value: 'spiral' },
		{ text: 'Checkerboard', value: 'checkerboard' },
		{ text: 'Radial', value: 'radial' },
		{ text: 'Hilbert', value: 'hilbert' },
		{ text: 'Scattered', value: 'scattered' },
		{ text: 'Triangle', value: 'triangle' },
		{ text: 'Triangle Alt', value: 'triangleAlt' },
	]

	let viewportRef: undefined | { centerOn: (x: bigint, y: bigint) => void } = $state(undefined)
	let cameraRef: undefined | { capture: () => void } = $state(undefined)
	let cameraReady = $state(false)

	function navigate(x: bigint, y: bigint): void {
		viewportRef?.centerOn(x, y)
	}

	const navButtons = ['↖', '↑', '↗', '←', '·', '→', '↙', '↓', '↘']
	const navTargets: Array<[bigint, bigint]> = [
		[0n, 0n],
		[X_MAX / 2n, 0n],
		[X_MAX, 0n],
		[0n, Y_MAX / 2n],
		[X_MAX / 2n, Y_MAX / 2n],
		[X_MAX, Y_MAX / 2n],
		[0n, Y_MAX],
		[X_MAX / 2n, Y_MAX],
		[X_MAX, Y_MAX],
	]

	function handleNavClick(event: ButtonGridClickEvent): void {
		const target = navTargets[event.detail.index]
		if (target === undefined) {
			return
		}

		const [x, y] = target
		navigate(x, y)
	}

	// The URL hash carries the possibility number plus any non-default
	// settings, so a reload or shared link reproduces the view. Writes wait
	// for the view to settle: Safari throws after 100 replaceState calls in
	// 30 seconds, which a drag would exceed.
	const HASH_WRITE_DELAY = 300
	let hashSynced = $state(false)
	let lastWrittenHash = ''

	function applyHash(hash: string): void {
		const view = parseViewState(hash)
		if (view.mappingMode !== undefined) {
			app.mappingMode = view.mappingMode
		}

		if (view.encodingMode !== undefined) {
			app.encodingMode = view.encodingMode
		}

		if (view.deltaSliderValue !== undefined) {
			app.deltaSliderValue = view.deltaSliderValue
		}

		if (view.zoom !== undefined) {
			app.zoom = view.zoom
		}

		if (view.cameraAutoStart !== undefined) {
			app.cameraAutoStart = view.cameraAutoStart
		}

		if (view.index === undefined) {
			return
		}

		app.selectedIndex = view.index
		navigate(app.selectedX, app.selectedY)
	}

	// Read the hash once the viewport engine is ready
	function readHash(): void {
		applyHash(globalThis.location.hash)
		hashSynced = true
	}

	// Respond to user-initiated hash changes (manual URL edits, back/forward)
	function onHashChange(): void {
		const hash = globalThis.location.hash.slice(1)
		if (hash !== lastWrittenHash) {
			applyHash(hash)
		}
	}

	$effect(() => on(globalThis, 'hashchange', onHashChange))

	$effect(() => {
		if (!hashSynced) {
			return
		}

		const hash = serializeViewState({
			cameraAutoStart: app.cameraAutoStart,
			deltaSliderValue: app.deltaSliderValue,
			encodingMode: app.encodingMode,
			index: app.selectedIndex,
			mappingMode: app.mappingMode,
			zoom: app.zoom,
		})
		if (hash === lastWrittenHash) {
			return
		}

		const timer = setTimeout(() => {
			lastWrittenHash = hash
			history.replaceState(undefined, '', '#' + hash)
		}, HASH_WRITE_DELAY)
		return () => clearTimeout(timer)
	})

	// The possibility number field updates live while navigating, and an edit
	// navigates once typing pauses, so the view doesn't warp on every keystroke
	// and the text isn't reformatted under the caret
	const POSITION_COMMIT_DELAY = 500
	let positionText = $state(app.formattedPosition)
	let editingPosition = false
	let positionCommitTimer: ReturnType<typeof setTimeout> | undefined

	$effect(() => {
		const formatted = app.formattedPosition
		if (!editingPosition) {
			positionText = formatted
		}
	})

	function handlePositionChange(event: TextareaChangeEvent): void {
		if (event.detail.origin !== 'internal') {
			return
		}

		editingPosition = true
		clearTimeout(positionCommitTimer)
		positionCommitTimer = setTimeout(() => {
			editingPosition = false
			app.formattedPosition = positionText
			navigate(app.selectedX, app.selectedY)
			positionText = app.formattedPosition
		}, POSITION_COMMIT_DELAY)
	}
</script>

<svelte:window bind:innerWidth={windowWidth} />

<div class="all-thumbs">
	<Viewport
		bind:this={viewportRef}
		accentColor={app.accentColor}
		backgroundColor={app.backgroundColor}
		delta={app.delta}
		dynamicReticle={app.dynamicReticle}
		encodingMode={app.encodingMode}
		fixedReticle={app.fixedReticle}
		inertia={app.inertia}
		lineWidth={app.reticleThickness}
		mappingMode={app.mappingMode}
		onready={readHash}
		onselectionchange={(x: bigint, y: bigint) => {
			app.selectedX = x
			app.selectedY = y
		}}
		onzoomchange={(z: number) => {
			app.zoom = z
		}}
		placeholderColor={app.placeholderColor}
		wheelAction={app.wheelAction}
		zoom={app.zoom}
	/>

	<Pane
		position="draggable"
		storePositionLocally={false}
		theme={paneTheme}
		title="All Thumbs"
		width={PANEL_WIDTH}
		x={PANEL_INSET}
		y={PANEL_INSET}
	>
		<Folder
			description="The whole space, shaded by how many pixels are white. Click or drag to jump there."
			title="Possibility Map"
		>
			<Element>
				<MiniMap
					coarse={app.coarseMinimap}
					color={app.accentColor}
					delta={app.delta}
					encodingMode={app.encodingMode}
					gap={app.crosshairGap}
					lineWidth={app.crosshairThickness}
					onNavigate={navigate}
					selectedX={app.selectedX}
					selectedY={app.selectedY}
				/>
			</Element>
		</Folder>
		<Folder title="Navigation">
			<List
				description="How the two coordinates' bits are arranged into pixels."
				label="Layout"
				options={mappingOptions}
				bind:value={app.mappingMode}
			/>
			<Slider
				description="Distance between neighboring images, from a single step up to the whole space."
				label="Delta"
				max={SLIDER_MAX}
				min={0}
				step={1}
				bind:value={app.deltaSliderValue}
			/>
			<Slider
				description="Magnification. Above 1× it snaps to whole screen pixels so images stay crisp."
				format={(value: number) => `${value.toFixed(2)}×`}
				label="Zoom"
				max={ZOOM_MAX}
				min={ZOOM_MIN}
				bind:value={app.zoom}
			/>
			<ButtonGrid
				buttons={navButtons}
				columns={3}
				description="Jump to the corners, edges, or center of the space."
				label="Go to"
				on:click={handleNavClick}
			/>
		</Folder>
		<Folder
			description="Point the camera at something to find that picture in the space."
			title="Camera"
		>
			{#if app.cameraEnabled}
				<Element>
					<CameraFeed
						bind:this={cameraRef}
						autoShutter={app.autoShutter}
						autoShutterInterval={app.autoShutterInterval}
						autoStart={app.cameraAutoStart}
						autoThreshold={app.autoThreshold}
						cameraOverlay={app.cameraOverlay}
						encodingMode={app.encodingMode}
						mappingMode={app.mappingMode}
						oncapture={navigate}
						onreadychange={(ready: boolean) => {
							cameraReady = ready
						}}
						onthresholdchange={(t: number) => {
							app.threshold = 256 - t
						}}
						threshold={256 - app.threshold}
					/>
				</Element>
			{/if}
			<Button disabled={!cameraReady} title="Search" on:click={() => cameraRef?.capture()} />
		</Folder>
		<Folder
			description="This image's number, counting from 1 at solid black. Type a number to jump there."
			expanded={false}
			title="Possibility Number"
		>
			<Textarea
				live={true}
				placeholder="Enter possibility number…"
				rows={10}
				bind:value={positionText}
				on:change={handlePositionChange}
			/>
		</Folder>
		<Checkbox
			description="Open a second panel with the fine-tuning controls."
			label="Show Advanced"
			bind:value={app.showAdvanced}
		/>
		<Element resetStyle={false}>
			<a
				class="about-link"
				href="https://frontiernerds.com/projects/all-thumbs"
				rel="noopener noreferrer"
				target="_blank"
			>
				About
				<svg
					class="external-icon"
					aria-hidden="true"
					fill="none"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					viewBox="0 0 24 24"
				>
					<path d="M14 4h6v6" />
					<path d="M20 4 10 14" />
					<path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
				</svg>
				<span class="visually-hidden">(opens in a new tab)</span>
			</a>
		</Element>
	</Pane>

	{#if app.showAdvanced}
		<Pane
			position="draggable"
			storePositionLocally={false}
			theme={paneTheme}
			title="Advanced"
			width={PANEL_WIDTH}
			x={advancedX}
			y={PANEL_INSET}
		>
			<Checkbox
				description="Show the camera feed and its controls."
				label="Camera"
				bind:value={app.cameraEnabled}
			/>
			<Checkbox
				description="Start the camera as soon as the page loads instead of waiting for a click. Saved in the URL as camera=1, for installations."
				label="Camera on Load"
				bind:value={app.cameraAutoStart}
			/>
			<Slider
				description="How much the black and white preview covers the live feed."
				label="B&W Overlay"
				max={1}
				min={0}
				step={0.01}
				bind:value={app.cameraOverlay}
			/>
			<Slider
				description="Brightness cutoff between black and white pixels."
				disabled={app.autoThreshold}
				label="Threshold"
				max={256}
				min={0}
				step={1}
				bind:value={app.threshold}
			/>
			<Checkbox
				description="Set the cutoff to each frame's median brightness."
				label="Auto Threshold"
				bind:value={app.autoThreshold}
			/>
			<Checkbox
				description="Search for the camera image on a timer."
				label="Auto Shutter"
				bind:value={app.autoShutter}
			/>
			<Slider
				description="Seconds between automatic searches."
				format={(value: number) => `${value.toFixed(2)} s`}
				label="Shutter Interval"
				max={5}
				min={0.01}
				step={0.01}
				bind:value={app.autoShutterInterval}
			/>
			<List
				description="Binary counts up normally. Gray code changes exactly one pixel per step."
				label="Encoding"
				options={encodingOptions}
				bind:value={app.encodingMode}
			/>
			<Checkbox
				description="Shade the map with one sample per reachable image at the current delta."
				label="Coarse Map"
				bind:value={app.coarseMinimap}
			/>
			<List
				description="What the mouse wheel or a two-finger scroll does. Pinch and ctrl+scroll always zoom."
				label="Scroll"
				options={wheelActionOptions}
				bind:value={app.wheelAction}
			/>
			<Checkbox
				description="Keep coasting after a drag."
				label="Inertia"
				bind:value={app.inertia}
			/>
			<Color
				description="Color of the reticle and map crosshair."
				label="Accent Color"
				bind:value={app.accentColor}
			/>
			<Color
				description="Shown between images and past the edges of the space."
				label="Background"
				bind:value={app.backgroundColor}
			/>
			<Color
				description="Blocks in images that haven't rendered yet."
				label="Placeholder"
				bind:value={app.placeholderColor}
			/>
			<Checkbox
				description="Outline the image under the center of the view."
				label="Fixed Reticle"
				bind:value={app.fixedReticle}
			/>
			<Checkbox
				description="Outline the selected image as it moves and fade out the previous ones."
				label="Dynamic Reticle"
				bind:value={app.dynamicReticle}
			/>
			<Slider
				description="Reticle line thickness."
				label="Reticle"
				max={10}
				min={0}
				step={0.25}
				bind:value={app.reticleThickness}
			/>
			<Slider
				description="Map crosshair line thickness."
				label="Crosshair"
				max={10}
				min={0}
				step={0.25}
				bind:value={app.crosshairThickness}
			/>
			<Slider
				description="Opening at the center of the map crosshair."
				label="Crosshair Gap"
				max={20}
				min={0}
				step={0.5}
				bind:value={app.crosshairGap}
			/>
		</Pane>
	{/if}
</div>

<style>
	.all-thumbs {
		position: relative;
		overflow: hidden;
		width: 100%;
		height: 100%;
		background: #2f3439;
	}

	/* A full-width link styled like a Tweakpane button, using its theme variables */
	.about-link {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		justify-content: center;
		height: var(--cnt-usz);
		border-radius: var(--bld-br);
		font-weight: bold;
		line-height: var(--cnt-usz);
		color: var(--btn-fg);
		text-decoration: none;
		background: var(--btn-bg);
	}

	@media (hover: hover) {
		.about-link:hover {
			background: var(--btn-bg-h);
		}
	}

	.about-link:focus-visible {
		background: var(--btn-bg-f);
		outline: none;
	}

	.about-link:active {
		background: var(--btn-bg-a);
	}

	.external-icon {
		width: 12px;
		height: 12px;
	}

	.visually-hidden {
		position: absolute;
		overflow: hidden;
		width: 1px;
		height: 1px;
		white-space: nowrap;
		clip-path: inset(50%);
	}

	/* Tabular figures in value fields so digits don't jiggle */
	:global(.tp-txtv_i),
	:global(.tp-mntv_t),
	:global(.tp-lstv_s) {
		font-variant-numeric: tabular-nums !important;
	}

	:global(.tp-rotv_t) {
		font-weight: bold !important;
	}

	:global(.tp-dfwv),
	:global(.tp-rotv) {
		user-select: none !important;
	}

	/* The pane's width-drag glyph (↔) is drawn at 1.5em by the library; 80% of that */
	:global(.tp-custom-width-handle) {
		font-size: 1.2em !important;
	}

	/* Popups are capped at the blade value width, but our width is a percentage
	   of the row, and inside the value column it shrinks them again */
	:global(.tp-popv) {
		max-width: none !important;
	}
</style>
