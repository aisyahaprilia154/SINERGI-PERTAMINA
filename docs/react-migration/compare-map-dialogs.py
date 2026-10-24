import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

output = Path(__file__).parent / 'stage-12'
states = ['import', 'export', 'all', 'full', 'selected', 'search', 'empty']
results = []
for size in ['desktop', 'mobile']:
    for theme in ['light', 'dark']:
        for state in states:
            old = Image.open(output / f'legacy-{state}-dialog-{size}-{theme}.png').convert('RGB')
            new = Image.open(output / f'react-{state}-dialog-{size}-{theme}.png').convert('RGB')
            row = dict(size=size, theme=theme, state=state, oldSize=old.size, newSize=new.size)
            if old.size == new.size:
                diff = ImageChops.difference(old, new)
                changed = sum(max(pixel) > 12 for pixel in diff.getdata())
                row.update(changedPixels=changed, totalPixels=old.width * old.height)
                if changed:
                    diff.save(output / f'diff-{state}-{size}-{theme}.png')
            results.append(row)
sheet = Image.new('RGB', (1200, 7 * 390), '#ddd')
draw = ImageDraw.Draw(sheet)
for row, state in enumerate(states):
    for col, version in enumerate(['legacy', 'react']):
        im = Image.open(output / f'{version}-{state}-dialog-desktop-dark.png')
        im.thumbnail((580, 355))
        sheet.paste(im, (col * 600 + 10, row * 390 + 25))
        draw.text((col * 600 + 10, row * 390 + 5), f'{version} {state}', fill='black')
sheet.save(output / 'contact-sheet.jpg')
(output / 'visual-comparison.json').write_text(json.dumps(dict(threshold=12, results=results), indent=2), encoding='utf-8')
print(json.dumps(results))
