(function(root,factory){
  const E=typeof module==='object'&&module.exports?require('./eval-engine'):root.QuantEval;
  const api=factory(E); if(typeof module==='object'&&module.exports)module.exports=api;else root.QuantKline=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(E){
  'use strict';
  function simulate(ks, strategy, capital, commissionRate, code, signalOverride){
    if(!['hold','ma'].includes(strategy)&&!signalOverride)throw new Error('该策略缺少可复现历史条件，请使用信号审计。');
    if(!Number.isFinite(capital)||capital<=0)throw new Error('本金必须大于零');
    const cfg=E.settings({commission:Number(commissionRate),notional:capital});
    const trades=[],nav=[];let cash=capital,qty=0,entry=0,entryIdx=-1,entryCost=0;
    let pending=null,wins=0,closed=0,unavailable=0;
    const fees=(v,buy)=>Math.max(cfg.minCommission,v*cfg.commission)+v*(cfg.transfer+(buy?0:cfg.stampTax));
    function sell(i,price,note){
      const px=price*(1-cfg.slippage),value=qty*px,net=value-fees(value,false);
      cash+=net;if(net>entryCost)wins++;closed++;
      trades.push({date:ks[i].date,type:'S',price:px,qty,note,netPnl:net-entryCost});
      qty=0;entry=0;entryIdx=-1;entryCost=0;
    }
    let lastDate='';
    for(let i=0;i<ks.length;i++){
      const k=ks[i],bar=[+k.open,+k.high,+k.low,+k.close];
      if(!E.validBar(bar)||!k.date||k.date<=lastDate)throw new Error('K线无效、重复或未按交易日升序排列');
      lastDate=k.date;
      const blocked=E.flatBar(bar);
      if(pending==='sell'&&qty&&i>entryIdx){
        if(!blocked){sell(i,k.open,'前一交易日退出指令·本日开盘');pending=null;}else unavailable++;
      }else if(pending==='buy'&&!qty){
        if(!blocked){
          const price=k.open*(1+cfg.slippage);
          let shares=Math.floor(cash/price/100)*100;
          while(shares>0&&shares*price+fees(shares*price,true)>cash)shares-=100;
          if(shares>0){
            qty=shares;entry=price;entryIdx=i;entryCost=shares*price+fees(shares*price,true);cash-=entryCost;
            trades.push({date:k.date,type:'B',price,qty,note:'前一日收盘信号·本日开盘；含买入费用和滑点'});
          }
        }else unavailable++;
        pending=null; // Unfilled entry order expires; never backfill at a later favorable price.
      }
      if(qty&&i>entryIdx&&strategy!=='hold'&&pending!=='sell'){
        const stop=entry*.97,take=entry*1.06;
        if(blocked){if(k.low<=stop||i-entryIdx>=3)pending='sell';}
        else if(k.open<=stop)sell(i,k.open,'跳空止损');
        else if(k.open>=take)sell(i,take,'止盈限价·跳空不额外美化');
        else if(k.low<=stop)sell(i,stop,'止损；同日双触发按止损优先');
        else if(k.high>=take)sell(i,take,'止盈');
        else if(i-entryIdx>=3)pending='sell'; // Date-only timeout known today; execute next open conservatively.
      }
      const prefix=ks.slice(0,i+1);
      let signal=null;
      if(signalOverride)signal=signalOverride(prefix);
      else if(strategy==='hold'&&i===0)signal='buy';
      else if(strategy==='ma'&&i>=20){
        const a=E.average(ks,i,5),b=E.average(ks,i,20),ap=E.average(ks,i-1,5),bp=E.average(ks,i-1,20);
        if(a>b&&ap<=bp)signal='buy';else if(a<b&&ap>=bp)signal='sell';
      }
      if(signal==='sell'&&qty&&pending!=='sell')pending='sell';
      if(signal==='buy'&&!qty&&pending==null)pending='buy';
      nav.push({date:k.date,val:cash+qty*k.close,pos:qty>0});
    }
    const final=nav.length?nav.at(-1).val:capital,totalRet=(final/capital-1)*100;
    const years=ks.length>1?(Date.parse(ks.at(-1).date)-Date.parse(ks[0].date))/(365.25*864e5):0;
    let peak=capital,maxDD=0;for(const n of nav){peak=Math.max(peak,n.val);maxDD=Math.max(maxDD,(peak-n.val)/peak*100);}
    const r=nav.slice(1).map((n,i)=>n.val/nav[i].val-1),m=E.average(r)||0;
    const sd=r.length?Math.sqrt(r.reduce((s,v)=>s+(v-m)**2,0)/r.length):0;
    return {nav,trades,capital,final,totalRet,annual:years>0?((final/capital)**(1/years)-1)*100:0,
      maxDD,sharpe:sd?m/sd*Math.sqrt(244):0,winRate:closed?wins/closed*100:0,sellTrades:closed,
      buyTrades:trades.filter(t=>t.type==='B').length,openPosition:qty>0,unavailable,
      feeRate:cfg.commission,stopPct:.03,takePct:.06,maxHold:3,pendingOrder:pending};
  }
  return {simulate};
});
