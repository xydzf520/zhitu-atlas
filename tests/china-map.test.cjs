const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{buildSync}=require('esbuild'),vm=require('node:vm');
const js=buildSync({stdin:{resolveDir:process.cwd(),contents:"export * from './packages/ui/src/common/map-provider';export {nationalBounds} from './packages/ui/src/common/opportunity-map';export {recruitmentCities} from './packages/ui/src/common/regions'"},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,m={exports:{}};vm.runInNewContext('(function(module,exports){'+js+'})',{})(m,m.exports);const a=m.exports;
test('public source no longer bundles unlicensed DataV boundary files or automatic Amap tiles',()=>{
 for(const name of ['map-boundaries.json','map-source.json'])assert.equal(fs.existsSync('packages/ui/src/common/data/'+name),false);
 const code=fs.readFileSync('packages/ui/src/renderer/src/components/career/OpportunityMap.vue','utf8');
 assert.ok(!code.includes('autonavi.com'));assert.ok(!code.includes('map-boundaries'));assert.ok(code.includes('career-map-tile'));
});
test('national viewport covers southern islands and Taiwan remains a Chinese provincial option',()=>{
 assert.ok(a.nationalBounds[0][0]<=2 && a.nationalBounds[1][0]>=55);
 assert.ok(a.nationalBounds[0][1]<=72 && a.nationalBounds[1][1]>=136);
 assert.ok(a.recruitmentCities.some(c=>c.name==='台湾'&&c.province==='台湾'));
 assert.deepEqual([...a.mapProvider.layers],['vec','cva','ibo']);
});
test('geographic provider preserves WGS84 display points without GCJ-02 double shifting',()=>{
 for(const [lat,lng] of [[31.23,121.47],[39.915,116.404],[22.54,114.06]])assert.equal(a.providerPoint(lat,lng).join(','),[lat,lng].join(','));
});
test('desktop and web render map images through the local service without third party script permissions',()=>{
 for(const f of ['packages/ui/src/main/features/atlas-server.ts','packages/ui/src/renderer/index.html']){const s=fs.readFileSync(f,'utf8');assert.ok(!s.includes('autonavi.com'));assert.ok(!s.includes('tile.openstreetmap.org'));assert.ok(s.includes("script-src 'self'"));}
});
