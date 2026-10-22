"""Optional browser checks: QL_TEST_CHROMIUM=/usr/bin/chromium python tests/browser-smoke.py.
Run npm start first. No TLS verification bypasses are used. Live data has separate integration checks.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
out=root/'test-results';out.mkdir(exist_ok=True)
errors=[]
with sync_playwright() as p:
    executable=os.environ.get('QL_TEST_CHROMIUM')
    browser=p.chromium.launch(**({'executable_path':executable} if executable else {}),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1500,'height':1100},accept_downloads=True)
    context.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:8080/') else r.abort())
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8080/',wait_until='domcontentloaded')
    page.wait_for_function("document.getElementById('data-banner').classList.contains('error')")
    assert page.locator('#stock-price').inner_text()=='—'  # no fabricated quote on outage
    page.click('#demo-mode')
    page.wait_for_function("document.getElementById('data-message').textContent.includes('演示模式')")
    assert '一手' in page.locator('#risk-result').inner_text()  # expensive stock not sized above budget
    page.click('#run-scan');page.wait_for_function("!document.getElementById('run-scan').disabled")
    assert page.locator('.candidate').count()>0
    assert '合成演示筛选' in page.locator('#scan-output').inner_text()
    assert '10/10' in page.locator('#scan-output').inner_text()
    with page.expect_download() as event:page.click('#export-snapshot')
    snapshot=out/'scan-snapshot.json';event.value.save_as(snapshot)
    result=json.loads(snapshot.read_text())
    assert result['notRealTrades'] and result['dataMode']=='demo'
    assert len(result['results'])==8 and any(r['status']=='excluded' for r in result['results'])
    page.fill('#capital','100');page.click('#run-scan')
    page.wait_for_function("!document.getElementById('run-scan').disabled")
    assert page.locator('.candidate').count()==0
    page.fill('#capital','50000');page.click('#run-scan')
    page.wait_for_function("!document.getElementById('run-scan').disabled")
    page.locator('[data-candidate="sh603696"]').click()
    assert page.locator('#stock-name').inner_text()=='安记食品'
    assert '股 /' in page.locator('#risk-result').inner_text()
    page.fill('#stock-note','等待收盘确认换手与失效条件。');page.click('#save-note')
    page.reload(wait_until='domcontentloaded');page.click('#demo-mode')
    page.wait_for_function("document.getElementById('data-message').textContent.includes('演示模式')")
    page.fill('#search','安记食品');page.press('#search','Enter')
    assert '失效条件' in page.locator('#stock-note').input_value()
    old=page.locator('#watch-count').inner_text();page.click('#toggle-star')
    assert page.locator('#watch-count').inner_text()!=old
    page.click('#toggle-star')
    page.click('[data-period="week"]');assert '演示' in page.locator('#chart-note').inner_text()
    page.click('[data-period="day"]')
    page.click('#run-scan');page.wait_for_function("!document.getElementById('run-scan').disabled")
    page.screenshot(path=str(out/'workbench-desktop.png'),full_page=True)
    page.click('[data-view="watch"]');assert page.locator('#scanner-panel').is_hidden()
    page.click('[data-view="scanner"]');page.click('#theme')
    assert page.locator('body').get_attribute('data-theme')=='dark'
    page.click('#theme');page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(out/'workbench-mobile.png'),full_page=True)
    browser.close()
assert not errors,errors
print('Browser checks passed: outage, demo isolation, budget gate, snapshots, notes, watchlist, chart, theme, mobile.')
