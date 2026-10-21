// Cell dimensions (pixels)
export const X_RES = 48
export const Y_RES = 48
const PADDING = 5

// Cells per pane
export const PANE_X_COUNT = 8
export const PANE_Y_COUNT = 8

// Derived dimensions
export const CELL_WIDTH = X_RES + PADDING // 53
export const CELL_HEIGHT = Y_RES + PADDING // 53
export const PANE_WIDTH = CELL_WIDTH * PANE_X_COUNT // 424
export const PANE_HEIGHT = CELL_HEIGHT * PANE_Y_COUNT // 424

// Bits per coordinate (half of 48x48 = 48*24 = 1152)
export const X_PIXEL_COUNT = (X_RES * Y_RES) / 2 // 1152
export const Y_PIXEL_COUNT = (X_RES * Y_RES) / 2 // 1152

// Coordinate space bounds
export const X_MAX = 2n ** BigInt(X_PIXEL_COUNT) - 1n
export const Y_MAX = 2n ** BigInt(Y_PIXEL_COUNT) - 1n

// Zoom range (CSS pixels per image pixel)
export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 20
