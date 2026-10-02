#!/usr/bin/env python3
"""
make-fonts.py — UI에 실제로 쓰는 글자만 담은 자체 호스팅 woff2를 만든다 (Noto Sans KR 가변 400~700 + Jua).
  python3 tools/make-fonts.py          # 글자 수집 → 서브셋 → assets/fonts/*.woff2, css/fonts.css, OFL 라이선스 파일
  python3 tools/make-fonts.py --check  # 소스에서 쓰는 한글이 서브셋에 다 있는지만 검사(없으면 exit 1)
원본 ttf는 /tmp/ride-it-fonts에 내려받아 캐시(저장소에 넣지 않음). 문구를 바꾸면 이 스크립트를 다시 돌릴 것.
라이선스: SIL Open Font License 1.1 — assets/fonts/OFL-*.txt
"""
import sys, re, os, glob, urllib.request
from fontTools import subset, ttLib
from fontTools.varLib import instancer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CACHE = '/tmp/ride-it-fonts'
SRC = {
    'NotoSansKR': ('https://github.com/google/fonts/raw/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf', 'https://github.com/google/fonts/raw/main/ofl/notosanskr/OFL.txt'),
    'Jua': ('https://github.com/google/fonts/raw/main/ofl/jua/Jua-Regular.ttf', 'https://github.com/google/fonts/raw/main/ofl/jua/OFL.txt'),
}
EXTRA = "…·—–•▼▲◀▶★☆●○✓✕×±↑↓←→♥%+-.,:;!?()[]{}/\\'\"&@#*=<>_~|^`$ "  # 키트·HUD·문구에서 쓰는 기호
LOGO = "떨어진다!!!RIDE IT"

def strip_comments(text, kind):
    if kind == 'js':
        out, i, n = [], 0, len(text)
        while i < n:
            c = text[i]
            if c in '\'"`':
                q = c; j = i + 1
                while j < n and text[j] != q:
                    j += 2 if text[j] == '\\' else 1
                out.append(text[i:j + 1]); i = j + 1
            elif text.startswith('//', i):
                j = text.find('\n', i); i = n if j < 0 else j
            elif text.startswith('/*', i):
                j = text.find('*/', i); i = n if j < 0 else j + 2
            else:
                out.append(c); i += 1
        return ''.join(out)
    return re.sub(r'/\*.*?\*/', '', re.sub(r'<!--.*?-->', '', text, flags=re.S), flags=re.S)

def collect():
    chars = set(EXTRA) | set(LOGO) | {chr(c) for c in range(0x20, 0x7F)}
    files = glob.glob(os.path.join(ROOT, 'js', '*.js')) + [os.path.join(ROOT, 'index.html')] + glob.glob(os.path.join(ROOT, 'css', '*.css')) + glob.glob(os.path.join(ROOT, 'assets', 'title', '*.svg'))
    for f in files:
        if os.path.basename(f) == 'ui-kit.js': pass
        t = open(f, encoding='utf-8').read()
        t = strip_comments(t, 'js' if f.endswith('.js') else 'html')
        chars |= {c for c in t if ord(c) > 0x7E and not c.isspace()}
    return chars

def fetch(url, dest):
    if not os.path.exists(dest):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        print('download', url); urllib.request.urlretrieve(url, dest)
    return dest

def build():
    chars = collect()
    print('글자 수', len(chars), '(한글 음절', sum(1 for c in chars if 0xAC00 <= ord(c) <= 0xD7A3), ')')
    os.makedirs(os.path.join(ROOT, 'assets', 'fonts'), exist_ok=True)
    for name, (ttf, ofl) in SRC.items():
        src = fetch(ttf, os.path.join(CACHE, name + '.ttf')); fetch(ofl, os.path.join(ROOT, 'assets', 'fonts', f'OFL-{name}.txt'))
        font = ttLib.TTFont(src)
        opts = subset.Options(); opts.layout_features = ['kern', 'locl', 'ccmp']; opts.notdef_outline = True; opts.name_IDs = [1, 2]
        sub = subset.Subsetter(opts); sub.populate(unicodes=[ord(c) for c in chars]); sub.subset(font)
        if 'fvar' in font:  # 가변 폰트: 서브셋한 뒤 400~700만 남겨 용량 축소
            font = instancer.instantiateVariableFont(font, {'wght': (400, 700)})
        out = os.path.join(ROOT, 'assets', 'fonts', f'{name}-subset.woff2')
        font.flavor = 'woff2'; font.save(out); print(name, os.path.getsize(out) // 1024, 'KB')
    css = """/* fonts.css — 자체 호스팅 서브셋 글꼴(tools/make-fonts.py가 생성). 폴백: -apple-system, "Apple SD Gothic Neo", sans-serif */
@font-face { font-family: "Noto Sans KR"; font-style: normal; font-weight: 400 700; font-display: swap; src: url("../assets/fonts/NotoSansKR-subset.woff2") format("woff2"); }
@font-face { font-family: "Jua"; font-style: normal; font-weight: 400; font-display: swap; src: url("../assets/fonts/Jua-subset.woff2") format("woff2"); }
"""
    open(os.path.join(ROOT, 'css', 'fonts.css'), 'w').write(css)

def check():
    chars = collect()
    ok = True
    for name in SRC:
        path = os.path.join(ROOT, 'assets', 'fonts', f'{name}-subset.woff2')
        cmap = set(ttLib.TTFont(path).getBestCmap().keys())
        # 서브셋 원본에 없는 글자는 원래 폰트에 없는 것 — 원본(캐시)과 비교해 "원본엔 있는데 서브셋에 빠진" 글자만 문제
        src = os.path.join(CACHE, name + '.ttf')
        full = set(ttLib.TTFont(src).getBestCmap().keys()) if os.path.exists(src) else None
        miss = [c for c in chars if ord(c) not in cmap and (full is None or ord(c) in full) and not c.isspace()]
        print(name, '누락 글자', ''.join(sorted(miss)) or '없음'); ok = ok and not miss
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    check() if '--check' in sys.argv else build()
