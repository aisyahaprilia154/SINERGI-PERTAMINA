import json
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw
output=Path(__file__).parent/'stage-8'; results=[]
for size in ['desktop','mobile']:
 for theme in ['light','dark']:
  for state in ['header','additions','conflicts']:
   old=Image.open(output/f'legacy-{state}-{size}-{theme}.png').convert('RGB');new=Image.open(output/f'react-{state}-{size}-{theme}.png').convert('RGB')
   if old.size!=new.size: results.append(dict(size=size,theme=theme,state=state,oldSize=old.size,newSize=new.size));continue
   diff=ImageChops.difference(old,new);pixels=sum(max(p)>12 for p in diff.getdata());results.append(dict(size=size,theme=theme,state=state,changedPixels=pixels,totalPixels=old.width*old.height))
sheet=Image.new('RGB',(960,1280),'#ddd');draw=ImageDraw.Draw(sheet)
for row,state in enumerate(['ready','conflict','empty','error']):
 for column,implementation in enumerate(['legacy','react']):
  im=Image.open(output/f'{implementation}-{state}-desktop-dark.png');im.thumbnail((480,295));sheet.paste(im,(column*480,row*320+25));draw.text((column*480+10,row*320+6),f'{implementation} {state}',fill='black')
sheet.save(output/'contact-sheet.jpg');(output/'visual-comparison.json').write_text(json.dumps(dict(threshold=12,results=results),indent=2));print(json.dumps(results))
