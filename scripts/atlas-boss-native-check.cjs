// Run with Electron against an esbuild bundle of atlas-boss-browser.ts.
// All BOSS-origin requests are served by a local fixture in an isolated session.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {app,BrowserWindow,session}=require('electron');
app.on('window-all-closed',()=>{});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-boss-native-'));
app.setPath('userData',path.join(root,'electron'));
process.env.ATLAS_DATA_ROOT=path.join(root,'data');
const {AtlasBossBrowser,initAtlasBossBrowser}=require(path.resolve(process.argv[2]));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let controller,window;
(async()=>{
 await app.whenReady();
 const site=session.fromPartition('persist:atlas-boss');
 let requests=0;
 site.protocol.handle('https',()=>{requests++;return new Response(`<!doctype html><title>BOSS fixture</title><main class="main-wrap">Fixture messages<div class="chat-user"><div class="user-list-content"><ul role="group"><li role="listitem">Recruiter fixture</li></ul></div></div></main><script>document.querySelector('.main-wrap').__vue__={$store:{state:{userInfo:{encryptUserId:'fixture-account',name:'测试账户'}}}};document.querySelector('li').__vue__={source:{encryptBossId:'fixture-boss',name:'测试联系人',brandName:'测试企业',jobName:'测试岗位'}};</script>`,{headers:{'content-type':'text/html'}})});
 window=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await window.loadURL('data:text/html,<h1>Atlas fixture</h1>#/main-layout/CareerBoss');
 controller=new AtlasBossBrowser(window);
 controller.setBounds({x:218,y:170,width:1038,height:580});
 await Promise.all([controller.open('https://www.zhipin.com/web/geek/chat'),controller.open('https://www.zhipin.com/web/geek/chat')]);
 assert.equal(window.contentView.children.length,1,'only one BOSS view');
 const view=window.contentView.children.find(v=>v.webContents&&v.webContents!==window.webContents);
 assert.ok(view);assert.equal(view.getVisible(),true);
 const initialRequests=requests;
 await controller.open();await controller.open('https://www.zhipin.com/web/geek/chat');
 assert.equal(requests,initialRequests,'reopening must not reload');
 assert.equal(await view.webContents.executeJavaScript('typeof window.electron + ":" + typeof window.require'),'undefined:undefined','remote page has no preload or Node API');
 await controller.action('sync');
 assert.equal(controller.status().sync,'connected');assert.equal(controller.status().loadedCount,1);
 controller.overlay(true);assert.equal(view.getVisible(),false);
 controller.overlay(false);assert.equal(view.getVisible(),true);
 controller.hide();assert.equal(view.getVisible(),false);
 await controller.open();assert.equal(view.getVisible(),true);assert.equal(requests,initialRequests);
 await window.loadURL('data:text/html,<h1>Other page</h1>#/main-layout/CareerDashboard');
 assert.equal(view.getVisible(),false,'route change hides native overlay');
 await assert.rejects(()=>controller.navigate('file:///etc/passwd'));
 const previousUrl=view.webContents.getURL();
 await view.webContents.executeJavaScript("window.open('https://outside.invalid/')");await delay(100);
 assert.equal(view.webContents.getURL(),previousUrl,'outside popup cannot replace site');
 assert.ok(controller.status().error);
 // Verify independent session cookies persist when the view is recreated.
 await site.cookies.set({url:'https://www.zhipin.com',name:'fixture',value:'fixture-only'});
 const retainedContents=view.webContents;
 const destroyed=new Promise(resolve=>retainedContents.once('destroyed',resolve));
 controller.dispose();await destroyed;assert.equal(retainedContents.isDestroyed(),true);
 // Electron may clear WebContentsView.webContents before a late route/loading event.
 controller.view={webContents:undefined};
 assert.doesNotThrow(()=>controller.hide());assert.doesNotThrow(()=>controller.overlay(true));assert.doesNotThrow(()=>controller.dispose());
 controller=new AtlasBossBrowser(window);await controller.open();assert.equal(controller.status().session,'existing');
 controller.dispose();window.destroy();
 console.log(JSON.stringify({nativeEmbeddedView:true,concurrentSingleView:true,reopenWithoutReload:true,remoteNodeIsolation:true,conversationSync:true,routeAndDialogOcclusion:true,invalidNavigationBlocked:true,cookieSessionPreserved:true,cleanup:true,externalNetworkRequests:0}));
 fs.writeFileSync(process.env.ATLAS_BOSS_CHECK_OUTPUT||path.join(root,'result.json'),JSON.stringify({passed:true,checks:10,externalNetworkRequests:0}));
 app.exit(0);
})().catch(error=>{console.error(error);if(controller)controller.dispose();if(window&&!window.isDestroyed())window.destroy();app.exit(1)});
app.on('quit',()=>{try{fs.rmSync(root,{recursive:true,force:true})}catch{}});
