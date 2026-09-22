// Offline routing checks and replay review. --judge-real opts into paid, isolated
// model review. Never imports a browser, sender, task dispatcher, or live RPC.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { buildSync } = require('esbuild');
const catalog = require('../tests/fixtures/communication/cases.cjs');
const rubric = require('./lib/communication-review.cjs');
const {evaluationSource,copyEvaluationConfig}=require('./lib/evaluation-config.cjs');
const arg = name => process.argv.find(v => v.startsWith('--'+name+'='))?.slice(name.length+3);
const q = s => String(s ?? '').replace(/\|/g,'\\|').replace(/\r?\n/g,' ').replace(/</g,'&lt;');
async function main() {
  const repo=path.resolve(__dirname,'..'), out=path.resolve(arg('out') || path.join(repo,'artifacts/communication-suite-'+Date.now()));
  if(fs.existsSync(path.join(out,'report.json')))throw Error('报告已存在，请使用新的 --out 目录');
  fs.mkdirSync(out,{recursive:true,mode:0o700});
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-review-suite-')), oldRoot=process.env.ATLAS_DATA_ROOT, actualFetch=global.fetch;
  const source=evaluationSource();
  let live;
  try {
    process.env.ATLAS_DATA_ROOT=temp;
    const file=path.join(temp,'api.cjs');
    buildSync({stdin:{resolveDir:repo,contents:[
      "export * from './packages/ui/src/common/auto-reply'",
      "export * from './packages/ui/src/common/communication-quality'",
      "export { modelConfig } from './packages/ui/src/main/features/atlas-model-config'",
      "export { modelJsonTransport } from './packages/ui/src/main/features/atlas-model-transport'",
    ].join('\n')},bundle:true,platform:'node',outfile:file,logLevel:'silent'});
    const api=require(file), report={startedAt:new Date().toISOString(),catalogVersion:catalog.version,rubricVersion:rubric.rubricVersion,rubricHash:rubric.hash(rubric.judgePrompt),
      syntheticCatalog:true,coverage:{routing:catalog.gates.length,style:catalog.styleCases.length,semantic:catalog.semanticCases.length},
      gates:catalog.gates.map(c=>rubric.gateReview(c,api.classifyReply(c.incoming,catalog.profile))),
      styleCases:catalog.styleCases.map(c=>{
        const actual=api.communicationStyleIssues(c).map(i=>i.code);
        return {id:c.id,expected:c.codes,actual,status:JSON.stringify([...actual].sort())===JSON.stringify([...c.codes].sort())?'pass':'fail'};
      }),
      semanticCases:catalog.semanticCases, messages:[], attempts:[], modelRequests:[],reviewStatus:'not-requested'};
    const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
    save();
    const paths=(arg('replay') || '').split(',').filter(Boolean).map(p=>path.resolve(p));
    const only=(arg('only') || '').split(',').filter(Boolean);
    for(let index=0;index<paths.length;index++) {
      const input=JSON.parse(fs.readFileSync(paths[index],'utf8'));
      if(!Array.isArray(input.cases))throw Error('回放文件缺少 cases');
      for(const c of input.cases) {
        const state=rubric.stageStatus(c);
        report.attempts.push({source:paths[index],id:c.id,...state});
        if(state.status!=='generated' || (only.length&&!only.includes(c.id)))continue;
        const sourceId=`run${index+1}:${c.id}`;
        const intent=c.id==='reply-location'?'location':c.id.includes('hello')?'greeting':'other';
        const audience=c.id.includes('specific-tool')?'technical':'unknown';
        const style=api.communicationStyleIssues({text:c.result.text,incoming:c.incoming||'',intent,audience});
        report.messages.push({id:sourceId,caseId:c.id,source:paths[index],type:c.type,sourceKind:'real-model-output',
          text:c.result.text,incoming:c.incoming||'',context:c.context||'',job:c.job||null,audience,audienceBasis:'测试设定；不是对真实招聘者身份的推断',
          profileVersion:c.result.profileVersion,profileEvidenceIds:c.result.evidenceIds||c.result.matches?.map(m=>m.evidenceId)||[],
          model:input.model,generatedAt:c.finishedAt,elapsedMs:c.elapsedMs,style,verdict:rubric.combineReview(style)});
      }
    }
    if(process.argv.includes('--calibration')) {
      for(const sample of catalog.calibration) {
        const scenario=catalog.semanticCases.find(c=>c.id===sample.caseId);
        const style=api.communicationStyleIssues({text:sample.text,incoming:scenario.incoming,audience:scenario.audience});
        report.messages.push({...scenario,...sample,id:'calibration:'+sample.caseId,type:scenario.intent==='first-contact'?'greeting':'reply',
          sourceKind:'synthetic-review-calibration',calibration:true,context:'',job:null,
          evidence:catalog.profile.evidence.filter(e=>e.confirmed && sample.evidenceIds.includes(e.id)),
          cities:catalog.profile.preferredCities,style,verdict:rubric.combineReview(style)});
      }
    }
    save();
    if(process.argv.includes('--judge-real')) {
      if(!report.messages.length)throw Error('--judge-real 需要通过 --replay 提供完成的真实话术');
      if(report.messages.length>8)throw Error('单次最多评审8条；请用 --only 选择案例，避免无限增加模型调用');
      if(report.messages.some(m=>!m.calibration))live=new DatabaseSync(path.join(source,'storage/atlas.db'),{readOnly:true});
      const inputs=[];
      for(const m of report.messages) {
        if(m.calibration) {
          inputs.push({id:m.id,kind:m.type,audience:m.audience,incoming:m.incoming,context:m.context,job:m.job,text:m.text,evidence:m.evidence,cities:m.cities});
          m.inputHash=rubric.hash(inputs.at(-1));continue;
        }
        const row=live.prepare('SELECT value FROM profile_versions WHERE id=?').get(m.profileVersion);
        // Never review old output against today's profile silently.
        if(!row){m.reviewError='原资料版本不可用，未用当前简历替代';continue}
        const profile=JSON.parse(row.value);
        inputs.push({id:m.id,kind:m.type,audience:m.audience,incoming:m.incoming,context:m.context,
          job:m.job,text:m.text,evidence:profile.evidence.filter(e=>e.confirmed && m.profileEvidenceIds.includes(e.id)),cities:profile.preferredCities});
        m.inputHash=rubric.hash(inputs.at(-1));
      }
      live?.close();live=null;
      if(inputs.length) {
        fs.mkdirSync(path.join(temp,'config'),{mode:0o700});
        copyEvaluationConfig(source,temp);
        const config=api.modelConfig();
        report.model={provider:config.provider,id:config.model,generation:config.generation,identity:config.identity};
        report.judgeLimitation='独立评审调用使用同一配置模型，存在同源偏差；与确定性检查结合，仍需人工抽查，不代表真人HR反馈。';
        global.fetch=async(url,options={})=>{
          if(String(url)!==config.url || options.method!=='POST')throw Error('评审器禁止模型接口以外的网络访问');
          if(report.modelRequests.length>=1)throw Error('本次评审只允许一次模型请求，不自动重试或调用工具');
          const entry={startedAt:new Date().toISOString()};report.modelRequests.push(entry);save();
          const response=await actualFetch(url,{...options,redirect:'error'});entry.status=response.status;entry.retryAfter=response.headers.get('retry-after')||null;save();return response;
        };
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5*60*1000);
        report.reviewStatus='running';save();
        try {
          const result=await api.modelJsonTransport(config,rubric.judgePrompt,{cases:inputs},controller.signal,{tools:[],maxToolCalls:0});
          report.rawReview=result.value;report.usage=result.usage;
          const reviews=rubric.validateReviews(result.value,inputs);
          for(const r of reviews){const m=report.messages.find(m=>m.id===r.id);m.aiReview=r;m.verdict=rubric.combineReview(m.style,r);
            if(m.calibration)m.calibrationPassed=m.expectedAI==='non-pass'?r.verdict!=='pass':r.verdict===m.expectedAI;}
          report.reviewStatus='completed';
        } catch(e) {report.reviewStatus='unavailable';report.reviewError=e.message;}
        finally{clearTimeout(timer);save()}
      } else report.reviewStatus='unavailable';
    }
    report.completedAt=new Date().toISOString();
    report.summary={routingPassed:report.gates.filter(g=>g.status==='pass').length,routingFailed:report.gates.filter(g=>g.status==='fail').length,
      stylePassed:report.styleCases.filter(c=>c.status==='pass').length,styleFailed:report.styleCases.filter(c=>c.status==='fail').length,
      messagePassed:report.messages.filter(m=>!m.calibration&&m.verdict==='pass').length,messageFailed:report.messages.filter(m=>!m.calibration&&m.verdict==='fail').length,
      needsReview:report.messages.filter(m=>!m.calibration&&m.verdict==='needs-review').length,unavailableAttempts:report.attempts.filter(a=>a.status==='unavailable').length,
      calibrationPassed:report.messages.filter(m=>m.calibration&&m.calibrationPassed).length,calibrationFailed:report.messages.filter(m=>m.calibration&&!m.calibrationPassed).length};
    report.safety={productionReadOnly:true,newSendAttempts:0,noPlatformAccess:true,noAutomaticRetries:true};save();
    const lines=['# 招呼与回复系统测试','',`场景目录：${catalog.gates.length+catalog.styleCases.length+catalog.semanticCases.length} 项；版本 ${catalog.version}。`,
      '',`规则分流：${report.summary.routingPassed} 通过 / ${report.summary.routingFailed} 未通过。真实文本评审：${report.summary.messagePassed} 通过 / ${report.summary.messageFailed} 未通过 / ${report.summary.needsReview} 待复核。`,
      '',`AI 评审状态：${report.reviewStatus}${report.reviewError?'；'+report.reviewError:''}。没有评审结果不等于通过。`,
      '',report.judgeLimitation||'本次未调用评审模型；规则通过只表示未发现所列确定性问题，不代表语义质量通过。',
      '','## 分流测试','','| ID | 场景 | 当前处理 | 结果与原因 |','|---|---|---|---|'];
    for(const g of report.gates)lines.push(`| ${g.id} | ${q(g.incoming)||'（空）'} | ${q(g.actual.reason)} | ${g.status} ${q(g.issues.join('；'))} |`);
    lines.push('','## 话术逐条评审','');
    for(const m of report.messages){
      lines.push('### '+m.id,'',`提问：${m.incoming||'首次联系'}；${m.calibration?'合成评审校准样本，非模型生成；预期 '+m.expectedAI+'，校准'+(m.calibrationPassed?'通过':'未通过'):'生成时间：'+(m.generatedAt||'未知')}。`,'','> '+m.text.replace(/\n/g,'\n> '),'',`综合结果：**${m.verdict}**。`);
      for(const issue of m.style)lines.push('- 规则提示：'+issue.reason);
      if(m.aiReview){lines.push('','| 维度 | 结果 | 依据 |','|---|---|---|');for(const k of rubric.dimensions){const d=m.aiReview.dimensions[k];lines.push(`| ${rubric.labels[k]} | ${d.status} | ${q(d.reason)}${d.quote?'；原文：'+q(d.quote):''} |`)}lines.push('', '建议：'+m.aiReview.suggestion)}
      else lines.push('语义评审尚未完成。'+(m.reviewError||''));
      lines.push('');
    }
    lines.push('## 验收口径','',
      '- 分流案例是合成测试资料，不能作为本人经历或真实发送内容。普通澄清、明确邀请提问与机械追问分别测试。',
      '- 事实、回答问题、可读性、角度、信息量、上下文与确认边界分开评审；不展示录用概率或不明来源的总分。',
      '- 缺失证据、限流、超时、格式错误及未评审均不计通过；失败保留原文和依据。评审引用必须存在于原回复，经历引用必须存在且已确认。',
      '- 系统回归测试检查程序行为，真实文本评审检查模型表达，两类结果分别统计。',
      '- 本评审器不能发送消息、修改简历或变更投递策略。生产数据库仅只读查询原资料版本。',
      '- JSON 含输入版本、规则版本、提示词哈希、模型配置标识、耗时和结果；不记录密钥。');
    fs.writeFileSync(path.join(out,'report.md'),lines.join('\n'),{mode:0o600});
    console.log(JSON.stringify({out,summary:report.summary,reviewStatus:report.reviewStatus}));
    // Exit 2 means observed product quality/routing failures or incomplete review,
    // not a harness crash. CI callers must not reinterpret it as a passing suite.
    if(report.summary.routingFailed || report.summary.styleFailed || report.summary.messageFailed || report.summary.needsReview || report.summary.calibrationFailed || report.reviewStatus==='unavailable')process.exitCode=2;
  } finally {global.fetch=actualFetch;live?.close();if(oldRoot===undefined)delete process.env.ATLAS_DATA_ROOT;else process.env.ATLAS_DATA_ROOT=oldRoot;fs.rmSync(temp,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
