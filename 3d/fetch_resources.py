# -*- coding: utf-8 -*-
"""下载 3D 几何画板所需的全部外部资源到本地，实现断网可用。"""
import os, re, urllib.request, concurrent.futures

ROOT = os.path.dirname(os.path.abspath(__file__))
def path(*p): return os.path.join(ROOT, *p)
def mkdir(p): os.makedirs(p, exist_ok=True)
mkdir(path('fonts', 'files')); mkdir(path('lib'))

def fetch(url, dest):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    data = urllib.request.urlopen(req, timeout=60).read()
    with open(dest, 'wb') as f: f.write(data)
    return len(data)

jobs = []

# 1. Computer Modern（KaTeX 字体构建，OFL）：正体 cmr + 数学斜体 cmmi
KT = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/'
for fn in ['KaTeX_Main-Regular.woff2', 'KaTeX_Main-Bold.woff2', 'KaTeX_Math-Italic.woff2']:
    jobs.append((KT + fn, path('fonts', fn)))

# 2. JS 库：Three.js r128 + OrbitControls + mathjs
jobs += [
    ('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', path('lib', 'three.min.js')),
    ('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js', path('lib', 'OrbitControls.js')),
    ('https://cdn.jsdelivr.net/npm/mathjs@11.11.0/lib/browser/math.js', path('lib', 'math.js')),
]

# 3. 思源宋体（Noto Serif SC，OFL）：400/700 两个权重，fontsource 分包（仅取 woff2）
NS = 'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5/'
css_parts = []
for weight, cssname in [('index', '400'), ('700', '700')]:
    req = urllib.request.Request(NS + weight + '.css', headers={'User-Agent': 'Mozilla/5.0'})
    css = urllib.request.urlopen(req, timeout=60).read().decode('utf-8')
    for m in re.finditer(r"url\(\./files/([^\)]+\.woff2)\)", css):
        jobs.append((NS + 'files/' + m.group(1), path('fonts', 'files', m.group(1))))
    # 只保留本地 woff2 引用，去掉 woff 回退
    css = re.sub(r"src: url\(\./files/([^\)]+\.woff2)\) format\('woff2'\), url\(\./files/[^\)]+\.woff\) format\('woff'\);",
                 r"src:url('./files/\1') format('woff2');", css)
    css_parts.append(css)

print('total downloads:', len(jobs))
fails = []
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
    futs = {ex.submit(fetch, u, d): (u, d) for u, d in jobs}
    done = 0
    for fut in concurrent.futures.as_completed(futs):
        u, d = futs[fut]
        try:
            n = fut.result(); done += 1
            if done % 25 == 0 or done == len(jobs): print('progress', done, '/', len(jobs))
        except Exception as e:
            fails.append((u, str(e)))
if fails:
    print('FAILURES:')
    for u, e in fails: print(' ', u, e)
    raise SystemExit(1)

# 4. 思源宋体 CSS：URL 重写为本地相对路径
noto_css = '\n'.join(css_parts)
noto_css = noto_css.replace("url('./files/", "url('./files/")
with open(path('fonts', 'noto-serif-sc.css'), 'w', encoding='utf-8') as f:
    f.write(noto_css)

# 5. Computer Modern @font-face 声明
cm_css = """/* Computer Modern（KaTeX 构建，SIL OFL）：KaTeX Main = cmr 罗马体；CM Math Italic = cmmi 数学斜体 */
@font-face{font-family:'KaTeX Main';font-style:normal;font-weight:400;font-display:swap;
  src:url('./KaTeX_Main-Regular.woff2') format('woff2');}
@font-face{font-family:'KaTeX Main';font-style:normal;font-weight:700;font-display:swap;
  src:url('./KaTeX_Main-Bold.woff2') format('woff2');}
@font-face{font-family:'CM Math Italic';font-style:normal;font-weight:400;font-display:swap;
  src:url('./KaTeX_Math-Italic.woff2') format('woff2');}
"""
with open(path('fonts', 'computer-modern.css'), 'w', encoding='utf-8') as f:
    f.write(cm_css)

print('ALL_DOWNLOADS_OK')
