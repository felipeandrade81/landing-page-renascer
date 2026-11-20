# Utilidades dos testes de ponta a ponta (Chromium via Playwright). Uso: RENASCER_URL=file:///caminho/index.html python3 fiscal_e2e.py
import os
from playwright.sync_api import sync_playwright
URL=os.environ.get('RENASCER_URL','file:///mnt/user-data/outputs/distribuierp-previa.html')
def start(p,init_script=None):
    b=p.chromium.launch(args=['--no-sandbox']);ctx=b.new_context(viewport={'width':1366,'height':900})
    if init_script: ctx.add_init_script(init_script)
    pg=ctx.new_page();errs=[]
    pg.on('pageerror',lambda e:errs.append('PAGEERROR: '+str(e)[:300]))
    pg.on('console',lambda m:errs.append('console.'+m.type+': '+m.text[:300]) if m.type=='error' else None)
    return b,ctx,pg,errs
def setup(pg,nome='Ana Souza',email='ana@renascer.com',senha='senha1234'):
    pg.goto(URL);pg.wait_for_selector('#fa')
    pg.fill('#an',nome);pg.fill('#ae',email);pg.fill('#as',senha);pg.fill('#ac',senha);pg.click('#fa button');pg.wait_for_selector('#nav button',timeout=8000)
def nav(pg,label):
    pg.click(f'#nav button:has-text("{label}")');pg.wait_for_timeout(200)
class Check:
    def __init__(s): s.ok=0;s.bad=[]
    def __call__(s,n,c):
        print('✓' if c else '✗',n)
        if c: s.ok+=1
        else: s.bad.append(n)
    def done(s,errs):
        print('\nERROS JS:',errs or 'nenhum');print(f'RESULTADO: {s.ok} ok, {len(s.bad)} falha(s)',s.bad);raise SystemExit(1 if s.bad or errs else 0)
