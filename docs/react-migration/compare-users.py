"""Compare stage 5 React UI with the legacy renderer and original list baseline."""
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

root = Path(__file__).parent
output = root / 'stage-5'
results = []
for size in ['desktop', 'mobile']:
    for theme in ['light', 'dark']:
        for state in ['list', 'create', 'edit', 'password', 'discard']:
            for reference in (['legacy', 'baseline'] if state == 'list' else ['legacy']):
                old_path = output / f'legacy-{state}-{size}-{theme}.png' if reference == 'legacy' else root / 'baseline' / f'users-{size}-{theme}.png'
                old = Image.open(old_path).convert('RGB')
                new = Image.open(output / f'react-{state}-{size}-{theme}.png').convert('RGB')
                assert old.size == new.size, (old_path, old.size, new.size)
                diff = ImageChops.difference(old, new)
                pixels = sum(max(pixel) > 12 for pixel in diff.getdata())
                results.append(dict(size=size, theme=theme, state=state, reference=reference, changedPixels=pixels, totalPixels=old.width * old.height, bbox=diff.getbbox()))
                if pixels:
                    diff.save(output / f'diff-{reference}-{state}-{size}-{theme}.png')

sheet = Image.new('RGB', (960, 5 * 320), '#ddd')
draw = ImageDraw.Draw(sheet)
for index, state in enumerate(['list', 'create', 'edit', 'password', 'discard']):
    for column, implementation in enumerate(['legacy', 'react']):
        screenshot = Image.open(output / f'{implementation}-{state}-desktop-dark.png').convert('RGB')
        screenshot.thumbnail((480, 295))
        sheet.paste(screenshot, (column * 480, index * 320 + 25))
        draw.text((column * 480 + 10, index * 320 + 6), f'{implementation} {state}', fill='black')
sheet.save(output / 'contact-sheet.jpg')
(output / 'visual-comparison.json').write_text(json.dumps(dict(threshold=12, results=results), indent=2), encoding='utf8')
print(json.dumps(results, indent=2))
