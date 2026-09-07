"""下载 Pexels 候选图到 raw/ 并报告尺寸（用法: python fetch.py <scene> <pexels_id>...）"""
import sys, os, subprocess

scene = sys.argv[1]
ids = sys.argv[2:]
outdir = os.path.join(os.path.dirname(__file__), 'raw')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

for pid in ids:
    dest = os.path.join(outdir, f'{scene}-{pid}.jpg')
    url = f'https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?auto=compress&cs=tinysrgb&w=1600'
    if not os.path.exists(dest) or os.path.getsize(dest) < 10000:
        subprocess.run(['curl', '-s', '--max-time', '40', '-A', UA, url, '-o', dest], check=False)
    try:
        from PIL import Image
        im = Image.open(dest)
        land = 'LANDSCAPE' if im.size[0] > im.size[1] * 1.05 else 'portrait/square'
        print(f'{scene}-{pid}.jpg {im.size[0]}x{im.size[1]} {os.path.getsize(dest)//1024}KB {land}')
    except Exception as e:
        print(f'{scene}-{pid}.jpg FAILED {e}')
