# Fingerprint Consistency Kit

A dependency-free test page that checks whether a Chromium-based browser gives
**consistent** answers from its Canvas 2D, Web Audio and native-function APIs.

Fingerprinting detectors rarely flag a browser because a canvas hash or an
audio sum "looks wrong"; any value is plausible. They flag it because two
ways of asking the same question disagree. Examples:

- noise that changes between two reads of the same canvas
- `toDataURL` and `getImageData` describing different pixels
- a worker or iframe returning different output from the main page
- `getChannelData` and `copyFromChannel` disagreeing
- `HTMLCanvasElement.prototype.toDataURL.toString()` not looking native

Each check here tests one of those invariants, so a failure points to a
specific code path rather than just saying "spoofed".

## Running it

The page needs a secure context (it uses `crypto.subtle`), so serve it over
localhost:

```bash
python3 -m http.server 8000
# desktop: open http://localhost:8000
# Android: adb reverse tcp:8000 tcp:8000, then open http://localhost:8000 on the device
```

Click **Download JSON** to save the results. Run it once in a stock Chromium
build (the baseline) and once in the build under test, on the **same device**,
then compare:

```bash
python3 compare.py baseline.json candidate.json
```

`compare.py` prints a Markdown table of every check and flags status changes,
so it can go straight into a report.

## Checks

| ID | Area | Invariant |
|----|------|-----------|
| C1 | Canvas | `toDataURL` is identical across 5 reads of one canvas |
| C2 | Canvas | `getImageData` is identical across 5 reads of one canvas |
| C3 | Canvas | The same drawing on two fresh canvases gives the same pixels |
| C4 | Canvas | A solid `rgb(10,20,30)` fill reads back exactly |
| C5 | Canvas | `putImageData` → `getImageData` round-trips opaque pixels exactly |
| C6 | Canvas | Decoded `toDataURL` PNG matches `getImageData` |
| C7 | Canvas | Main-thread `OffscreenCanvas` matches a document canvas *(warn)* |
| C8 | Canvas | Worker `OffscreenCanvas` matches a document canvas *(warn)* |
| C9 | Canvas | A fresh iframe realm matches the top-level page |
| A1 | Audio | Oscillator + compressor render is identical across 2 runs |
| A2 | Audio | `getChannelData` matches `copyFromChannel` |
| A3 | Audio | `ConstantSourceNode` at 0.5 renders as exactly 0.5 |
| A4 | Audio | `copyToChannel` → `getChannelData` round-trips exactly |
| A5 | Audio | `AnalyserNode` data is identical across 2 reads *(warn)* |
| A6 | Audio | `AudioContext` sample rate, latency, channel count *(info)* |
| N0 | Natives | `Function.prototype.toString` is native and matches the iframe realm |
| N1–N9 | Natives | Canvas/Audio methods have native `toString`, WebIDL descriptor flags, correct `name`/`length`, no own `prototype`, and match the iframe realm |

**fail** means the invariant holds in stock Chromium and does not hold here.
**warn** means it can differ for legitimate reasons, such as GPU vs CPU raster
between a document canvas and a worker. Judge a warn against the baseline run on
the same device, not on its own.

## Reading the results

| Pattern | Likely cause |
|---------|--------------|
| C1/C2 fail | Noise is re-randomised on every readback instead of being seeded per session/origin |
| C4/C5 fail | Noise is applied to every readback, including content with no rendering entropy |
| C6 fails, C2 passes | Only one readback path (`getImageData` or the encoder) is modified |
| C9 fails, or N-checks fail | A JavaScript-level hook rather than an engine change |
| C8 differs from the baseline | The worker / `OffscreenCanvas` path was not patched |
| A2 fails | `getChannelData` and `copyFromChannel` are modified inconsistently |
| A3/A4 fail | Audio noise is added to buffers that carry no fingerprint entropy |

Whether a given result is a defect or intended privacy behaviour depends on
the design goal. For example, Brave deliberately adds per-session noise
("farbling"). The kit only reports what is consistent and what is not.

## Files

- `index.html`: runs the checks and exports JSON
- `tests.js`: the checks
- `scene.js`: the shared drawing and hashing used by every context
- `worker.js`: `OffscreenCanvas` check inside a dedicated worker
- `compare.py`: baseline vs candidate diff
- `docs/report-template.md`: structure for a root-cause write-up

## License

MIT
