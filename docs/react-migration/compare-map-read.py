import json
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw
output=Path(__file__).parent/'stage-10';results=[]
for size in ['desktop','mobile']:
 for theme in ['light','dark']:
  for state in ['default','networks','legend','basemap','search']:
   old=Image.open(output/f'legacy-{state}-part-{size}-{theme}.png').convert('RGB');new=Image.open(output/f'react-{state}-part-{size}-{theme}.png').convert('RGB')
   if old.size!=new.size:results.append(dict(size=size,theme=theme,state=state,oldSize=old.size,newSize=new.size));continue
   diff=ImageChops.difference(old,new);pixels=sum(max(p)>12 for p in diff.getdata());results.append(dict(size=size,theme=theme,state=state,changedPixels=pixels,totalPixels=old.width*old.height))
   if pixels:diff.save(output/f'diff-{state}-{size}-{theme}.png')
sheet=Image.new('RGB',(960,1600),'#ddd');draw=ImageDraw.Draw(sheet)
for row,state in enumerate(['default','networks','legend','search','error']):
 for col,version in enumerate(['legacy','react']):
  im=Image.open(output/f'{version}-{state}-desktop-dark.png');im.thumbnail((480,295));sheet.paste(im,(col*480,row*320+25));draw.text((col*480+10,row*320+5),f'{version} {state}',fill='black')
sheet.save(output/'contact-sheet.jpg');(output/'visual-comparison.json').write_text(json.dumps(dict(threshold=12,note='Prepared React read UI is inactive. Import/export and diagram dialogs remain later stages; full-page equality is not asserted.',results=results),indent=2),encoding='utf-8');print(json.dumps(results))
