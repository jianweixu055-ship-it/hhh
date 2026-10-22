"""Descriptive moving-block bootstrap. This does not estimate live profitability probability."""
import csv
import datetime as dt
import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent


def bootstrap(trades, repetitions=10000, seed=20261022):
    # Four consecutive calendar weeks per block keep same-day stocks together and
    # preserve short-range serial dependence. Include weeks with no closed trade.
    rows = [t for t in trades if t['status'] == 'closed']
    if not rows:
        return None
    dates = [dt.date.fromisoformat(t['date']) for t in rows]
    start = min(dates) - dt.timedelta(days=min(dates).weekday())
    count = (max(dates) - start).days // 7 + 1
    values = np.zeros((count, 3))
    for date, trade in zip(dates, rows):
        i = (date - start).days // 7
        values[i] += [trade['netPct'], 1, int(trade['netPct'] > 0)]
    rng = np.random.default_rng(seed)
    blocks = (count + 3) // 4
    # Circular moving blocks: wraparound is an explicit bootstrap approximation.
    starts = rng.integers(0, count, size=(repetitions, blocks))
    indices = ((starts[:, :, None] + np.arange(4)) % count).reshape(repetitions, -1)[:, :count]
    sums = values[indices].sum(axis=1)
    sums = sums[sums[:, 1] > 0]
    means, wr = sums[:, 0] / sums[:, 1], sums[:, 2] / sums[:, 1] * 100
    return {
        'meanNetPct95': np.quantile(means, [.025, .975]).tolist(),
        'winRatePct95': np.quantile(wr, [.025, .975]).tolist(),
        'calendarWeeks': count, 'blockWeeks': 4, 'repetitions': repetitions, 'seed': seed,
        'interpretation': 'Conditional historical sampling uncertainty; not a live win/profit probability; no correction for previous strategy searches.'
    }


def main():
    p = ROOT / 'research-results.json'
    report = json.loads(p.read_text())
    for dataset, info in report['datasets'].items():
        for scenario, result in info['scenarios'].items():
            result['summary']['blockBootstrap'] = bootstrap(result['trades'])
            for year, summary in result['years'].items():
                summary['blockBootstrap'] = bootstrap([t for t in result['trades'] if t['date'].startswith(year)])
            fields = ['date','code','name','status','entryBar','exitBar','entryPrice','exitPrice','grossPct','netPct','cashPnl','buyFee','sellFee','reason','gapPct','ambiguous','markGrossPct']
            with (ROOT / f'trades_{dataset}_{scenario}.csv').open('w', encoding='utf-8-sig', newline='') as f:
                w = csv.DictWriter(f,fieldnames=fields,extrasaction='ignore')
                w.writeheader();w.writerows(result['trades'])
    p.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    # A small result file for fast offline panel startup; complete trades remain in CSV/JSON.
    compact = json.loads(json.dumps(report))
    for info in compact['datasets'].values():
        for result in info['scenarios'].values():
            del result['trades']
    (ROOT / 'audit-summary.json').write_text(json.dumps(compact,ensure_ascii=False,indent=2))
    for name,info in report['datasets'].items():
        for scenario in ['corrected','guarded']:
            s=info['scenarios'][scenario]['years']['2026']
            print(name,scenario,'2026',s['winRatePct'],s['meanNetPct'],s['blockBootstrap'])


if __name__ == '__main__':
    main()
