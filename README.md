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
- **12 animations** — Fade Up / In / Down, Slide Left / Right, Zoom In, Pop, Bounce In (entrance) and Pulse, Shake, Float, Spin (attention)
- **Full control** — duration, easing, and trigger: **on load**, **on scroll** (into view), or **on hover**
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
2. Click the element you want to animate (in the preview or the code).
3. Click the **✦ Motion** button in the toolbar.
4. Set duration / easing / trigger, then click an animation. Done.

## Development

Plain JS + jQuery, no build step.

```bash
npm test     # pure-logic tests (class merge, CSS assembly, keyframe dedup)
npm run check
```

The animation catalog and the pure CSS/HTML helpers live at the top of `main.js` and are unit-tested in `test/motion.test.js`.

## Roadmap

- Explicit click-to-select with an on-preview highlight of the target
- More animations + richer gallery previews
- Per-element timing (stagger, delay) and scroll-linked effects
- Save applied animations as reusable presets

## License

MIT © [Krrish](https://github.com/Electrofist)
