"""Build small offline map assets from public geographic data; no tile downloads.
Inputs: CN/TW/HK/MO.zip (GeoNames) in argv[1]. Boundary assets are separately verified and never regenerated here.
"""
import sys,json,pathlib,zipfile,collections,math
root=pathlib.Path(sys.argv[1]);out=pathlib.Path('packages/ui/src/common/data')
cities=json.loads((out/'boss-cities.json').read_text());records=[]
for country in ['CN','TW','HK','MO']:
 with zipfile.ZipFile(root/(country+'.zip')) as z:
  for line in z.read(country+'.txt').decode().splitlines():
   c=line.split('\t')
   if c[6] in ['P','A']:records.append(c)
by=collections.defaultdict(list)
for c in records:
 for n in set([c[1],c[2],*c[3].split(',')]):
  if n:by[n].append(c)
provinces={}
for city in cities:
 name=city['province']
 if name in ['香港','澳门','台湾']:continue
 match=[c for c in by[name] if c[7]=='ADM1' and c[8]=='CN']
 assert len(match)==1,(name,len(match))
 provinces[name]=match[0]
priority={'PPLC':10,'PPLA':9,'PPLA2':8,'ADM2':7,'PPLA3':6,'ADM3':5,'PPLA4':4,'PCLS':3,'ADM1':2,'PPL':1}
points={};missing=[];districtCount=0
for city in cities:
 name,province=city['name'],city['province'];country={'香港':'HK','澳门':'MO','台湾':'TW'}.get(province,'CN');prov=provinces.get(province)
 alternatives=[name,name+'市',name[:-1] if name.endswith('市') else name]
 candidates={c[0]:c for n in alternatives for c in by[n] if c[8]==country and (not prov or c[10]==prov[10]) and c[7] in priority}
 rows=sorted(candidates.values(),key=lambda c:(priority[c[7]],int(c[14] or 0)),reverse=True)
 record=rows[0] if rows else prov
 if not rows:missing.append(name)
 if not record:continue
 value={'lat':float(record[4]),'lng':float(record[5]),'sourceId':record[0],'level':'city' if rows else 'province','province':province,'districts':{}}
 for d in city['districts']:
  matches=[c for c in by[d] if c[8]==country and c[7] in ['ADM2','ADM3','ADM4'] and (not prov or c[10]==prov[10]) and (not record[11] or c[11]==record[11])]
  if len(matches)!=1:continue
  c=matches[0];value['districts'][d]={'lat':float(c[4]),'lng':float(c[5]),'sourceId':c[0]};districtCount+=1
 points[name]=value
(out/'map-places.json').write_text(json.dumps(points,ensure_ascii=False,separators=(',',':'))+'\n')
print(json.dumps({'cities':len(points),'districts':districtCount,'provinceFallback':missing},ensure_ascii=False))
