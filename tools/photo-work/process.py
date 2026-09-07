"""候选图 → 16:9 / 1600×900 / ≤200KB 成品（用法: python process.py <src> <dest> [垂直裁切重心0~1]）"""
import sys, os
from PIL import Image

src, dest = sys.argv[1], sys.argv[2]
bias = float(sys.argv[3]) if len(sys.argv) > 3 else 0.42
im = Image.open(src).convert('RGB')
w, h = im.size
target = 16 / 9
if w / h < target:
    nh = int(w / target)
    top = max(0, min(h - nh, int((h - nh) * bias)))
    im = im.crop((0, top, w, top + nh))
else:
    nw = int(h * target)
    left = max(0, min(w - nw, (w - nw) // 2))
    im = im.crop((left, 0, left + nw, h))
im = im.resize((1600, 900), Image.LANCZOS)
q = 84
while True:
    im.save(dest, quality=q, optimize=True, progressive=True)
    if os.path.getsize(dest) <= 200 * 1024 or q <= 60:
        break
    q -= 4
print(f'{dest} {os.path.getsize(dest)//1024}KB q={q}')
