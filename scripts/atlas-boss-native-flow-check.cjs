// Native integration test. All BOSS URLs resolve to fixtures in an isolated session.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {app,BrowserWindow,session}=require('electron');
app.on('window-all-closed',()=>{});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-boss-flow-'));
app.setPath('userData',path.join(root,'electron'));process.env.ATLAS_DATA_ROOT=path.join(root,'data');
const api=require(path.resolve(process.argv[2])),delay=ms=>new Promise(r=>setTimeout(r,ms));
let controller,win,native;
const checks=[];
async function until(fn){for(let i=0;i<30;i++){if(await fn())return;await delay(100)}throw Error('fixture condition timed out')}
const fixture=`<!doctype html><meta charset="UTF-8"><main class="main-wrap"><div class="chat-user"><div class="user-list-content"><ul role="group"><li role="listitem">招聘者</li></ul></div></div><div class="chat-conversation"><div class="message-content"><div class="chat-record"></div></div><div class="message-controls"><div class="chat-input" contenteditable="true"></div><div class="chat-op"><button class="btn-send">发送</button></div></div></div></main><script>
window.sentClicks=0;window.msgs=[{mid:'initial',isSelf:false,type:'text',text:'您好',time:Date.now(),status:0}];
const source={encryptBossId:'boss',name:'测试招聘者',brandName:'测试企业',encryptJobId:'job',lastIsSelf:false,unreadCount:1,lastText:'您好',updateTime:Date.now()};
document.querySelector('.main-wrap').__vue__={$store:{state:{userInfo:{encryptUserId:'account',name:'测试账户'}}}};
document.querySelector('.chat-user').__vue__={list:[source]};document.querySelector('li').__vue__={source};document.querySelector('.chat-conversation').__vue__={selectedFriend$:source};
document.querySelector('.chat-record').__vue__={boss:{encryptBossId:'boss',name:'测试招聘者'},list$:window.msgs};
window.incoming=(id,text)=>{window.msgs.push({mid:id,isSelf:false,type:'text',text,time:Date.now(),status:0});source.lastIsSelf=false;source.lastText=text;source.unreadCount=1;source.updateTime=Date.now();document.querySelector('.chat-input').blur()};
document.querySelector('.btn-send').onclick=()=>{const input=document.querySelector('.chat-input');window.sentClicks++;window.msgs.push({mid:'sent-'+window.sentClicks,isSelf:true,type:'text',text:input.textContent,time:Date.now(),status:1});source.lastIsSelf=true;source.lastText=input.textContent;source.unreadCount=0;input.textContent='';input.blur()};
window.readJob=()=>fetch('/wapi/zpgeek/job/detail.json').then(r=>r.json());
</script>`;
(async()=>{
 await app.whenReady();
 api.atlasWrite("atlas-boss-sync-settings", { enabled: false });
 const site=session.fromPartition('persist:atlas-boss');let navigations=0;
 site.protocol.handle('https',req=>{const p=new URL(req.url).pathname;if(p==='/wapi/zpgeek/job/detail.json')return new Response(JSON.stringify({code:0,zpData:{jobInfo:{encryptId:'job',jobName:'AI产品负责人',postDescription:'负责企业AI应用平台、技能复用和产品迭代。',address:'上海徐汇区',salaryDesc:'40-60K·14薪'},bossInfo:{encryptBossId:'boss',name:'招聘者',activeTimeDesc:'刚刚活跃'},brandComInfo:{encryptBrandId:'company',brandName:'测试企业'}}}),{headers:{'Content-Type':'application/json'}});if(p==='/job_detail/job.html')return new Response('<!doctype html><meta charset="UTF-8"><div class="job-primary"><h1>公开岗位</h1></div><div class="job-location"><div class="job-location-map" data-content="上海市长宁区福泉北路"></div></div>',{headers:{'Content-Type':'text/html'}});if(p.startsWith('/web/')){navigations++;return new Response(fixture,{headers:{'Content-Type':'text/html'}})}return new Response('',{status:404})});
 win=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadURL('data:text/html,<h1>Fixture</h1>#/main-layout/CareerBoss');
 api.saveBossSnapshot({account:{id:'account',name:'测试账户'},items:[]});api.atlasWrite('atlas-boss-sync-settings',{enabled:true});
 controller=new api.AtlasBossBrowser(win);await controller.accountSync.tick();await until(()=>controller.accountSync.view && !controller.accountSync.view.webContents.isLoadingMainFrame());await controller.accountSync.tick();
 assert.equal(api.bossSyncCoverage().conversations,1);assert.equal(controller.view,null);assert.ok(win.webContents.getURL().startsWith('data:text/html'));checks.push('startup-sync-before-opening-boss-workspace');
 api.atlasWrite('atlas-boss-sync-settings',{enabled:false});await controller.accountSync.tick();
 await controller.open();await controller.action('sync');
 const view=win.contentView.children.find(v=>v.webContents&&v.webContents!==win.webContents),wc=view.webContents;
 await delay(100);await controller.action('sync');await until(()=>api.bossSyncCoverage().messages===1);checks.push('visible-message-ingestion');
 await wc.executeJavaScript('window.readJob()');await until(()=>api.bossSyncCoverage().linkedDetails===1);assert.equal(api.capturedBossJobs()[0].salaryMonth,14);checks.push('passive-real-electron-response-capture');
 await wc.executeJavaScript(`{const el=document.createElement('section');el.className='job-detail-box';el.__vue__={$store:document.querySelector('.main-wrap').__vue__.$store,data:{jobInfo:{encryptId:'cached-job',jobName:'缓存的岗位',postDescription:'已经加载的岗位说明',address:'上海市杨浦区国定路'},brandComInfo:{brandName:'测试企业'}}};document.body.append(el)}`);await controller.action('sync');assert.equal(api.capturedBossJobs().find(j=>j.encryptJobId==='cached-job').address,'上海市杨浦区国定路');checks.push('rendered-cached-job-address-ingestion');

 await controller.action('sync');await controller.action('sync');assert.equal(api.bossSyncCoverage().messages,1);checks.push('message-deduplication');
 await wc.executeJavaScript("document.querySelector('.chat-conversation').__vue__.selectedFriend$={encryptBossId:'other'};window.incoming('mismatch','不得混入')");await controller.action('sync');assert.equal(api.bossSyncCoverage().messages,1);checks.push('conversation-identity-rejection');
 await wc.executeJavaScript("document.querySelector('.chat-conversation').__vue__.selectedFriend$=document.querySelector('li').__vue__.source;window.msgs.splice(0);window.incoming('normal','你好')");
 api.setRuntime({paused:false,startHour:0,endHour:24});api.writeLocalJson('career-auto-reply.json',{mode:'auto',dailyLimit:20,cooldownMinutes:10,startHour:0,endHour:24,activatedAt:new Date(Date.now()-10000).toISOString()});
 native=api.createNativeReplyPage(wc);await api.runCareerReplyCycle(native.page);assert.equal(await wc.executeJavaScript('window.sentClicks'),1);assert.equal(api.readReplyEvents()[0].status,'sent');checks.push('native-routine-reply-and-readback');
 await api.runCareerReplyCycle(native.page);assert.equal(await wc.executeJavaScript('window.sentClicks'),1);checks.push('no-duplicate-reply');
 await wc.executeJavaScript("window.incoming('salary','期望薪资多少');document.querySelector('.chat-input').textContent='用户未发送草稿'");await api.runCareerReplyCycle(native.page);assert.equal(await wc.executeJavaScript("document.querySelector('.chat-input').textContent"),'用户未发送草稿');assert.equal(await wc.executeJavaScript('window.sentClicks'),1);checks.push('user-draft-preserved');
 await wc.executeJavaScript("document.querySelector('.chat-input').textContent=''");await api.runCareerReplyCycle(native.page);assert.ok(api.readReplyEvents().some(e=>e.messageId==='salary'&&e.status==='review'));assert.equal(await wc.executeJavaScript('window.sentClicks'),1);checks.push('important-matter-held-for-review');
 const request={...(await native.page.evaluate(api.readCareerReplyPage)),text:'测试中的草稿'};await native.page.atlasWriteDraft(request);wc.emit('before-input-event',{}, {type:'keyDown'});await assert.rejects(()=>native.page.atlasSendDraft(request),/用户输入/);assert.equal(await wc.executeJavaScript('window.sentClicks'),1);checks.push('typing-interrupts-send');
 await wc.executeJavaScript("document.querySelector('.chat-input').textContent='';document.querySelector('.chat-input').blur()");const second={...(await native.page.evaluate(api.readCareerReplyPage)),text:'不会发出'};await native.page.atlasWriteDraft(second);api.setRuntime({paused:true});await assert.rejects(()=>native.page.atlasSendDraft(second),/暂停/);assert.equal(await wc.executeJavaScript('window.sentClicks'),1);checks.push('pause-before-send');
 api.setRuntime({paused:false});await wc.executeJavaScript("document.querySelector('.main-wrap').__vue__.$store.state.userInfo.encryptUserId='other'");await assert.rejects(()=>native.page.atlasSendDraft(second),/会话或消息/);assert.equal(await wc.executeJavaScript('window.sentClicks'),1);checks.push('account-switch-before-send');api.setRuntime({paused:true});
 assert.equal(navigations,2);checks.push('no-automatic-navigation-or-refresh');
 await wc.executeJavaScript("document.querySelector('.main-wrap').__vue__.$store.state.userInfo.encryptUserId='account'");await controller.action('sync');
 await controller.navigate('https://www.zhipin.com/job_detail/job.html');await controller.action('sync');await until(()=>!wc.isLoadingMainFrame());await controller.action('sync');await until(()=>api.capturedBossJobs().find(j=>j.encryptJobId==='job').address==='上海市长宁区福泉北路');assert.equal(api.capturedBossJobs().find(j=>j.encryptJobId==='job').address,'上海市长宁区福泉北路');assert.equal(controller.status().sync,'job-detail');checks.push('standalone-public-address-without-account-store');assert.equal(controller.status().recordedPage.url,'https://www.zhipin.com/job_detail/job.html');assert.equal(controller.status().recordedPage.kind,'职位详情');checks.push('native-navigation-automatically-recorded');

 await controller.openSeparate('https://www.zhipin.com/web/geek/chat');
 const popup=BrowserWindow.getAllWindows().find(w=>w!==win&&!w.isDestroyed());assert.ok(popup);assert.equal(popup.webContents.session,site);
 await until(()=>!popup.webContents.isLoadingMainFrame());await popup.webContents.executeJavaScript('window.readJob()');await until(()=>api.capturedBossJobs().find(j=>j.encryptJobId==='job').salaryMonth===14);
 await popup.webContents.executeJavaScript("document.querySelector('.chat-input').textContent='独立窗口中保留的草稿'");assert.equal(await controller.humanBusy(),true);checks.push('separate-window-shares-session-captures-details-and-yields-to-draft');popup.close();
 native.dispose();controller.dispose();win.destroy();api.closeAtlas();const result={passed:true,checks:checks.length,details:checks,externalNetworkRequests:0};console.log(JSON.stringify(result));fs.writeFileSync(process.env.ATLAS_BOSS_CHECK_OUTPUT||path.join(root,'result.json'),JSON.stringify(result,null,2));app.exit(0);
})().catch(error=>{console.error(error);native?.dispose();controller?.dispose();if(win&&!win.isDestroyed())win.destroy();app.exit(1)});
app.on('quit',()=>{try{fs.rmSync(root,{recursive:true,force:true})}catch{}});
