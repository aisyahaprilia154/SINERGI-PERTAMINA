import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw
root=Path(__file__).parent/'stage-16'
rows=[]
for size in ['desktop','mobile']:
 for theme in ['light','dark']:
  for view in ['login','map','topology']:
   a=Image.open(root/f'{view}-before-{size}-{theme}-crop.png').convert('RGB');b=Image.open(root/f'{view}-after-{size}-{theme}-crop.png').convert('RGB')
   row=dict(view=view,size=size,theme=theme,beforeSize=a.size,afterSize=b.size)
   if a.size==b.size:
    changed=sum(max(pixel)>12 for pixel in ImageChops.difference(a,b).getdata());row.update(changedPixels=changed,totalPixels=a.width*a.height)
   full_a=Image.open(root/f'{view}-before-{size}-{theme}.png').convert('RGB');full_b=Image.open(root/f'{view}-after-{size}-{theme}.png').convert('RGB');row.update(beforePageSize=full_a.size,afterPageSize=full_b.size)
   if full_a.size==full_b.size:
    diff=ImageChops.difference(full_a,full_b);count=sum(max(pixel)>12 for pixel in diff.getdata());row['pageChangedPixels']=count
    if count:diff.save(root/f'diff-spa-{view}-{size}-{theme}.png')
    else:(root/f'diff-spa-{view}-{size}-{theme}.png').unlink(missing_ok=True)
   if view=='topology':row['svgIdentical']=(root/f'{view}-before-{size}-{theme}.svg').read_bytes()==(root/f'{view}-after-{size}-{theme}.svg').read_bytes()
   rows.append(row)
sheet=Image.new('RGB',(1200,1050),'#ddd');draw=ImageDraw.Draw(sheet)
for index,view in enumerate(['login','map','topology']):
 for col,phase in enumerate(['before','after']):
  image=Image.open(root/f'{view}-{phase}-desktop-dark.png');image.thumbnail((580,315));sheet.paste(image,(col*600+10,index*350+25));draw.text((col*600+10,index*350+5),view+' '+phase,fill='black')
sheet.save(root/'spa-contact-sheet.jpg')
(root/'spa-visual-comparison.json').write_text(json.dumps(dict(threshold=12,results=rows),indent=2)+'\n',encoding='utf-8');print(json.dumps(rows))
