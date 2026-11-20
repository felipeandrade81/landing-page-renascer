# Modo "banco da plataforma" (simulado com localStorage): grava em 3 partes e recarrega. Rodar: python3 db_mode_e2e.py
from base import *
ok=Check()
MOCK="window.claude={use:async n=>n=='db'?{doc:p=>({get:async()=>{const v=localStorage.getItem('mockdb:'+p);return{exists:v!==null,data:()=>JSON.parse(v)}},set:async d=>{localStorage.setItem('mockdb:'+p,JSON.stringify(d))}})}:null}"
with sync_playwright() as p:
    b,ctx,pg,errs=start(p,MOCK);setup(pg);pg.wait_for_timeout(1200)
    ok('modo db: grava users, config e data',pg.evaluate("STORE.kind")=='db' and all(pg.evaluate(f"localStorage.getItem('mockdb:app/{k}')!==null") for k in ('users','config','data')))
    pg.evaluate("FISC.cscId='7';FISC.prod[CAT[0][0]]={ncm:'04011010',cfop:'5102',origem:'0',cst:'102',pisCst:'49',cofinsCst:'49'};EMP.ie='032141840';schedSave()");pg.wait_for_timeout(1500)
    cfg=pg.evaluate("JSON.parse(localStorage.getItem('mockdb:app/config'))")
    ok('a configuração fiscal e a matriz chegam ao banco',cfg['FISC']['cscId']=='7' and cfg['FISC']['prod'][pg.evaluate("CAT[0][0]")]['ncm']=='04011010' and cfg['EMP']['ie']=='032141840')
    ok('nenhum segredo vai para o banco (só o que o usuário digitou nos campos fiscais)',not any(w in json.dumps(cfg).lower() for w in ['token_hom','focusnfe_token','senha_certificado']) if (json:=__import__('json')) else True)
    pg.reload();pg.wait_for_selector('#nav button',timeout=8000);pg.wait_for_timeout(500)
    ok('recarregar: tudo volta do banco',pg.evaluate("FISC.cscId=='7'&&EMP.ie=='032141840'&&FISC.prod[CAT[0][0]].cst=='102'"))
    ok.done(errs)
