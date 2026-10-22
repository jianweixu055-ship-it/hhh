/* QuantLab audit engine. Percent results are historical simulations, never live win probabilities. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QuantEval = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const defaults = Object.freeze({
    notional: 50000, commission: 0.0003, minCommission: 5,
    stampTax: 0.0005, transfer: 0.00001, slippage: 0.001,
    maxEntryGapPct: null, regimeFloor: null, stopPct: null, takePct: null
  });
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  function settings(options) {
    const cfg = Object.assign({}, defaults, options);
    for (const key of ['notional', 'commission', 'minCommission', 'stampTax', 'transfer', 'slippage']) {
      if (!Number.isFinite(cfg[key]) || cfg[key] < 0) throw new Error('Invalid setting: ' + key);
    }
    if (!cfg.notional || cfg.slippage >= 1) throw new Error('Invalid notional/slippage');
    for (const key of ['maxEntryGapPct', 'regimeFloor', 'stopPct', 'takePct']) {
      if (cfg[key] != null && !Number.isFinite(cfg[key])) throw new Error('Invalid setting: ' + key);
    }
    if (cfg.stopPct != null && !(cfg.stopPct > 0 && cfg.stopPct < 100)) throw new Error('Invalid stop');
    if (cfg.takePct != null && cfg.takePct <= 0) throw new Error('Invalid take');
    return cfg;
  }
  function validBar(b) {
    return Array.isArray(b) && b.length === 4 && b.every(x => Number.isFinite(x) && x > 0)
      && b[2] <= Math.min(b[0], b[3]) && b[1] >= Math.max(b[0], b[3]);
  }
  // These datasets lack raw prices, corporate actions and actual limit prices.
  // A flat daily bar is conservatively unavailable in either direction; no queue fills invented.
  function flatBar(b) { return Math.abs(b[1] - b[2]) < 1e-8; }
  function commission(value, cfg) { return Math.max(cfg.minCommission, value * cfg.commission); }
  function costs(entry, exit, cfg) {
    // Fractional exposure intentionally avoids pretending qfq prices are historical raw lot prices.
    const buy = entry * (1 + cfg.slippage), sell = exit * (1 - cfg.slippage);
    const qty = cfg.notional / buy;
    const sale = qty * sell;
    const buyFee = commission(cfg.notional, cfg) + cfg.notional * cfg.transfer;
    const sellFee = commission(sale, cfg) + sale * (cfg.transfer + cfg.stampTax);
    return {
      entryPrice: buy, exitPrice: sell, exposureUnits: qty,
      buyFee, sellFee, cashPnl: sale - cfg.notional - buyFee - sellFee,
      netPct: (sale - cfg.notional - buyFee - sellFee) / (cfg.notional + buyFee) * 100,
      grossPct: (exit / entry - 1) * 100
    };
  }
  function evaluateSignal(rec, options) {
    const cfg = settings(options);
    const base = {date: rec.d, code: rec.c || null, name: rec.n || null};
    if (!(Number.isFinite(rec.b) && rec.b > 0) || !Array.isArray(rec.x)
      || rec.x.length < 3 || !rec.x.every(validBar)) return {...base, status: 'invalid'};
    if (cfg.regimeFloor != null && (!Number.isFinite(rec.i) || rec.i < cfg.regimeFloor)) {
      return {...base, status: 'regime_filtered'};
    }
    const bars = rec.x, entry = bars[0][0];
    const gapPct = (entry / rec.b - 1) * 100;
    if (cfg.maxEntryGapPct != null && gapPct > cfg.maxEntryGapPct) {
      return {...base, status: 'gap_filtered', gapPct};
    }
    if (flatBar(bars[0])) return {...base, status: 'entry_unavailable', gapPct};
    const stop = cfg.stopPct == null ? null : entry * (1 + cfg.slippage) * (1 - cfg.stopPct / 100);
    const take = cfg.takePct == null ? null : entry * (1 + cfg.slippage) * (1 + cfg.takePct / 100);
    let exit = null, exitBar = null, reason = 'scheduled_t3_close', ambiguous = false, pendingStop = false;
    // T+1: bars[0] is the purchase day. It must never permit a sale.
    for (let day = 1; day < 3; day++) {
      const [o, h, l, c] = bars[day];
      if (flatBar(bars[day])) {
        if (stop != null && l <= stop) pendingStop = true;
        continue;
      }
      if (pendingStop) { exit = o; reason = 'delayed_stop'; }
      else if (stop != null && o <= stop) { exit = o; reason = 'gap_stop'; }
      else if (take != null && o >= take) { exit = take; reason = 'gap_take_capped'; }
      else if (stop != null && l <= stop) {
        exit = stop; reason = 'stop'; ambiguous = take != null && h >= take;
      } else if (take != null && h >= take) { exit = take; reason = 'take'; }
      else if (day === 2) { exit = c; }
      if (exit != null) { exitBar = day + 1; break; }
    }
    if (exit == null) {
      // Do not delete blocked sells as losses or pretend to sell at a limit-down price.
      return {...base, status: 'unresolved_exit', gapPct, markGrossPct: (bars[2][3] / entry - 1) * 100};
    }
    return {...base, status: 'closed', entryBar: 1, exitBar, gapPct, reason, ambiguous,
      ...costs(entry, exit, cfg)};
  }
  function wilson(w, n) {
    if (!n) return null;
    const p = w / n, z = 1.96, den = 1 + z * z / n;
    const mid = (p + z * z / (2 * n)) / den;
    const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
    return [(mid - half) * 100, (mid + half) * 100];
  }
  function summarize(trades) {
    const a = trades.filter(t => t.status === 'closed').map(t => t.netPct);
    const wins = a.filter(r => r > 0), losses = a.filter(r => r < 0);
    const gain = wins.reduce((s, x) => s + x, 0), loss = -losses.reduce((s, x) => s + x, 0);
    const avgWin = mean(wins), avgLoss = losses.length ? -mean(losses) : null;
    return {
      n: a.length, wins: wins.length, losses: losses.length, flats: a.filter(x => x === 0).length,
      winRatePct: a.length ? wins.length / a.length * 100 : null,
      wilson95Pct: wilson(wins.length, a.length), meanNetPct: mean(a),
      avgWinPct: avgWin, avgLossPct: avgLoss,
      payoffRatio: avgLoss ? avgWin / avgLoss : null,
      profitFactor: loss ? gain / loss : null,
      breakevenWinRatePct: avgWin != null && avgLoss != null ? 100 * avgLoss / (avgWin + avgLoss) : null,
      worstPct: a.length ? Math.min(...a) : null, bestPct: a.length ? Math.max(...a) : null,
      statusCounts: trades.reduce((m, t) => { m[t.status] = (m[t.status] || 0) + 1; return m; }, {})
    };
  }
  function runSignals(records, options) {
    const trades = records.map(r => evaluateSignal(r, options));
    return {settings: settings(options), summary: summarize(trades), trades};
  }
  // Historical reference only: same-close entries reproduce the uploaded program, not executable fills.
  function legacy(records, horizon, costPct) {
    return records.map(r => ({date: r.d, code: r.c || null, status: 'closed',
      netPct: (r.x[horizon - 1][3] / r.b - 1) * 100 - costPct}));
  }
  function average(values, end, period) {
    if (end == null) return mean(values);
    const a = values.slice(Math.max(0, end - period + 1), end + 1).map(x => x.close);
    return mean(a);
  }
  return {defaults, settings, validBar, flatBar, costs, evaluateSignal, runSignals, summarize, legacy, average, wilson};
});
