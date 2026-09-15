/** Local SVG artwork only; no training, collision, or reward decisions. */
const images = new Map();
const sceneIds = new Set(['xihu','huangshan','lijiang','zhangjiajie','erhai','dunhuang','hulunbeir','greatwall','taishan','gugong','qinghaihu','potala','wudang']);
const propIds = new Set(['water','traveler','flower','lantern','koi']);

export function stampArtUrl(sceneId, { gold = false, compact = false } = {}) {
  const id = sceneIds.has(sceneId) ? sceneId : 'xihu';
  return `assets/art/stamps/${id}${gold ? '-gold' : ''}${compact ? '-token' : ''}.svg`;
}

export function propArtUrl(name) {
  return propIds.has(name) ? `assets/art/props/${name}.svg` : null;
}

function getImage(url) {
  if (!images.has(url)) {
    const img = new Image();
    const entry = { img, ready: false };
    images.set(url, entry);
    img.onload = () => { entry.ready = img.naturalWidth > 0; };
    img.onerror = () => { entry.ready = false; };
    img.src = url;
  }
  return images.get(url);
}

export function preloadSceneArt(sceneId) {
  for (const gold of [false, true]) {
    for (const compact of [false, true]) getImage(stampArtUrl(sceneId, { gold, compact }));
  }
  for (const name of propIds) getImage(propArtUrl(name));
}

/** Draw centered into a box; false requests a visible fallback from the caller. */
export function drawArt(ctx, url, x, y, width, height = width) {
  if (!url || width <= 0 || height <= 0) return false;
  const { img, ready } = getImage(url);
  if (!ready) return false;
  const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
  return true;
}

export function drawArtFallback(ctx, x, y, size, gold = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = gold ? '#f4e4bb' : '#f5f2e5';
  ctx.strokeStyle = gold ? '#85622c' : '#24594b';
  ctx.lineWidth = Math.max(1.5, size * .035);
  ctx.beginPath(); ctx.arc(0, 0, size * .46, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-size*.28, size*.17); ctx.lineTo(-size*.08, -size*.19);
  ctx.lineTo(size*.06, size*.02); ctx.lineTo(size*.16, -size*.09); ctx.lineTo(size*.3, size*.17);
  ctx.stroke();
  ctx.restore();
}
