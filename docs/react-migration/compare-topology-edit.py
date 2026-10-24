import json
import hashlib
import re
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

root = Path(__file__).parent / 'stage-15'
captures = json.loads((root / 'capture-results.json').read_text(encoding='utf-8'))['results']
states = ['detail', 'composer', 'draft', 'export', 'rename']
rows = []
for size in ['desktop', 'mobile']:
    for theme in ['light', 'dark']:
        for state in states:
            old = Image.open(root / f'legacy-{state}-crop-{size}-{theme}.png').convert('RGB')
            new = Image.open(root / f'react-{state}-crop-{size}-{theme}.png').convert('RGB')
            row = dict(size=size, theme=theme, state=state, oldSize=old.size, newSize=new.size)
            old_capture = next(r for r in captures if r['implementation'] == 'legacy' and (r['state'], r['size'], r['theme']) == (state, size, theme))
            new_capture = next(r for r in captures if r['implementation'] == 'react' and (r['state'], r['size'], r['theme']) == (state, size, theme))
            if old_capture.get('viewportMetrics') is not None:
                row['viewportIdentical'] = old_capture['viewportMetrics'] == new_capture['viewportMetrics']
            if old.size == new.size:
                diff = ImageChops.difference(old, new)
                changed = sum(max(pixel) > 12 for pixel in diff.getdata())
                row.update(changedPixels=changed, totalPixels=old.width * old.height)
                if changed:
                    diff.save(root / f'diff-{state}-{size}-{theme}.png')
                else:
                    (root / f'diff-{state}-{size}-{theme}.png').unlink(missing_ok=True)
            old_svg = root / f'legacy-{state}-{size}-{theme}.svg'
            new_svg = root / f'react-{state}-{size}-{theme}.svg'
            if old_capture.get('rawSvgSha256'):
                row['rawSvgIdentical'] = old_capture['rawSvgSha256'] == new_capture['rawSvgSha256']
            if old_svg.exists() and new_svg.exists():
                old_text = old_svg.read_text(encoding='utf-8')
                new_text = new_svg.read_text(encoding='utf-8')
                row['svgWithoutKeyboardAttributesIdentical'] = re.sub(r' (?:tabindex="0"|role="button"|aria-label="Ganti nama frame")', '', old_text) == re.sub(r' (?:tabindex="0"|role="button"|aria-label="Ganti nama frame")', '', new_text)
                row.update(svgIdentical=old_text == new_text, oldSvgSha256=hashlib.sha256(old_text.encode()).hexdigest(), newSvgSha256=hashlib.sha256(new_text.encode()).hexdigest())
            rows.append(row)
sheet = Image.new('RGB', (1200, len(states) * 350), '#ddd')
draw = ImageDraw.Draw(sheet)
for i, state in enumerate(states):
    for j, implementation in enumerate(['legacy', 'react']):
        im = Image.open(root / f'{implementation}-{state}-crop-desktop-dark.png')
        im.thumbnail((580, 315))
        sheet.paste(im, (j * 600 + 10, i * 350 + 25))
        draw.text((j * 600 + 10, i * 350 + 5), implementation + ' ' + state, fill='black')
sheet.save(root / 'contact-sheet.jpg')
(root / 'visual-comparison.json').write_text(json.dumps(dict(threshold=12, results=rows), indent=2) + '\n', encoding='utf-8')
print(json.dumps(rows))
