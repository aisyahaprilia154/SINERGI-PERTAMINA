import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw
output = Path(__file__).parent / 'stage-7'
results = []
for size in ['desktop', 'mobile']:
    for theme in ['light', 'dark']:
        for state in ['table', 'header', 'drawer-panel', 'discard-panel']:
            old = Image.open(output / f'legacy-{state}-{size}-{theme}.png').convert('RGB')
            new = Image.open(output / f'react-{state}-{size}-{theme}.png').convert('RGB')
            assert old.size == new.size, (size, theme, state, old.size, new.size)
            diff = ImageChops.difference(old, new)
            pixels = sum(max(pixel) > 12 for pixel in diff.getdata())
            results.append(dict(size=size, theme=theme, state=state, changedPixels=pixels, totalPixels=old.width * old.height, bbox=diff.getbbox()))
            if pixels: diff.save(output / f'diff-{state}-{size}-{theme}.png')
sheet = Image.new('RGB', (960, 4 * 320), '#ddd'); draw = ImageDraw.Draw(sheet)
for index, state in enumerate(['list', 'drawer', 'discard', 'empty']):
    for column, implementation in enumerate(['legacy', 'react']):
        screenshot = Image.open(output / f'{implementation}-{state}-desktop-dark.png').convert('RGB'); screenshot.thumbnail((480, 295))
        sheet.paste(screenshot, (column * 480, index * 320 + 25)); draw.text((column * 480 + 10, index * 320 + 6), f'{implementation} {state}', fill='black')
sheet.save(output / 'contact-sheet.jpg')
(output / 'visual-comparison.json').write_text(json.dumps(dict(threshold=12, note='Full pages intentionally add search/status toolbar. Compare unchanged parts without hiding new UI.', results=results), indent=2), encoding='utf8')
print(json.dumps(results, indent=2))
