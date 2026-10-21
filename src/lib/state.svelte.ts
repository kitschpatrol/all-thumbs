import type { EncodingMode } from './pane-renderer'
import type { MappingMode } from './pixel-mappings'
import { formatNumber, getSelectedIndex, indexToCoordinates } from './bigint-utils'
import { sliderToDelta } from './deltas'

/** What a plain mouse wheel or two-finger scroll does to the view. */
export type WheelAction = 'pan' | 'zoom'

class AppState {
	accentColor: string = $state('#ff0000')
	autoShutter: boolean = $state(false)
	// Seconds between automatic searches
	autoShutterInterval: number = $state(1)
	autoThreshold: boolean = $state(true)
	// Shown wherever there is no image: between cells and past the edges
	backgroundColor: string = $state('#4a525a')
	// Installations set this so the camera starts without a click
	cameraAutoStart: boolean = $state(false)
	// Camera
	cameraEnabled: boolean = $state(true)
	cameraOverlay: number = $state(1)

	coarseMinimap: boolean = $state(false)
	crosshairGap: number = $state(6)
	crosshairThickness: number = $state(2)
	deltaSliderValue: number = $state(0)
	// Derived
	delta: bigint = $derived(sliderToDelta(this.deltaSliderValue))

	dynamicReticle: boolean = $state(false)

	encodingMode: EncodingMode = $state('binary')

	// Reticle
	fixedReticle: boolean = $state(true)

	inertia: boolean = $state(true)

	mappingMode: MappingMode = $state('original')
	// Cells of panes that haven't rendered yet
	placeholderColor: string = $state('#3f464d')
	reticleThickness: number = $state(3)
	// Navigation
	selectedX: bigint = $state(0n)

	selectedY: bigint = $state(0n)
	showAdvanced: boolean = $state(false)
	threshold: number = $state(128)
	wheelAction: WheelAction = $state('zoom')
	// Visual
	zoom: number = $state(1)
	get formattedPosition(): string {
		return formatNumber(this.selectedIndex.toString(10))
	}

	set formattedPosition(value: string) {
		const digits = value.replaceAll(/\D/gv, '')
		if (digits === '') {
			return
		}

		this.selectedIndex = BigInt(digits)
	}
	get selectedIndex(): bigint {
		return getSelectedIndex(this.selectedX, this.selectedY) + 1n
	}

	set selectedIndex(value: bigint) {
		const { x, y } = indexToCoordinates(value < 1n ? 0n : value - 1n)
		this.selectedX = x
		this.selectedY = y
	}
}

export const app = new AppState()
