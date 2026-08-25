const fs=require('node:fs'),path=require('node:path')
const root=process.cwd(),src=path.join(root,'snapflow-website'),out=path.join(root,'dist','site')
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true})
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'))
const release={
  version:pkg.version,
  publishedAt:process.env.SNAPFLOW_PUBLISHED_AT||'',
  windowsSetupUrl:process.env.SNAPFLOW_WINDOWS_SETUP_URL||'',
  windowsPortableUrl:process.env.SNAPFLOW_WINDOWS_PORTABLE_URL||'',
  manifestUrl:process.env.SNAPFLOW_MANIFEST_URL||''
}
let html=fs.readFileSync(path.join(src,'index.html'),'utf8')
html=html.replace(/\/\*__SNAPFLOW_RELEASE__\*\/[{][^;]*[}];/,`/*__SNAPFLOW_RELEASE__*/${JSON.stringify(release)};`)
if(Buffer.byteLength(html)>200*1024)throw new Error('Website index.html exceeds 200KB')
fs.writeFileSync(path.join(out,'index.html'),html)
for(const name of ['robots.txt','sitemap.xml','README.md'])if(fs.existsSync(path.join(src,name)))fs.copyFileSync(path.join(src,name),path.join(out,name))
if(fs.existsSync(path.join(src,'docs')))fs.cpSync(path.join(src,'docs'),path.join(out,'docs'),{recursive:true})
const manifest={version:release.version,publishedAt:release.publishedAt,windowsSetupUrl:release.windowsSetupUrl,windowsPortableUrl:release.windowsPortableUrl,sha256:process.env.SNAPFLOW_WINDOWS_SHA256||'',minSupported:process.env.SNAPFLOW_MIN_SUPPORTED||release.version,channel:process.env.SNAPFLOW_CHANNEL||'stable',updateBaseUrl:process.env.SNAPFLOW_UPDATE_BASE_URL||''}
fs.mkdirSync(path.join(out,'update'),{recursive:true});fs.writeFileSync(path.join(out,'update','manifest.json'),JSON.stringify(manifest,null,2))
console.log(`PASS website build: ${Buffer.byteLength(html)} bytes`)
console.log(`Release URLs: setup=${release.windowsSetupUrl?'configured':'NOT PUBLISHED'} portable=${release.windowsPortableUrl?'configured':'NOT PUBLISHED'}`)
