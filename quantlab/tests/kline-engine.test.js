const test=require('node:test'),assert=require('node:assert/strict');
const K=require('../kline-engine');
const rows=(bars)=>bars.map((b,i)=>({date:`2026-01-${String(i+1).padStart(2,'0')}`,open:b[0],high:b[1],low:b[2],close:b[3]}));
test('entry executes next open; entry day cannot stop out',()=>{
 const b=rows([[100,101,99,100],[100,120,50,100],[101,102,100,101]]);
 const r=K.simulate(b,'ma',50000,.0003,'600000',p=>p.length===1?'buy':null);
 assert.equal(r.trades.length,1);assert.equal(r.trades[0].date,'2026-01-02');assert.equal(r.openPosition,true);
});
test('close exit signal executes next open, not signal close',()=>{
 const b=rows([[100,101,99,100],[100,102,99,101],[101,103,100,102],[95,96,94,95]]);
 const r=K.simulate(b,'ma',50000,.0003,'600000',p=>p.length===1?'buy':p.length===3?'sell':null);
 assert.equal(r.trades.length,2);assert.equal(r.trades[1].date,'2026-01-04');
 assert.equal(r.trades[1].price,95*.999);
});
test('unavailable entry expires and unknown strategy fails',()=>{
 const b=rows([[100,101,99,100],[110,110,110,110],[109,110,108,109]]);
 const r=K.simulate(b,'ma',50000,.0003,'600000',p=>p.length===1?'buy':null);
 assert.equal(r.trades.length,0);assert.equal(r.unavailable,1);
 assert.throws(()=>K.simulate(b,'strength',50000,.0003,'600000'));
});
test('flat limit-down exit is deferred and final positions are not fake closed wins',()=>{
 const b=rows([[100,101,99,100],[100,101,99,100],[90,90,90,90],[80,81,79,80]]);
 const r=K.simulate(b,'ma',50000,.0003,'600000',p=>p.length===1?'buy':null);
 assert.equal(r.trades[1].date,'2026-01-04');assert.equal(r.trades[1].price,80*.999);
 assert.ok(r.trades[1].netPnl<0);
});
