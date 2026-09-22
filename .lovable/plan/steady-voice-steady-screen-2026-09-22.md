# Steady voice, steady screen

She currently stutters — sound breaking up and the sphere jumping at the same
moment, on phone and laptop. That pairing is the tell: her voice is being fed
out from inside the same drawing loop that paints the sphere. Whenever a frame
of drawing runs long, the next piece of sound is handed over late, the speaker
runs dry for a few milliseconds, and you hear a break at the exact instant the
animation hitches.

## What changes

**1. Separate her voice from the drawing.**
Her sound will be prepared on its own clock, independent of anything on screen.
A heavy frame, a slow phone, a backgrounded tab, a resize — none of them can
starve her voice any more.

**2. Give her a small head start.**
Right now she starts speaking almost the instant the first bytes land, with
only a fraction of a second of runway. Any hiccup on conference wifi empties
it. She will collect a short cushion first and keep a longer cushion ahead of
herself while talking, so a slow moment on the network is absorbed instead of
heard. The extra delay before her first word stays small enough not to feel
laggy.

**3. Never restart mid-word.**
Today, if she does run dry, playback jumps to "now" and continues — which is
the click/skip you hear. Instead she will continue exactly where she left off,
with a hair of fade at each joint so pieces knit together silently.

**4. Make the sphere cheap enough to keep up.**
The sphere rebuilds every glow and gradient from scratch on every single frame,
at up to three times the pixel density on a phone. Those get built once and
reused, the detail is capped on dense screens, and the whole thing eases down
while she speaks so the drawing can never be what makes her stutter.

**5. Smooth the level that drives the pulse.**
The pulse follows her voice reading directly, so a dropped frame shows up as a
visible jump. It will be eased between readings and keep moving on its own
between updates, so the sphere stays fluid even when a frame is late.

## Technical notes

- `src/lib/audio-engine.ts` — `speak()`: move `schedule()` off `requestAnimationFrame`
  onto a fixed 50ms timer (`setInterval`) plus a call on each chunk append; keep
  rAF only for the level/progress read. Raise `LOOKAHEAD` from 0.4s to ~1.2s,
  add a ~0.25s prebuffer gate before the first `source.start`, and stop resetting
  `scheduledEnd` to `now + 0.04` on underrun — advance it from the last scheduled
  end and apply a 5ms gain ramp at each piece boundary. Drop the 0.15s rewind in
  `resume()` to a value that does not repeat audible syllables.
- The stall guard, pause/cut-in behaviour, `played()` accounting and one-voice
  rule stay exactly as they are; only the pacing changes.
- `src/components/mary-presence.tsx` — hoist `createRadialGradient` results into
  a cache keyed by radius/level bucket, cap the backing-store scale (currently
  `devicePixelRatio * zoom`, up to 3) at 2, reduce `MOTES`/`SHELLS` passes while
  `speaking`, and smooth the incoming level with an EWMA plus interpolation
  between updates.

## Verification

- Phone-sized Playwright run with a full spoken turn, checking for scheduler
  underruns via the existing trace events and zero console errors.
- Frame-time sampling on the sphere while speaking, before and after.
- Then a live listen on your iPhone and laptop — the ear is the real gate here.
