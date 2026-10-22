const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../eval-engine');
const zero = {commission: 0, minCommission: 0, stampTax: 0, transfer: 0, slippage: 0};
const rec = (x) => ({d: '2026-01-01', c: '600000', b: 100, i: 0, x});
test('purchase-day stop is forbidden under T+1', () => {
  const t = E.evaluateSignal(rec([[100, 110, 80, 90], [100, 102, 99, 100], [100, 103, 99, 102]]), {...zero, stopPct: 3});
  assert.equal(t.netPct.toFixed(2), '2.00');
  assert.equal(t.exitBar, 3);
});
test('stop gaps fill at open; thresholds do not hide losses', () => {
  const t = E.evaluateSignal(rec([[100, 101, 99, 100], [80, 90, 78, 85], [85, 90, 80, 88]]), {...zero, stopPct: 3});
  assert.equal(t.netPct.toFixed(2), '-20.00');
  assert.equal(t.reason, 'gap_stop');
});
test('open take is processed before the later low; ambiguous intraday path takes stop first', () => {
  const opts = {...zero, stopPct: 3, takePct: 3};
  const gap = E.evaluateSignal(rec([[100,101,99,100],[105,110,90,100],[100,101,99,100]]), opts);
  assert.equal(gap.netPct.toFixed(2),'3.00');
  const both = E.evaluateSignal(rec([[100,101,99,100],[100,110,90,100],[100,101,99,100]]), opts);
  assert.equal(both.netPct.toFixed(2),'-3.00'); assert.equal(both.ambiguous,true);
});
test('blocked entry and blocked final exit remain visible', () => {
  assert.equal(E.evaluateSignal(rec([[110,110,110,110],[109,111,108,110],[110,111,109,110]]),zero).status, 'entry_unavailable');
  const t = E.evaluateSignal(rec([[100,101,99,100],[90,90,90,90],[81,81,81,81]]), {...zero,stopPct:3});
  assert.equal(t.status,'unresolved_exit');
  assert.equal(E.summarize([t]).n,0);
});
test('a blocked stop is executed on the next available day rather than forgotten', () => {
  const t = E.evaluateSignal(rec([[100,101,99,100],[90,90,90,90],[92,95,91,94]]), {...zero, stopPct:3});
  assert.equal(t.reason,'delayed_stop'); assert.equal(t.netPct.toFixed(2),'-8.00');
});
test('minimum commissions and stamp tax have cash consequences', () => {
  const c = E.costs(100,100,E.settings({notional:10000,slippage:0}));
  assert.ok(Math.abs(c.buyFee-5.1)<1e-10); assert.ok(Math.abs(c.sellFee-10.1)<1e-10);
  assert.ok(c.netPct < -.15 && c.netPct > -.16);
});
test('profit factor is distinct from average win/loss ratio', () => {
  const s = E.summarize([1,1,-1].map(netPct=>({status:'closed',netPct})));
  assert.equal(s.profitFactor,2); assert.equal(s.payoffRatio,1);
  assert.equal(s.breakevenWinRatePct,50);
});
test('bad prices, missing data and invalid costs fail visibly', () => {
  assert.equal(E.evaluateSignal(rec([[100,90,101,100]]),zero).status,'invalid');
  assert.throws(()=>E.runSignals([], {slippage:-1}));
});
test('regime and gap rules only inspect information available by entry', () => {
  const r = rec([[104,110,90,100],[100,101,99,100],[100,101,99,100]]);
  assert.equal(E.evaluateSignal(r,{...zero,maxEntryGapPct:3}).status,'gap_filtered');
  assert.equal(E.evaluateSignal({...r,i:-5},{...zero,regimeFloor:-3}).status,'regime_filtered');
});
test('both average signatures work; no hoisted function collision', () => {
  assert.equal(E.average([1,2,3]),2);
  assert.equal(E.average([{close:1},{close:2},{close:3}],2,2),2.5);
});
