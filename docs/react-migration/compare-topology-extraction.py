import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

root = Path(__file__).parent / 'stage-13'
rows = []
for old_path in sorted((root / 'before').glob('*.png')):
    old = Image.open(old_path).convert('RGB')
    new = Image.open(root / 'after' / old_path.name).convert('RGB')
    row = dict(file=old_path.name, oldSize=old.size, newSize=new.size)
    if old.size == new.size:
        diff = ImageChops.difference(old, new)
        row.update(changedPixels=sum(max(pixel) > 12 for pixel in diff.getdata()), totalPixels=old.width * old.height)
        if row['changedPixels']:
            diff.save(root / ('diff-' + old_path.name))
    rows.append(row)
sheet = Image.new('RGB', (1200, 1920), '#ddd')
draw = ImageDraw.Draw(sheet)
for i, state in enumerate(['overview', 'area', 'detail', 'search', 'empty', 'error']):
    for j, phase in enumerate(['before', 'after']):
        im = Image.open(root / phase / (state + '-desktop-dark.png'))
        im.thumbnail((580, 280))
        sheet.paste(im, (j * 600 + 10, i * 320 + 25))
        draw.text((j * 600 + 10, i * 320 + 5), phase + ' ' + state, fill='black')
sheet.save(root / 'contact-sheet.jpg')
(root / 'visual-comparison.json').write_text(json.dumps(dict(threshold=12, results=rows), indent=2) + '\n', encoding='utf-8')
print(json.dumps(rows))
