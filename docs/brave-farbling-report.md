# Canvas and Web Audio consistency in Brave: root-cause report

**Summary.** Brave's fingerprint protection ("farbling") changes Canvas and
Web Audio output inside the Blink engine, not through JavaScript hooks. Every
native-function check passes and the output is the same in workers,
OffscreenCanvas and iframes. The kit still detects it through 8 consistency
checks. One of them is an implementation defect:

> **`AudioBuffer.getChannelData()` scales the buffer's stored samples in
> place, so every call multiplies the data again.** Writing `0.5` and reading
> it three times returns `0.499572`, `0.499144`, `0.498717`. A read changes
> state, and any page can detect this in one line.

All source links are pinned to brave-core commit
[`e576432`](https://github.com/brave/brave-core/tree/e576432aad21463941650bb987e61e64fee4fae4).

## Setup

| | Baseline | Candidate |
|---|---|---|
| Browser | Chrome 157 (stock) | Brave on Chromium 157, Shields **Strict** fingerprinting |
| Device | Windows x64 desktop (same machine) | same |
| Kit | `fp-consistency-kit` at this commit | same |
| Raw results | [`results/chrome-157-windows.json`](../results/chrome-157-windows.json) | [`results/brave-strict-windows.json`](../results/brave-strict-windows.json), [`results/brave-strict-windows-session2.json`](../results/brave-strict-windows-session2.json) |

Brave was run 4 times across 3 sessions. The same checks failed every time.

- Two runs in the same session returned identical hashes and audio values, so
  the output is deterministic within a session.
- The three sessions used factors `k = 0.999175`, `0.999144` and `0.999582`.
- All three are in the `[0.999, 1.000]` range the source defines (see F1). So
  the factor is per session, and the failure pattern does not depend on it.

## Results

`python3 compare.py results/chrome-157-windows.json results/brave-strict-windows.json`

| ID | Check | Chrome | Brave |
|----|-------|--------|-------|
| C1 | toDataURL identical across repeated reads | pass | **fail** (`AABBB`) |
| C2 | getImageData identical across repeated reads | pass | pass |
| C3 | Same drawing on two fresh canvases | pass | pass |
| C4 | Solid fill reads back exactly | pass | **fail** (145/256 pixels) |
| C5 | putImageData → getImageData round-trip | pass | **fail** (240 bytes) |
| C6 | toDataURL matches getImageData | pass | **fail** (see note) |
| C7–C9 | OffscreenCanvas, worker, iframe match | pass | pass |
| C10 | toDataURL only, no getImageData between | pass | pass (`AAAAA`) |
| C11 | C1's interleaved reads on a CPU canvas | pass | pass (`AAAAA`) |
| A1 | Audio render identical across runs | pass | pass |
| A2 | getChannelData matches copyFromChannel | pass | **fail** |
| A3 | ConstantSource 0.5 renders as 0.5 | pass | **fail** (0.499572) |
| A4 | copyToChannel → getChannelData round-trip | pass | **fail** (2047/2048) |
| A7 | getChannelData idempotent | pass (0.5, 0.5, 0.5) | **fail** (compounds) |
| N0–N9 | Native functions untouched | pass | pass |

## Findings

### F1: getChannelData compounds on every call (defect)

- **Observed (A7):** writing 0.5 and calling `getChannelData(0)` three times
  returns `0.49957195`, `0.49914426`, `0.49871695`. Each read multiplies the
  previous value by the same factor, `k = 0.9991439`.
- **Invariant broken:** a getter must not modify state. In Chromium,
  repeated calls return identical values.
- **Code path:**
  - Brave's patch puts a hook into upstream `AudioBuffer::getChannelData`,
    just before it returns
    ([patch](https://github.com/brave/brave-core/blob/e576432aad21463941650bb987e61e64fee4fae4/patches/third_party-blink-renderer-modules-webaudio-audio_buffer.cc.patch)).
  - The hook ([`audio_buffer.cc` L16–25](https://github.com/brave/brave-core/blob/e576432aad21463941650bb987e61e64fee4fae4/chromium_src/third_party/blink/renderer/modules/webaudio/audio_buffer.cc#L16-L25))
    calls the internal `getChannelData(channel_index)`. That returns
    `channels_[channel_index]`, the buffer's own storage, not a copy. It then
    passes that span to `FarbleAudioChannel`.
  - `BraveAudioFarblingHelper::FarbleAudioChannel`
    ([L32–44](https://github.com/brave/brave-core/blob/e576432aad21463941650bb987e61e64fee4fae4/third_party/blink/renderer/platform/brave_audio_farbling_helper.cc#L32-L44))
    runs `value = value * fudge_factor_` in place.
  - `fudge_factor_ = 0.999 + u/1000`, where `u` comes from the session's
    farbling token
    ([`brave_session_cache.cc` L327–345](https://github.com/brave/brave-core/blob/e576432aad21463941650bb987e61e64fee4fae4/third_party/blink/renderer/core/farbling/brave_session_cache.cc#L327-L345)).
    The measured `k = 0.9991439` is in that range.
- **Evidence:** A7 ratios `0.99914388` and `0.99914392` are equal to within
  float32 rounding. A3 (`0.5 × k = 0.499572`) and A1 (sum `124.0435 × k =
  123.9373`) give the same `k`.
- **Classification:** implementation defect. Scaling the output is
  intentional; scaling the stored data on every read is not. It also makes the
  protection easier to detect than intended.

### F2: copyFromChannel and getChannelData disagree (consequence of F1)

- **Observed (A2):** at sample 4600, `copyFromChannel / getChannelData =
  0.9991439`, which is exactly one extra factor of `k`.
- **Code path:** the `copyFromChannel` hook
  ([L27–31](https://github.com/brave/brave-core/blob/e576432aad21463941650bb987e61e64fee4fae4/chromium_src/third_party/blink/renderer/modules/webaudio/audio_buffer.cc#L27-L31))
  scales the copy after it is made. The source was already scaled in place by
  the earlier `getChannelData` call, so the copy gets `k²`.
- **Classification:** defect. The two read APIs return different data for the
  same buffer, depending on call order.

### F3: script-written audio is scaled too (detectable by design)

- **Observed (A3, A4):** a constant 0.5 signal, and samples the page wrote
  itself with `copyToChannel`, come back scaled. Only the 0.0 sample survives
  (2047/2048 altered).
- **Cause:** the same `getChannelData` hook. It cannot tell rendered audio,
  which carries fingerprint entropy, from data the page wrote.
- **Classification:** intended privacy behaviour, but easy to detect: a page
  that writes a known value and reads it back sees the change at once.

### F4: canvas readback flips low bits, keyed on content (intended)

- **Observed (C2–C5):** repeated `getImageData` reads are stable and two
  identical canvases match. A solid fill comes back with 145 of 256 pixels
  altered, and a put/get round-trip changes 240 bytes.
- **Code path:** `getImageData`
  ([`base_rendering_context_2d.cc` L16–21](https://github.com/brave/brave-core/blob/e576432aad21463941650bb987e61e64fee4fae4/chromium_src/third_party/blink/renderer/modules/canvas/canvas2d/base_rendering_context_2d.cc#L16-L21))
  and `toDataURL`
  ([`html_canvas_element.cc` L11–22](https://github.com/brave/brave-core/blob/e576432aad21463941650bb987e61e64fee4fae4/chromium_src/third_party/blink/renderer/core/html/canvas/html_canvas_element.cc#L11-L22))
  call `PerturbPixels`
  ([`brave_session_cache.cc` L362–396](https://github.com/brave/brave-core/blob/e576432aad21463941650bb987e61e64fee4fae4/third_party/blink/renderer/core/farbling/brave_session_cache.cc#L362-L396)).
  - It seeds an LFSR (a cheap pseudo-random generator) with
    `HMAC-SHA256(farbling_token, pixels)`.
  - It then XORs the lowest bit of an R, G or B value at up to 512 positions.
  - Because the seed includes the pixels, the same content always gets the
    same flips, which is why C2 and C3 pass.
  - The flip count is fixed rather than scaled to the read size. A 16×16 read
    is therefore heavily altered (C4), while a large canvas barely changes
    (C5: 240 of 115,200 bytes).
- **Classification:** intended privacy behaviour. Being consistent across
  contexts (C7–C9) is a good property. The fixed flip count makes small known
  regions an easy probe.

### F5: toDataURL changes after the GPU-to-CPU switch (confirmed)

- **Observed (C1):** five reads of an unchanged canvas give `AABBB`. Reads 1–2
  match, then reads 3–5 match each other but differ from 1–2. Chrome gives
  `AAAAA`. `getImageData` on the same canvas stays stable (`AAAAA`).
- **Hypothesis:**
  - C1 interleaves `toDataURL` and `getImageData`. Chromium moves a canvas
    from GPU to CPU rendering after repeated readbacks, so reads 1–2 and
    reads 3–5 come from differently produced snapshots.
  - In stock Chrome both snapshots encode to the same PNG.
  - `PerturbPixels` is keyed on the snapshot's pixels, so any difference, even
    1 bit, produces a completely different set of flips.
- **Experiment:** two checks isolate the trigger. Both pass in both browsers:
  - **C10** removes the interleaved `getImageData` calls: `AAAAA`.
  - **C11** keeps them but creates the canvas with `willReadFrequently: true`,
    so it uses CPU rendering from the start: `AAAAA`.
- **Conclusion:**
  - The drift appears only when readbacks switch a GPU canvas to CPU
    mid-session.
  - Brave's content-keyed perturbation turns a difference that stock Chrome
    hides into a visible hash change.
  - A page can detect it with nothing more than toDataURL, getImageData,
    toDataURL.
- **Classification:** side effect of intended behaviour. Each component works
  as designed: the raster switch is upstream Chromium, the content-keyed flips
  are Brave. Together they produce an inconsistency.
- **Fix options:**
  - Key the perturbation on something stable across raster modes, such as the
    session token plus canvas dimensions instead of the exact pixels. This
    trades away some per-content variation.
  - Alternatively, perturb before encoding from a snapshot that is
    canonicalised the same way in both modes.
- **Not yet verified at source level:** logging the pre-perturbation snapshot
  hash in `HTMLCanvasElement::ToDataURLInternal` would show the exact
  snapshot difference. That needs a Brave build.

### F6: C6 cannot isolate a single path in Brave (test limitation)

C6 decodes the PNG and reads it back with `getImageData`, which is perturbed
again on different content. In Brave this check would fail even if both paths
were consistent, so it is not counted as a finding. Brave perturbs every pixel
readback, so JavaScript cannot see the raw pixels.

### Also observed

With Strict fingerprinting, Brave reported 9 CPU threads instead of 12, 16 GB
of memory instead of 32, and a 1280×800 screen instead of 1600×900.

## Fix options for F1/F2

| Option | Change | Trade-off |
|--------|--------|-----------|
| **A. Scale once, when rendering completes** | Apply `FarbleAudioChannel` to the rendered bus when `OfflineAudioContext` produces its `AudioBuffer`, and remove the `getChannelData`/`copyFromChannel` hooks. | All read paths agree and reads are idempotent. Script-written buffers are left untouched (fixes F3 too). Needs a hook in the offline render completion path. |
| B. Mark the buffer as scaled | Add a `brave_farbled_` flag to `AudioBuffer`. Scale the stored data on the first `getChannelData`. Make `copyFromChannel` scale the copy only while the flag is unset. | Smallest patch, and makes reads idempotent and consistent. Still scales script-written data, and needs a rule for `copyToChannel` after scaling. |
| C. Scale a copy | Return a scaled copy from `getChannelData`. | Breaks the spec: `getChannelData` must return a live view of the buffer. Not recommended. |

Option A is the cleanest. A regression test needs three assertions on one
buffer with farbling enabled:
1. Repeated `getChannelData` calls return identical values.
2. `getChannelData` and `copyFromChannel` agree.
3. Data written with `copyToChannel` reads back unchanged.

Checks A2, A4 and A7 in this kit test exactly these.

## Reproduce

```bash
git clone <this repo> && cd fp-consistency-kit
python3 -m http.server 8000
# open http://localhost:8000 in each browser, Download JSON, then:
python3 compare.py baseline.json candidate.json
```
