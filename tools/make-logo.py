#!/usr/bin/env python3
"""
make-logo.py — 타이틀 로고 글자("떨어진다!!!", "RIDE IT")를 Jua 글리프 외곽선(SVG path)으로 변환해 js/title-logo-data.js로 저장.
폰트 로딩에 의존하지 않고 어떤 해상도에서도 선명한 로고를 만들기 위함. 원본 ttf는 tools/make-fonts.py가 /tmp/ride-it-fonts에 내려받음(없으면 먼저 실행).
사용: python3 tools/make-logo.py
"""
import os, json
from fontTools import ttLib
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
font = ttLib.TTFont('/tmp/ride-it-fonts/Jua.ttf')
gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm

def glyph(ch):
    name = cmap[ord(ch)]
    bp = BoundsPen(gs); gs[name].draw(bp)
    x0, y0, x1, y1 = bp.bounds
    pen = SVGPathPen(gs, ntos=lambda v: ('%.1f' % v).rstrip('0').rstrip('.'))
    # y 뒤집기(SVG 좌표) + 글리프 왼쪽 위를 원점에 맞춤: y' = -(y - y1) → 맨 위가 0
    tp = TransformPen(pen, (1, 0, 0, -1, -x0, y1))
    gs[name].draw(tp)
    return {'ch': ch, 'd': pen.getCommands(), 'w': round(x1 - x0), 'h': round(y1 - y0), 'adv': gs[name].width}

data = {'upm': upm, 'logo': [glyph(c) for c in '떨어진다!'], 'ride': [glyph(c) for c in 'RIDE'] + [glyph(c) for c in 'IT']}
js = '/** 자동 생성(tools/make-logo.py) — Jua 글리프 외곽선 path. 직접 고치지 말 것. */\nconst TITLE_LOGO_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
open(os.path.join(ROOT, 'js', 'title-logo-data.js'), 'w').write(js)
print(len(js) // 1024, 'KB', [(g['ch'], g['w'], g['h']) for g in data['logo']])
