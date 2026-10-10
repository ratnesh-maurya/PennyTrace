#!/usr/bin/env python3
"""
Generates the PennyTrace logo (SVG variants) from simple geometry, into assets/brand/.
A coin leaving a trail of ever smaller dots: a penny, traced. Colours are the app's own
(electric blue hero gradient from src/ui/theme/palette.ts, white).

    python3 scripts/make-logo.py          # writes the .svg files
    scripts/render-logo.sh                # renders them to PNG with Chrome
"""
import math, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / 'assets' / 'brand'
OUT.mkdir(parents=True, exist_ok=True)

# App theme (light accent "blue"): hero gradient 140deg and accent.
G0, G1, G2 = '#1440DB', '#2563FF', '#4C95FF'
ACCENT = '#1E5EFF'
SIZE = 1024

# ---- geometry: a ₹ coin, and dots shrinking away from it along a rising curve -----------------
COIN_R = 150
RATIO = 0.66          # each dot is this much smaller than the one before
GAP = 26              # clear space between neighbouring circles
N_DOTS = 4
START_HEADING = math.radians(104)   # screen coords (y down): from the coin, steeply down-left…
ARC_R = 540                         # …flattening to the left: the trail reads as a rising curve

# ₹ drawn as strokes in a coin of radius 100 (centre at 0,0): two bars, a bowl, a leg.
RUPEE = ('M-36 -42H38 M-36 -14H38 '
         'M-36 -42H2C30 -42 30 2 2 2H-36 '
         'M-36 2L28 56')

def build():
    radii = [COIN_R]
    for _ in range(N_DOTS):
        radii.append(radii[-1] * RATIO)
    pts = [(0.0, 0.0)]
    x = y = 0.0
    heading = START_HEADING
    for i in range(1, len(radii)):
        step = radii[i - 1] + radii[i] + GAP
        heading_mid = heading + (step / ARC_R) / 2
        x += step * math.cos(heading_mid)
        y += step * math.sin(heading_mid)
        heading += step / ARC_R
        pts.append((x, y))
    return pts, radii

def placed(mode):
    """Centre the mark and scale it: 'icon' = fills ~64% of the canvas, 'adaptive' = inside the launcher safe circle."""
    pts, radii = build()
    x0 = min(p[0] - r for p, r in zip(pts, radii)); x1 = max(p[0] + r for p, r in zip(pts, radii))
    y0 = min(p[1] - r for p, r in zip(pts, radii)); y1 = max(p[1] + r for p, r in zip(pts, radii))
    cx0, cy0 = (x0 + x1) / 2, (y0 + y1) / 2
    pts = [(p[0] - cx0, p[1] - cy0) for p in pts]            # bbox centre at origin
    far = max(math.hypot(p[0], p[1]) + r for p, r in zip(pts, radii))
    if mode == 'adaptive':
        k = (SIZE * 66 / 108 / 2) * 0.96 / far               # launcher masks anything outside 66/108
    else:
        k = SIZE * 0.64 / max(x1 - x0, y1 - y0)
    pts = [(SIZE / 2 + p[0] * k, SIZE / 2 + p[1] * k) for p in pts]
    return pts, [r * k for r in radii], k

def mark(mode='icon'):
    pts, radii, k = placed(mode)
    out = []
    for i in range(len(pts) - 1, 0, -1):                     # far end first, coin last (on top)
        (cx, cy), r = pts[i], radii[i]
        out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="#fff" fill-opacity="{1.0 - 0.17 * i:.2f}"/>')
    cx, cy = pts[0]
    r = radii[0]
    u = r / 100
    out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="#fff"/>')
    out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r * 0.87:.1f}" fill="none" stroke="{ACCENT}" stroke-opacity="0.28" stroke-width="{r * 0.045:.1f}"/>')
    # the ₹ glyph spans x -36..38, y -42..56: centre it in the coin and enlarge it
    out.append(f'<path transform="translate({cx:.1f} {cy:.1f}) scale({u * 1.14:.4f}) translate(-1 -7)" d="{RUPEE}" fill="none" stroke="{ACCENT}" '
               f'stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>')
    return '\n  '.join(out), pts, radii

def defs():
    # CSS linear-gradient(140deg, ...) as an SVG vector over the unit square
    a = math.radians(140)
    dx, dy = math.sin(a), -math.cos(a)
    x1, y1, x2, y2 = 0.5 - dx / 2, 0.5 - dy / 2, 0.5 + dx / 2, 0.5 + dy / 2
    return f'''<defs>
  <linearGradient id="bg" x1="{x1:.3f}" y1="{y1:.3f}" x2="{x2:.3f}" y2="{y2:.3f}">
    <stop offset="0" stop-color="{G0}"/><stop offset="0.52" stop-color="{G1}"/><stop offset="1" stop-color="{G2}"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.78" cy="0.12" r="0.55">
    <stop offset="0" stop-color="#fff" stop-opacity="0.30"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </radialGradient>
</defs>'''

def svg(body, bg=True, rounded=False, circle=False):
    rx = f' rx="{SIZE * 0.2237:.0f}"' if rounded else (f' rx="{SIZE // 2}"' if circle else '')
    back = f'<rect width="{SIZE}" height="{SIZE}"{rx} fill="url(#bg)"/>\n  <rect width="{SIZE}" height="{SIZE}"{rx} fill="url(#glow)"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="{SIZE}" height="{SIZE}">\n{defs()}\n  {back}\n  {body}\n</svg>\n'

body_icon, pts, radii = mark('icon')
body_adaptive, pts_a, radii_a = mark('adaptive')
far = max(math.hypot(p[0] - SIZE / 2, p[1] - SIZE / 2) + r for p, r in zip(pts_a, radii_a))
print(f'adaptive mark reaches {far:.0f}px from centre; safe radius {SIZE * 66 / 108 / 2:.0f}px')

(OUT / 'icon-square.svg').write_text(svg(body_icon))                      # Play listing, full bleed
(OUT / 'logo-rounded.svg').write_text(svg(body_icon, rounded=True))       # README / web
(OUT / 'logo-round.svg').write_text(svg(body_icon, circle=True))           # legacy round launcher icon
(OUT / 'adaptive-foreground.svg').write_text(svg(body_adaptive, bg=False)) # launcher foreground (transparent)
(OUT / 'adaptive-background.svg').write_text(svg('', bg=True))            # launcher background
(OUT / 'mark-white.svg').write_text(svg(body_icon, bg=False))             # the mark alone
print('wrote', *sorted(p.name for p in OUT.glob('*.svg')))
