// Shared drawing used by every canvas test (main thread, iframe and worker).
// The background is opaque on purpose: with no transparent pixels, a PNG
// round-trip (toDataURL -> decode -> getImageData) must be bit-exact, so any
// difference is caused by the readback path, not by alpha premultiplication.
var SCENE_W = 240;
var SCENE_H = 120;

function drawScene(ctx, withText) {
  ctx.fillStyle = '#f0e8d8';
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);

  var g = ctx.createLinearGradient(0, 0, SCENE_W, 0);
  g.addColorStop(0, '#c0392b');
  g.addColorStop(1, '#2980b9');
  ctx.fillStyle = g;
  ctx.fillRect(10, 10, 220, 30);

  ctx.beginPath();
  ctx.arc(60, 80, 28, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(39, 174, 96, 0.7)';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(120, 60);
  ctx.bezierCurveTo(150, 20, 200, 110, 230, 70);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#8e44ad';
  ctx.stroke();

  // Text depends on installed fonts, and fonts can differ between a document
  // and a worker, so text is only used for same-context stability checks.
  if (withText) {
    ctx.font = '16px Arial, sans-serif';
    ctx.fillStyle = '#222';
    ctx.fillText('Cwm fjord \u{1F603} 0.1', 100, 105);
  }
}

async function sha256Bytes(bytes) {
  var view = bytes instanceof Uint8Array ? bytes
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var digest = await crypto.subtle.digest('SHA-256', view);
  return Array.from(new Uint8Array(digest), function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('').slice(0, 16);
}
