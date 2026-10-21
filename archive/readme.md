> [!NOTE]
>
> This `/archive` folder preserves the original 2010 ActionScript 3 / Flash implementation of All Thumbs. `bin-debug/AllThumbs.swf` is the compiled build.
>
> See the [parent directory](../) for the web-based reimplementation.

---

# All Thumbs (Flash)

Built by [Eric Mika](https://ericmika.com) in 2010 and revised in 2011 for a 1680 × 1050 exhibition display.

## Notes

- Flash Player no longer runs in browsers; the `.swf` is kept for the record.
- Expects a camera. The auto-shutter submits the thresholded camera image once a second from startup.
- The right-click context menu toggles full screen mode and the "knobs and dials" control panel.
- Built against the Flex 4.5.1 SDK.

## Third-party code

- [as3crypto](https://github.com/timkurvers/as3-crypto) by Henri Torgemane, with a modified `BigInteger`. License: [`src/com/hurlant/LICENSE.md`](./src/com/hurlant/LICENSE.md).
- [Minimal Comps](https://github.com/kitschpatrol/minimalcomps) by Keith Peters. License: [`src/com/bit101/LICENSE.md`](./src/com/bit101/LICENSE.md).
- Minimal Comps renders text with the free [PF Ronda Seven](https://www.dafont.com/pf-ronda-seven.font) font by Yuusuke Kamiyamane, included at `src/assets/pf_ronda_seven.ttf`.
