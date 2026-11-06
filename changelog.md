# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Documentation

- Correct the jsbn attribution link in the archived as3crypto license to use an archived URL.

### Maintenance

- Refresh Svelte, Vite, Vitest, Cloudflare tooling and shared-config requirements; update pnpm to 12.16.1 and the dependency-update workflow action.
- Replace the `skills` dependency and prepare hook with pnpm-managed shared-config skills for `.agents/skills` and `.claude/skills`.
- Use `shx rm` in `clean-deep` to remove the lockfile without staging its deletion in Git.

## [1.0.1] - 2026-10-21

### Added

- Add permanent redirects from legacy `/48x48` URLs to `/all-thumbs`, preserving nested paths.

### Fixed

- Eliminate premature corner-grid rendering by waiting for viewport positioning before rendering the pane beneath the reticle.

## [1.0.0] - 2026-10-21

### Added

- Introduce a web application for exploring all 2^2304 possible 48 × 48 black-and-white images.
- Navigate with mouse or touch dragging, arrow keys, double-click centering, optional inertia and elastic boundary behavior.
- Support wheel, pinch, keyboard and slider zoom from 0.1× to 20×, with an adaptive minimum for large viewports, high-DPI rendering and progressive detail.
- Jump using a brightness-density minimap, corner and edge shortcuts, or editable possibility numbers counted from 1 at solid black.
- Adjust the delta between neighboring images from single-coordinate steps to strides spanning the entire possibility space.
- Choose eight pixel layouts, including spiral, checkerboard, radial, Hilbert, scattered and triangular arrangements, with binary or Gray-code encoding.
- Search for camera images with manual or automatic brightness thresholding, manual or timed capture, on-demand camera access and optional startup on load.
- Save and restore the selected possibility, layout, encoding, delta, zoom and camera startup preference through shareable URL hashes.
- Provide an Advanced panel for colors, fixed and fading reticles, minimap detail and crosshairs, scroll behavior, inertia and camera settings.

### Documentation

- Document navigation, layouts, camera use and URL sharing, plus the original Flash application's exhibition history, build requirements and third-party credits.

### Maintenance

- Preserve the original ActionScript source, assets and compiled Flash application in `archive/`, with third-party license notices.
- Set up the Svelte/Vite build, Cloudflare static deployment with version metadata, unit tests, shared linting and cross-platform CI/release automation.

[Unreleased]: https://github.com/kitschpatrol/all-thumbs/compare/v1.0.1...HEAD
[1.0.0]: https://github.com/kitschpatrol/all-thumbs/releases/tag/v1.0.0
[1.0.1]: https://github.com/kitschpatrol/all-thumbs/compare/v1.0.0...v1.0.1
