"""Run against node server.js; requires Python Playwright and a Chromium installation."""
import os
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

url='http://127.0.0.1:8666/'
errors=[]
with sync_playwright() as p:
    executable=os.environ.get('QL_TEST_CHROMIUM')
    browser=p.chromium.launch(**({'executable_path':executable} if executable else {}),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1360,'height':1100},accept_downloads=True)
    # These are offline interface tests. They make no assertions about live quotes.
    context.route('**/*',lambda r:r.continue_() if r.request.url.startswith(url) else r.abort())
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url+'audit.html',wait_until='networkidle')
    page.wait_for_function("document.getElementById('kpis').textContent.includes('50.14')")
    assert '0.196%' in page.locator('#kpis').inner_text()
    page.select_option('#scenario','guarded');page.click('#run')
    assert '45.45%' in page.locator('#kpis').inner_text()
    assert '负' in page.locator('#verdict').inner_text()
    page.select_option('#scenario','corrected');page.fill('#slippage','0.2');page.click('#run')
    assert '-0.004%' in page.locator('#kpis').inner_text()
    assert '已更改成本' in page.locator('#confidence').inner_text()
    with page.expect_download() as event:page.click('#export')
    with tempfile.TemporaryDirectory() as tmp:
        dest=Path(tmp)/'trades.csv';event.value.save_as(dest)
        assert dest.read_text(encoding='utf-8-sig').count('\n')==365
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.set_viewport_size({'width':1360,'height':1000})
    page.goto(url+'index.html',wait_until='domcontentloaded')
    page.wait_for_timeout(300)
    assert page.locator('#selStrategy').input_value()=='strength'
    assert page.locator('#selStrategy option[value="steady"]').is_disabled()
    page.locator('.nav-item[data-route="lab"]').click()
    assert page.locator('#view-lab').is_visible()
    # Exercise the patched single-stock wrapper and locally vendored charts with a test fixture.
    page.evaluate('''async()=>{
      API.kline=async()=>Array.from({length:45},(_,i)=>{
        const close=i<23?100-i*.4:91+(i-23)*1.3;
        return {date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:close-.1,high:close+1,low:close-1,close,vol:10000,chg:1};
      });
      navigate('backtest');document.getElementById('btCode').value='600000';
      await runBacktest();
    }''')
    assert '总收益率' in page.locator('#btKpis').inner_text()
    assert '回测失败' not in page.locator('#btKpis').inner_text()
    assert page.evaluate("avg([1,2,3])") == 2
    assert page.evaluate("typeof echarts.init") == 'function'
    browser.close()
assert not errors,errors
print('Offline browser smoke checks passed; no page script errors.')
