"""Build original scenic emblems around attributed Game-icons motifs. No raster editing."""
from pathlib import Path
import math
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/art'
NS = '{http://www.w3.org/2000/svg}'

def icon(name):
    root = ET.parse(OUT / 'sources' / (name.replace('/', '--') + '.svg')).getroot()
    return ''.join(f'<path d="{p.attrib["d"]}"/>' for p in root.findall(NS + 'path') if p.get('fill') == '#fff')

def motif(name):
    return f'<g transform="translate(62 45) scale(.258)" fill="currentColor">{icon(name)}</g>'

waves = '<path d="M65 159q15-10 30 0t30 0t30 0t30 0M75 171q15-8 30 0t30 0t30 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'
custom = {
    'pillars': '<path d="M62 164l5-59 14-17 15 20 3 56zm45 0l4-106 12-16 16 23 2 99zm44 0l5-78 16-20 17 35 5 63z" fill="currentColor"/><path d="M65 111h20m31-39h14m31 31h15" stroke="#f4f0dd" stroke-width="4"/>',
    'wall': '<path d="M50 160l26-37 23 4 27-32 28 6 42-43 13 14-46 53-29-5-26 33-24-4-20 31z" fill="currentColor"/><path d="M70 113V96h9v9h9v-9h9v30m26-38V72h9v8h9v-8h9v24m36-42V37h9v9h9v-9h9v26" fill="none" stroke="currentColor" stroke-width="6"/>',
    'palace': '<path d="M52 163V120h24V94h29V66h53v28h24v26h22v43z" fill="currentColor"/><path d="M100 64h64M72 92h37m46 0h33M48 119h32m98 0h31" stroke="currentColor" stroke-width="7"/><path d="M119 81h10v15h-10zm20 0h10v15h-10zm-49 30h10v14H90zm32 0h10v14h-10zm33 0h10v14h-10zm-83 28h10v14H72zm28 0h10v14h-10zm27 0h10v24h-10zm28 0h10v14h-10zm26 0h10v14h-10z" fill="#f4f0dd"/>',
    'lake': '<circle cx="159" cy="75" r="17" fill="currentColor"/><path d="M58 132l34-50 33 42 24-22 42 37H58z" fill="currentColor"/>' + waves,
    'dunes': '<circle cx="165" cy="67" r="20" fill="currentColor"/><path d="M47 158q35-74 97-58-39 8-51 34 60-41 115 24z" fill="currentColor"/><path d="M64 176q62-22 128 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>',
    'imperial': '<g fill="currentColor"><path d="M128 53q-15 25-55 27l10 10h90l10-10q-40-2-55-27zm-44 39h88v17H84zM128 100q-37 35-88 38l14 11h148l14-11q-51-3-88-38zM62 150h132v22H62z"/><path d="M71 160h12v24H71zm101 0h12v24h-12z"/></g><path d="M104 151h48v23h-48z" fill="#f4f0dd"/><path d="M127 151v25" stroke="currentColor" stroke-width="5"/>',
    'taoist': '<path d="M48 142 84 62l35 55 18-29 53 63z" fill="currentColor" opacity=".4"/><path d="M150 88q-15 23-52 29l9 10h90l10-10q-37-6-57-29zM116 130h74v37h-74zM106 174h94v9h-94z" fill="currentColor"/><path d="M139 140h18v27h-18z" fill="#f4f0dd"/>',
    'highlandLake': '<circle cx="90" cy="65" r="13" fill="currentColor"/><path d="M55 120 101 88l25 21 31-29 45 40z" fill="currentColor"/><path d="M55 137q36-12 73 0t73 0M61 154q33-11 67 0t67 0M74 171q27-10 54 0t54 0" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round"/>',
}
SCENES = [
    ('xihu','杭州西湖',motif('lorc/lotus')),
    ('huangshan','黄山云海',motif('lorc/mountaintop')),
    ('lijiang','桂林漓江',motif('delapouite/mountain-road')),
    ('zhangjiajie','张家界',custom['pillars']),
    ('erhai','大理洱海',custom['lake']),
    ('dunhuang','敦煌鸣沙山',custom['dunes']),
    ('hulunbeir','呼伦贝尔',motif('delapouite/grass')),
    ('greatwall','万里长城',custom['wall']),
    ('taishan','泰山日出',motif('delapouite/sunrise')),
    ('gugong','故宫',custom['imperial']),
    ('qinghaihu','青海湖',custom['highlandLake']),
    ('potala','布达拉宫',custom['palace']),
    ('wudang','武当仙山',custom['taoist']),
]

def svg(body, title, view='0 0 256 256'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" role="img"><title>{title}</title>{body}</svg>'

def emblem(scene_id, title, picture, number, gold=False, compact=False):
    ink, edge, paper = ('#735221','#ae884c','#f4e4bb') if gold else ('#24594b','#608878','#f5f2e5')
    # A twelve-lobed die-cut outline; all geometry fixed at build time.
    pts=[]
    for i in range(144):
        theta = i * math.tau / 144 - math.pi/2
        radius = 119 + 2.1 * math.cos(i * math.tau / 12)
        pts.append(f'{128+radius*math.cos(theta):.2f},{128+radius*math.sin(theta):.2f}')
    rim = ''.join(f'<circle cx="{128+107*math.cos(a*math.tau/48):.2f}" cy="{128+107*math.sin(a*math.tau/48):.2f}" r="1.15" fill="{edge}"/>' for a in range(48))
    crown = '<path d="m128 20 3 7 8 1-6 5 1 8-6-4-6 4 1-8-6-5 8-1z" fill="currentColor"/>' if gold else '<path d="M116 26h24" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'
    body=f'<g color="{ink}"><polygon points="{" ".join(pts)}" fill="{paper}" stroke="{edge}" stroke-width="2.5"/><circle cx="128" cy="128" r="112" fill="none" stroke="{edge}" stroke-width="1.4"/>{rim}<circle cx="128" cy="113" r="80" fill="{ink}" opacity=".045"/>{crown}{picture}<path d="M65 183h126" stroke="{edge}" stroke-width="1.2"/><text x="128" y="211" text-anchor="middle" fill="{ink}" font-family="sans-serif" font-size="{19 if len(title)>5 else 22}" font-weight="650" letter-spacing="2">{title}</text><text x="128" y="229" text-anchor="middle" fill="{ink}" font-family="sans-serif" font-size="8" letter-spacing="2">山 河 · {number:02d}</text></g>'
    if compact:
        # Keep die-cut frame, give the motif the full center, omit text at game-token sizes.
        body = f'<g color="{ink}"><polygon points="{" ".join(pts)}" fill="{paper}" stroke="{edge}" stroke-width="5"/><circle cx="128" cy="128" r="106" fill="none" stroke="{edge}" stroke-width="2"/><g transform="translate(-22 -2) scale(1.17)">{picture}</g></g>'
    return svg(body, f'{title}{"金色纪念章" if gold else "纪念章"}')

def build():
    (OUT/'stamps').mkdir(exist_ok=True)
    (OUT/'props').mkdir(exist_ok=True)
    for n,(key,title,picture) in enumerate(SCENES,1):
        for gold in (False,True):
            (OUT/'stamps'/f'{key}{"-gold" if gold else ""}.svg').write_text(emblem(key,title,picture,n,gold),encoding='utf-8')
            (OUT/'stamps'/f'{key}{"-gold" if gold else ""}-token.svg').write_text(emblem(key,title,picture,n,gold,True),encoding='utf-8')
    # Use the bottle from the source, crop the companion glass, and remove the black background.
    bottle=svg(f'<g fill="#28675c">{icon("delapouite/water-bottle")}</g>','旅行水瓶','70 18 181 492')
    (OUT/'props/water.svg').write_text(bottle,encoding='utf-8')
    # Retain the source hiker's head/body/backpack. Replace its mountain with a light hiking staff.
    d=ET.parse(OUT/'sources/delapouite--hiking.svg').getroot().findall(NS+'path')[1].get('d')
    d=d.split('m352.7')[0]
    hiker=svg(f'<path d="M307 157l87 311" stroke="#d7ba7c" stroke-width="16" stroke-linecap="round"/><path d="{d}" fill="#dce9dc"/><path d="m137 156-40 12-6 86q23 11 43 3z" fill="#bca46f"/>','山河旅行者','65 32 340 454')
    (OUT/'props/traveler.svg').write_text(hiker,encoding='utf-8')
    flower=svg(f'<g transform="translate(18 18) scale(.43)" fill="#995c60">{icon("lorc/lotus")}</g>','莲花吉物')
    (OUT/'props/flower.svg').write_text(flower,encoding='utf-8')
    lantern=svg('<g stroke="#975f49" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M128 23v22m0 169v22m-13-8v17m26-17v17"/><rect x="96" y="41" width="64" height="13" rx="6" fill="#c6ac73"/><path d="M91 55h74q43 70 0 142H91q-43-72 0-142z" fill="#bf7661"/><path d="M108 57q-22 68 0 138m40-138q22 68 0 138M128 57v138" fill="none" stroke="#edc4a0" stroke-width="5"/><rect x="97" y="199" width="62" height="12" rx="5" fill="#c6ac73"/></g>','旅行灯笼')
    (OUT/'props/lantern.svg').write_text(lantern,encoding='utf-8')
    koi=svg('<path d="M188 99q-55-68-129 23-6 47 39 49 51-6 90-72z" fill="#e6c6a0" stroke="#647b69" stroke-width="5"/><path d="M61 124 23 97l10 63 48-12z" fill="#a65a44"/><path d="M181 96q-47 20-57 48-18 21-37 25 54 6 101-70z" fill="#b26c51"/><path d="M143 88q-14-28-39-19l9 38m5 50 17 23 17-34" fill="#557767"/><circle cx="165" cy="109" r="5" fill="#28483c"/>','锦鲤吉物')
    (OUT/'props/koi.svg').write_text(koi,encoding='utf-8')
    print(f'Built {len(SCENES)*4} emblems and 5 props')

if __name__ == '__main__':
    build()
