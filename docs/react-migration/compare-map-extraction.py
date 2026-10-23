import json
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw
root=Path(__file__).parent/'stage-9';results=[];sheet=Image.new('RGB',(960,640),'#ddd');draw=ImageDraw.Draw(sheet)
for size in ['desktop','mobile']:
 for theme in ['light','dark']:
  old=Image.open(root/'before'/f'map-{size}-{theme}.png').convert('RGB');new=Image.open(root/'after'/f'map-{size}-{theme}.png').convert('RGB');assert old.size==new.size
  diff=ImageChops.difference(old,new);pixels=sum(max(p)>12 for p in diff.getdata());results.append(dict(size=size,theme=theme,changedPixels=pixels,totalPixels=old.width*old.height))
  if pixels:diff.save(root/f'diff-{size}-{theme}.png')
for row,size in enumerate(['desktop','mobile']):
 for col,version in enumerate(['before','after']):
  im=Image.open(root/version/f'map-{size}-dark.png');im.thumbnail((480,295));sheet.paste(im,(col*480,row*320+25));draw.text((col*480+10,row*320+5),f'{version} {size}',fill='black')
sheet.save(root/'contact-sheet.jpg');(root/'visual-comparison.json').write_text(json.dumps(dict(threshold=12,results=results),indent=2),encoding='utf-8');print(json.dumps(results))
