# We Rise — FSD Lab 01

A scroll-told landing page for **We Rise**, a productivity system played like a game:
quests for your habits, XP for deep work, and an AI that won't let the loop win.

Built with **HTML5, CSS and vanilla JavaScript**, GSAP (ScrollTrigger, ScrollSmoother),
WebGL shaders and a 300-frame canvas image sequence. No framework, no build step.

---

## The story, in scroll order

| Section | What happens | Code |
|---|---|---|
| Gate | Frosted ice creeps down over a loading counter; a hand moves under the frost, bent by it. Draw a circle to enter (+100 XP). | `js/gate.js` |
| Intro | "You Believed", alone on white. The figure rises out of snow and mist. | `js/app.js` |
| Hero | 300 frames scrubbed on a canvas, with five beliefs split across the figure. | `js/app.js` |
| Transition | The last frame burns to crimson, black climbs through it, and the dark shatters into the red room. | `js/portal.js` |
| Red room | Rising flame behind a reaching hand. "But," — "That's Bullsh*t" — then six 3D glass shards carrying real, sourced findings. | `js/shards.js` |
| Quote | The room overexposes to white and the line comes into focus. | `js/app.js` |
| Waitlist | Email sign-up with validation and a success state. | `js/app.js` |

The chrome — liquid-glass sound button, XP counter, scroll ruler, dock, custom
cursors and the generated soundtrack — lives in `js/ui.js`.

## The numbers on the glass

| Finding | Source |
|---|---|
| 43% of what you do each day is habit, not a decision | Wood, Quinn & Kashy, 2002 |
| 66 days, on average, to make a habit automatic | Lally et al., UCL, 2010 |
| 47% of waking hours, your mind is somewhere else | Killingsworth & Gilbert, 2010 |
| 23 minutes to get back on track after an interruption | Mark, Gudith & Klocke, 2008 |
| 40% of productive time lost to switching tasks | Rubinstein, Meyer & Evans, 2001 |
| 20% of adults are chronic procrastinators | Ferrari et al., 2005 |

---

## Running it

```bash
npm install
npm run dev
```

Serves the folder at `http://127.0.0.1:5173`. Any static server works; the page needs
one (rather than opening the file directly) because the frame loader uses a Web Worker.

## Files

```
index.html          the whole document
css/app.css         all styles
js/ui.js            liquid glass, sound, XP, ruler
js/gate.js          the loading gate: WebGL frost, the hand, loop recognition
js/app.js           the pinned story: intro, hero frames, beats, quote, waitlist
js/portal.js        the crimson bleed and the break into the red room
js/shards.js        the red room: flame scene and 3D glass shards (WebGL)
js/vendor/          GSAP 3 with ScrollTrigger and ScrollSmoother
assets/frames/      the 300-frame hero sequence (WebP)
assets/gate/        the hand under the frost
assets/cursors/     custom cursors
assets/fonts/       self-hosted Instrument Serif, Pinyon Script, Space Grotesk
```

## Accessibility and fallbacks

- `prefers-reduced-motion: reduce` replaces the pinned story with still sections:
  a single hero frame, the red room's words and all six findings on still cards,
  the quote, and the waitlist.
- The gate can be passed with **Enter** or **Space** instead of drawing.
- Every animated passage has screen-reader copy; decorative canvases are `aria-hidden`.
- A `<noscript>` block reveals the page as an ordinary document.
- Without WebGL the gate and red room fall back to plain backgrounds.
