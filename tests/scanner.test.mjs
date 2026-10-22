import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {marketDate,analyzeCandidate,riskPlan,csvText,movingAverage} from '../assets/scanner.mjs';
import {parseQuote,parseBars,normalizeSymbol,demoBars} from '../assets/market.mjs';
const bars=Array.from({length:20},(_,i)=>({date:`2026-10-${String(i+1).padStart(2,'0')}`,close:10,open:10,high:10.1,low:9.9,volume:1000}));
const q={symbol:'sh603696',name:'安记食品',price:10.4,prevClose:10,changePct:4,turnover:6,volumeRatio:1.5,marketCap:30e8,high:10.41,low:10,date:'2026-10-21',time:'14:50:00'};
test('complete intraday candidate is preliminary; never a confirmed close signal',()=>{
 const r=analyzeCandidate(q,bars,{today:q.date});assert.equal(r.status,'preliminary');assert.equal(r.passed,9);assert.equal(r.signalNotOrder,true);
});
test('close confirmation requires a matching final daily bar',()=>{
 const closed={...q,time:'15:01:00'};
 assert.equal(analyzeCandidate(closed,bars,{today:q.date}).status,'preliminary');
 assert.equal(analyzeCandidate(closed,[...bars,{...bars[0],date:q.date,close:q.price}],{today:q.date}).status,'confirmed');
});
test('missing volume ratio, historical prices and stale date fail visibly',()=>{
 assert.equal(analyzeCandidate({...q,volumeRatio:null},bars,{today:q.date}).status,'incomplete');
 assert.equal(analyzeCandidate(q,[],{today:q.date}).status,'incomplete');
 assert.equal(analyzeCandidate(q,bars,{today:'2026-10-22'}).status,'excluded');
 assert.equal(analyzeCandidate(q,bars.map(b=>({...b,close:1})),{today:q.date}).status,'incomplete');
});
test('ST and inappropriate board cannot pass',()=>{
 assert.equal(analyzeCandidate({...q,name:'ST示例'},bars,{today:q.date}).status,'excluded');
 assert.equal(analyzeCandidate({...q,symbol:'sz300650'},bars,{today:q.date}).status,'excluded');
});
test('zero turnover is a known failure, distinct from a missing field',()=>{
 assert.equal(analyzeCandidate({...q,turnover:0},bars,{today:q.date}).status,'excluded');
 assert.equal(analyzeCandidate({...q,turnover:null},bars,{today:q.date}).status,'incomplete');
});
test('position calculation includes costs, cap, risk budget and real lot constraints',()=>{
 const p=riskPlan({price:10,symbol:q.symbol});
 assert.ok(p.qty>0&&p.qty%100===0);assert.ok(p.cashRequired<=10000);assert.ok(p.modeledLoss<=250);
 assert.equal(p.lossIsGuaranteed,false);
 assert.equal(riskPlan({price:1500,symbol:'sh600519'}).qty,0);
 assert.equal(riskPlan({price:20,symbol:'sh688981'}).qty,0);
 assert.throws(()=>riskPlan({price:10,capital:-1}));
});
test('China date conversion is correct at UTC date boundaries',()=>assert.equal(marketDate(new Date('2026-10-21T18:00:00Z')),'2026-10-22'));
test('CSV cannot turn a provider name into an Excel formula',()=>assert.ok(csvText([['=HYPERLINK("bad")',-1.5]]).includes("'=HYPERLINK")));
test('quote parser preserves nulls and reads provider timestamps without inventing dates',()=>{
 const f=Array(55).fill('');Object.assign(f,{1:'安记食品',2:'603696',3:'10.4',4:'10',30:'20261021150000',32:'4',38:'6',41:'10.41',42:'10',45:'30'});
 const parsed=parseQuote(q.symbol,f.join('~'));assert.equal(parsed.date,'2026-10-21');assert.equal(parsed.time,'15:00:00');assert.equal(parsed.volumeRatio,null);assert.equal(parsed.marketCap,30e8);
 assert.equal(parseQuote(q.symbol,'bad'),null);
});
test('kline parser rejects invalid OHLC and sorts dates',()=>{
 const payload={data:{[q.symbol]:{qfqday:[['2026-10-20',10,11,11,9,1000],['2026-10-19',10,10,11,9,1000],['2026-10-21',10,20,11,9,1000]]}}};
 const a=parseBars(payload,q.symbol);assert.equal(a.length,2);assert.equal(a[0].date,'2026-10-19');
});
test('symbol mapping and real moving averages are deterministic',()=>{
 assert.equal(normalizeSymbol('600519'),'sh600519');assert.equal(normalizeSymbol('000001'),'sz000001');assert.throws(()=>normalizeSymbol('x'));
 assert.deepEqual(movingAverage([{close:1},{close:2},{close:3}],2),[null,1.5,2.5]);
 assert.deepEqual(demoBars(q.symbol),demoBars(q.symbol));
});
test('frontend IDs are unique so SVG sprites cannot shadow form controls',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(ids).size,ids.length);
});
