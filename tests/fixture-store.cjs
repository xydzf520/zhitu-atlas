const fs = require('node:fs'), path = require('node:path'), {DatabaseSync} = require('node:sqlite')
function use(config, run) {
  const file=path.join(config,'../storage/atlas.db'); if(!fs.existsSync(file)) return undefined
  const db=new DatabaseSync(file);try{return run(db)}finally{db.close()}
}
exports.get=(config,key)=>use(config,db=>{const r=db.prepare('SELECT value FROM documents WHERE key=?').get(key);return r?JSON.parse(r.value):undefined})
exports.list=(config,prefix)=>use(config,db=>db.prepare('SELECT key FROM documents WHERE key LIKE ? AND value<>?').all(prefix+'/%','null').map(r=>r.key.split('/').pop()))||[]
exports.put=(config,key,value)=>{const exists=fs.existsSync(path.join(config,'../storage/atlas.db'));if(exists&&(/^(career-|atlas-)/.test(key)))use(config,db=>db.prepare('INSERT INTO documents VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=documents.revision+1').run(key,JSON.stringify(value),new Date().toISOString()));else{const file=path.join(config,key);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value))}}
