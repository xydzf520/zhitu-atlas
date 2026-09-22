// Isolated fixture only. Verification is mocked; no live account, model or sending.
const puppeteer = require('puppeteer'), assert = require('node:assert/strict'), fs = require('node:fs');
(async()=>{
 const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-gpu']});
 const page=await browser.newPage(), errors=[], checks=[], verifications=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);
 page.on('request',r=>{
  if(r.url().endsWith('/atlas-api/rpc')){
   const b=JSON.parse(r.postData()||'{}');
   assert.ok(!/career-contact-start|career-reply-command/.test(b.channel),'Must not send');
   if(b.channel==='career-project-verify'){
    verifications.push(b.payload);
    return r.respond({status:200,contentType:'application/json',body:JSON.stringify({data:{verified:true,reason:'公开仓库及许可证核实通过',license:'Apache-2.0'}})});
   }
  }
  return r.continue();
 });
 const click=async(text,scope='')=>page.evaluate((text,scope)=>{
  const e=[...document.querySelectorAll(scope+' button')].find(e=>e.textContent.trim()===text&&e.getBoundingClientRect().height);
  if(!e)throw Error('Missing button '+text);e.click();
 },text,scope);
 const input=async(selector,value)=>page.$eval(selector,(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))},value);
 const save=async()=>{
  await click('保存资料','.career-header');
  await page.waitForFunction(()=>[...document.querySelectorAll('.career-header button')].some(e=>e.textContent==='保存资料'&&e.disabled&&!e.classList.contains('is-loading')));
 };
 try{
  await page.setViewport({width:1920,height:1080});
  await page.goto('http://127.0.0.1:5179/desktop.html#/main-layout/CareerWorkspace');
  await page.waitForSelector('.profile-navigation');
  await page.evaluate(()=>[...document.querySelectorAll('.profile-navigation nav button')].find(e=>e.textContent.includes('AI 可引用经历')).click());
  await page.click('.profile-evidence summary');
  if (await page.$('.project-editor input')) await click('取消关联');
  await click('关联作品 / 开源项目');
  await input('.project-editor .el-form-item:nth-of-type(1) input','SkillForge 合成测试项目 '+Date.now());
  await input('.project-editor .el-form-item:nth-of-type(2) input','https://github.com/example/skillforge');
  await input('.project-editor textarea','负责产品规划、交互设计与实现验证。');
  await page.waitForFunction(()=>document.querySelector('.project-editor .actions button')?.disabled);
  assert.equal(await page.$eval('.project-editor .actions button',e=>e.disabled),true);
  checks.push('未保存时不核验；项目编辑需要重新确认经历');
  await save();
  await page.waitForFunction(()=>!document.querySelector('.project-editor .actions button')?.disabled);
  await click('核实公开仓库');
  await page.waitForFunction(()=>document.querySelector('.project-editor [role=status]')?.textContent.includes('Apache-2.0'));
  assert.equal(verifications.length,1);assert.ok(verifications[0].profileVersion);assert.equal(verifications[0].evidenceId,'fixture');
  assert.match(await page.$eval('.profile-evidence summary',e=>e.textContent),/待确认/);
  checks.push('公开核验绑定保存版本；核验通过仍不自动确认个人贡献');
  await input('.project-editor textarea','修改后的真实贡献');
  await page.waitForFunction(()=>document.querySelector('.project-editor .actions button')?.disabled);
  assert.equal(await page.$eval('.project-editor .actions button',e=>e.disabled),true);
  assert.doesNotMatch(await page.$eval('.project-editor [role=status]',e=>e.textContent),/公开仓库及许可证核实通过/);
  await save();
  checks.push('修改贡献后清除旧核验提示，草稿可保存');
  await page.waitForFunction(()=>!document.querySelector('.career-header .is-loading'));
  await page.evaluate(()=>{const e=document.querySelector('.profile-evidence');if(e&&!e.open)e.querySelector('summary').click()});
  for(const [width,height]of [[1920,1080],[1280,720]]){
   await page.setViewport({width,height});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.$eval('.project-editor', e => e.scrollIntoView({block:'center'}));
   await page.screenshot({path:`artifacts/portfolio-20260920/profile-${width}.png`,fullPage:true});
  }
  checks.push('1920×1080 与 1280×720 无横向溢出');
  assert.deepEqual(errors,[]);
  fs.writeFileSync('artifacts/portfolio-20260920/ui-check.json',JSON.stringify({checks,errors,verifications:verifications.length},null,2));console.log(JSON.stringify({checks,errors},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
