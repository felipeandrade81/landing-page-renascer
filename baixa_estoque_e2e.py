# A venda baixa o estoque (unidades e kg). Rodar: python3 baixa_estoque_e2e.py
from base import *
ok=Check()
def abrir(pg): pg.click('button:has-text("Abrir caixa")');pg.wait_for_selector('.dg form');pg.click('.dg button:has-text("Abrir caixa")');pg.wait_for_timeout(250)
def fechar(pg):
    for _ in range(5):
        if not pg.locator('.dg').count(): break
        pg.keyboard.press('Escape');pg.evaluate("closeDlg()");pg.wait_for_timeout(80)
def vender(pg,carrinho,m='Dinheiro'):
    pg.evaluate(f"cart={carrinho};DESC=0;show('pdv')");pg.click('button:has-text("Pagamento (F5)")');pg.wait_for_selector('.dg');pg.click(f'.dg [data-v="{m}"]');pg.wait_for_timeout(200);pg.click('.dg button:has-text("Finalizar venda")');pg.wait_for_timeout(300);fechar(pg)
est=lambda pg,i:pg.evaluate(f"T.produtos.rows.find(r=>r[0]==CAT[{i}][0])[4]")
with sync_playwright() as p:
    b,ctx,pg,errs=start(p);setup(pg);nav(pg,'PDV');abrir(pg)
    ok('estoques iniciais: leite 140 un, queijo 55 kg',est(pg,0)=='140 un' and est(pg,3)=='55 kg')
    vender(pg,"[[0,2]]")
    ok('venda de 2 un de leite: 140 → 138 un',est(pg,0)=='138 un')
    vender(pg,"[[3,0.35],[3,0.2],[1,1]]")
    ok('queijo por peso: 55 − 0,350 − 0,200 = 54,45 kg (sem erro de ponto flutuante)',est(pg,3)=='54.45 kg')
    ok('suco: 210 → 209 un',est(pg,1)=='209 un')
    # produto novo (unidade e kg) com estoque inicial
    pg.evaluate("regProduto(dv('789777000011'),'Bolacha Teste',5,'UN','Mercearia',10);regProduto(dv('789777000022'),'Presunto Teste',40,'KG','Frios',5)")
    n=pg.evaluate("CAT.length");vender(pg,f"[[{n-2},3],[{n-1},1.25]]",'Débito')
    ok('produtos cadastrados pelo PDV também baixam: bolacha 10 → 7 un, presunto 5 → 3,75 kg',est(pg,n-2)=='7 un' and est(pg,n-1)=='3.75 kg')
    # saldo negativo: venda não é bloqueada, mas avisa
    pg.evaluate("cart=[[%d,5]];DESC=0;show('pdv')"%(n-2));pg.click('button:has-text("Pagamento (F5)")');pg.wait_for_selector('.dg');pg.click('.dg [data-v="Dinheiro"]');pg.wait_for_timeout(200);pg.click('.dg button:has-text("Finalizar venda")');pg.wait_for_timeout(300)
    ok('bolacha 7 − 5 = 2 un (ainda positivo)',est(pg,n-2)=='2 un')
    fechar(pg);vender(pg,f"[[{n-2},4]]")
    ok('bolacha 2 − 4 = −2 un: venda concluída e toast de estoque negativo',est(pg,n-2)=='-2 un' and pg.evaluate("LAST.itens.some(x=>x.n=='Bolacha Teste')"))
    ok('toast avisa o estoque negativo',pg.locator('.toast:has-text("Estoque negativo")').count()==1)
    # offline (contingência) também baixa
    pg.click('.top button.pill');pg.wait_for_timeout(200);vender(pg,"[[0,1]]");ok('modo offline: venda em contingência também baixa (138 → 137 un)',est(pg,0)=='137 un' and pg.evaluate("pend>=1"))
    pg.click('.top button.pill');pg.wait_for_timeout(2700)
    # abas
    nav(pg,'Produtos');t=pg.inner_text('#t-produtos');ok('aba Produtos mostra o saldo novo (137 un, 54.45 kg)','137 un' in t and '54.45 kg' in t)
    nav(pg,'Estoque');m=pg.inner_text('#main');ok('aba Estoque: Posição por produto mostra saldo atual e "Negativo (conferir)"','54.45 kg' in m and '-2 un' in m and 'Negativo' in m)
    # cancelar item no carrinho ou suspender NÃO baixa
    nav(pg,'PDV');pg.evaluate("cart=[[0,3]];show('pdv')");pg.evaluate("act('suspender')");pg.wait_for_timeout(250)
    ok('venda suspensa (não finalizada) não baixa estoque',est(pg,0)=='137 un')
    pg.wait_for_timeout(1000);pg.reload();pg.wait_for_selector('#nav button',timeout=8000);pg.wait_for_timeout(500)
    ok('recarregar: os saldos baixados continuam salvos',est(pg,0)=='137 un' and est(pg,3)=='54.45 kg')
    ok('todas as 15 abas abrem',pg.evaluate("NAV.every(([k])=>{show(k);return true})"))
    ok.done(errs)
