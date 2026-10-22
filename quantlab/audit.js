'use strict';
let DATA,SUMMARY,LAST;
const $=id=>document.getElementById(id);
const fmt=(n,d=2)=>n==null?'—':Number(n).toFixed(d);
const pct=n=>fmt(n)+'%';
const rule={corrected:{},guarded:{regimeFloor:-3,maxEntryGapPct:3,stopPct:4}};
const labels={closed:'已平仓',invalid:'无效数据',regime_filtered:'市场过滤',gap_filtered:'跳空过滤',entry_unavailable:'入场不可确认',unresolved_exit:'到期卖出未完成'};
function config(){
 return {...rule[$('scenario').value],notional:+$('notional').value,commission:+$('commission').value/100,
   minCommission:+$('minimum').value,slippage:+$('slippage').value/100};
}
function render(){
 try{
  const dataset=$('dataset').value,year=$('year').value,id=$('scenario').value,cfg=config();
  const pack=dataset==='strength'?DATA.strength:DATA;
  const rows=pack.base.filter(r=>year==='all'||r.d.startsWith(year));
  LAST=QuantEval.runSignals(rows,cfg); const s=LAST.summary;
  const k=(label,value,sub)=>`<div class="kpi"><small>${label}</small><strong>${value}</strong><small>${sub}</small></div>`;
  $('kpis').innerHTML=k('历史模拟胜率',pct(s.winRatePct),`${s.wins} 胜 / ${s.losses} 负 / ${s.flats} 平`)+
   k('平均单笔净收益',fmt(s.meanNetPct,3)+'%','全部费用和滑点后；不是账户收益')+
   k('平均赚 / 平均亏',fmt(s.payoffRatio),'与盈利因子分开计算')+k('盈利因子',fmt(s.profitFactor),'总盈利 ÷ 总亏损');
  $('dataRange').textContent=rows.length?`${rows[0].d} ～ ${rows.at(-1).d} / ${rows.length} 信号`:'无信号';
  $('status').textContent=Object.entries(s.statusCounts).map(([key,n])=>`${labels[key]||key}：${n}`).join('　')+
   `\n最差已平仓 ${pct(s.worstPct)}；未完成卖出不计入已平仓胜率，相关持仓风险仍存在。`;
  const same=cfg.notional===50000&&cfg.commission===.0003&&cfg.minCommission===5&&cfg.slippage===.001;
  const saved=SUMMARY.datasets[dataset].scenarios[id], stats=year==='all'?saved.summary:saved.years[year];
  const boot=same&&stats?stats.blockBootstrap:null;
  $('confidence').textContent=boot?`按连续4个日历周分块、重抽样10,000次：历史胜率95%区间 ${boot.winRatePct95.map(x=>fmt(x)).join(' ～ ')}%；历史平均单笔净收益95%区间 ${boot.meanNetPct95.map(x=>fmt(x)).join(' ～ ')}%。这是样本区间，不能解释为未来赚钱概率。`:
   '已更改成本：上方结果按当前输入重算；预生成的分块置信区间仅适用于默认成本，不套用旧区间。';
  $('verdict').textContent=s.meanNetPct==null?'没有可评价的已平仓样本。':s.meanNetPct<=0?'该口径历史平均净收益为负，尚无证据支持实盘盈利。':'该口径历史平均净收益为正；仍需独立样本外、真实成交和账户级验证，不能据此宣布实盘优势。';
  $('verdict').className=s.meanNetPct>0?'good':'bad';
  drawChart(LAST.trades);
 }catch(e){$('status').textContent='计算失败：'+e.message;$('kpis').innerHTML='';$('confidence').textContent='';$('verdict').textContent='';}
}
function drawChart(trades){
 const group={};for(const t of trades){if(t.status==='closed')(group[t.date.slice(0,7)]??=[]).push(t.netPct);}
 const months=Object.keys(group).sort(),means=months.map(m=>QuantEval.average(group[m]));
 if(!months.length){$('chart').textContent='无已平仓样本';return;}
 const w=1000,h=220,pad=35,baseline=100,range=Math.max(1,...means.map(Math.abs)),step=(w-2*pad)/months.length;
 let svg=`<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:220px" role="img" aria-label="分月历史平均净收益"><line x1="${pad}" y1="${baseline}" x2="${w-pad}" y2="${baseline}" stroke="#63738b"/><text x="0" y="${baseline}" fill="#acb9ce" font-size="12">0%</text>`;
 months.forEach((m,i)=>{
  const v=means[i],bar=v/range*76,x=pad+i*step,y=bar>=0?baseline-bar:baseline;
  svg+=`<rect x="${x+2}" y="${y}" width="${Math.max(1,step-4)}" height="${Math.max(.5,Math.abs(bar))}" fill="${v>=0?'#81b1ff':'#ff9c8f'}"><title>${m}: ${pct(v)} / ${group[m].length}笔</title></rect>`;
  if(months.length<16||i%3===0)svg+=`<text x="${x+3}" y="200" fill="#acb9ce" font-size="11">${m}</text>`;
 });$('chart').innerHTML=svg+'</svg>';
}
function comparison(){
 let html='';
 for(const [name,info] of Object.entries(SUMMARY.datasets)){
  for(const id of ['legacy_t1','legacy_t3','corrected','guarded']){
   const label={legacy_t1:'原价口径·次日收盘',legacy_t3:'原价口径·第三日收盘',corrected:'执行修正·第三日收盘',guarded:'风控试验·未通过验证'}[id];
   for(const year of ['all','2026']){
    const s=year==='all'?info.scenarios[id].summary:info.scenarios[id].years[year];
    html+=`<tr><td>${name==='base'?'尾盘':'收盘强度'} / ${label}</td><td>${year==='all'?'全期':year}</td><td>${s.n}</td><td>${pct(s.winRatePct)}</td><td class="${s.meanNetPct>0?'good':'bad'}">${fmt(s.meanNetPct,3)}%</td><td>${fmt(s.payoffRatio)}</td><td>${fmt(s.profitFactor)}</td></tr>`;
   }
  }
 }$('comparison').innerHTML=html;
 $('fingerprint').textContent='输入 lab_data.json SHA-256：'+SUMMARY.inputSha256+'。实际信号最晚 2026-10-13；附件元数据标称截至 2026-10-21，两者不同。';
}
$('run').onclick=render;
$('export').onclick=()=>{
 if(!LAST)return;
 const fields=['date','code','name','status','entryBar','exitBar','entryPrice','exitPrice','grossPct','netPct','cashPnl','buyFee','sellFee','reason','gapPct','ambiguous','markGrossPct'];
 const cell=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
 const text='\ufeff'+[fields.map(cell).join(','),...LAST.trades.map(t=>fields.map(k=>cell(t[k])).join(','))].join('\r\n');
 const u=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');
 a.href=u;a.download=`quantlab-${$('dataset').value}-${$('year').value}-${$('scenario').value}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
};
Promise.all([fetch('lab_data.json').then(r=>{if(!r.ok)throw Error('data HTTP '+r.status);return r.json();}),fetch('audit-summary.json').then(r=>{if(!r.ok)throw Error('summary HTTP '+r.status);return r.json();})])
 .then(([data,summary])=>{DATA=data;SUMMARY=summary;comparison();render();})
 .catch(e=>{$('status').textContent='无法加载审计数据：'+e.message;});
