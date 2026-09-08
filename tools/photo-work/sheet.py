"""把某景点已下载的横版候选图拼成带编号的对比图（用法: python sheet.py <scene>）"""
import sys, os, glob
from PIL import Image, ImageDraw

scene = sys.argv[1]
base = os.path.dirname(__file__)
files = sorted(glob.glob(os.path.join(base, 'raw', f'{scene}-*.jpg')))
cells = []
for f in files:
    try:
        im = Image.open(f)
        if im.size[0] > im.size[1] * 1.05:
            cells.append((f, im.convert('RGB')))
    except Exception:
        pass
cols = 4
rows = (len(cells) + cols - 1) // cols
CW, CH = 420, 260
sheet = Image.new('RGB', (cols * CW, rows * (CH + 22)), (24, 24, 28))
d = ImageDraw.Draw(sheet)
for i, (f, im) in enumerate(cells):
    im.thumbnail((CW - 8, CH - 8))
    x = (i % cols) * CW
    y = (i // cols) * (CH + 22)
    sheet.paste(im, (x + 4, y + 4))
    d.text((x + 8, y + CH + 4), f'{i}: {os.path.basename(f)}', fill=(255, 255, 120))
out = os.path.join(base, 'sheets', f'{scene}.jpg')
sheet.save(out, quality=80)
print(out, f'{len(cells)}/{len(files)} landscape candidates')
