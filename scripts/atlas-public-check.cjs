// Report rule names and locations only. Never print the value that failed a check.
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const blockedPath = /(?:^|\/)(?:private|\.local-backups|\.local-build|artifacts|storage|attachments|Partitions|Session Storage)(?:\/|$)|(?:^|\/)(?:llm|credentials|secrets|atlas-runtime)\.json$|(?:^|\/)\.env(?:\..+)?$|\.(?:db(?:-wal|-shm)?|sqlite3?|pem|key|p12|pfx|atlas|docx)$/i;
function pathFinding(file) {
  if (/^packages\/ui\/src\/common\/data\/map-(?:boundaries|source)\.json$/.test(file.replaceAll('\\','/'))) return 'map-redistribution-unresolved';
  if (/(?:^|\/)\.env\.example$/.test(file)) return null;
  return blockedPath.test(file.replaceAll('\\','/')) ? 'private-file' : null;
}
const rules = [
  ['api-token', /\b(?:sk-[A-Za-z0-9_-]{20,}|user_[A-Za-z0-9]{45,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,})\b/g],
  ['private-key', /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/g],
  ['url-credentials', /https?:\/\/[^\s/:'"]+:[^\s/@'"]+@/g],
  ['credential-literal', /\b(?:password|passwd|providerApiSecret|apiKey|api_key|accessToken|refreshToken)\s*["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']/gi],
];
function synthetic(value) {
  return /(?:^|[-_])(?:fixture|test|example)(?:[-_]|$)/i.test(value) || /^(?:(?:placeholder|isolated|replace|your)[_ -]|user_isolated_|sk-1234567890\d*$|(?:agent|legacy|old|storage)-backup-password$|strong-password-\d+$|wrong-password$|incorrect-password$|PRIVATE_SECRET_NEVER_EXPORT$|https?:\/\/user:(?:pass|pw)@|\$\{[A-Za-z_][\w]*\}$)/i.test(value)
}
function scanText(file, content) {
  const issues=[];
  for (const [offset,line] of content.split(/\r?\n/).entries()) for (const [rule,pattern] of rules) {
    pattern.lastIndex=0;
    for (const match of line.matchAll(pattern)) {
      if (rule !== 'private-key' && synthetic(match[1] || match[0])) continue;
      issues.push({file,line:offset+1,rule});
    }
  }
  return issues;
}
const git=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:80*1024*1024});
function sourceFiles(root) {
  if (fs.existsSync(path.join(root, '.git')))
    return git(root,['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
  // Downloaded source archives have no .git directory. Scan them directly,
  // excluding only generated/dependency folders, never local credential folders.
  const files = [], generated = new Set(['node_modules','out','dist','web-dist','artifacts','coverage','test-results','playwright-report','.atlas-cache','.local-build','.local-tools','.local-backups']);
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (!generated.has(entry.name)) visit(file); }
      else files.push(path.relative(root, file).replaceAll('\\','/'));
    }
  }
  visit(root); return files;
}
function checkRepository(root, history=false) {
  if (history && !fs.existsSync(path.join(root, '.git'))) throw Error('源码压缩包不含 Git 历史，请运行当前源码检查');
  const names=sourceFiles(root),issues=[];
  for (const file of new Set(names)) {
    const full=path.join(root,file);if(!fs.existsSync(full))continue;
    const rule=pathFinding(file);if(rule)issues.push({file,rule});
    const stat=fs.lstatSync(full);
    if(stat.isSymbolicLink()){issues.push({file,rule:'source-symlink'});continue}
    if(!stat.isFile())continue;
    const content=fs.readFileSync(full);
    if(!content.includes(0))issues.push(...scanText(file,content.toString('utf8')));
  }
  let historyBlobs=0;
  if(history) for(const record of git(root,['rev-list','--objects','--all']).trim().split('\n')){
    const [oid,...parts]=record.split(' '),file=parts.join(' ');if(!file)continue;
    if(git(root,['cat-file','-t',oid]).trim()!=='blob')continue;
    historyBlobs++;
    const content=execFileSync('git',['cat-file','blob',oid],{cwd:root,maxBuffer:80*1024*1024});
    // Reviewed upstream example: provider URL, secret and model are empty. The
    // exact blob is allowed; a modified example still undergoes the path check.
    const emptyLegacyTemplate=file==='packages/geek-auto-start-chat-with-boss/default-config-file/llm.json' && oid==='87389d9b6851f0d1e68039d6dafeb8e548d5b44c';
    const rule=pathFinding(file);if(rule&&!emptyLegacyTemplate)issues.push({file,object:oid.slice(0,12),rule});
    if(!content.includes(0))issues.push(...scanText(file,content.toString('utf8')).map(x=>({...x,object:oid.slice(0,12)})));
  }
  return {checkedFiles:new Set(names).size,historyBlobs,issues};
}
function checkBuildDirectory(directory) {
  const issues=[];let checkedFiles=0;
  function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,item.name),relative=path.relative(directory,file).replaceAll('\\','/');
    if(item.isSymbolicLink()){issues.push({file:relative,rule:'build-symlink'});continue}
    const rule=pathFinding(relative);if(rule)issues.push({file:relative,rule});
    if(item.isDirectory()){walk(file);continue}
    checkedFiles++;const bytes=fs.readFileSync(file);
    if(!bytes.includes(0))issues.push(...scanText(relative,bytes.toString('utf8')));
  }}
  walk(directory);return {checkedFiles,issues};
}
function assertPublicBuild(directory) {
  const result=checkBuildDirectory(directory);
  if(result.issues.length)throw Error('发布产物包含私有文件或疑似凭据：'+JSON.stringify(result.issues));
  return result;
}
module.exports={scanText,pathFinding,sourceFiles,checkRepository,checkBuildDirectory,assertPublicBuild};
if(require.main===module) try {
  const root=path.resolve(__dirname,'..');
  const result=process.argv.includes('--build') ? checkBuildDirectory(path.resolve(process.argv[process.argv.indexOf('--build')+1])) : checkRepository(root,process.argv.includes('--history'));
  console.log(JSON.stringify(result,null,2));process.exitCode=result.issues.length?1:0;
}catch{console.error('开源检查未能完成，请检查 Git 和目标目录；未输出文件内容。');process.exitCode=1}
