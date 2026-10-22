// Reproducible evaluation of uploaded snapshots; no network calls or parameter search.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('./eval-engine');
const input = fs.readFileSync(path.join(__dirname,'lab_data.json'));
const data = JSON.parse(input);
const configs = {
  legacy_t1: null,
  legacy_t3: null,
  corrected: {},
  guarded: {regimeFloor:-3, maxEntryGapPct:3, stopPct:4}
};
const output = {
  inputSha256:crypto.createHash('sha256').update(input).digest('hex'),
  provenance:'User-uploaded qfq OHLC signal snapshots; provider accuracy and point-in-time membership not independently verified.',
  dataMeta:data.meta, defaults:E.defaults, datasets:{}, sensitivity:[]
};
for(const [name,pack] of Object.entries({base:data,strength:data.strength})) {
  const rows = pack.base;
  const dates = rows.map(r=>r.d).sort();
  const keyCounts = new Map();
  for(const r of rows){ const k=r.d+'_'+r.c; keyCounts.set(k,(keyCounts.get(k)||0)+1); }
  const info = output.datasets[name] = {
    rows:rows.length, codes:new Set(rows.map(r=>r.c)).size,
    signalDates:new Set(dates).size, firstSignal:dates[0], lastSignal:dates.at(-1),
    invalidRows:rows.filter(r=>!r.x || r.x.length!==3 || !r.x.every(E.validBar)).length,
    duplicateRows:[...keyCounts.values()].reduce((s,n)=>s+Math.max(0,n-1),0), scenarios:{}
  };
  for(const [id,cfg] of Object.entries(configs)){
    const trades = id.startsWith('legacy') ? E.legacy(rows,id==='legacy_t1'?1:3,.15) : E.runSignals(rows,cfg).trades;
    const years = {};
    for(const year of ['2024','2025','2026']) years[year]=E.summarize(trades.filter(t=>t.date.startsWith(year)));
    const months={};
    for(const month of [...new Set(dates.map(d=>d.slice(0,7)))]) months[month]=E.summarize(trades.filter(t=>t.date.startsWith(month)));
    info.scenarios[id]={settings:cfg,summary:E.summarize(trades),years,months,trades};
  }
  for(const notional of [5000,10000,15000,50000]){
    for(const slippage of [0,.0005,.001,.002,.003]){
      const r = E.runSignals(rows.filter(r=>r.d.startsWith('2026')), {notional,slippage});
      output.sensitivity.push({dataset:name,year:2026,notional,slippage,...r.summary});
    }
  }
}
fs.writeFileSync(path.join(__dirname,'research-results.json'),JSON.stringify(output,null,2));
for(const [dataset,d] of Object.entries(output.datasets)){
  for(const [scenario,s] of Object.entries(d.scenarios)){
    for(const [period,m] of Object.entries({all:s.summary,...s.years})){
      console.log(dataset,scenario,period,m.n,m.winRatePct?.toFixed(2),m.meanNetPct?.toFixed(4),m.statusCounts);
    }
  }
}
