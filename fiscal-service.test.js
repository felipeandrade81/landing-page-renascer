// Executa o serviço de emissão (src/fiscal/fiscal-nfce.ts) de verdade, com banco e provedor FALSOS. Rodar: npm run test:fiscal
const ts = require('typescript'), fs = require('fs'), path = require('path'), Module = require('module');
const cache = {}, orig = Module._load;
function loadTs(f) {
  if (cache[f]) return cache[f].exports;
  const out = ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  const m = cache[f] = new Module(f, null); m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f)); m._compile(out, f); return m.exports;
}
class Ex extends Error { constructor(r) { super(typeof r === 'string' ? r : r?.message || 'x'); this.response = r; this.name = this.constructor.name; } }
const exc = {}, nest = new Proxy({}, { get: (_, k) => String(k).endsWith('Exception') ? (exc[k] ??= class extends Ex { constructor(r) { super(r); this.name = k; } }) : () => () => {} });
Module._load = (req, parent, isMain) => {
  if (req === '@nestjs/common') return nest;
  if (req === '../auth') return { Roles: () => () => {} };
  if (req === '../prisma.service') return { PrismaService: class {} };
  if (req.startsWith('.')) { const abs = path.resolve(path.dirname(parent.filename), req) + '.ts'; if (fs.existsSync(abs)) return loadTs(abs); }
  return orig(req, parent, isMain);
};
const { FiscalNfceService } = loadTs(path.join(__dirname, '../src/fiscal/fiscal-nfce.ts'));
let ok = 0; const bad = []; const t = (n, c) => { console.log(c ? '✓' : '✗', n); c ? ok++ : bad.push(n); };
const rejects = async (fn, name) => { try { await fn(); return null; } catch (e) { return e; } };

function mk(over = {}) {
  const db = {
    company: { cnpj: '69196200000168', legalName: 'RENASCER DISTRIBUIDORA DE ALIMENTOS LTDA', tradeName: 'RENASCER', status: 'Ativa desde 17/09/2026 (matriz)', stateRegistration: '032141840', crt: '1', street: 'Av. Piracicaba', streetNumber: '584', district: 'Jardim São Paulo', city: 'Recife', uf: 'PE', zip: '50790205', ...over.company },
    settings: { id: 'main', environment: 'HOMOLOGACAO', provider: 'FOCUSNFE', series: 1, cscId: null, checklist: {} },
    products: [{ sku: 'LEI-001', name: 'Leite', unit: 'UN', ncm: '04011010', cfop: '5102', origin: '0', cst: '102', pisCst: '49', cofinsCst: '49', active: true }, { sku: 'QJM-040', name: 'Queijo', unit: 'KG', ncm: '04061010', active: true }],
    sales: { s1: { id: 's1', number: 1001, channel: 'VAREJO', paymentMethod: 'DINHEIRO', discount: 0, status: 'AGUARDANDO_EMISSAO', createdAt: new Date('2026-10-28T15:30:00Z'), invoiceId: 'i1', items: [{ quantity: 2, unitPrice: 74.9, taxSnapshot: null, product: { sku: 'LEI-001', name: 'Leite', unit: 'UN', ncm: '04011010', cfop: '5102', origin: '0', cst: '102', pisCst: '49', cofinsCst: '49' } }], transactions: [{ type: 'RECEITA', method: 'DINHEIRO', amount: 149.8 }], ...over.sale } },
    invoices: { i1: { id: 'i1', model: 'NFCE_65', status: 'AGUARDANDO_EMISSAO', providerRef: null, events: null, accessKey: null, protocol: null, ...over.invoice } },
  };
  const prisma = { db,
    fiscalSettings: { upsert: async ({ update }) => Object.assign(db.settings, update) },
    company: { findUnique: async () => db.company },
    product: { findMany: async () => db.products },
    sale: { findUnique: async ({ where }) => { const s = db.sales[where.id]; return s ? { ...s, invoice: db.invoices[s.invoiceId] } : null; }, update: async ({ where, data }) => Object.assign(db.sales[where.id], data) },
    invoice: { update: async ({ where, data }) => Object.assign(db.invoices[where.id], data), findUniqueOrThrow: async ({ where }) => db.invoices[where.id] },
  };
  const svc = new FiscalNfceService(prisma); const calls = []; let next = { state: 'autorizada', httpStatus: 201, message: 'Autorizado o uso da NF-e', key: 'NFe2626...', number: '1', series: '1', qrcodeUrl: 'http://qr', danfeUrl: 'http://danfe', xmlUrl: 'http://xml' };
  svc.makeClient = (token, env) => ({ emitNfce: async (ref, payload) => { calls.push({ op: 'emit', ref, token, env, payload }); return next; }, getNfce: async (ref) => { calls.push({ op: 'get', ref }); return next; }, cancelNfce: async (ref, j) => { calls.push({ op: 'cancel', ref, j }); return { state: 'cancelada', httpStatus: 200, message: 'Cancelado' }; } });
  return { svc, db, calls, setNext: (r) => (next = r) };
}
const user = { sub: 'u1', name: 'Ana', role: 'GERENTE' };
(async () => {
  delete process.env.FOCUSNFE_TOKEN_HOMOLOGACAO; delete process.env.FOCUSNFE_TOKEN_PRODUCAO; delete process.env.FISCAL_ALLOW_PRODUCTION;
  let h = mk({ company: { stateRegistration: null, crt: null } });
  let p = await h.svc.preview('s1');
  t('prévia com empresa sem IE e CRT: bloqueada e lista as pendências', !p.ok && p.issues.some(i => /Inscrição estadual/.test(i.msg)) && p.issues.some(i => /CRT/.test(i.msg)));
  h = mk(); p = await h.svc.preview('s1');
  t('prévia completa: ok, item com SKU, NCM e CSOSN da matriz do produto', p.ok && p.payload.items[0].codigo_produto === 'LEI-001' && p.payload.items[0].icms_situacao_tributaria === '102' && p.payload.valor_total === '149.80');
  t('pagamento do banco (DINHEIRO) vira forma 01', p.payload.formas_pagamento[0].forma_pagamento === '01');
  let e = await rejects(() => h.svc.emit('s1', user));
  t('emitir sem token no servidor: 412 pedindo FOCUSNFE_TOKEN_HOMOLOGACAO e NADA é enviado', e && e.name === 'PreconditionFailedException' && /FOCUSNFE_TOKEN_HOMOLOGACAO/.test(e.message) && h.calls.length === 0);
  process.env.FOCUSNFE_TOKEN_HOMOLOGACAO = 'tok-hom';
  let r = await h.svc.emit('s1', user);
  t('emitir: envia para HOMOLOGAÇÃO com o token certo e a referência estável', h.calls[0].env === 'homologacao' && h.calls[0].token === 'tok-hom' && h.calls[0].ref === 'nfce-i1');
  t('autorizada: nota AUTORIZADA com chave, QR Code e links; venda FATURADA', r.state === 'autorizada' && h.db.invoices.i1.status === 'AUTORIZADA' && h.db.invoices.i1.accessKey === 'NFe2626...' && h.db.invoices.i1.qrcodeUrl === 'http://qr' && h.db.sales.s1.status === 'FATURADA');
  t('JSON enviado fica salvo na nota (auditoria) e o evento do provedor no histórico', h.db.invoices.i1.payload.cnpj_emitente === '69196200000168' && h.db.invoices.i1.events.length === 1);
  r = await h.svc.emit('s1', user);
  t('emitir de novo uma nota já autorizada NÃO reenvia (idempotente)', r.already === true && h.calls.filter(c => c.op === 'emit').length === 1);
  // rejeição e reenvio com a mesma ref
  h = mk(); h.setNext({ state: 'rejeitada', httpStatus: 422, message: 'Rejeição 539: NCM inválido' });
  await h.svc.emit('s1', user);
  t('rejeição: nota REJEITADA com o motivo, venda continua aguardando', h.db.invoices.i1.status === 'REJEITADA' && /NCM/.test(h.db.invoices.i1.rejectionReason) && h.db.sales.s1.status === 'AGUARDANDO_EMISSAO');
  h.setNext({ state: 'autorizada', httpStatus: 201, message: 'ok', key: 'K2' }); await h.svc.emit('s1', user);
  t('corrigido, reenviar usa a MESMA referência (o provedor não duplica) e autoriza', h.calls.filter(c => c.op === 'emit').map(c => c.ref).join() === 'nfce-i1,nfce-i1' && h.db.invoices.i1.status === 'AUTORIZADA' && h.db.invoices.i1.rejectionReason === null);
  // erro de rede
  h = mk(); h.setNext({ state: 'erro', httpStatus: 0, message: 'Falha de rede: ENOTFOUND' }); r = await h.svc.emit('s1', user);
  t('falha de rede: status da nota NÃO muda (pode reenviar) e a mensagem fica registrada', h.db.invoices.i1.status === 'AGUARDANDO_EMISSAO' && /Falha de rede/.test(h.db.invoices.i1.lastMessage) && h.db.sales.s1.status === 'AGUARDANDO_EMISSAO');
  h.setNext({ state: 'processando', httpStatus: 201, message: 'processando_autorizacao' }); await h.svc.emit('s1', user);
  t('processando: aguarda; a consulta de status depois atualiza para autorizada', h.db.invoices.i1.status === 'AGUARDANDO_EMISSAO' && (h.setNext({ state: 'autorizada', httpStatus: 200, message: 'ok', key: 'K3' }), (await h.svc.status('s1')).state === 'autorizada') && h.db.invoices.i1.status === 'AUTORIZADA');
  // bloqueios
  h = mk({ sale: { channel: 'ATACADO' } }); p = await h.svc.preview('s1');
  t('venda de atacado não vira NFC-e (exige NF-e 55)', !p.ok && p.issues.some(i => /NF-e \(modelo 55\)/.test(i.msg)));
  e = await rejects(() => h.svc.emit('s1', user)); t('e a emissão é recusada com 422 e a lista de pendências', e && e.name === 'UnprocessableEntityException' && e.response.issues.length > 0 && h.calls.length === 0);
  h = mk({ sale: { paymentMethod: 'PRAZO', transactions: [{ type: 'RECEITA', method: 'PRAZO', amount: 149.8 }] } }); p = await h.svc.preview('s1'); t('venda a prazo/boleto não vira NFC-e', !p.ok && p.issues.some(i => /prazo/i.test(i.msg)));
  h = mk(); h.db.settings.environment = 'PRODUCAO'; process.env.FOCUSNFE_TOKEN_PRODUCAO = 'tok-prod';
  e = await rejects(() => h.svc.emit('s1', user)); t('produção bloqueada sem FISCAL_ALLOW_PRODUCTION=1 (nada enviado)', e && e.name === 'ForbiddenException' && h.calls.length === 0);
  process.env.FISCAL_ALLOW_PRODUCTION = '1'; await h.svc.emit('s1', user); t('com a liberação explícita, usa o endereço e o token de PRODUÇÃO', h.calls[0].env === 'producao' && h.calls[0].token === 'tok-prod');
  delete process.env.FISCAL_ALLOW_PRODUCTION;
  h = mk({ invoice: { model: 'NFE_55' } }); e = await rejects(() => h.svc.emit('s1', user)); t('nota que não é NFC-e (modelo 55) é recusada', e && e.name === 'ConflictException');
  h = mk(); h.db.settings.provider = 'NFEIO'; e = await rejects(() => h.svc.emit('s1', user)); t('provedor ainda não implementado (NFE.io) avisa em vez de fingir', e && /não está implementado/.test(e.message));
  // cancelamento
  h = mk(); e = await rejects(() => h.svc.cancel('s1', { justification: 'curta' }, user)); t('cancelar exige justificativa de 15+ caracteres', e && e.name === 'UnprocessableEntityException');
  e = await rejects(() => h.svc.cancel('s1', { justification: 'Cliente desistiu da compra depois da emissão' }, user)); t('cancelar nota não autorizada é recusado', e && e.name === 'ConflictException');
  await h.svc.emit('s1', user); r = await h.svc.cancel('s1', { justification: 'Cliente desistiu da compra depois da emissão' }, user);
  t('cancelar nota autorizada: CANCELADA e venda CANCELADA, justificativa enviada ao provedor', r.state === 'cancelada' && h.db.invoices.i1.status === 'CANCELADA' && h.db.sales.s1.status === 'CANCELADA' && h.calls.at(-1).j.length >= 15);
  // prontidão e configurações
  h = mk(); delete process.env.FOCUSNFE_TOKEN_HOMOLOGACAO; let rd = await h.svc.readiness();
  t('prontidão: lista o que falta (token, IE habilitada, certificado, credenciamento, CSC, matriz do queijo)', !rd.readyForHomologation && ['token', 'ieHab', 'cert', 'credHom', 'csc', 'matriz'].every(id => !rd.checks.find(c => c.id === id).ok) && rd.pendingProducts.some(x => x.sku === 'QJM-040'));
  t('prontidão: CNPJ ativo, IE, CRT e endereço aparecem como prontos', ['cnpj', 'ie', 'crt', 'emitente'].every(id => rd.checks.find(c => c.id === id).ok));
  e = await rejects(() => h.svc.saveSettings({ environment: 'PRODUCAO' })); t('não deixa trocar para PRODUÇÃO enquanto faltar item', e && e.name === 'ConflictException' && h.db.settings.environment === 'HOMOLOGACAO');
  e = await rejects(() => h.svc.saveSettings({ cscId: 'abc' })); t('ID do CSC precisa ser numérico', e && e.name === 'UnprocessableEntityException');
  await h.svc.saveSettings({ cscId: '1', series: 2, checklist: { ieHab: true, cert: true, certVal: '2027-09-30', credHom: true, cscToken: true } });
  h.db.products = h.db.products.slice(0, 1); process.env.FOCUSNFE_TOKEN_HOMOLOGACAO = 'x'; rd = await h.svc.readiness();
  t('com tudo confirmado e a matriz completa: pronto para HOMOLOGAÇÃO, ainda não para produção (falta credenciamento de produção)', rd.readyForHomologation && !rd.readyForProduction);
  console.log(`\nRESULTADO: ${ok} ok, ${bad.length} falha(s)`, bad); process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
