const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{buildSync}=require('esbuild');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-boss-policy-'));
buildSync({entryPoints:['packages/ui/src/common/boss-browser.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'policy.cjs')});
const {isBossUrl,bossCookieForImport,bossViewBounds}=require(path.join(dir,'policy.cjs'));
process.on('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));
test('内嵌站点不接受伪造域名、本地文件、明文 HTTP 或凭据 URL',()=>{
 for(const url of ['https://www.zhipin.com/web/geek/chat','https://login.zhipin.com/account/'])assert.equal(isBossUrl(url),true);
 for(const url of ['https://zhipin.com.evil.test/','https://evilzhipin.com/','file:///etc/passwd','javascript:alert(1)','http://www.zhipin.com/','https://user:pass@www.zhipin.com/','https://www.zhipin.com:9000/'])assert.equal(isBossUrl(url),false,url);
});
test('登录迁移过滤其他站点与过期 Cookie，不更改会话凭据',()=>{
 const cookie={domain:'.zhipin.com',name:'fixture',value:'fixture-only',sameSite:'Lax',expires:5000,httpOnly:true};
 assert.equal(bossCookieForImport({...cookie,domain:'.other.test'},1000),null);
 assert.equal(bossCookieForImport({...cookie,expires:900},1000),null);
 assert.equal(bossCookieForImport(cookie,1000).value,'fixture-only');
 assert.equal(bossCookieForImport(cookie,1000).httpOnly,true);
 assert.equal(bossCookieForImport({...cookie,expires:-1},1000).expirationDate,undefined);
});
test('内嵌区域裁剪在窗口内，拒绝非有限坐标',()=>{
 const b=bossViewBounds({x:-10,y:-30,width:5000,height:5000},1280,720);
 assert.equal(b.x+b.width,1280);assert.equal(b.y+b.height,720);assert.ok(b.x>=64&&b.y>=90);
 assert.throws(()=>bossViewBounds({x:Infinity,y:0,width:10,height:10},1280,720));
 assert.equal(bossViewBounds({x:1400,y:900,width:20,height:20},1280,720).width,0);
});
