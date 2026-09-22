const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),vm=require('node:vm')
const source=buildSync({entryPoints:['packages/ui/src/common/deepseek-policy.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text
const m={exports:{}};vm.runInNewContext('(function(module,exports){'+source+'\n})')(m,m.exports)
test('one shared policy preserves max reasoning, output and long-call timeout',()=>{
 assert.equal(m.exports.deepseekGeneration.reasoning_effort,'max')
 assert.equal(m.exports.deepseekGeneration.thinking.type,'enabled')
 assert.equal(m.exports.deepseekGeneration.max_tokens,393216)
 assert.equal(m.exports.DEEPSEEK_CONTEXT_TOKENS,1048576)
 assert.equal(m.exports.DEEPSEEK_REQUEST_TIMEOUT_MS,2700000)
 // Context capacity is provider metadata, never an invented Chat request parameter.
 assert.equal(m.exports.deepseekGeneration.context_length,undefined)
})
