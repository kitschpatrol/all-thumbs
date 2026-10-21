<script lang="ts">
	import { onMount } from 'svelte'
	import type { EncodingMode } from '../pane-renderer'
	import type { MappingMode } from '../pixel-mappings'
	import { grayDecode } from '../bigint-utils'
	import { getPixelMapping } from '../pixel-mappings'

	type Props = {
		autoShutter: boolean
		// Seconds between automatic captures while the shutter is on
		autoShutterInterval: number
		/**
		 * Start the camera (prompting for permission) as soon as the component
		 * mounts
		 */
		autoStart: boolean
		autoThreshold: boolean
		cameraOverlay: number
		encodingMode: EncodingMode
		mappingMode: MappingMode
		oncapture: (x: bigint, y: bigint) => void
		// Reports whether frames are flowing and a capture would succeed
		onreadychange?: (ready: boolean) => void
		onthresholdchange: (threshold: number) => void
		threshold: number
	}

	let {
		autoShutter,
		autoShutterInterval,
		autoStart,
		autoThreshold,
		cameraOverlay,
		encodingMode,
		mappingMode,
		oncapture,
		onreadychange,
		onthresholdchange,
		threshold,
	}: Props = $props()

	const CAPTURE_WIDTH = 48
	const CAPTURE_HEIGHT = 48
	const CAPTURE_PIXEL_COUNT = CAPTURE_WIDTH * CAPTURE_HEIGHT
	const DISPLAY_SCALE = 2.5
	// The shutter flash fades over this long; an auto shutter firing faster than
	// that skips it rather than strobe
	const FLASH_DURATION_MS = 800

	type CameraState = 'active' | 'busy' | 'checking' | 'denied' | 'idle' | 'insecure' | 'unavailable'

	function getCameraHelpUrl(): string {
		const ua = navigator.userAgent
		if (ua.includes('Firefox')) {
			return 'https://support.mozilla.org/en-US/kb/how-manage-your-camera-and-microphone-permissions'
		}

		if (ua.includes('Edg/')) {
			return 'https://support.microsoft.com/en-us/microsoft-edge/manage-camera-and-microphone-permissions-in-microsoft-edge-59498c41-d666-4a53-a80d-40d46f0c2609'
		}

		return ua.includes('Safari/') && !ua.includes('Chrome')
			? 'https://support.apple.com/guide/safari/websites-ibrwe2159f50/mac'
			: 'https://support.google.com/chrome/answer/2693767'
	}

	/**
	 * Map a getUserMedia failure to the status the UI should show.
	 *
	 * @param error - Rejection value from `getUserMedia`, usually a
	 *   `DOMException`
	 *
	 * @returns The status to show for this failure
	 */
	function classifyCameraError(error: unknown): CameraState {
		const name = error instanceof DOMException ? error.name : ''
		switch (name) {
			case 'AbortError':
			case 'NotReadableError': {
				return 'busy'
			}

			case 'NotAllowedError':
			case 'SecurityError': {
				return 'denied'
			}

			default: {
				return 'unavailable'
			}
		}
	}

	/**
	 * Luminance (Rec. 601 weights) of the RGBA pixel at `index`.
	 *
	 * @param data - RGBA pixel buffer
	 * @param index - Pixel index (not byte offset)
	 *
	 * @returns Luminance from 0 to 255
	 */
	function luminanceAt(data: Uint8ClampedArray, index: number): number {
		const offset = index * 4
		return Math.round(
			0.299 * (data[offset] ?? 0) +
				0.587 * (data[offset + 1] ?? 0) +
				0.114 * (data[offset + 2] ?? 0),
		)
	}

	let colorCanvasElement: HTMLCanvasElement = $state()!
	let displayCanvasElement: HTMLCanvasElement = $state()!
	let videoElement: HTMLVideoElement = $state()!
	let captureCanvas: OffscreenCanvas
	let captureContext: OffscreenCanvasRenderingContext2D
	let processedCanvas: OffscreenCanvas
	let processedContext: OffscreenCanvasRenderingContext2D
	let processedImage: ImageData
	let colorContext: CanvasRenderingContext2D
	let displayContext: CanvasRenderingContext2D
	let stream: MediaStream | undefined
	let shutterInterval: ReturnType<typeof setInterval> | undefined
	let animFrameId: number
	// Aborted on unmount so in-flight camera setup can bail out
	const lifecycle = new AbortController()
	// Browsers only expose the camera in secure contexts (HTTPS or localhost)
	let cameraState: CameraState = $state(globalThis.isSecureContext ? 'idle' : 'insecure')
	let cameraReady = $state(false)
	let fadeIn = $state(false)
	let flashElement: HTMLDivElement = $state()!
	const luminances = new Uint8Array(CAPTURE_PIXEL_COUNT)

	// A function call, not a property read, so TypeScript doesn't narrow the
	// flag to `false` across the awaits in startCamera
	function isDisposed(): boolean {
		return lifecycle.signal.aborted
	}

	function stopStream(target: MediaStream | undefined): void {
		const tracks = target?.getTracks() ?? []
		for (const track of tracks) {
			track.stop()
		}
	}

	function releaseCamera(): void {
		lifecycle.abort()
		cancelAnimationFrame(animFrameId)
		if (shutterInterval !== undefined) {
			clearInterval(shutterInterval)
		}

		stopStream(stream)
		stream = undefined
	}

	onMount(() => {
		captureCanvas = new OffscreenCanvas(CAPTURE_WIDTH, CAPTURE_HEIGHT)
		captureContext = captureCanvas.getContext('2d', { willReadFrequently: true })!
		processedCanvas = new OffscreenCanvas(CAPTURE_WIDTH, CAPTURE_HEIGHT)
		processedContext = processedCanvas.getContext('2d')!
		processedImage = new ImageData(CAPTURE_WIDTH, CAPTURE_HEIGHT)

		return releaseCamera
	})

	// Installations start the camera without a click; otherwise it waits for the
	// placeholder button so nobody is asked for permission just to look around
	$effect(() => {
		if (autoStart && cameraState === 'idle') {
			void requestCamera()
		}
	})

	$effect(() => {
		onreadychange?.(cameraReady)
		return () => {
			onreadychange?.(false)
		}
	})

	// Manage auto-shutter timer
	$effect(() => {
		if (shutterInterval !== undefined) {
			clearInterval(shutterInterval)
			shutterInterval = undefined
		}

		if (!autoShutter || !cameraReady) {
			return
		}

		const intervalMs = autoShutterInterval * 1000
		const showFlash = intervalMs >= FLASH_DURATION_MS
		shutterInterval = setInterval(() => {
			captureFrame(showFlash)
		}, intervalMs)
	})

	async function requestCamera(): Promise<void> {
		if (!globalThis.isSecureContext) {
			cameraState = 'insecure'
			return
		}

		cameraState = 'checking'
		await startCamera()
	}

	async function startCamera(): Promise<void> {
		let newStream: MediaStream
		try {
			newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
		} catch (error) {
			cameraState = classifyCameraError(error)
			return
		}

		// The component may have unmounted while the permission prompt was open
		if (isDisposed()) {
			stopStream(newStream)
			return
		}

		stream = newStream
		cameraState = 'active'

		// Wait a frame so the canvases are mounted before grabbing contexts
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => {
				resolve()
			})
		})
		if (isDisposed()) {
			return
		}

		colorContext = colorCanvasElement.getContext('2d')!
		colorContext.imageSmoothingEnabled = false
		displayContext = displayCanvasElement.getContext('2d')!
		displayContext.imageSmoothingEnabled = false

		videoElement.srcObject = stream
		try {
			await videoElement.play()
		} catch {
			if (!isDisposed()) {
				cameraState = 'unavailable'
			}

			return
		}

		if (isDisposed()) {
			return
		}

		cameraReady = true
		startUpdateLoop()
		// Trigger B&W overlay fade-in on next frame
		requestAnimationFrame(() => {
			fadeIn = true
		})
	}

	function startUpdateLoop(): void {
		function frame(): void {
			updateCameraFrame()
			animFrameId = requestAnimationFrame(frame)
		}

		animFrameId = requestAnimationFrame(frame)
	}

	function getSquareCrop(): { size: number; sx: number; sy: number } {
		const vw = videoElement.videoWidth
		const vh = videoElement.videoHeight
		const size = Math.min(vw, vh)
		return { size, sx: (vw - size) / 2, sy: (vh - size) / 2 }
	}

	function updateCameraFrame(): void {
		if (!cameraReady) {
			return
		}

		const { size, sx, sy } = getSquareCrop()
		captureContext.drawImage(videoElement, sx, sy, size, size, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT)

		// Color underlay always updates live
		colorContext.drawImage(captureCanvas, 0, 0, colorCanvasElement.width, colorCanvasElement.height)

		const rawData = captureContext.getImageData(0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT)

		let effectiveThreshold = threshold

		if (autoThreshold) {
			for (let i = 0; i < CAPTURE_PIXEL_COUNT; i++) {
				luminances[i] = luminanceAt(rawData.data, i)
			}

			luminances.sort()
			effectiveThreshold = luminances[CAPTURE_PIXEL_COUNT / 2] ?? 0
			onthresholdchange(effectiveThreshold)
		}

		const { data } = processedImage
		for (let i = 0; i < CAPTURE_PIXEL_COUNT; i++) {
			const color = luminanceAt(rawData.data, i) < effectiveThreshold ? 0 : 255
			const offset = i * 4
			data[offset] = color
			data[offset + 1] = color
			data[offset + 2] = color
			data[offset + 3] = 255
		}

		processedContext.putImageData(processedImage, 0, 0)
		displayContext.drawImage(
			processedCanvas,
			0,
			0,
			displayCanvasElement.width,
			displayCanvasElement.height,
		)
	}

	function flash(): void {
		flashElement.style.transition = 'none'
		flashElement.style.opacity = '1'
		flashElement.offsetHeight
		flashElement.style.transition = `opacity ${FLASH_DURATION_MS}ms ease-out`
		flashElement.style.opacity = '0'
	}

	/**
	 * Threshold the current camera frame to 1-bit, split it into X and Y
	 * coordinates via the active pixel mapping, and report them to `oncapture`.
	 */
	export function capture(): void {
		captureFrame(true)
	}

	function captureFrame(showFlash: boolean): void {
		if (!cameraReady) {
			return
		}

		if (showFlash) {
			flash()
		}

		const { size, sx, sy } = getSquareCrop()
		captureContext.drawImage(videoElement, sx, sy, size, size, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT)
		const rawData = captureContext.getImageData(0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT)

		const mapping = getPixelMapping(mappingMode)
		const halfPixels = CAPTURE_PIXEL_COUNT / 2

		const xBits = new Uint8Array(halfPixels)
		const yBits = new Uint8Array(halfPixels)

		for (let i = 0; i < CAPTURE_PIXEL_COUNT; i++) {
			const bit = luminanceAt(rawData.data, i) < threshold ? 0 : 1
			const entry = mapping[i]
			if (entry === undefined) {
				continue
			}

			if (entry.source === 'x') {
				xBits[entry.bitIndex] = bit
			} else {
				yBits[entry.bitIndex] = bit
			}
		}

		let xBigInt = BigInt('0b' + xBits.join(''))
		let yBigInt = BigInt('0b' + yBits.join(''))

		if (encodingMode === 'gray') {
			xBigInt = grayDecode(xBigInt)
			yBigInt = grayDecode(yBigInt)
		}

		oncapture(xBigInt, yBigInt)
	}
</script>

<!-- Kept in the layout (not display: none) so iOS Safari keeps decoding frames -->
<video bind:this={videoElement} class="hidden-video" autoplay muted playsinline></video>

<div class="camera-feed">
	{#if cameraState === 'active'}
		<div class="canvas-stack">
			<canvas
				bind:this={colorCanvasElement}
				class="color-canvas"
				height={CAPTURE_HEIGHT * DISPLAY_SCALE}
				width={CAPTURE_WIDTH * DISPLAY_SCALE}
			></canvas>
			<canvas
				bind:this={displayCanvasElement}
				style:--bw-opacity={cameraOverlay}
				class="bw-canvas"
				class:fade-in={fadeIn}
				height={CAPTURE_HEIGHT * DISPLAY_SCALE}
				width={CAPTURE_WIDTH * DISPLAY_SCALE}
			></canvas>
			<div bind:this={flashElement} class="flash-overlay"></div>
		</div>
	{:else if cameraState === 'idle'}
		<button class="enable-button" onclick={requestCamera} type="button">
			<svg
				class="camera-icon"
				aria-hidden="true"
				fill="none"
				stroke="currentColor"
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="1.5"
				viewBox="0 0 24 24"
			>
				<path
					d="M9 5 7 8H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-3l-2-3Z"
				/>
				<circle cx="12" cy="13" r="3" />
			</svg>
			<span>Enable camera navigation</span>
		</button>
	{:else}
		<div class="camera-status">
			{#if cameraState === 'checking'}
				<span class="status-text">Starting camera...</span>
			{:else if cameraState === 'denied'}
				<span class="status-text">Camera access denied</span>
				<a class="help-link" href={getCameraHelpUrl()} rel="noopener noreferrer" target="_blank">
					How to re-enable
				</a>
			{:else if cameraState === 'insecure'}
				<span class="status-text">Camera needs an HTTPS connection</span>
			{:else}
				<span class="status-text">
					{cameraState === 'busy' ? 'Camera is in use by another app' : 'No camera available'}
				</span>
				<button class="retry-button" onclick={requestCamera} type="button">Retry</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.hidden-video {
		pointer-events: none;
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	/* Square, matching the 48 × 48 crop that gets searched, so the frame keeps
	   its height whether it shows the placeholder, a status, or the live feed */
	.camera-feed {
		aspect-ratio: 1;
		width: 100%;
	}

	.canvas-stack {
		position: relative;
		width: 100%;
		height: 100%;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
	}

	.color-canvas {
		position: absolute;
		inset: 0;
		filter: grayscale(1);
	}

	.bw-canvas {
		position: relative;
		opacity: 0;
		transition: opacity 5s ease-out;
	}

	.bw-canvas.fade-in {
		opacity: var(--bw-opacity);
	}

	.flash-overlay {
		pointer-events: none;
		position: absolute;
		inset: 0;
		opacity: 0;
		background: white;
	}

	.enable-button {
		cursor: pointer;
		display: grid;
		gap: 10px;
		place-content: center;
		justify-items: center;
		width: 100%;
		height: 100%;
		padding: 16px;
		border: 1px solid rgb(255 255 255 / 20%);
		border-radius: 4px;
		font-family: sans-serif;
		font-size: 12px;
		color: rgb(255 255 255 / 55%);
		background: #2f3439;
		transition:
			color 0.15s ease-out,
			border-color 0.15s ease-out;
	}

	.enable-button:focus-visible {
		outline: 2px solid rgb(255 255 255 / 60%);
		outline-offset: -2px;
	}

	@media (hover: hover) {
		.enable-button:hover {
			border-color: rgb(255 255 255 / 40%);
			color: rgb(255 255 255 / 85%);
		}
	}

	.camera-icon {
		width: 36px;
		height: 36px;
	}

	.camera-status {
		display: flex;
		flex-direction: column;
		gap: 8px;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		background: #1a1a1a;
	}

	.status-text {
		font-family: sans-serif;
		font-size: 11px;
		color: #888;
		text-align: center;
	}

	.retry-button {
		cursor: pointer;
		padding: 8px 16px;
		border: 1px solid #555;
		border-radius: 4px;
		font-family: sans-serif;
		font-size: 12px;
		color: #ccc;
		background: #3a3a3a;
	}

	@media (hover: hover) {
		.retry-button:hover {
			color: #fff;
			background: #4a4a4a;
		}
	}

	.help-link {
		font-family: sans-serif;
		font-size: 10px;
		color: #888;
		text-decoration: underline;
	}

	@media (hover: hover) {
		.help-link:hover {
			color: #bbb;
		}
	}
</style>
