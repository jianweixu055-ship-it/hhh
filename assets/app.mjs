import {INDEXES,DEFAULT_STOCKS,normalizeSymbol,fetchQuotes,fetchBars,demoQuotes,demoBars} from './market.mjs';
import {analyzeCandidate,riskPlan,movingAverage,csvText,marketDate,RULE_VERSION} from './scanner.mjs';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const pct=v=>Number.isFinite(v)?(v>0?'+':'')+v.toFixed(2)+'%':'—';
const big=v=>!Number.isFinite(v)?'—':Math.abs(v)>=1e8?(v/1e8).toFixed(2)+'亿':Math.abs(v)>=1e4?(v/1e4).toFixed(1)+'万':fmt(v,0);
const cls=v=>v>0?'up':v<0?'down':'';
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{toast('浏览器存储不可用，请导出保存');return false;}}
let watch=read('jw-watch-v1',['sh600519','sh603696','sz003002']);if(!Array.isArray(watch))watch=[];
watch=watch.filter(s=>/^(sh|sz|bj)\d{6}$/.test(s));
let notes=read('jw-notes-v1',{});if(!notes||typeof notes!=='object'||Array.isArray(notes))notes={};
const state={mode:'live',view:'scanner',symbol:'sh600519',period:'day',quotes:{},bars:[],universe:[],sort:false,generation:0,chartRequest:0,scanResults:[],lastScan:null,refreshing:false};
const known=new Map([...INDEXES,...DEFAULT_STOCKS].map(s=>[s.symbol,s.name]));
const chart=echarts.init($('price-chart'));let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,2600);}
function observedSymbols(){return [...new Set([...DEFAULT_STOCKS.map(s=>s.symbol),...watch,state.symbol])];}
function banner(message,type=''){$('data-message').textContent=message;$('data-banner').className='data-banner '+type;}
function renderIndexes(){
 $('index-grid').innerHTML=INDEXES.map(index=>{
  const q=state.quotes[index.symbol],c=cls(q?.changePct),p=q?.price;
  const point=q?.high>q?.low?Math.max(7,Math.min(68,7+(p-q.low)/(q.high-q.low)*61)):37;
  const range=q?`<svg viewBox="0 0 76 30" class="${c}" role="img" aria-label="当日高低价区间，圆点为现价"><title>日内区间 ${fmt(q.low)}～${fmt(q.high)}，不是分时走势</title><line x1="7" y1="20" x2="69" y2="20" opacity=".18" stroke-width="4"/><circle cx="${point}" cy="20" r="3" fill="currentColor" stroke="none"/></svg>`:'';
  return `<article class="index-card"><header><span>${index.name}</span><small>${index.symbol.slice(2)}</small></header><div class="index-data"><strong class="${c}">${fmt(p)}</strong>${range}</div><div class="index-changes ${c}"><span>${q?.change>0?'+':''}${fmt(q?.change)}</span><span>${pct(q?.changePct)}</span></div><div class="index-time">${state.mode==='demo'?'合成演示 · 非市场行情':q?esc(q.date+' '+q.time):'数据连接中 / 暂无行情'}</div></article>`;
 }).join('');
}
function renderTable(){
 let symbols=state.view==='watch'?[...watch]:observedSymbols();
 if(state.sort)symbols.sort((a,b)=>(state.quotes[b]?.changePct??-Infinity)-(state.quotes[a]?.changePct??-Infinity));
 $('table-title').textContent=state.view==='watch'?'我的自选':'精选观察池';$('table-count').textContent=symbols.length+' 只';
 $('watch-count').textContent=watch.length;
 $('watch-body').innerHTML=symbols.length?symbols.map(s=>{
  const q=state.quotes[s];return `<tr class="watch-row ${s===state.symbol?'selected':''}" data-symbol="${s}" tabindex="0" aria-label="查看${esc(q?.name||known.get(s)||s)}"><td><b>${esc(q?.name||known.get(s)||'等待查询')}</b><small>${s.slice(2)} · ${s.startsWith('sh')?'沪市':s.startsWith('sz')?'深市':'北交所'}</small></td><td class="${cls(q?.changePct)}">${fmt(q?.price)}</td><td><span class="pill-change ${cls(q?.changePct)}">${pct(q?.changePct)}</span></td><td>${big(q?.amount)}</td><td>${Number.isFinite(q?.turnover)?fmt(q.turnover)+'%':'—'}</td><td>${fmt(q?.volumeRatio)}</td><td><button class="star-button ${watch.includes(s)?'active':''}" data-star="${s}" aria-label="${watch.includes(s)?'取消':'添加'}${esc(q?.name||s)}自选"><svg><use href="#icon-star"/></svg></button></td></tr>`;
 }).join(''):'<tr><td colspan="7"><div class="empty">还没有自选。搜索股票后，点击星标加入。</div></td></tr>';
 $('watch-body').querySelectorAll('[data-symbol]').forEach(row=>{
  row.onclick=e=>{if(!e.target.closest('[data-star]'))selectSymbol(row.dataset.symbol);};
  row.onkeydown=e=>{if(e.key==='Enter'&&!e.target.closest('button'))selectSymbol(row.dataset.symbol);};
 });
 $('watch-body').querySelectorAll('[data-star]').forEach(b=>b.onclick=()=>toggleWatch(b.dataset.star));
 $('source-label').textContent=state.mode==='demo'?'合成演示 · 不代表真实价格':'腾讯行情 · 见各标的时间';
}
function toggleWatch(symbol){watch=watch.includes(symbol)?watch.filter(s=>s!==symbol):[...watch,symbol];save('jw-watch-v1',watch);renderTable();renderDetails();}
function renderDetails(){
 const q=state.quotes[state.symbol];
 $('stock-name').textContent=q?.name||known.get(state.symbol)||'股票查询';
 $('stock-code').textContent=state.symbol.slice(2)+' · '+(state.symbol.startsWith('sh')?'沪市':state.symbol.startsWith('sz')?'深市':'北交所');
 $('stock-price').textContent=fmt(q?.price);$('stock-price').className=cls(q?.changePct);
 $('stock-change').textContent=q?`${q.change>0?'+':''}${fmt(q.change)}  ${pct(q.changePct)}`:'等待行情';$('stock-change').className=cls(q?.changePct);
 $('quote-date').textContent=state.mode==='demo'?'合成演示':q?.date?`${q.date} ${q.time}`:'数据时间待确认';
 $('toggle-star').classList.toggle('active',watch.includes(state.symbol));
 $('snapshot-mode').textContent=state.mode==='demo'?'演示':q?'腾讯快照':'待连接';
 const entries=[['今开',q?.open],['昨收',q?.prevClose],['最高',q?.high],['最低',q?.low],['成交额',big(q?.amount)],['换手率',q?.turnover==null?'—':fmt(q.turnover)+'%']];
 $('snapshot').innerHTML=entries.map(([name,v])=>`<label>${name}<strong>${typeof v==='string'?esc(v):fmt(v)}</strong></label>`).join('');
 const rows=[...(q?.asks||Array(5).fill({})).map((r,i)=>({...r,label:'卖'+(i+1),ask:true})).reverse(),null,...(q?.bids||Array(5).fill({})).map((r,i)=>({...r,label:'买'+(i+1),ask:false}))];
 const max=Math.max(1,...rows.filter(Boolean).map(r=>r.lots||0));
 $('orderbook').innerHTML=rows.map(r=>r?`<div class="order-row"><i style="width:${Math.max(0,r.lots||0)/max*65}%;background:${r.ask?'var(--up)':'var(--down)'}"></i><span>${r.label}</span><span class="${r.ask?'up':'down'}">${fmt(r.price)}</span><span>${fmt(r.lots,0)}</span></div>`:'<div class="order-divider"></div>').join('');
 updateRisk();
}
function updateRisk(){
 const q=state.quotes[state.symbol];if(!q){$('risk-result').textContent='获取有效参考价格后，才计算整手数量。';return;}
 try{
  const plan=riskPlan({capital:+$('capital').value,weightPct:+$('weight').value,riskPct:+$('risk-pct').value,stopPct:+$('stop-pct').value,price:q.price,symbol:q.symbol});
  if(!plan.qty){$('risk-result').textContent=plan.blocked;return;}
  $('risk-result').innerHTML=`${state.mode==='demo'?'合成演示测算':'按当前价格测算'} · 非下单指令<br><strong>${plan.qty}</strong>股 / ${plan.qty/100}手<br>含买入成本约 ${fmt(plan.cashRequired)} 元<br>按设定止损与成本，估算亏损 ${fmt(plan.modeledLoss)} 元<br><span class="small">次日价格变化后需重新计算；不承诺成交或亏损上限。</span>`;
 }catch(e){$('risk-result').textContent=e.message;}
}
function emptyChart(message){chart.clear();chart.setOption({graphic:{type:'text',left:'center',top:'middle',style:{text:message,fill:'#96a3b5',font:'12px sans-serif',textAlign:'center'}}});}
function renderChart(){
 const bars=state.bars;if(!bars.length){emptyChart('暂无可核验历史 K 线');return;}
 const dark=document.body.dataset.theme==='dark',text=dark?'#7f90aa':'#a3aebe',line=dark?'#233047':'#f0f2f6';
 chart.clear();chart.setOption({animation:false,backgroundColor:'transparent',
  tooltip:{trigger:'axis',axisPointer:{type:'cross'},confine:true,backgroundColor:dark?'#1b2a41':'#fff',borderColor:line,textStyle:{color:dark?'#dbe5f5':'#31415d',fontSize:10}},
  axisPointer:{link:[{xAxisIndex:'all'}]},grid:[{left:55,right:26,top:25,height:'58%'},{left:55,right:26,top:'73%',height:'12%'}],
  xAxis:[{type:'category',data:bars.map(b=>b.date),axisLine:{lineStyle:{color:line}},axisTick:{show:false},axisLabel:{color:text,fontSize:9,formatter:v=>v.slice(5)},boundaryGap:true},
   {type:'category',gridIndex:1,data:bars.map(b=>b.date),axisLine:{show:false},axisLabel:{show:false},axisTick:{show:false}}],
  yAxis:[{scale:true,splitNumber:4,axisLabel:{color:text,fontSize:9},splitLine:{lineStyle:{color:line,type:'dashed'}},axisPointer:{label:{precision:2}}},
   {gridIndex:1,scale:true,splitNumber:2,axisLabel:{show:false},splitLine:{show:false}}],
  dataZoom:[{type:'inside',xAxisIndex:[0,1],start:state.period==='day'?35:0,end:100}],
  series:[{name:state.mode==='demo'?'合成演示K线':'前复权K线',type:'candlestick',data:bars.map(b=>[b.open,b.close,b.low,b.high]),itemStyle:{color:'#eb737b',color0:'#30b99c',borderColor:'#e7656e',borderColor0:'#26aa8f'},barMaxWidth:8},
   ...[[5,'#dfa553'],[10,'#9e7cd4'],[20,'#6496dc']].map(([n,color])=>({name:'MA'+n,type:'line',data:movingAverage(bars,n),symbol:'none',lineStyle:{width:1,color},itemStyle:{color}})),
   {name:'成交量（手）',type:'bar',xAxisIndex:1,yAxisIndex:1,barMaxWidth:8,data:bars.map(b=>({value:b.volume,itemStyle:{color:b.close>=b.open?'#e78b9265':'#70cbb575'}}))}]
 });
}
async function loadChart(){
 const request=++state.chartRequest,generation=state.generation,symbol=state.symbol,period=state.period;
 state.bars=[];emptyChart('正在加载历史 K 线…');$('chart-note').textContent='数据读取中…';
 try{
  const bars=state.mode==='demo'?demoBars(symbol,period):await fetchBars(symbol,period);
  if(request!==state.chartRequest||generation!==state.generation)return;
  state.bars=bars;renderChart();$('chart-note').textContent=state.mode==='demo'?'图表为合成演示数据，不能用于选股验证。':`腾讯前复权 ${period==='day'?'日':period==='week'?'周':'月'}K · ${bars[0].date} ～ ${bars.at(-1).date} · 鼠标滚轮缩放，拖动查看`;
 }catch(e){if(request!==state.chartRequest||generation!==state.generation)return;emptyChart('历史 K 线暂不可用');$('chart-note').textContent=e.message+'；未用演示数据替换。';}
}
async function selectSymbol(symbol){
 try{symbol=normalizeSymbol(symbol);}catch(e){toast(e.message);return;}
 state.symbol=symbol;$('search').value='';$('search-results').hidden=true;
 $('stock-note').value=notes[symbol]?.text||'';$('note-status').textContent=notes[symbol]?'已保存于本机':'';
 renderTable();renderDetails();loadChart();
 if(!state.quotes[symbol]){while(state.refreshing)await new Promise(r=>setTimeout(r,100));if(state.symbol===symbol&&!state.quotes[symbol])await loadMarket();}
}
async function loadMarket(){
 if(state.refreshing)return;state.refreshing=true;$('refresh').disabled=true;const generation=state.generation;
 try{
  const symbols=[...INDEXES.map(i=>i.symbol),...observedSymbols()];
  const quotes=state.mode==='demo'?demoQuotes(symbols):await fetchQuotes(symbols);
  if(generation!==state.generation)return;
  state.quotes={...state.quotes,...quotes};
  banner(state.mode==='demo'?'演示模式 · 所有数值均为合成示例，不代表真实行情或策略盈利。':`腾讯行情已连接 · 各标的时间见快照，休市时显示最近交易数据 · ${Object.keys(quotes).length} 个有效快照`,state.mode==='demo'?'demo':'');
  renderIndexes();renderTable();renderDetails();
 }catch(e){if(generation!==state.generation)return;banner(e.message+'。当前结果可能为空或已过期，可手动选择演示体验。','error');}
 finally{state.refreshing=false;$('refresh').disabled=false;}
}
async function switchMode(mode){
 if(mode===state.mode)return;state.mode=mode;state.generation++;state.chartRequest++;state.quotes={};state.bars=[];state.scanResults=[];
 $('scan-output').hidden=true;$('scan-status').textContent='模式已切换，需重新核验';
 $('live-mode').classList.toggle('active',mode==='live');$('demo-mode').classList.toggle('active',mode==='demo');
 renderIndexes();renderTable();renderDetails();
 // Previous requests may be finishing. Their generation checks prevent cross-mode data mixing.
 if(state.refreshing){while(state.refreshing)await new Promise(r=>setTimeout(r,100));}
 await Promise.all([loadMarket(),loadChart()]);
}
function setView(view){
 state.view=view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 const titles={scanner:['短线选股','发现机会，先看清风险'],market:['行情看板','市场脉搏，一眼看清'],watch:['我的自选','把关注，留给有依据的机会']};
 $('breadcrumb').textContent=titles[view][0];$('page-title').textContent=titles[view][1]+'.';$('scanner-panel').hidden=view!=='scanner';renderTable();chart.resize();
}
async function runScan(){
 const button=$('run-scan');button.disabled=true;const generation=state.generation,mode=state.mode;
 $('scan-output').hidden=false;$('scan-output').innerHTML='<div class="empty">正在获取观察池行情并核验条件…</div>';
 try{
  const pool=$('scan-universe').value==='historical'?state.universe.map(s=>s.symbol):observedSymbols();
  if(!pool.length)throw new Error('股票池尚未加载，请稍后重试');
  const budget={capital:+$('capital').value,weightPct:+$('weight').value,riskPct:+$('risk-pct').value,stopPct:+$('stop-pct').value};
  riskPlan({...budget,price:1,symbol:'sh600000'});
  const unique=[...new Set(pool)],quotes=mode==='demo'?demoQuotes(unique):await fetchQuotes(unique);
  if(generation!==state.generation)return;
  state.quotes={...state.quotes,...quotes};const results=[];const snapshots={};let fetched=0;
  const mainOnly=$('scan-board').value==='main';
  // Only fetch daily histories after the observable quote checks pass. Missing factors stay missing.
  for(let i=0;i<unique.length;i+=3){
   await Promise.all(unique.slice(i,i+3).map(async symbol=>{
    const q=quotes[symbol];if(!q){results.push({symbol,name:known.get(symbol),status:'incomplete',passed:0,total:10,reasons:['行情缺失'],checks:[]});return;}
    let bars=[];const partial=analyzeCandidate(q,[],{mainOnly,today:mode==='demo'?q.date:marketDate()});
    if(!partial.checks.some(c=>c.passed===false)){
     try{bars=mode==='demo'?demoBars(symbol):await fetchBars(symbol);fetched++;}catch{}
    }
    const result=analyzeCandidate(q,bars,{mainOnly,today:mode==='demo'?q.date:marketDate()});
    const plan=riskPlan({...budget,price:q.price,symbol:q.symbol});
    const supported=/^(sh60|sz00|sz30)\d{4}$/.test(q.symbol);
    const moneyCheck={name:'当前资金与含成本风险可覆盖至少一手',passed:supported?plan.qty>0:null,value:plan.qty};
    result.checks.push(moneyCheck);result.total++;
    if(moneyCheck.passed===true)result.passed++;
    else{result.reasons.push(plan.blocked);if(result.status!=='excluded')result.status=supported?'excluded':'incomplete';}
    snapshots[symbol]={quote:q,dailyBars:bars,capitalPlan:plan};
    results.push({...result,dataMode:mode,emittedAt:new Date().toISOString()});
   }));
   if(generation!==state.generation)return;
   $('scan-status').textContent=`核验 ${Math.min(i+3,unique.length)} / ${unique.length}`;
  }
  results.sort((a,b)=>b.passed-a.passed||String(a.symbol).localeCompare(String(b.symbol)));
  state.scanResults=results;state.lastScan={ruleVersion:RULE_VERSION,emittedAt:new Date().toISOString(),dataMode:mode,mainOnly,budget,universe:unique,results,snapshots,notRealTrades:true};
  save('jw-last-scan-v1',state.lastScan);
  const candidates=results.filter(r=>['confirmed','preliminary'].includes(r.status)),missing=results.filter(r=>r.status==='incomplete').length;
  const confirmed=candidates.filter(r=>r.status==='confirmed').length;
  $('scan-status').textContent=`${unique.length}只 · ${confirmed}个收盘条件完整`;
  const source=mode==='demo'?'合成演示筛选；所有结果不参与真实验证。':'腾讯快照复核；不含真实成交、未来收益或完整全市场。';
  const summary=`<div class="scan-summary">${source}<br>${unique.length}只核验 · ${confirmed}个收盘条件完整 · ${candidates.length-confirmed}个盘中预筛 · ${missing}个数据不完整 · 查询${fetched}份日K。<br>无匹配时不自动放宽条件；次日跳空、排队与T+1风险仍需另查。</div>`;
  const cards=candidates.length?`<div class="scan-result">${candidates.slice(0,30).map(r=>`<button class="candidate" data-candidate="${r.symbol}"><span><b>${esc(quotes[r.symbol]?.name||r.name||r.symbol)}</b> <span class="stock-code">${r.symbol.slice(2)}</span><small>${esc(mode==='demo'?'演示预筛':r.status==='confirmed'?'收盘条件完整，仍非买入指令':'盘中预筛，等待收盘复核')} · ${esc(r.sourceDate||'')} ${esc(r.sourceTime||'')}</small></span><span class="pass">${r.passed}/${r.total} 条件</span></button>`).join('')}</div>`:'<div class="empty">没有条件完整的候选。空结果也是有效结果，不替换成高分股票。</div>';
  $('scan-output').innerHTML=summary+cards+'<button class="text-button" id="export-scan" style="margin-top:12px">导出全部核验结果（含排除和缺失记录） ↓</button><button class="text-button" id="export-snapshot" style="margin-top:8px">下载完整核验快照 JSON（非真实成交） ↓</button>';
  $('scan-output').querySelectorAll('[data-candidate]').forEach(b=>b.onclick=()=>selectSymbol(b.dataset.candidate));
  $('export-scan').onclick=()=>exportScan();$('export-snapshot').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(state.lastScan,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='短线核验快照-'+state.mode+'-'+marketDate()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};renderTable();renderDetails();
 }catch(e){$('scan-output').innerHTML='<div class="empty">'+esc(e.message)+'</div>';$('scan-status').textContent='核验未完成';}
 finally{button.disabled=false;if(generation!==state.generation){$('scan-output').hidden=true;$('scan-status').textContent='模式已切换，请重新核验';}}
}
function download(name,rows){const u=URL.createObjectURL(new Blob([csvText(rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function exportScan(){download('短线条件核验-'+state.mode+'-'+marketDate()+'.csv',[
 ['代码','名称','数据模式','状态','已满足条件数','总条件数','原因','行情日期','行情时间','记录时间','规则版本'],
 ...state.scanResults.map(r=>[r.symbol,state.quotes[r.symbol]?.name||r.name,r.dataMode||state.mode,r.status,r.passed,r.total,r.reasons.join('；'),r.sourceDate,r.sourceTime,r.emittedAt,RULE_VERSION])]);}
$('refresh').onclick=loadMarket;$('live-mode').onclick=()=>switchMode('live');$('demo-mode').onclick=()=>switchMode('demo');
$('toggle-star').onclick=()=>toggleWatch(state.symbol);$('run-scan').onclick=runScan;
$('sort-change').onclick=()=>{state.sort=!state.sort;renderTable();};
$('export-watch').onclick=()=>download('自选行情-'+state.mode+'-'+marketDate()+'.csv',[
 ['代码','名称','最新价','涨跌幅%','行情日期','行情时间','数据模式'],...watch.map(s=>{const q=state.quotes[s];return [s,q?.name||known.get(s),q?.price,q?.changePct,q?.date,q?.time,state.mode];})]);
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{state.period=b.dataset.period;document.querySelectorAll('[data-period]').forEach(x=>x.classList.toggle('active',x===b));loadChart();});
for(const id of ['capital','weight','risk-pct','stop-pct'])$(id).oninput=updateRisk;
$('save-note').onclick=()=>{if(save('jw-notes-v1',{...notes,[state.symbol]:{text:$('stock-note').value.slice(0,5000),savedAt:new Date().toISOString()}})){notes=read('jw-notes-v1',notes);$('note-status').textContent='已保存于本机';toast('观察笔记已保存');}};
$('theme').onclick=()=>{document.body.dataset.theme=document.body.dataset.theme==='dark'?'light':'dark';save('jw-theme-v1',document.body.dataset.theme);renderChart();};
if(read('jw-theme-v1','light')==='dark')document.body.dataset.theme='dark';
$('search').oninput=()=>{
 const query=$('search').value.trim();if(!query){$('search-results').hidden=true;return;}
 const matches=[...known].filter(([s,n])=>s.includes(query)||n.includes(query)).slice(0,7);
 $('search-results').innerHTML=matches.map(([s,n])=>`<button data-search="${s}"><span>${esc(n)}</span><span class="muted">${s.slice(2)}</span></button>`).join('');$('search-results').hidden=!matches.length;
 $('search-results').querySelectorAll('[data-search]').forEach(b=>b.onclick=()=>selectSymbol(b.dataset.search));
};
$('search').onkeydown=e=>{if(e.key==='Enter'){const query=$('search').value.trim(),match=[...known].find(([s,n])=>n===query||s===query);selectSymbol(match?.[0]||query);}else if(e.key==='Escape')$('search-results').hidden=true;};
document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))$('search-results').hidden=true;});
new ResizeObserver(()=>chart.resize()).observe($('price-chart'));
function clock(){$('clock').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())+' 北京时间';}
clock();setInterval(clock,1000);setInterval(()=>{if(state.mode==='live'&&!document.hidden)loadMarket();},30000);
fetch('./assets/universe.json').then(r=>{if(!r.ok)throw Error('股票池读取失败');return r.json();}).then(data=>{state.universe=data.stocks.filter(s=>/^(sh|sz)\d{6}$/.test(s.symbol));for(const s of state.universe)if(!known.has(s.symbol))known.set(s.symbol,s.name);}).catch(()=>toast('历史股票池暂不可用，当前观察池仍可使用'));
$('stock-note').value=notes[state.symbol]?.text||'';
renderIndexes();renderTable();renderDetails();Promise.all([loadMarket(),loadChart()]);
