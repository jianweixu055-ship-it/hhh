export const RULE_VERSION='close-strength-audit-1.0';
export function marketDate(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=k=>parts.find(p=>p.type===k).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function isMainBoard(symbol){return /^(sh60|sz00)\d{4}$/.test(symbol);}
export function analyzeCandidate(q,bars=[],{mainOnly=true,today=marketDate()}={}) {
  const checks=[];
  const check=(name,passed,value=null)=>checks.push({name,passed,value});
  const range=(value,lo,hi)=>Number.isFinite(value)?value>=lo&&value<=hi:null;
  check('非ST/退市风险且有有效价格',q?.price>0&&!/ST|退/i.test(q?.name||''));
  check('市场权限范围',!mainOnly||isMainBoard(q?.symbol||''));
  check('涨幅2–6%',range(q?.changePct,2,6),q?.changePct);
  check('换手3–10%',range(q?.turnover,3,10),q?.turnover);
  check('量比1.2–2.5',range(q?.volumeRatio,1.2,2.5),q?.volumeRatio);
  check('总市值小于50亿',q?.marketCap>0?q.marketCap<50e8:null,q?.marketCap);
  const strength=q?.high>q?.low&&q.price>=q.low&&q.price<=q.high?(q.price-q.low)/(q.high-q.low):null;
  check('收盘强度≥90%',strength==null?null:strength>=.9,strength);
  const history=bars.filter(b=>b.date<q?.date&&Number.isFinite(b.close)&&b.close>0).sort((a,b)=>a.date.localeCompare(b.date));
  const compatible=history.length>=20&&q?.prevClose>0&&Math.abs(history.at(-1).close/q.prevClose-1)<.02;
  const momentum=compatible?(q.price/history.at(-20).close-1)*100:null;
  check('20日涨幅<30%',momentum==null?null:momentum<30,momentum);
  check('行情日期为今日',q?.date? q.date===today:null,q?.date);
  const failed=checks.filter(c=>c.passed===false),missing=checks.filter(c=>c.passed==null);
  const isClosed=q?.time>='15:00:00';
  const end=bars.find(b=>b.date===q?.date);
  const finalBar=!!end&&Number.isFinite(end.close)&&q.price>0&&Math.abs(end.close/q.price-1)<.002;
  let status=failed.length?'excluded':missing.length?'incomplete':!isClosed||!finalBar?'preliminary':'confirmed';
  const reasons=[...failed.map(c=>c.name+'不满足'),...missing.map(c=>c.name+'缺数据')];
  if(status==='preliminary')reasons.push('盘中或当日完整日K尚未核验，只可预筛');
  return {symbol:q?.symbol,name:q?.name,ruleVersion:RULE_VERSION,status,checks,reasons,
    passed:checks.filter(c=>c.passed===true).length,total:checks.length,sourceDate:q?.date,sourceTime:q?.time,
    strength,momentum20:momentum,signalNotOrder:true};
}
export function riskPlan({capital=50000,weightPct=20,riskPct=.5,stopPct=4,price,symbol='sh600000'}={}){
  for(const [key,v] of Object.entries({capital,weightPct,riskPct,stopPct,price})){
    if(!Number.isFinite(v)||v<=0)throw new Error(key+'必须为正数');
  }
  if(weightPct>100||riskPct>100||stopPct>=100)throw new Error('比例超出可计算范围');
  if(!/^(sh60|sz00|sz30)\d{4}$/.test(symbol))return {qty:0,blocked:'该板块特殊申报规则未纳入测算，请先核验交易权限与最小申报数量。'};
  const cap=capital*weightPct/100,budget=capital*riskPct/100;
  const buy=price*1.001,exit=buy*(1-stopPct/100)*.999;
  const fee=(value,sell=false)=>Math.max(5,value*.0003)+value*(.00001+(sell ? 0.0005 : 0));
  let qty=Math.max(0,Math.floor(Math.min(cap/buy,budget/(buy-exit))/100)*100);
  const metrics=n=>({cash:n*buy+fee(n*buy),loss:n*(buy-exit)+fee(n*buy)+fee(n*exit,true)});
  while(qty>0&&(metrics(qty).cash>cap||metrics(qty).loss>budget))qty-=100;
  return {qty,referencePrice:price,buyPrice:buy,allocationCap:cap,riskBudget:budget,
    cashRequired:qty?metrics(qty).cash:0,modeledLoss:qty?metrics(qty).loss:0,
    assumedCommission:.0003,minCommission:5,slippageEachSide:.001,stopPct,
    blocked:qty?null:'一手的资金或含成本风险超过设定上限，不生成股数。',lossIsGuaranteed:false};
}
export function movingAverage(bars,period){return bars.map((_,i)=>i<period-1?null:bars.slice(i-period+1,i+1).reduce((s,b)=>s+b.close,0)/period);}
export function csvText(rows){
  const cell=v=>{let s=String(v??'');if(/^[=+@-]/.test(s)&&!/^[-+]?\d+(\.\d+)?%?$/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return '\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
