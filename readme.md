<!-- title -->

# all-thumbs

<!-- /title -->

<!-- badges -->

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/license/mit)
[![CI](https://github.com/kitschpatrol/all-thumbs/actions/workflows/ci.yml/badge.svg)](https://github.com/kitschpatrol/all-thumbs/actions/workflows/ci.yml)

<!-- /badges -->

<!-- short-description -->

**Every image, ever.**

<!-- /short-description -->

## Overview

An interface to navigate every possible 48 × 48 pixel black and white image. The software presents a complete, navigable spatial map of all 2^(48×48) images, from solid black at the top-left of the map to solid white at the bottom-right.

By default, each image is split into two 1152-bit halves: the top half encodes the map's X coordinate and the bottom half encodes the Y coordinate. Ways to navigate:

- **Pan** the viewport by dragging or with the arrow keys (shift for a whole pane); double-click a cell to center it
- **Zoom** with the wheel or a two-finger scroll, a pinch, the `+` and `-` keys, or the slider (the Advanced panel can make scrolling pan instead)
- **Teleport** by clicking anywhere on the possibility map (the density minimap)
- **Jump** to a specific image by editing the possibility number, or share a location via the URL hash, which also records the layout, encoding, delta, and zoom
- **Search by camera**: a live camera feed is thresholded to 1-bit and located in the possibility space, revealing that every photograph is just a coordinate waiting to be visited. The camera only starts when you click to enable it, unless the URL carries `camera=1` (or "Camera on Load" is set under Advanced), which installations use to start with it running

The delta slider changes the step size between adjacent cells, from single-index steps to strides that cross the entire space in a few cells.

Alternate bit layouts (spiral, checkerboard, radial, Hilbert, scattered, triangle, etc.) change how coordinates map to pixels.

This is a web port of the original 2010 ActionScript/Flash version, which is preserved in [`archive/`](./archive/). See [the project page](https://frontiernerds.com/projects/all-thumbs) for more background and exhibition history.

<!-- license -->

## License

[MIT](license.txt) © [Eric Mika](https://ericmika.com)

<!-- /license -->
