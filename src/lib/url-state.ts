import type { EncodingMode } from './pane-renderer'
import type { MappingMode } from './pixel-mappings'
import { ZOOM_MAX, ZOOM_MIN } from './constants'
import { SLIDER_MAX } from './deltas'
import { ENCODING_MODES } from './pane-renderer'
import { MAPPING_MODES } from './pixel-mappings'

/** Everything needed to reproduce a view: which image, and how it's shown. */
export type ViewState = {
	/** Start the camera on load without waiting for a click */
	cameraAutoStart: boolean
	deltaSliderValue: number
	encodingMode: EncodingMode
	/** Possibility number, counting from 1 at solid black */
	index: bigint
	mappingMode: MappingMode
	zoom: number
}

export const DEFAULT_VIEW: Omit<ViewState, 'index'> = {
	cameraAutoStart: false,
	deltaSliderValue: 0,
	encodingMode: 'binary',
	mappingMode: 'original',
	zoom: 1,
}

const DIGITS = /^\d+$/v

function isMappingMode(value: string): value is MappingMode {
	return (MAPPING_MODES as readonly string[]).includes(value)
}

function isEncodingMode(value: string): value is EncodingMode {
	return (ENCODING_MODES as readonly string[]).includes(value)
}

/**
 * Serialize a view for the URL hash. Settings at their defaults are left out,
 * so the common case is just the possibility number (`#1`); otherwise the
 * number and settings are query parameters (`#n=1&layout=spiral`). `camera=1`
 * starts the camera on load, for installation links.
 */
export function serializeViewState(view: ViewState): string {
	const params = new URLSearchParams({ n: view.index.toString(10) })
	if (view.mappingMode !== DEFAULT_VIEW.mappingMode) {
		params.set('layout', view.mappingMode)
	}

	if (view.encodingMode !== DEFAULT_VIEW.encodingMode) {
		params.set('encoding', view.encodingMode)
	}

	if (view.deltaSliderValue !== DEFAULT_VIEW.deltaSliderValue) {
		params.set('delta', String(view.deltaSliderValue))
	}

	if (view.zoom !== DEFAULT_VIEW.zoom) {
		params.set('zoom', String(view.zoom))
	}

	if (view.cameraAutoStart !== DEFAULT_VIEW.cameraAutoStart) {
		params.set('camera', '1')
	}

	return params.size === 1 ? view.index.toString(10) : params.toString()
}

/**
 * Parse a URL hash written by `serializeViewState`. A bare number is the
 * possibility number. Missing or invalid fields are left out of the result so
 * the caller keeps its current values for them.
 */
export function parseViewState(hash: string): Partial<ViewState> {
	const text = hash.startsWith('#') ? hash.slice(1) : hash
	if (text === '') {
		return {}
	}

	if (DIGITS.test(text)) {
		return { index: BigInt(text) }
	}

	const params = new URLSearchParams(text)
	const view: Partial<ViewState> = {}

	const index = params.get('n')
	if (index !== null && DIGITS.test(index)) {
		view.index = BigInt(index)
	}

	const layout = params.get('layout')
	if (layout !== null && isMappingMode(layout)) {
		view.mappingMode = layout
	}

	const encoding = params.get('encoding')
	if (encoding !== null && isEncodingMode(encoding)) {
		view.encodingMode = encoding
	}

	const delta = params.get('delta')
	if (delta !== null && DIGITS.test(delta) && Number(delta) <= SLIDER_MAX) {
		view.deltaSliderValue = Number(delta)
	}

	const zoom = params.get('zoom')
	if (zoom !== null) {
		const value = Number(zoom)
		if (Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX) {
			view.zoom = value
		}
	}

	const camera = params.get('camera')
	if (camera !== null) {
		if (['1', 'on', 'true'].includes(camera)) {
			view.cameraAutoStart = true
		} else if (['0', 'false', 'off'].includes(camera)) {
			view.cameraAutoStart = false
		}
	}

	return view
}
