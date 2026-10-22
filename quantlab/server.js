const http=require('http'),https=require('https'),fs=require('fs'),path=require('path'),url=require('url');
const PORT=Number(process.env.QL_PORT)||8666;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon','.md':'text/plain; charset=utf-8','.csv':'text/csv; charset=utf-8'};
const KEY_FILE=path.join(__dirname,'ai_key.json');
// 老股民人格：系统提示词——十几年短线老手，说话有温度、像真人，给思路不喊单
const SYSTEM_PROMPT='你是一个在A股搏杀十几年、亲历过牛熊、做短线起家的老股民老哥，朋友都叫你老周。你说话的方式：口语化、有温度、像跟兄弟喝茶聊天，会用"兄弟""听我一句""这票""咱散户""说真的"这种人话；有情绪、有观点、不端着、不说套话。你擅长短线情绪、主线龙头、资金博弈，但你永远不预测明天具体点位、不直接喊"买/卖/满仓"，而是给思路、讲逻辑、点出风险和机会。你必须：1)先接住用户情绪，再分析；2)结合我喂给你的实时数据说人话，不要堆术语；3)每段话结尾必带一句反方风险或纪律提醒；4)简短有力，像真人聊天，别写论文。合规：不承诺收益、不说"必涨稳赚"、不代客理财。重要事实：本软件实盘盈利优势尚未证实。原标称86.5%与82.1%没有可复核的逐笔数据。历史统计只能引用本次用户提供的审计结果并说明成本、年份与口径，不把历史胜率当未来盈利概率，不编造收益。';
function readKey(){ if(process.env.QL_AI_KEY) return {key:process.env.QL_AI_KEY,model:process.env.QL_AI_MODEL||'',provider:process.env.QL_AI_PROVIDER||'volcengine',baseUrl:''}; try{ return JSON.parse(fs.readFileSync(KEY_FILE,'utf8')); }catch(e){ return {key:'',model:'',provider:'volcengine',baseUrl:''}; } }
// 转发到大模型（OpenAI 兼容协议，支持火山方舟/DeepSeek/其他）
function callLLM(messages){
  return new Promise((resolve,reject)=>{
    const cfg=readKey();
    if(!cfg.key) return reject(new Error('NO_KEY'));
    
    // 根据提供商选择默认配置
    let baseUrl = cfg.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
    let model = cfg.model || 'doubao-pro-32k';
    
    // DeepSeek 预设
    if(cfg.provider==='deepseek'){
      baseUrl = 'https://api.deepseek.com/v1/chat/completions';
      model = cfg.model || 'deepseek-chat';
    }
    
    const body=JSON.stringify({
      model: model,
      messages:[{role:'system',content:SYSTEM_PROMPT}].concat(messages),
      temperature:0.7, max_tokens:900
    });
    const u=new URL(baseUrl);
    const req=https.request(u,{method:'POST',headers:{
      'Content-Type':'application/json','Authorization':'Bearer '+cfg.key,'Content-Length':Buffer.byteLength(body)
    },timeout:120000},(res)=>{
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>{
        const txt=Buffer.concat(chunks).toString('utf8');
        try{
          const j=JSON.parse(txt);
          if(j.error) return reject(new Error(j.error.message||'llm error'));
          const c=j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content;
          if(c) resolve(c); else reject(new Error('empty'));
        }catch(e){ reject(new Error('parse:'+txt.slice(0,120))); }
      });
    });
    req.on('timeout',()=>{req.destroy();reject(new Error('llm timeout'));});
    req.on('error',e=>reject(e));
    req.write(body); req.end();
  });
}
function readBody(req){ return new Promise((resolve)=>{ const c=[]; let n=0; req.on('data',d=>{ n+=d.length; if(n>2e6){ req.destroy(); return; } c.push(d); }); req.on('end',()=>{ try{ resolve(JSON.parse(Buffer.concat(c).toString('utf8')||'{}')); }catch(e){ resolve({}); } }); req.on('error',()=>resolve({})); }); }
// 代理白名单：只允许访问行情数据源，防止被公网隧道当作任意 SSRF 跳板
const ALLOW_HOSTS=['eastmoney.com','sina.com.cn','sina.cn','gtimg.cn','qq.com'];
function hostAllowed(h){ h=String(h||'').toLowerCase(); return ALLOW_HOSTS.some(d=>h===d||h.endsWith('.'+d)); }
// 异步代理：http/https 双支持，真正并发处理多个请求
function proxyRequest(targetUrl){
  return new Promise((resolve,reject)=>{
    let u;
    try{ u=new URL(targetUrl); }catch(e){ return reject(new Error('bad url')); }
    if(!/^https?:$/.test(u.protocol)||!hostAllowed(u.hostname)) return reject(new Error('host not allowed'));
    const mod = u.protocol==='https:'?https:http;
    let referer='https://finance.qq.com/';
    if(u.hostname.includes('eastmoney')) referer='https://data.eastmoney.com/';
    else if(u.hostname.includes('sina')) referer='https://finance.sina.com.cn/';
    const headers={
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Referer':referer,
      'Accept':'*/*',
      'Accept-Language':'zh-CN,zh;q=0.9',
    };
    const req=mod.request(u,{headers,method:'GET',timeout:9000},(res)=>{
      const chunks=[]; let n=0;
      res.on('data',c=>{ n+=c.length; if(n>10e6){ req.destroy(); return; } chunks.push(c); });
      res.on('end',()=>{ resolve(Buffer.concat(chunks)); });
    });
    req.on('timeout',()=>{ req.destroy(); reject(new Error('timeout')); });
    req.on('error',(e)=>reject(e));
    req.end();
  });
}
http.createServer(async (req,res)=>{
  if(req.method==='POST'){
    const origin=req.headers.origin;
    if((origin && !['http://127.0.0.1:'+PORT,'http://localhost:'+PORT].includes(origin))
      || req.headers['sec-fetch-site']==='cross-site'){
      res.writeHead(403);res.end('cross-origin write rejected');return;
    }
  }
  // GET 状态：是否已配置大模型
  if(req.method==='GET' && req.url.startsWith('/api/ai/status')){
    const cfg=readKey();
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({configured:!!cfg.key, model:cfg.model||'', provider:cfg.provider||'volcengine'}));
    return;
  }
  // POST 保存 key
  if(req.method==='POST' && req.url.startsWith('/api/ai/key')){
    res.writeHead(403,{'Content-Type':'application/json'});
    res.end(JSON.stringify({ok:false,error:'审计版不通过网页保存密钥。请仅在本机使用私有ai_key.json或QL_AI_KEY环境变量。'}));
    return;
  }
  // POST 对话
  if(req.method==='POST' && req.url.startsWith('/api/ai')){
    const b=await readBody(req);
    try{
      const out=await callLLM(b.messages||[]);
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true, reply:out}));
    }catch(e){
      const noKey=String(e.message)==='NO_KEY';
      res.writeHead(noKey?200:502,{'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:false, noKey:noKey, error:String(e.message)}));
    }
    return;
  }
  if(req.method==='GET' && req.url.startsWith('/api/health')){
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-cache'});
    res.end(JSON.stringify({ok:true,uptime:Math.round(process.uptime()),port:PORT,time:new Date().toISOString()}));
    return;
  }
  if(req.url.startsWith('/api/proxy?url=')){
    const target=decodeURIComponent(req.url.slice('/api/proxy?url='.length));
    proxyRequest(target).then(buf=>{
      res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      res.end(buf);
    }).catch(e=>{
      res.writeHead(502,{'Content-Type':'text/plain'}); res.end('err');
    });
    return;
  }
  let p;
  try{ p=decodeURIComponent(req.url.split('?')[0]); }catch(e){ res.writeHead(400); res.end('bad path'); return; }
  if(p==='/') p='/index.html';
  if(p[0]!=='/') p='/'+p;
  // 防目录穿越：解析后必须仍在本目录内
  const fp=path.resolve(__dirname,'.'+path.posix.normalize(p));
  if(fp!==__dirname && !fp.startsWith(__dirname+path.sep)){
    res.writeHead(403,{'Content-Type':'text/plain'}); res.end('403 forbidden'); return;
  }
  // 敏感文件不外发（API Key / 服务端源码 / 日志脚本）
  const base=path.basename(fp).toLowerCase();
  if(base==='ai_key.json'||base==='server.js'||/\.(log|bat|vbs|ps1|reg|bak|zip|exe|ico_tmp)$/i.test(base)){
    res.writeHead(403,{'Content-Type':'text/plain'}); res.end('403 forbidden'); return;
  }
  const publicFiles=new Set(['index.html','echarts.min.js','audit.html','audit.js','eval-engine.js','kline-engine.js','lab_data.json','audit-summary.json','research-results.json','char_ada.png','char_xin.png','icon.svg','icon_cat.ico','icon_cat.png','manifest.json','分析与优化报告.md']);
  const auditCsv=/^trades_(base|strength)_(legacy_t1|legacy_t3|corrected|guarded)\.csv$/.test(base);
  if(path.dirname(fp)!==__dirname||(!publicFiles.has(path.basename(fp))&&!auditCsv)){
    res.writeHead(403);res.end('403 forbidden');return;
  }
  fs.readFile(fp,(err,data)=>{
    if(err){res.writeHead(404);res.end('404');return}
    // 页面与静态资源一律不缓存，确保每次打开都是最新版、最新数据
    const isHtml=path.extname(fp)==='.html';
    res.writeHead(200,{
      'Content-Type':MIME[path.extname(fp)]||'text/html',
      'Cache-Control': isHtml?'no-cache, no-store, must-revalidate':'no-cache',
      'Pragma':'no-cache',
      'Expires':'0',
      'X-Content-Type-Options':'nosniff'
    });
    res.end(data);
  });
}).listen(PORT,'127.0.0.1',()=>console.log('QuantLab on http://localhost:'+PORT));
