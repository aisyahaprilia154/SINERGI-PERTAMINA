import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

output = Path(__file__).parent / 'stage-11'
results = []
for size in ['desktop', 'mobile']:
    for theme in ['light', 'dark']:
        for state in ['detail', 'relation', 'mounting', 'icon', 'error']:
            old = Image.open(output / f'legacy-{state}-drawer-{size}-{theme}.png').convert('RGB')
            new = Image.open(output / f'react-{state}-drawer-{size}-{theme}.png').convert('RGB')
            if old.size != new.size:
                results.append(dict(size=size, theme=theme, state=state, oldSize=old.size, newSize=new.size))
                continue
            diff = ImageChops.difference(old, new)
            changed = sum(max(pixel) > 12 for pixel in diff.getdata())
            results.append(dict(size=size, theme=theme, state=state, changedPixels=changed, totalPixels=old.width*old.height))
            if changed:
                diff.save(output / f'diff-{state}-{size}-{theme}.png')
            else:
                (output / f'diff-{state}-{size}-{theme}.png').unlink(missing_ok=True)
sheet = Image.new('RGB', (960, 1800), '#ddd')
draw = ImageDraw.Draw(sheet)
for row, state in enumerate(['detail', 'relation', 'mounting', 'icon', 'error']):
    for col, version in enumerate(['legacy', 'react']):
        im = Image.open(output / f'{version}-{state}-drawer-desktop-dark.png')
        im.thumbnail((460, 330))
        sheet.paste(im, (col*480+10, row*360+25))
        draw.text((col*480+10, row*360+5), f'{version} {state}', fill='black')
sheet.save(output / 'contact-sheet.jpg')
(output / 'visual-comparison.json').write_text(json.dumps(dict(threshold=12, results=results), indent=2), encoding='utf-8')
print(json.dumps(results))
