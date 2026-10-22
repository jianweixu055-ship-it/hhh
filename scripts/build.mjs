import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'_site');
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
const copy=async relative=>{const target=path.join(out,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,relative),target);};
await copy('index.html');await fs.cp(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
const quantFiles=['index.html','audit.html','audit.js','eval-engine.js','kline-engine.js','echarts.min.js','ECHARTS-LICENSE.txt','lab_data.json','audit-summary.json','char_ada.png','char_xin.png','icon.svg','icon_cat.ico','icon_cat.png','manifest.json','分析与优化报告.md'];
for(const file of quantFiles)await copy('quantlab/'+file);
await copy('reports/分析与优化报告.pdf');
let commit='local';try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{}
await fs.writeFile(path.join(out,'assets','build.json'),JSON.stringify({commit,builtAt:new Date().toISOString(),app:'jianwei-market-workbench'}));
await fs.writeFile(path.join(out,'.nojekyll'),'');
console.log('Static Pages artifact built in _site; backend files and credentials excluded.');
