// Testes do núcleo fiscal e do cliente FocusNFe. Rodar:  npm run test:fiscal   (usa o TypeScript do projeto, sem banco e sem internet)
const ts = require('typescript'), fs = require('fs'), path = require('path'), Module = require('module');
function load(name) {
  const f = path.join(__dirname, '../src/fiscal', name + '.ts');
  const out = ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const m = new Module(f); m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f)); m._compile(out, f); return m.exports;
}
const C = load('fiscal-core'), { FocusNfeClient } = load('focusnfe.client');
let ok = 0; const bad = [];
const t = (n, c) => { console.log(c ? '✓' : '✗', n); c ? ok++ : bad.push(n); };

const emp = { cnpj: '69.196.200/0001-68', razao: 'RENASCER DISTRIBUIDORA DE ALIMENTOS LTDA', fantasia: 'RENASCER DISTRIBUIDORA DE ALIMENTOS', ie: '0321418-40', crt: '1', logradouro: 'Av. Piracicaba', numero: '584', bairro: 'Jardim São Paulo', municipio: 'Recife', uf: 'PE', cep: '50.790-205' };
// ATENÇÃO: os dados fiscais abaixo (IE, NCM, CST...) são SÓ de teste, não são os da empresa.
const taxS = { ncm: '04011010', cfop: '5102', origem: '0', cst: '102', unidade: 'UN', pisCst: '49', cofinsCst: '49' };
const tax = { A: { ...taxS }, B: { ...taxS, ncm: '04061010', unidade: 'KG' }, C: { ...taxS, ncm: '10063021' } };
const sale = (o = {}) => ({ id: 1001, items: [{ code: 'A', name: 'Leite UHT 1L (cx 12)', qty: 2, unitPrice: 74.9 }, { code: 'B', name: 'Queijo Mussarela fatiado (kg)', qty: 0.35, unitPrice: 49.9 }], discount: 0, payments: [{ method: 'Dinheiro', value: 167.27 }], troco: 0, at: new Date('2026-10-28T15:30:00Z'), ...o });

let r = C.buildNfce({ company: { cnpj: '69.196.200/0001-68', razao: 'X LTDA' }, sale: sale(), tax });
t('empresa sem IE, CRT e endereço: lista as pendências e bloqueia', !r.ok && r.issues.some(i => /Inscrição estadual/.test(i.msg)) && r.issues.some(i => /CRT/.test(i.msg)) && r.issues.some(i => /CEP/.test(i.msg)));
r = C.buildNfce({ company: emp, sale: sale(), tax }); const p = r.payload;
t('Simples (CSOSN 102): sem pendências', r.ok && !r.issues.some(i => i.level === 'erro'));
t('cabeçalho no formato da FocusNFe', p.cnpj_emitente === '69196200000168' && p.inscricao_estadual_emitente === '032141840' && p.natureza_operacao === 'Venda ao Consumidor' && p.tipo_documento === '1' && p.presenca_comprador === '1' && p.modalidade_frete === '9' && p.uf_emitente === 'PE' && p.cep_emitente === '50790205');
t('data de emissão com fuso -03:00', p.data_emissao === '2026-10-28T12:30:00-03:00');
t('itens: numeração, NCM de 8 dígitos, CFOP, CSOSN e origem', p.items.length === 2 && p.items[0].numero_item === '1' && p.items[0].codigo_ncm === '04011010' && p.items[0].cfop === '5102' && p.items[0].icms_situacao_tributaria === '102' && p.items[0].icms_origem === '0');
t('Simples não envia base/alíquota de ICMS', !('icms_aliquota' in p.items[0]) && !('icms_base_calculo' in p.items[0]));
t('queijo por peso: 0,350 kg × 49,90 = 17,47', p.items[1].quantidade_comercial === '0.350' && p.items[1].valor_bruto === '17.47' && p.items[1].unidade_comercial === 'KG');
t('totais e pagamento em dinheiro (01) com troco 0.00', p.valor_produtos === '167.27' && p.valor_total === '167.27' && JSON.stringify(p.formas_pagamento) === JSON.stringify([{ forma_pagamento: '01', valor_pagamento: '167.27', troco: '0.00' }]));
const taxN = { A: { ncm: '04011010', cfop: '5102', origem: '0', cst: '00', icmsAliq: 18, pisCst: '01', pisAliq: 0.65, cofinsCst: '01', cofinsAliq: 3, unidade: 'UN' } };
r = C.buildNfce({ company: { ...emp, crt: '3' }, sale: sale({ items: [{ code: 'A', name: 'Leite', qty: 2, unitPrice: 50 }], payments: [{ method: 'PIX', value: 100 }] }), tax: taxN }); const i0 = r.payload.items[0];
t('Regime Normal CST 00: ICMS 18% = 18,00, PIS 0,65, COFINS 3,00', r.ok && i0.icms_base_calculo === '100.00' && i0.icms_valor === '18.00' && i0.icms_modalidade_base_calculo === '3' && i0.pis_valor === '0.65' && i0.cofins_valor === '3.00');
r = C.buildNfce({ company: emp, sale: sale({ items: [{ code: 'A', name: 'A', qty: 1, unitPrice: 10.01 }, { code: 'A', name: 'A', qty: 1, unitPrice: 20.02 }, { code: 'A', name: 'A', qty: 1, unitPrice: 30.03 }], discount: 10.01, payments: [{ method: 'Débito', value: 50.05 }] }), tax });
const sd = r.payload.items.reduce((a, x) => a + Number(x.valor_desconto), 0);
t('desconto de R$ 10,01 rateado em 3 itens fecha em centavos', Math.abs(sd - 10.01) < 1e-9 && r.payload.valor_total === '50.05' && r.ok);
r = C.buildNfce({ company: emp, sale: sale({ items: [{ code: 'A', name: 'Leite', qty: 2, unitPrice: 74.9 }], payments: [{ method: 'PIX', value: 50 }, { method: 'Dinheiro', value: 110 }], troco: 10.2 }), tax });
t('pagamento dividido com troco: troco no dinheiro; PIX = 17', r.ok && r.payload.formas_pagamento[0].forma_pagamento === '17' && !('troco' in r.payload.formas_pagamento[0]) && r.payload.formas_pagamento[1].troco === '10.20');
t('pagamentos que não fecham com o total: erro', !C.buildNfce({ company: emp, sale: sale({ payments: [{ method: 'Dinheiro', value: 100 }] }), tax }).ok);
t('troco sem dinheiro: erro', C.buildNfce({ company: emp, sale: sale({ payments: [{ method: 'PIX', value: 200 }], troco: 32.73 }), tax }).issues.some(i => /troco/i.test(i.msg)));
const prob = (x) => C.buildNfce({ company: emp, sale: sale({ items: [{ code: 'A', name: 'Leite', qty: 1, unitPrice: 10 }], payments: [{ method: 'PIX', value: 10 }] }), tax: { A: { ...taxS, ...x } } });
t('CSOSN 900 recusado como não suportado', prob({ cst: '900' }).issues.some(i => /CSOSN 900.*não monta/.test(i.msg)));
t('CST de regime normal em empresa do Simples recusado', prob({ cst: '00' }).issues.some(i => /CSOSN inválido/.test(i.msg)));
t('CFOP 6102 recusado na NFC-e', prob({ cfop: '6102' }).issues.some(i => /CFOP/.test(i.msg)));
t('NCM com 7 dígitos recusado', prob({ ncm: '0401101' }).issues.some(i => /NCM/.test(i.msg)));
t('PIS CST 01 sem alíquota recusado', prob({ pisCst: '01' }).issues.some(i => /PIS CST 01/.test(i.msg)));
t('produto sem matriz fiscal recusado', C.buildNfce({ company: emp, sale: sale(), tax: { A: taxS } }).issues.some(i => /Sem dados fiscais/.test(i.msg)));
t('CSOSN 101 exige alíquota de crédito', prob({ cst: '101' }).issues.some(i => /crédito/.test(i.msg)));
t('CST 60 em regime normal recusado como não suportado', C.buildNfce({ company: { ...emp, crt: '3' }, sale: sale({ items: [{ code: 'A', name: 'Leite', qty: 1, unitPrice: 10 }], payments: [{ method: 'PIX', value: 10 }] }), tax: { A: { ...taxS, cst: '60' } } }).issues.some(i => /CST 60/.test(i.msg)));
t('CPF válido entra só com dígitos; inválido bloqueia', C.buildNfce({ company: emp, sale: sale({ cpf: '529.982.247-25' }), tax }).payload.cpf_destinatario === '52998224725' && !C.buildNfce({ company: emp, sale: sale({ cpf: '111.111.111-11' }), tax }).ok);
t('CNPJ da empresa válido; 11.111.111/1111-11 inválido', C.cnpjOk('69.196.200/0001-68') && !C.cnpjOk('11.111.111/1111-11'));
t('total acima de R$ 10.000 gera aviso', C.buildNfce({ company: emp, sale: sale({ items: [{ code: 'C', name: 'Arroz', qty: 60, unitPrice: 189 }], payments: [{ method: 'PIX', value: 11340 }] }), tax }).issues.some(i => i.level === 'aviso' && /10\.000/.test(i.msg)));
t('venda sem itens recusada', !C.buildNfce({ company: emp, sale: sale({ items: [] }), tax }).ok);
let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; let falhas = 0;
for (let k = 0; k < 2000; k++) {
  const its = []; for (let j = 0, n = 1 + Math.floor(rnd() * 5); j < n; j++) { const w = rnd() < 0.3; its.push({ code: 'ABC'[Math.floor(rnd() * 3)], name: 'P' + j, qty: w ? Math.round((0.05 + rnd() * 4) * 1000) / 1000 : 1 + Math.floor(rnd() * 8), unitPrice: Math.round((1 + rnd() * 200) * 100) / 100 }); }
  const gross = C.c2(its.reduce((a, x) => a + C.c2(x.qty * x.unitPrice), 0)), disc = rnd() < 0.5 ? C.c2(rnd() * gross * 0.4) : 0, tot = C.c2(gross - disc), m = ['Dinheiro', 'PIX', 'Débito', 'Crédito'][Math.floor(rnd() * 4)];
  const extra = m === 'Dinheiro' && rnd() < 0.5 ? Math.ceil(tot) + Math.floor(rnd() * 50) - tot : 0;
  const res = C.buildNfce({ company: emp, sale: { id: k, items: its, discount: disc, payments: [{ method: m, value: C.c2(tot + extra) }], troco: C.c2(extra) }, tax });
  const sb = res.payload.items.reduce((a, x) => a + Math.round(Number(x.valor_bruto) * 100), 0), sdd = res.payload.items.reduce((a, x) => a + Math.round(Number(x.valor_desconto) * 100), 0);
  if (!res.ok || sb - sdd !== Math.round(Number(res.payload.valor_total) * 100) || sdd !== Math.round(Number(res.payload.valor_desconto) * 100) || sb !== Math.round(Number(res.payload.valor_produtos) * 100) || Math.round(Number(res.payload.valor_total) * 100) !== Math.round(tot * 100)) falhas++;
}
t(`2.000 vendas aleatórias: Σ itens = total e Σ descontos = desconto, em centavos (${falhas} falhas)`, falhas === 0);

(async () => {
  const calls = []; const mk = (status, body, o = {}) => async (url, init) => { calls.push({ url, init }); if (o.throw) throw o.throw; return { status, json: async () => body }; };
  let c = new FocusNfeClient('TOKEN123', 'homologacao', mk(201, { status: 'autorizado', mensagem_sefaz: 'Autorizado o uso da NF-e', chave_nfe: 'NFe26261069196200000168650010000000011000000019', numero: '1', serie: '1', caminho_xml_nota_fiscal: '/arquivos/x.xml', caminho_danfe: '/arquivos/x.html', qrcode_url: 'http://nfce.sefaz.pe.gov.br/qr?p=abc' }));
  let x = await c.emitNfce('nfce-123', { a: 1 });
  t('cliente: homologação → endereço de testes, POST /v2/nfce?ref=', calls[0].url === 'https://homologacao.focusnfe.com.br/v2/nfce?ref=nfce-123' && calls[0].init.method === 'POST');
  t('cliente: autenticação Basic com o token e senha vazia', calls[0].init.headers.Authorization === 'Basic ' + Buffer.from('TOKEN123:').toString('base64'));
  t('cliente: autorizada traz chave, QR Code e links absolutos', x.state === 'autorizada' && x.key.startsWith('NFe2626') && x.qrcodeUrl.includes('qr?p=') && x.xmlUrl === 'https://homologacao.focusnfe.com.br/arquivos/x.xml');
  c = new FocusNfeClient('PROD', 'producao', mk(200, { status: 'cancelado' })); x = await c.cancelNfce('nfce-9', 'Cancelamento por erro de digitação do operador');
  t('cliente: produção → api.focusnfe.com.br, DELETE com justificativa', calls[1].url === 'https://api.focusnfe.com.br/v2/nfce/nfce-9' && calls[1].init.method === 'DELETE' && x.state === 'cancelada');
  c = new FocusNfeClient('T', 'homologacao', mk(200, { status: 'processando_autorizacao' })); t('cliente: processando_autorizacao → processando', (await c.getNfce('r1')).state === 'processando');
  c = new FocusNfeClient('T', 'homologacao', mk(422, { status: 'erro_autorizacao', mensagem_sefaz: 'Rejeição: NCM inválido' })); x = await c.emitNfce('r2', {}); t('cliente: rejeição da SEFAZ → rejeitada com a mensagem', x.state === 'rejeitada' && x.message.includes('NCM'));
  c = new FocusNfeClient('T', 'homologacao', mk(422, { codigo: 'requisicao_invalida', mensagem: 'Campo cfop obrigatório' })); x = await c.emitNfce('r3', {}); t('cliente: erro de validação → erro com a mensagem', x.state === 'erro' && x.message.includes('cfop'));
  c = new FocusNfeClient('T', 'homologacao', mk(0, null, { throw: new Error('ENOTFOUND') })); x = await c.emitNfce('r4', {}); t('cliente: sem internet → erro claro, sem lançar exceção', x.state === 'erro' && /Falha de rede/.test(x.message));
  c = new FocusNfeClient('T', 'homologacao', (u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => { const e = new Error('abort'); e.name = 'AbortError'; rej(e); })), 50); x = await c.emitNfce('r5', {}); t('cliente: tempo esgotado → "não respondeu a tempo"', x.state === 'erro' && /a tempo/.test(x.message));
  let th = false; try { new FocusNfeClient('', 'homologacao'); } catch { th = true; } t('cliente: sem token recusa criar', th);
  console.log(`\nRESULTADO: ${ok} ok, ${bad.length} falha(s)`, bad); process.exit(bad.length ? 1 : 0);
})();
