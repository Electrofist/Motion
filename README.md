<h1 align="center">✦ Motion</h1>

<p align="center">
  <b>Apply CSS animations to any element visually, straight from the Live Preview.</b><br/>
  Pick an element, choose an animation, and Motion writes clean keyframes and a class into your code.
</p>

<p align="center">
  A <a href="https://phcode.dev">Phoenix Code</a> extension · no build step · standard CSS out, no lock-in
</p>

<!-- TODO: drop a short screen recording here (drag/pick element -> animate). Nothing sells this like the GIF. -->

---

## Why

Animations are one of the fiddliest parts of front-end work: you copy keyframes from somewhere, guess at timing, paste a class, tweak, repeat. Motion turns that into: **click the element in your live page, pick an animation, done.** You watch it happen on the real element, in context, and the code that lands is plain CSS you own and can edit.

Not a runtime. Not a lock-in. Just the animation you wanted, written into your file.

## Features

- **Visual apply from the Live Preview** — select any element and animate it in place
- **Live trial** — hover an animation to preview it on the selected element before committing
- **18 animations** — Fade In / Up / Down, Slide Left / Right, Zoom In, Pop, Bounce In, Flip In, Roll In, Blur In (entrance) and Pulse, Shake, Float, Spin, Wobble, Heartbeat, Tada (emphasis)
- **Full control** — duration, **delay**, easing, a **loop** toggle, and trigger: **on load**, **on scroll** (into view), or **on hover**
- **Custom easing** — a draggable **cubic-bézier curve editor** for springs and custom timing
- **Copy CSS** — grab the generated `@keyframes` + rule for the clipboard anytime
- **Remove** — strip Motion from a single element, or **Reset** to clear the whole file
- **Draggable panel** — move it out of the way of whatever you're animating; it remembers where you left it
- **Clean output** — merges into existing classes, dedupes keyframes, and keeps everything in one managed `<style>` block

## How it works

Motion maps the element you pick in the preview back to its exact spot in your source (via Phoenix's live-preview instrumentation), then makes two small, standard edits:

1. Adds a class to the element's tag, preserving any classes already there:
   ```html
   <button class="btn mo-fade-up">Click me</button>
   ```
2. Writes the animation into a managed block in `<head>`:
   ```html
   <style id="motion-animations">
     @keyframes mo-kf-fade-up { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }
     .mo-fade-up { animation: mo-kf-fade-up 600ms ease-out both }
   </style>
   ```

Pick *on scroll* and Motion drops in a tiny `IntersectionObserver` helper so elements animate as they enter the viewport. That's the whole footprint — nothing proprietary.

## Install

Once published: open **Phoenix Code → Extensions**, search **Motion**, click Install.

Or load it manually: copy this folder into your Phoenix user-extensions directory and restart.

## Usage

1. Open an HTML file and turn on **Live Preview**.
2. Click the **✦ Motion** button in the toolbar (drag the panel by its header to reposition it).
3. Click the element you want to animate in the Live Preview — the panel shows what's selected.
4. Pick an animation, tune trigger / speed / easing / delay / loop, then **Apply**. Use **Copy CSS** to export, or **Remove** to undo on that element.

## Development

Plain JS + jQuery, no build step.

```bash
npm test     # pure-logic tests (class merge, CSS assembly, keyframe dedup)
npm run check
```

The animation catalog and the pure CSS/HTML helpers live at the top of `main.js` and are unit-tested in `test/motion.test.js`.

## Roadmap

- Explicit click-to-select with an on-preview highlight of the target
- Stagger across a multi-element selection (cascade reveals)
- Save applied configs as reusable presets / favorites
- `prefers-reduced-motion` fallbacks in the emitted CSS

## License

MIT © [Krrish](https://github.com/Electrofist)
