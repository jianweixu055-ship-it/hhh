export const INDEXES=[{symbol:'sh000001',name:'上证指数'},{symbol:'sz399001',name:'深证成指'},{symbol:'sz399006',name:'创业板指'},{symbol:'sh000300',name:'沪深300'}];
export const DEFAULT_STOCKS=[{symbol:'sh600519',name:'贵州茅台'},{symbol:'sz300750',name:'宁德时代'},{symbol:'sz002594',name:'比亚迪'},{symbol:'sh600036',name:'招商银行'},{symbol:'sh603696',name:'安记食品'},{symbol:'sz003002',name:'壶化股份'},{symbol:'sh600969',name:'郴电国际'},{symbol:'sh603929',name:'亚翔集成'}];
export function normalizeSymbol(input){
  const s=String(input).trim().toLowerCase();
  if(/^(sh|sz|bj)\d{6}$/.test(s))return s;
  if(!/^\d{6}$/.test(s))throw new Error('请输入6位股票代码');
  return (/^6/.test(s)?'sh':/^[48]|^92/.test(s)?'bj':'sz')+s;
}
const number=x=>x===''||x==null?null:Number.isFinite(Number(x))?Number(x):null;
export function parseQuote(symbol,raw){
  if(typeof raw!=='string')return null;
  const f=raw.split('~');if(f.length<46||!(+f[3]>0)||!f[1])return null;
  const stamp=f[30]||'',date=/^\d{14}$/.test(stamp)?`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}`:null;
  const time=date?`${stamp.slice(8,10)}:${stamp.slice(10,12)}:${stamp.slice(12,14)}`:null;
  const ladder=(offset)=>Array.from({length:5},(_,i)=>({price:number(f[offset+i*2]),lots:number(f[offset+i*2+1])}));
  return {symbol,name:f[1],code:f[2],price:number(f[3]),prevClose:number(f[4]),open:number(f[5]),
    change:number(f[31]),changePct:number(f[32]),high:number(f[41]),low:number(f[42]),
    volume:number(f[36])==null?null:number(f[36])*100,amount:number(f[37])==null?null:number(f[37])*10000,
    turnover:number(f[38]),pe:number(f[39]),volumeRatio:number(f[49]),
    marketCap:number(f[45])==null?null:number(f[45])*1e8,date,time,source:'腾讯行情',mode:'live',bids:ladder(9),asks:ladder(19)};
}
export function parseBars(payload,symbol,period='day'){
  const node=payload?.data?.[symbol];
  const source=node?.['qfq'+period]||node?.[period];
  if(!Array.isArray(source))return [];
  return source.map(a=>({date:String(a[0]),open:+a[1],close:+a[2],high:+a[3],low:+a[4],volume:+a[5]}))
    .filter(b=>/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&[b.open,b.close,b.high,b.low].every(v=>Number.isFinite(v)&&v>0)
      &&b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close))
    .sort((a,b)=>a.date.localeCompare(b.date));
}
function loadScript(url,{charset='utf-8',timeout=10000}={}){
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.charset=charset;script.src=url;script.referrerPolicy='strict-origin-when-cross-origin';
    let done=false;const end=(error)=>{if(done)return;done=true;clearTimeout(timer);script.remove();error?reject(error):resolve();};
    const timer=setTimeout(()=>end(new Error('行情请求超时')),timeout);
    script.onload=()=>end();script.onerror=()=>end(new Error('行情数据源连接失败'));
    document.head.append(script);
  });
}
let quoteQueue=Promise.resolve(),sequence=0;
export function fetchQuotes(symbols){
  const run=async()=>{
    const unique=[...new Set(symbols)].filter(s=>/^(sh|sz|bj)\d{6}$/.test(s)),result={};
    for(let offset=0;offset<unique.length;offset+=60){
      const chunk=unique.slice(offset,offset+60);
      for(const s of chunk)delete globalThis['v_'+s];
      await loadScript('https://qt.gtimg.cn/q='+chunk.join(',')+'&_='+Date.now(),{charset:'gbk'});
      for(const s of chunk){const q=parseQuote(s,globalThis['v_'+s]);if(q)result[s]=q;delete globalThis['v_'+s];}
    }
    if(!Object.keys(result).length)throw new Error('行情源未返回有效数据');return result;
  };
  const task=quoteQueue.then(run,run);quoteQueue=task.catch(()=>{});return task;
}
const cache=new Map();
export async function fetchBars(symbol,period='day'){
  if(!/^(sh|sz|bj)\d{6}$/.test(symbol)||!['day','week','month'].includes(period))throw new Error('无效行情参数');
  const key=symbol+period,saved=cache.get(key);if(saved&&Date.now()-saved.at<60000)return saved.bars;
  const variable='ql_kline_'+Date.now()+'_'+sequence++;
  try{
    await loadScript('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='+encodeURIComponent(`${symbol},${period},,,100,qfq`)+'&_var='+variable);
    const bars=parseBars(globalThis[variable],symbol,period);if(!bars.length)throw new Error('历史K线为空或格式不符');
    cache.set(key,{at:Date.now(),bars});return bars;
  }finally{delete globalThis[variable];}
}
export function demoBars(symbol,period='day'){
  const bases={sh600519:1486,sz300750:249,sz002594:103,sh600036:43,sh603696:11.6,sz003002:24.8,sh600969:10.4,sh603929:32.7,sh000001:3276,sz399001:10850,sz399006:2290,sh000300:3820};
  const base=bases[symbol]||18+(Number(symbol.slice(-3))%80),seed=Number(symbol.slice(-3))%17;
  const bars=[];let date=new Date('2026-03-02T00:00:00Z');let previous=base*.83;
  for(let i=0;i<90;i++){
    while(date.getUTCDay()===0||date.getUTCDay()===6)date.setUTCDate(date.getUTCDate()+1);
    const close=base*(.84+i*.0018+Math.sin((i+seed)/5)*.025+Math.sin(i*1.8)*.005);
    const open=previous*(1+Math.sin(i+seed)*.007),high=Math.max(close,open)*1.009,low=Math.min(close,open)*.991;
    bars.push({date:date.toISOString().slice(0,10),open,close,high,low,volume:80000+Math.round((Math.sin(i*.7)+1)*40000+i*700)});
    previous=close;date.setUTCDate(date.getUTCDate()+1);
  }
  if(period==='day')return bars;
  const groups=new Map();for(const b of bars){const key=period==='month'?b.date.slice(0,7):Math.floor((Date.parse(b.date)-Date.parse(bars[0].date))/(7*864e5));const group=groups.get(key)||[];group.push(b);groups.set(key,group);}
  return [...groups.values()].map(a=>({date:a.at(-1).date,open:a[0].open,close:a.at(-1).close,high:Math.max(...a.map(b=>b.high)),low:Math.min(...a.map(b=>b.low)),volume:a.reduce((s,b)=>s+b.volume,0)}));
}
export function demoQuotes(symbols){
  return Object.fromEntries(symbols.map((symbol,i)=>{
    const bars=demoBars(symbol),last=bars.at(-1),prev=bars.at(-2),small=/^(sh603|sz003|sh600969)/.test(symbol);
    const price=small?prev.close*1.038:last.close,high=small?price*1.001:last.high,low=small?prev.close*.993:last.low;
    const seed=Number(symbol.slice(-3))%9;
    return [symbol,{symbol,code:symbol.slice(2),name:[...INDEXES,...DEFAULT_STOCKS].find(s=>s.symbol===symbol)?.name||'演示标的',
      price,prevClose:prev.close,open:last.open,high,low,change:price-prev.close,changePct:(price/prev.close-1)*100,
      volume:15000000+seed*1600000,amount:price*18000000,turnover:small?5.6:1.6+seed*.3,volumeRatio:small?1.68:.8+seed*.12,
      marketCap:small?32e8:700e8,date:last.date,time:'14:50:00',source:'合成演示，非市场行情',mode:'demo',
      bids:Array.from({length:5},(_,j)=>({price:price-(j+1)*.01,lots:350+seed*100+j*70})),asks:Array.from({length:5},(_,j)=>({price:price+(j+1)*.01,lots:480+seed*60+j*90}))}];
  }));
}
