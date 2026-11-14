// Draws the no-text scene on an OffscreenCanvas inside a dedicated worker and
// returns the getImageData hash, so the main thread can compare it with the
// same scene read back from a document canvas.
importScripts('scene.js');

self.onmessage = async function () {
  try {
    var c = new OffscreenCanvas(SCENE_W, SCENE_H);
    var ctx = c.getContext('2d');
    drawScene(ctx, false);
    var a = await sha256Bytes(ctx.getImageData(0, 0, SCENE_W, SCENE_H).data);
    var b = await sha256Bytes(ctx.getImageData(0, 0, SCENE_W, SCENE_H).data);
    self.postMessage({ ok: true, hash: a, stable: a === b });
  } catch (e) {
    self.postMessage({ ok: false, error: String(e) });
  }
};
