import { describe, expect, it } from 'vitest'
import { ZOOM_MAX } from '../src/lib/constants'
import { SLIDER_MAX } from '../src/lib/deltas'
import { DEFAULT_VIEW, parseViewState, serializeViewState } from '../src/lib/url-state'

const HUGE = 10n ** 693n + 12_345n

describe('serializeViewState', () => {
	it('writes just the number when every setting is at its default', () => {
		expect(serializeViewState({ ...DEFAULT_VIEW, index: 1n })).toBe('1')
		expect(serializeViewState({ ...DEFAULT_VIEW, index: HUGE })).toBe(HUGE.toString(10))
	})

	it('adds only the settings that differ from the defaults', () => {
		expect(serializeViewState({ ...DEFAULT_VIEW, index: 7n, mappingMode: 'spiral' })).toBe(
			'n=7&layout=spiral',
		)
		expect(
			serializeViewState({
				cameraAutoStart: false,
				deltaSliderValue: 5,
				encodingMode: 'gray',
				index: 7n,
				mappingMode: 'hilbert',
				zoom: 2.5,
			}),
		).toBe('n=7&layout=hilbert&encoding=gray&delta=5&zoom=2.5')
	})
})

describe('parseViewState', () => {
	it('reads a bare number, with or without the hash mark', () => {
		expect(parseViewState('#42')).toEqual({ index: 42n })
		expect(parseViewState('42')).toEqual({ index: 42n })
		expect(parseViewState(`#${HUGE}`)).toEqual({ index: HUGE })
	})

	it('round-trips every field', () => {
		const view = {
			cameraAutoStart: true,
			deltaSliderValue: SLIDER_MAX,
			encodingMode: 'gray',
			index: HUGE,
			mappingMode: 'triangleAlt',
			zoom: 0.5,
		} as const
		expect(serializeViewState(view)).toContain('camera=1')
		expect(parseViewState(`#${serializeViewState(view)}`)).toEqual(view)
	})

	it('returns nothing for an empty hash', () => {
		expect(parseViewState('')).toEqual({})
		expect(parseViewState('#')).toEqual({})
	})

	it('drops fields it cannot use and keeps the rest', () => {
		expect(
			parseViewState(
				`#n=abc&layout=nope&encoding=hex&delta=${SLIDER_MAX + 1}&zoom=${ZOOM_MAX + 1}&extra=1`,
			),
		).toEqual({})
		expect(parseViewState('#n=-5&layout=radial&zoom=nan')).toEqual({ mappingMode: 'radial' })
		expect(parseViewState('#n=12&delta=3')).toEqual({ deltaSliderValue: 3, index: 12n })
		expect(parseViewState('#camera=on')).toEqual({ cameraAutoStart: true })
		expect(parseViewState('#camera=off')).toEqual({ cameraAutoStart: false })
		expect(parseViewState('#camera=maybe')).toEqual({})
	})

	it('ignores junk that is not a number or query string', () => {
		expect(parseViewState('#hello world')).toEqual({})
	})
})
