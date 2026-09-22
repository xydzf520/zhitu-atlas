import {buildSync} from 'esbuild'
import path from 'node:path'
import {createRequire} from 'node:module'
const root=import.meta.dirname, file=path.join(root,'.atlas-cache/server.cjs')
buildSync({entryPoints:[path.join(root,'../src/main/features/atlas-server.ts')],bundle:true,platform:'node',format:'cjs',outfile:file})
const server=await createRequire(import.meta.url)(file).startAtlasServer(path.join(root,'../web-dist'))
console.log(`职途 Atlas 本机服务：http://127.0.0.1:${server.address().port}/desktop.html`)
process.on('SIGTERM',()=>server.close(()=>process.exit(0)))
