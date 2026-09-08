"""把核验通过的候选图处理为成品：assets/photos/<scene>-2.jpg / -3.jpg / -4.jpg
横版图直接居中裁 16:9；竖版图裁取上部约 55% 高度的横条（山景/建筑主体通常在上半部）。
用法: python produce.py
"""
import os, sys
from PIL import Image

BASE = os.path.dirname(__file__)
RAW = os.path.join(BASE, 'raw')
OUT = os.path.join(BASE, '..', '..', 'assets', 'photos')

# scene -> [(raw_id, orientation)]  orientation: L=横版, P=竖版
SELECTION = {
    'xihu':        [('34628153', 'L'), ('33671633', 'L'), ('32732917', 'L')],
    'huangshan':   [('31582902', 'L'), ('38769324', 'L'), ('28957341', 'L')],
    'lijiang':     [('24246271', 'L'), ('24246270', 'L'), ('24887037', 'L')],
    'zhangjiajie': [('33231934', 'L'), ('37621083', 'L'), ('38967058', 'L')],
    'erhai':       [('36552431', 'L'), ('33970874', 'L'), ('38402528', 'L')],
    'dunhuang':    [('25974825', 'L'), ('33412586', 'L'), ('33412587', 'L')],
    'hulunbeir':   [('35497986', 'L'), ('35497983', 'L'), ('33770617', 'L')],
    'greatwall':   [('19031655', 'L'), ('37099720', 'L'), ('3892425', 'L')],
    'taishan':     [('31506012', 'L'), ('31090636', 'L'), ('5765823', 'L')],
    'gugong':      [('31508175', 'L'), ('6560976', 'L'), ('10578436', 'L')],
    'qinghaihu':   [('34630868', 'L'), ('31811948', 'L'), ('38693022', 'L')],
    'potala':      [('31013239', 'L'), ('8604524', 'L'), ('29370347', 'L')],
    'wudang':      [('14516289', 'P'), ('14516291', 'P'), ('37138674', 'L')],
}

def process(src, dest, bias):
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
    return os.path.getsize(dest) // 1024, q

total = 0
for scene, items in SELECTION.items():
    for i, (pid, orient) in enumerate(items, start=2):
        src = os.path.join(RAW, f'{scene}-{pid}.jpg')
        dest = os.path.join(OUT, f'{scene}-{i}.jpg')
        if not os.path.exists(src):
            print(f'MISSING {src}')
            continue
        kb, q = process(src, dest, 0.35 if orient == 'P' else 0.45)
        total += kb
        print(f'{scene}-{i}.jpg  <- {pid}  {kb}KB q{q}')
print(f'TOTAL {total}KB')
