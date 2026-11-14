// Consistency checks for Canvas 2D, Web Audio and the native-function surface.
//
// Every check asks one question: "do two ways of getting the same answer
// agree?" A browser that adds fingerprint noise in only some code paths, or
// that changes it between reads, fails these checks even when every single
// value looks plausible. That is the usual reason detectors label output
// "Spoofed".
//
// Status meanings:
//   pass - the invariant holds
//   fail - the invariant must hold in stock Chromium, and it does not here
//   warn - can differ for legitimate reasons (e.g. GPU vs CPU raster);
//          judge it against a baseline run with compare.py
//   info - reported value only

var W = SCENE_W, H = SCENE_H;

// Repetitions for the stability checks (C1, C2, A1). The page sets it from
// the "Repetitions" input; more runs catch noise that only changes sometimes.
var REPEAT = 5;

function allEqual(xs) { return xs.every(function (x) { return x === xs[0]; }); }
function uniq(xs) { return Array.from(new Set(xs)); }

function newCanvas(doc) {
  var c = (doc || document).createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

function makeIframe() {
  var f = document.createElement('iframe');
  f.style.display = 'none';
  document.body.appendChild(f);
  return f;
}

function decodeToPixels(dataUrl) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () {
      var c = newCanvas();
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, W, H).data);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function runWorker() {
  return new Promise(function (resolve) {
    var w;
    try { w = new Worker('worker.js'); } catch (e) { return resolve({ ok: false, error: String(e) }); }
    var timer = setTimeout(function () { w.terminate(); resolve({ ok: false, error: 'timeout' }); }, 5000);
    w.onmessage = function (ev) { clearTimeout(timer); w.terminate(); resolve(ev.data); };
    w.onerror = function (ev) { clearTimeout(timer); resolve({ ok: false, error: ev.message }); };
    w.postMessage('go');
  });
}

// ---------------------------------------------------------------- Canvas

async function canvasTests(add) {
  // C1/C2: repeated reads of one unchanged canvas must be identical.
  // The default context is used on purpose: willReadFrequently would force
  // the CPU raster path and hide noise added only on GPU readback.
  var c = newCanvas();
  var ctx = c.getContext('2d');
  drawScene(ctx, true);
  var urlHashes = [], pixHashes = [];
  for (var i = 0; i < REPEAT; i++) {
    urlHashes.push(await sha256Bytes(new TextEncoder().encode(c.toDataURL())));
    pixHashes.push(await sha256Bytes(ctx.getImageData(0, 0, W, H).data));
  }
  add('C1', 'canvas', 'toDataURL identical across repeated reads of one canvas',
    allEqual(urlHashes) ? 'pass' : 'fail', { runs: REPEAT, uniqueHashes: uniq(urlHashes) });
  add('C2', 'canvas', 'getImageData identical across repeated reads of one canvas',
    allEqual(pixHashes) ? 'pass' : 'fail', { runs: REPEAT, uniqueHashes: uniq(pixHashes) });

  // C3: the same drawing on two fresh canvases must give the same pixels.
  var c2 = newCanvas();
  drawScene(c2.getContext('2d'), true);
  var other = await sha256Bytes(c2.getContext('2d').getImageData(0, 0, W, H).data);
  add('C3', 'canvas', 'Same drawing on two fresh canvases gives same pixels',
    other === pixHashes[0] ? 'pass' : 'fail', { first: pixHashes[0], second: other });

  // C4: a solid fill must read back as exactly that colour.
  var k = newCanvas().getContext('2d');
  k.fillStyle = 'rgb(10, 20, 30)';
  k.fillRect(0, 0, W, H);
  var kd = k.getImageData(0, 0, 16, 16).data, wrong = 0;
  for (var p = 0; p < kd.length; p += 4) {
    if (kd[p] !== 10 || kd[p + 1] !== 20 || kd[p + 2] !== 30 || kd[p + 3] !== 255) wrong++;
  }
  add('C4', 'canvas', 'Solid rgb(10,20,30) fill reads back exactly',
    wrong === 0 ? 'pass' : 'fail', { wrongPixels: wrong, of: kd.length / 4,
      sample: Array.from(kd.slice(0, 8)) });

  // C5: putImageData -> getImageData must round-trip opaque pixels exactly.
  var rt = newCanvas().getContext('2d');
  var src = rt.createImageData(W, H), seed = 12345;
  for (var j = 0; j < src.data.length; j += 4) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    src.data[j] = seed & 255; src.data[j + 1] = (seed >> 8) & 255;
    src.data[j + 2] = (seed >> 16) & 255; src.data[j + 3] = 255;
  }
  rt.putImageData(src, 0, 0);
  var back = rt.getImageData(0, 0, W, H).data, diff = 0;
  for (var q = 0; q < back.length; q++) if (back[q] !== src.data[q]) diff++;
  add('C5', 'canvas', 'putImageData -> getImageData round-trips exactly',
    diff === 0 ? 'pass' : 'fail', { differingBytes: diff, of: back.length });

  // C6: toDataURL and getImageData must describe the same pixels.
  var base = newCanvas();
  var bctx = base.getContext('2d');
  drawScene(bctx, false);
  var direct = await sha256Bytes(bctx.getImageData(0, 0, W, H).data);
  var viaPng = await sha256Bytes(await decodeToPixels(base.toDataURL()));
  add('C6', 'canvas', 'toDataURL (decoded) matches getImageData',
    direct === viaPng ? 'pass' : 'fail', { getImageData: direct, decodedPng: viaPng });

  // C7: OffscreenCanvas on the main thread vs a document canvas.
  if (typeof OffscreenCanvas === 'undefined') {
    add('C7', 'canvas', 'OffscreenCanvas (main thread) matches canvas', 'info', { unsupported: true });
  } else {
    var oc = new OffscreenCanvas(W, H).getContext('2d');
    drawScene(oc, false);
    var off = await sha256Bytes(oc.getImageData(0, 0, W, H).data);
    add('C7', 'canvas', 'OffscreenCanvas (main thread) matches canvas',
      off === direct ? 'pass' : 'warn', { canvas: direct, offscreen: off });
  }

  // C8: OffscreenCanvas in a worker vs a document canvas.
  var wr = await runWorker();
  if (!wr.ok) {
    add('C8', 'canvas', 'Worker OffscreenCanvas matches canvas', 'info', { error: wr.error });
  } else {
    add('C8', 'canvas', 'Worker OffscreenCanvas matches canvas',
      wr.hash === direct && wr.stable ? 'pass' : 'warn',
      { canvas: direct, worker: wr.hash, workerStable: wr.stable });
  }

  // C9: a fresh iframe realm vs the top document. JS-level hooks often
  // patch only the top window, so this catches them.
  var f = makeIframe();
  var ic = newCanvas(f.contentDocument);
  var ictx = ic.getContext('2d');
  drawScene(ictx, false);
  var ifr = await sha256Bytes(ictx.getImageData(0, 0, W, H).data);
  f.remove();
  add('C9', 'canvas', 'Fresh iframe canvas matches top-level canvas',
    ifr === direct ? 'pass' : 'fail', { top: direct, iframe: ifr });
}

// ---------------------------------------------------------------- Audio

async function audioTests(add) {
  var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) { add('A0', 'audio', 'OfflineAudioContext available', 'info', { unsupported: true }); return; }

  // The widely used oscillator + compressor fingerprint.
  async function classic() {
    var ctx = new OAC(1, 44100, 44100);
    var osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 10000;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -50; comp.knee.value = 40; comp.ratio.value = 12;
    comp.attack.value = 0; comp.release.value = 0.25;
    osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
    var buf = await ctx.startRendering();
    var d = buf.getChannelData(0), sum = 0;
    for (var i = 4500; i < 5000; i++) sum += Math.abs(d[i]);
    var copy = new Float32Array(d.length);
    buf.copyFromChannel(copy, 0);
    return { sum: sum, hash: await sha256Bytes(d), copyHash: await sha256Bytes(copy) };
  }

  // A1: rendering the same graph repeatedly must give the same samples.
  var runs = [];
  for (var n = 0; n < REPEAT; n++) runs.push(await classic());
  var r1 = runs[0];
  var renderHashes = runs.map(function (r) { return r.hash; });
  add('A1', 'audio', 'Oscillator+compressor render identical across repeated runs',
    allEqual(renderHashes) ? 'pass' : 'fail',
    { runs: REPEAT, uniqueHashes: uniq(renderHashes), uniqueSums: uniq(runs.map(function (r) { return r.sum; })) });

  // A2: getChannelData and copyFromChannel must return the same samples.
  add('A2', 'audio', 'getChannelData matches copyFromChannel on rendered buffer',
    r1.hash === r1.copyHash ? 'pass' : 'fail', { getChannelData: r1.hash, copyFromChannel: r1.copyHash });

  // A3: a constant 0.5 signal must render as exactly 0.5.
  var cctx = new OAC(1, 1024, 44100);
  var cs = cctx.createConstantSource();
  cs.offset.value = 0.5;
  cs.connect(cctx.destination); cs.start(0);
  var cb = await cctx.startRendering();
  var cd = cb.getChannelData(0), off = 0;
  for (var i = 0; i < cd.length; i++) if (cd[i] !== 0.5) off++;
  add('A3', 'audio', 'ConstantSource 0.5 renders as exactly 0.5',
    off === 0 ? 'pass' : 'fail', { wrongSamples: off, of: cd.length, first: Array.from(cd.slice(0, 4)) });

  // A4: samples written into an AudioBuffer must read back unchanged.
  var ab = new AudioBuffer({ length: 2048, sampleRate: 44100, numberOfChannels: 1 });
  var ramp = new Float32Array(2048);
  for (var r = 0; r < ramp.length; r++) ramp[r] = Math.sin(r / 7) * 0.8;
  ab.copyToChannel(ramp, 0);
  var got = ab.getChannelData(0), bad = 0;
  for (var s = 0; s < ramp.length; s++) if (got[s] !== ramp[s]) bad++;
  add('A4', 'audio', 'copyToChannel -> getChannelData round-trips exactly',
    bad === 0 ? 'pass' : 'fail', { wrongSamples: bad, of: ramp.length });

  // A5: AnalyserNode data must not change between reads after rendering ends.
  var actx = new OAC(1, 4096, 44100);
  var aosc = actx.createOscillator();
  aosc.frequency.value = 1000;
  var an = actx.createAnalyser();
  an.fftSize = 256;
  aosc.connect(an); an.connect(actx.destination); aosc.start(0);
  await actx.startRendering();
  var f1 = new Float32Array(an.frequencyBinCount), f2 = new Float32Array(an.frequencyBinCount);
  an.getFloatFrequencyData(f1); an.getFloatFrequencyData(f2);
  var h1 = await sha256Bytes(f1), h2 = await sha256Bytes(f2);
  add('A5', 'audio', 'AnalyserNode frequency data identical across 2 reads',
    h1 === h2 ? 'pass' : 'warn', { read1: h1, read2: h2 });

  // A6: realtime context properties, for comparison with the baseline.
  try {
    var rt = new (window.AudioContext || window.webkitAudioContext)();
    add('A6', 'audio', 'AudioContext properties', 'info', {
      sampleRate: rt.sampleRate, baseLatency: rt.baseLatency, outputLatency: rt.outputLatency,
      maxChannelCount: rt.destination.maxChannelCount, state: rt.state });
    await rt.close();
  } catch (e) {
    add('A6', 'audio', 'AudioContext properties', 'info', { error: String(e) });
  }
}

// ---------------------------------------------------------------- Natives

// [interface, method, WebIDL length]. Lengths are the counts of required
// arguments in Chromium's IDL; compare with the baseline if one looks off.
var NATIVE_TARGETS = [
  ['HTMLCanvasElement', 'toDataURL', 0],
  ['HTMLCanvasElement', 'toBlob', 1],
  ['CanvasRenderingContext2D', 'getImageData', 4],
  ['CanvasRenderingContext2D', 'measureText', 1],
  ['OffscreenCanvasRenderingContext2D', 'getImageData', 4],
  ['AudioBuffer', 'getChannelData', 1],
  ['AudioBuffer', 'copyFromChannel', 2],
  ['AnalyserNode', 'getFloatFrequencyData', 1],
  ['OfflineAudioContext', 'startRendering', 0],
];

async function nativeTests(add) {
  var f = makeIframe();
  var iw = f.contentWindow;
  var fnToString = Function.prototype.toString;

  // N0: Function.prototype.toString itself must be native and agree with
  // the iframe's copy (a patched toString is the classic hook giveaway).
  var selfStr = fnToString.call(fnToString);
  add('N0', 'natives', 'Function.prototype.toString is native',
    /\{\s*\[native code\]\s*\}$/.test(selfStr) && selfStr === iw.Function.prototype.toString.call(iw.Function.prototype.toString)
      ? 'pass' : 'fail', { toString: selfStr });

  NATIVE_TARGETS.forEach(function (t, idx) {
    var iface = t[0], name = t[1], len = t[2], id = 'N' + (idx + 1);
    var label = iface + '.prototype.' + name;
    if (!window[iface]) { add(id, 'natives', label, 'info', { unsupported: true }); return; }
    var d = Object.getOwnPropertyDescriptor(window[iface].prototype, name);
    if (!d || typeof d.value !== 'function') { add(id, 'natives', label, 'fail', { descriptor: 'missing or accessor' }); return; }
    var fn = d.value;
    var src = fnToString.call(fn);
    var iframeSrc = iw[iface] ? iw.Function.prototype.toString.call(iw[iface].prototype[name]) : null;
    var problems = [];
    if (!new RegExp('^function ' + name + '\\(\\) \\{\\s*\\[native code\\]\\s*\\}$').test(src)) problems.push('toString not native');
    if (!(d.writable && d.enumerable && d.configurable)) problems.push('descriptor flags differ from WebIDL');
    if (fn.name !== name) problems.push('name is ' + JSON.stringify(fn.name));
    if (fn.length !== len) problems.push('length ' + fn.length + ' (expected ' + len + ')');
    if (Object.prototype.hasOwnProperty.call(fn, 'prototype')) problems.push('has own prototype (natives do not)');
    if (iframeSrc !== null && iframeSrc !== src) problems.push('differs from iframe realm');
    add(id, 'natives', label, problems.length ? 'fail' : 'pass', problems.length ? { problems: problems, toString: src } : {});
  });
  f.remove();
}
