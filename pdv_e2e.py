# Regressão do PDV, Delivery e persistência (modo local). Rodar: python3 pdv_e2e.py
from base import *
import random
ok=Check()
def scan(pg,code,wait=650): pg.fill('#bc',code);pg.press('#bc','Enter');pg.wait_for_timeout(wait)
def abrir(pg): pg.click('button:has-text("Abrir caixa")');pg.wait_for_selector('.dg form');pg.click('.dg button:has-text("Abrir caixa")');pg.wait_for_timeout(250)
def fechar(pg):
    for _ in range(5):
        if not pg.locator('.dg').count(): break
        pg.keyboard.press('Escape');pg.evaluate("closeDlg()");pg.wait_for_timeout(80)
def venda(pg,steps,carrinho):
    pg.evaluate(f"cart={carrinho};DESC=0;show('pdv')");pg.click('button:has-text("Pagamento (F5)")');pg.wait_for_selector('.dg')
    for m,v in steps:
        if v is not None: pg.fill('#pv',v)
        pg.click(f'.dg [data-v="{m}"]');pg.wait_for_timeout(180)
        if m=='PIX' and pg.locator('#pxc').count(): pg.check('#pxc');pg.click('.dg button:has-text("Confirmar recebimento")');pg.wait_for_timeout(180)
    f=pg.locator('.dg button:has-text("Finalizar venda")')
    if f.count() and f.is_enabled(): f.click();pg.wait_for_timeout(250);r=pg.evaluate("LAST&&{tot:LAST.tot,troco:LAST.troco}");fechar(pg);return r
    fechar(pg);return None
with sync_playwright() as p:
    b,ctx,pg,errs=start(p);setup(pg);nav(pg,'PDV');abrir(pg)
    codes=pg.evaluate("[CAT[0][0],CAT[1][0],CAT[2][0],CAT[3][0]]")
    ok('conta Bradesco (ag. 3935-7, c/c 53635-0, chave CNPJ) já cadastrada',pg.evaluate("BK[0].ag=='3935-7'&&BK[0].conta=='53635-0'&&BK[0].pix=='69196200000168'&&bkOk('PIX')&&bkOk('Espécie')"))
    pg.click('button:has-text("Pagamento (F5)")');pg.wait_for_timeout(200);ok('carrinho vazio: aviso vermelho',pg.locator('.toast.w').count()==1)
    scan(pg,codes[0]);scan(pg,codes[0]);scan(pg,codes[3],400);pg.wait_for_selector('.dg form');pg.fill('#d_p','0,350');pg.click('.dg button:has-text("Adicionar")');pg.wait_for_timeout(250)
    ok('leitura de código de barras e pesagem: total R$ 167,27 (centavos)',pg.evaluate("tot$()")==167.27)
    pg.click('button:has-text("Pagamento (F5)")');pg.wait_for_selector('.dg');pg.click('.dg [data-v="Dinheiro"]');pg.wait_for_timeout(200);pg.click('.dg button:has-text("Finalizar venda")');pg.wait_for_timeout(300)
    ok('botão Pagamento → Dinheiro → Finalizar: venda concluída com comprovante',pg.locator('.dg h2:has-text("finalizada")').count()==1 and pg.evaluate("caixaDin()")==267.27);fechar(pg)
    pg.evaluate("cart=[[0,1]];show('pdv')");pg.click('button:has-text("PIX · QR Code")');pg.wait_for_selector('.dg svg path')
    ok('PIX: QR Code do valor aparece e usa a chave CNPJ',len(pg.eval_on_selector('.dg svg path','e=>e.getAttribute("d")'))>500 and 'br.gov.bcb.pix0114691962000001685204' in pg.evaluate("PIXC.payload"));fechar(pg)
    r=venda(pg,[('Dinheiro','100'),('PIX',None)],"[[0,2],[2,1]]");ok('pagamento dividido (dinheiro + PIX)',bool(r) and r['tot']==338.8)
    r=venda(pg,[('Dinheiro','100')],"[[0,1]]");ok('dinheiro maior que o total: troco R$ 25,10',bool(r) and r['troco']==25.1)
    for m in ['Débito','Crédito','Vale','Transferência']: r=venda(pg,[(m,None)],"[[2,1]]");ok(f'pagamento só em {m}',bool(r) and r['tot']==189)
    pg.evaluate("window.__m=1;cart=[[0,1]];show('pdv')");pg.keyboard.press('F5');pg.wait_for_timeout(250);ok('F5 abre o Pagamento sem recarregar a página',pg.evaluate("window.__m")==1 and pg.locator('.dg h2:has-text("Pagamento")').count()==1);fechar(pg)
    pg.evaluate("cart=[[0,2]];show('pdv')");pg.reload();pg.wait_for_selector('#nav button',timeout=8000);pg.wait_for_timeout(300)
    if pg.evaluate("cur")!='pdv': nav(pg,'PDV')
    ok('recarregar a página: caixa aberto e venda em andamento voltam',pg.evaluate("CX.aberto&&cart.length==1&&cart[0][1]==2"))
    random.seed(5);fal=[]
    for k in range(25):
        its=[[i:=random.choice([0,1,2,3]),round(random.uniform(0.05,4),3) if i==3 else random.randint(1,7)] for _ in range(random.randint(1,4))]
        m=random.choice(['Dinheiro','Débito','Crédito','PIX','Vale']);r=venda(pg,[(m,None)],str(its))
        esp=round(sum(round(round([74.9,59.9,189,49.9][a]*q*100+1e-7)/100,2) for a,q in its),2)
        if not r or abs(r['tot']-esp)>0.001: fal.append((m,its,r,esp))
    ok('25 carrinhos aleatórios (pesos, 5 meios): todos finalizam com o total certo',not fal)
    nav(pg,'Delivery');n0=len(pg.query_selector_all('#t-delivery tbody tr'));pg.click('button:has-text("Simular novo pedido")');pg.wait_for_timeout(300)
    ok('Delivery: "Simular novo pedido" inclui o pedido e mostra a faixa "Aceitar"',len(pg.query_selector_all('#t-delivery tbody tr'))==n0+1 and pg.locator('.off.in:has-text("Novo pedido")').count()==1)
    pg.click('.off.in button:has-text("Aceitar")');pg.wait_for_timeout(250);ok('Delivery: Aceitar move para "Em preparo"','Em preparo' in pg.inner_text('#t-delivery tbody tr:first-child'))
    nav(pg,'PDV');pg.click('.top button.pill');pg.wait_for_timeout(200);venda(pg,[('Dinheiro',None)],"[[2,1]]")
    ok('modo offline: venda fica pendente e o cupom indica contingência',pg.evaluate("pend==1&&LAST.fiscal.includes('CONTINGÊNCIA')"))
    pg.click('.top button.pill');pg.wait_for_timeout(2700);ok('volta a internet: sincroniza',pg.evaluate("net&&pend==0"))
    ok('todas as 15 abas abrem',pg.evaluate("NAV.every(([k])=>{show(k);return true})"))
    ok.done(errs)
