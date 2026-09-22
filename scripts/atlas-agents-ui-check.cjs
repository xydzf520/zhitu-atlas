const puppeteer=require('puppeteer'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
;(async()=>{
 const output=path.resolve(process.env.ATLAS_CHECK_OUTPUT || 'artifacts/agents'),browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-gpu']})
 fs.mkdirSync(output,{recursive:true})
 const page=await browser.newPage(),errors=[],checks=[]
 page.on('pageerror',e=>errors.push(e.message))
 const rpc=(channel,payload)=>page.evaluate(async(channel,payload)=>window.electron.ipcRenderer.invoke(channel,payload),channel,payload)
 const click=async(text)=>{const h=await page.evaluateHandle(text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text),text);await h.asElement().click();await h.dispose()}
 try{
  await page.setViewport({width:1280,height:720});await page.goto('http://127.0.0.1:5198/desktop.html#/main-layout/CareerAgents');await page.waitForSelector('#agent-prompt')
  assert.equal((await page.$$('.agent-card')).length,7);assert.ok(await page.$('a[aria-label="Agent 管理"]'));checks.push('独立导航及七类 Agent 展示')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,'agents-1280.png')});checks.push('1280×720 无横向溢出')
  const initial=await page.$eval('#agent-prompt',e=>e.value)
  await page.$eval('#agent-prompt',e=>{e.value+='\n优先用三条简洁依据说明岗位建议。';e.dispatchEvent(new Event('input',{bubbles:true}))})
  await click('刷新状态');await page.waitForFunction(()=>document.querySelector('#agent-prompt').value.endsWith('优先用三条简洁依据说明岗位建议。'));assert.match(await page.$eval('.editor-controls',e=>e.textContent),/未保存/)
  await page.click('a[aria-label="设置"]');await page.waitForSelector('.el-message-box');await click('继续编辑');await page.waitForSelector('.el-message-box',{hidden:true});assert.ok(page.url().includes('CareerAgents'));checks.push('刷新与离开页面保护未保存草稿')
  const current=(await rpc('career-agents-load')).agents.find(a=>a.id==='analysis');await rpc('career-agent-save',{id:'analysis',prompt:current.prompt+'\n另一个窗口的修改。',enabled:true,baseRevision:current.revision});await click('保存并生效');await page.waitForFunction(()=>/另一个窗口已修改此 Agent|其他窗口已更新配置/.test(document.body.innerText));assert.ok((await page.$eval('#agent-prompt',e=>e.value)).endsWith('优先用三条简洁依据说明岗位建议。'));checks.push('跨窗口冲突提示且不丢草稿')
  await click('读取最新版本');await page.waitForSelector('.el-message-box');await click('放弃修改');await page.waitForSelector('.el-message-box',{hidden:true});await page.waitForFunction(()=>document.querySelector('#agent-prompt').value.endsWith('另一个窗口的修改。'))
  await page.click('.editor-controls input[type="checkbox"]');await page.waitForFunction(()=>document.querySelector('.editor-controls').textContent.includes('未保存'));await click('保存并生效');await page.waitForFunction(()=>document.querySelector('.agent-card.selected').textContent.includes('已停用'))
  const error=await rpc('career-ai-analyze',{job:{jobName:'平台产品经理',description:'负责企业平台产品需求与规划。'.repeat(12)}}).then(()=>'',e=>e.message);assert.match(error,/已停用/);checks.push('界面停用后后台实际拒绝模型调用')
  await page.click('.editor-controls input[type="checkbox"]');await click('使用默认提示词');await click('保存并生效');await page.waitForFunction(()=>document.querySelector('.agent-card.selected').textContent.includes('已启用'));assert.equal(await page.$eval('#agent-prompt',e=>e.value),initial)
  await rpc('career-ai-analyze',{job:{jobName:'平台产品经理',description:'负责企业平台产品需求与规划。'.repeat(12)},refresh:true});await click('刷新状态');await page.waitForFunction(()=>document.querySelectorAll('.calls-panel tbody tr').length>=2)
  await click('查看调用提示词');await page.waitForSelector('.actual-prompt',{visible:true});assert.match(await page.$eval('.actual-prompt',e=>e.textContent),/程序约束与输出协议/);await page.waitForFunction(()=>![...document.querySelectorAll('.el-overlay,.el-dialog')].some(e=>e.getAnimations().some(a=>a.playState==='running')));await page.screenshot({path:path.join(output,'agents-call-prompt-1280.png')});await page.keyboard.press('Escape');await page.waitForSelector('.el-dialog',{hidden:true});checks.push('启用与默认恢复生效，模型调用可查看真实系统提示词快照')
  await page.$eval('.agents-page',e=>e.scrollTop=0);await click('版本历史');await page.waitForSelector('.history details');checks.push('提示词历史可读')
  await page.setViewport({width:1920,height:1080});await page.$eval('.agents-page',e=>e.scrollTop=0);await page.screenshot({path:path.join(output,'agents-1920.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push('1920×1080 布局正常')
  assert.deepEqual(errors,[]);const result={passed:true,checks,pageErrors:errors,realModelCalls:0,recruiterMessages:0};fs.writeFileSync(path.join(output,'ui-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
 }catch(e){await page.screenshot({path:path.join(output,'agents-ui-failure.png')});console.error((await page.$eval('.agents-page',e=>e.innerText)).slice(0,2000));throw e}finally{await browser.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1})
