// Núcleo fiscal: SEM dependências, para rodar igual no backend (NestJS) e dentro do PDV (navegador).
// Valida a matriz fiscal e converte uma venda no JSON da NFC-e (modelo 65) no formato da API da FocusNFe.
// Campos conferidos na documentação pública da FocusNFe. Regras tributárias: confirme sempre com o contador.

export type Issue = { level: 'erro' | 'aviso'; where: string; msg: string };
export type TaxData = {
  ncm?: string; cest?: string; unidade?: string; origem?: string; cfop?: string; cst?: string; credSnAliq?: number;
  icmsAliq?: number; pisCst?: string; pisAliq?: number; cofinsCst?: string; cofinsAliq?: number;
};
export type Company = { cnpj: string; razao: string; fantasia?: string; ie?: string; crt?: string; logradouro?: string; numero?: string; bairro?: string; municipio?: string; uf?: string; cep?: string };
export type SaleItem = { code: string; name: string; qty: number; unitPrice: number; unit?: string };
export type Pay = { method: string; value: number };
export type SaleIn = { id: string | number; items: SaleItem[]; discount: number; payments: Pay[]; troco: number; cpf?: string; at?: Date; info?: string };

export const ORIGENS = ['0 – Nacional', '1 – Estrangeira (importação direta)', '2 – Estrangeira (adquirida no mercado interno)', '3 – Nacional (importação > 40% e ≤ 70%)', '4 – Nacional (processos produtivos básicos)', '5 – Nacional (importação ≤ 40%)', '6 – Estrangeira (importação direta, sem similar)', '7 – Estrangeira (mercado interno, sem similar)', '8 – Nacional (importação > 70%)'];
export const CSOSN_OK: Record<string, string> = { '101': 'Tributada com permissão de crédito', '102': 'Tributada sem permissão de crédito', '103': 'Isenção do ICMS (faixa de receita bruta)', '300': 'Imune', '400': 'Não tributada pelo Simples Nacional' };
export const CSOSN_NAO_SUPORTADO: Record<string, string> = { '201': 'Tributada com crédito e ST', '202': 'Tributada sem crédito e ST', '203': 'Isenção (faixa) e ST', '500': 'ICMS cobrado anteriormente por ST', '900': 'Outros' };
export const CST_OK: Record<string, string> = { '00': 'Tributada integralmente', '40': 'Isenta', '41': 'Não tributada', '50': 'Suspensão' };
export const CST_NAO_SUPORTADO: Record<string, string> = { '10': 'Tributada e com ST', '20': 'Com redução de base de cálculo', '30': 'Isenta/não tributada e com ST', '51': 'Diferimento', '60': 'ICMS cobrado anteriormente por ST', '70': 'Redução de base e ST', '90': 'Outras' };
export const PIS_COFINS_CST: Record<string, string> = { '01': 'Tributável (alíquota básica)', '02': 'Tributável (alíquota diferenciada)', '04': 'Monofásica (alíquota zero)', '05': 'Substituição tributária', '06': 'Alíquota zero', '07': 'Isenta', '08': 'Sem incidência', '09': 'Suspensão', '49': 'Outras operações de saída', '99': 'Outras operações' };
export const CRT_OPTIONS = ['1 – Simples Nacional', '2 – Simples Nacional (excesso de sublimite)', '3 – Regime Normal (Lucro Presumido ou Real)', '4 – MEI'];
// Forma de pagamento do PDV → código da NF-e 4.0 (tPag). "Vale" e "Transferência" dependem do que for pago de fato: confirme com o contador.
export const FORMA_PAGAMENTO: Record<string, string> = { 'Dinheiro': '01', 'Crédito': '03', 'Débito': '04', 'PIX': '17', 'Transferência': '18', 'Vale': '99' };

export const c2 = (v: number) => Math.round((v + 1e-9) * 100) / 100;
const d2 = (v: number) => c2(v).toFixed(2);
const dg = (s?: string) => String(s ?? '').replace(/\D/g, '');
export const isSimples = (crt?: string) => ['1', '2', '4'].includes(String(crt ?? '')[0]);

export function cnpjOk(v: string) {
  const c = dg(v);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const f = (b: string) => { let s = 0, p = b.length - 7; for (const n of b) { s += +n * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return f(c.slice(0, 12)) === +c[12] && f(c.slice(0, 13)) === +c[13];
}
export function cpfOk(v: string) {
  const c = dg(v);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  const f = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return f(9) === +c[9] && f(10) === +c[10];
}

export function validateCompany(c: Company): Issue[] {
  const e: Issue[] = [], W = 'Empresa (emitente)';
  const bad = (m: string) => e.push({ level: 'erro', where: W, msg: m });
  if (!cnpjOk(c.cnpj || '')) bad('CNPJ inválido ou ausente');
  if (!c.razao || c.razao.trim().length < 3) bad('Razão social ausente');
  if (!/^\d{2,14}$/.test(dg(c.ie)) ) bad('Inscrição estadual não informada (necessária para emitir NFC-e)');
  if (!['1', '2', '3', '4'].includes(String(c.crt ?? '')[0])) bad('Regime tributário (CRT) não definido');
  for (const [k, l] of [['logradouro', 'Logradouro'], ['numero', 'Número'], ['bairro', 'Bairro'], ['municipio', 'Município']] as const) if (!(c as any)[k]?.trim()) bad(`${l} do endereço ausente`);
  if (!/^[A-Za-z]{2}$/.test(c.uf || '')) bad('UF ausente');
  if (dg(c.cep).length !== 8) bad('CEP ausente ou inválido');
  return e;
}

/** Valida a matriz fiscal de UM produto conforme o regime da empresa. */
export function validateTax(t: TaxData | undefined, crt: string | undefined, nome: string): Issue[] {
  const e: Issue[] = [], W = `Produto: ${nome}`, bad = (m: string) => e.push({ level: 'erro', where: W, msg: m }), warn = (m: string) => e.push({ level: 'aviso', where: W, msg: m });
  if (!t) { bad('Sem dados fiscais (NCM, CFOP, CST/CSOSN, alíquotas)'); return e; }
  if (!/^\d{8}$/.test(dg(t.ncm))) bad('NCM deve ter 8 dígitos');
  if (!/^5\d{3}$/.test(String(t.cfop ?? ''))) bad('CFOP inválido para NFC-e (venda dentro do estado: 5xxx, ex.: 5102)');
  if (!/^[0-8]$/.test(String(t.origem ?? ''))) bad('Origem da mercadoria (0 a 8) não informada');
  const simples = isSimples(crt), cst = String(t.cst ?? '');
  if (!['1', '2', '3', '4'].includes(String(crt ?? '')[0])) bad('Defina o regime tributário da empresa para validar CST/CSOSN');
  else if (simples) {
    if (CSOSN_NAO_SUPORTADO[cst]) bad(`CSOSN ${cst} (${CSOSN_NAO_SUPORTADO[cst]}) exige campos de ST que esta versão ainda não monta: emita pelo contador/provedor`);
    else if (!CSOSN_OK[cst]) bad('CSOSN inválido para empresa do Simples Nacional (use 101, 102, 103, 300 ou 400)');
    if (cst === '101' && !(Number(t.credSnAliq) > 0)) bad('CSOSN 101 exige a alíquota de crédito do Simples Nacional');
  } else {
    if (CST_NAO_SUPORTADO[cst]) bad(`CST ${cst} (${CST_NAO_SUPORTADO[cst]}) exige campos de ST/redução/diferimento que esta versão ainda não monta: emita pelo contador/provedor`);
    else if (!CST_OK[cst]) bad('CST de ICMS inválido (use 00, 40, 41 ou 50)');
    if (cst === '00' && !(Number(t.icmsAliq) > 0)) bad('CST 00 exige a alíquota de ICMS');
  }
  if (t.cest && !/^\d{7}$/.test(dg(t.cest))) bad('CEST deve ter 7 dígitos');
  for (const [tag, c, a] of [['PIS', t.pisCst, t.pisAliq], ['COFINS', t.cofinsCst, t.cofinsAliq]] as const) {
    if (!PIS_COFINS_CST[String(c ?? '')]) bad(`CST do ${tag} não informado`);
    else if (['01', '02'].includes(String(c)) && !(Number(a) > 0)) bad(`${tag} CST ${c} exige alíquota`);
    else if (String(c) === '99' && !(Number(a) >= 0 && a !== undefined && a !== null)) bad(`${tag} CST 99 exige alíquota (pode ser 0)`);
  }
  if (!t.unidade) warn('Unidade não informada (será usada UN)');
  return e;
}

export type NfceInput = { company: Company; sale: SaleIn; tax: Record<string, TaxData | undefined>; now?: Date };

/** Converte a venda no JSON da NFC-e (FocusNFe) e lista pendências. Não envia nada. */
export function buildNfce(inp: NfceInput) {
  const { company, sale } = inp, issues: Issue[] = [...validateCompany(company)];
  const err = (where: string, msg: string) => issues.push({ level: 'erro', where, msg }), warn = (where: string, msg: string) => issues.push({ level: 'aviso', where, msg });
  if (!sale.items.length) err('Venda', 'A venda não tem itens');

  const lines = sale.items.map((it) => ({ it, gross: c2(it.qty * it.unitPrice), disc: 0 }));
  const sumGross = c2(lines.reduce((a, l) => a + l.gross, 0)), disc = c2(sale.discount || 0);
  if (disc > sumGross) err('Venda', 'O desconto é maior que o total dos produtos');
  let rest = Math.min(disc, sumGross);
  lines.forEach((l, i) => { const d = i === lines.length - 1 ? rest : c2(Math.min(rest, (disc * l.gross) / (sumGross || 1))); l.disc = d; rest = c2(rest - d); }); // rateio do desconto entre os itens (a soma fecha em centavos)
  const total = c2(sumGross - Math.min(disc, sumGross));

  const seen = new Set<string>();
  for (const l of lines) { if (!seen.has(l.it.code)) { seen.add(l.it.code); issues.push(...validateTax(inp.tax[l.it.code], company.crt, l.it.name)); } }

  const simples = isSimples(company.crt);
  const items = lines.map((l, i) => {
    const t = inp.tax[l.it.code] || {}, un = t.unidade || l.it.unit || 'UN', kg = /^(kg|g|l|ml)$/i.test(un);
    const q = kg ? l.it.qty.toFixed(3) : l.it.qty.toFixed(2), base = c2(l.gross - l.disc);
    const o: Record<string, string> = {
      numero_item: String(i + 1), codigo_produto: l.it.code, descricao: l.it.name, codigo_ncm: dg(t.ncm), cfop: String(t.cfop ?? ''),
      ...(t.cest ? { cest: dg(t.cest) } : {}),
      unidade_comercial: un, quantidade_comercial: q, valor_unitario_comercial: l.it.unitPrice.toFixed(4),
      unidade_tributavel: un, quantidade_tributavel: q, valor_unitario_tributavel: l.it.unitPrice.toFixed(4),
      valor_bruto: d2(l.gross), valor_desconto: d2(l.disc), inclui_no_total: '1',
      icms_origem: String(t.origem ?? ''), icms_situacao_tributaria: String(t.cst ?? ''),
    };
    if (simples && t.cst === '101') { o.icms_aliquota_credito_simples = String(t.credSnAliq ?? ''); o.icms_valor_credito_simples = d2((base * Number(t.credSnAliq || 0)) / 100); }
    if (!simples && t.cst === '00') { o.icms_modalidade_base_calculo = '3'; o.icms_base_calculo = d2(base); o.icms_aliquota = String(t.icmsAliq ?? ''); o.icms_valor = d2((base * Number(t.icmsAliq || 0)) / 100); }
    for (const [tag, cst, aliq] of [['pis', t.pisCst, t.pisAliq], ['cofins', t.cofinsCst, t.cofinsAliq]] as const) {
      o[`${tag}_situacao_tributaria`] = String(cst ?? '');
      if (['01', '02', '99'].includes(String(cst))) { o[`${tag}_base_calculo`] = d2(base); o[`${tag}_aliquota_porcentual`] = String(aliq ?? 0); o[`${tag}_valor`] = d2((base * Number(aliq || 0)) / 100); }
    }
    return o;
  });

  const troco = c2(sale.troco || 0), paid = c2(sale.payments.reduce((a, p) => a + p.value, 0));
  if (!sale.payments.length) err('Pagamento', 'A venda não tem forma de pagamento');
  if (c2(paid - troco) !== total) err('Pagamento', `Pagamentos (${d2(paid)}) menos troco (${d2(troco)}) não fecham com o total da nota (${d2(total)})`);
  const cashIdx = sale.payments.findIndex((p) => p.method === 'Dinheiro');
  if (troco > 0 && cashIdx < 0) err('Pagamento', 'Há troco, mas nenhum pagamento em dinheiro');
  const formas = sale.payments.map((p, i) => {
    const code = FORMA_PAGAMENTO[p.method];
    if (!code) err('Pagamento', `Forma de pagamento "${p.method}" não tem código fiscal`);
    if (p.method === 'Vale') warn('Pagamento', 'Vale foi enviado como "99 – Outros": confirme com o contador o tipo correto (alimentação, refeição, presente)');
    if (p.method === 'Crédito' || p.method === 'Débito') warn('Pagamento', 'Cartão: se a maquininha for integrada (TEF), a bandeira e a autorização precisam ser informadas');
    return { forma_pagamento: code ?? '', valor_pagamento: d2(p.value), ...(i === (cashIdx >= 0 ? cashIdx : 0) ? { troco: d2(troco) } : {}) };
  });
  if (total > 10000 && !sale.cpf) warn('Venda', 'Total acima de R$ 10.000,00: a SEFAZ pode exigir a identificação do consumidor (CPF/CNPJ)');
  if (sale.cpf && !cpfOk(sale.cpf)) err('Venda', 'CPF do consumidor inválido');

  const when = new Date(((inp.now ?? sale.at) ?? new Date()).getTime() - 3 * 3600e3).toISOString().slice(0, 19) + '-03:00'; // horário de Brasília (-03:00)
  const payload: Record<string, unknown> = {
    cnpj_emitente: dg(company.cnpj), nome_emitente: company.razao, nome_fantasia_emitente: company.fantasia || company.razao, inscricao_estadual_emitente: dg(company.ie),
    logradouro_emitente: company.logradouro, numero_emitente: company.numero, bairro_emitente: company.bairro, municipio_emitente: company.municipio, uf_emitente: (company.uf || '').toUpperCase(), cep_emitente: dg(company.cep),
    data_emissao: when, natureza_operacao: 'Venda ao Consumidor', tipo_documento: '1', presenca_comprador: '1', finalidade_emissao: '1', modalidade_frete: '9', local_destino: '1',
    indicador_inscricao_estadual_destinatario: '9',
    ...(sale.cpf && cpfOk(sale.cpf) ? { cpf_destinatario: dg(sale.cpf) } : {}),
    valor_produtos: d2(sumGross), valor_desconto: d2(Math.min(disc, sumGross)), valor_total: d2(total),
    ...(sale.info ? { informacoes_adicionais_contribuinte: sale.info } : {}),
    items, formas_pagamento: formas,
  };
  return { payload, issues, totals: { produtos: sumGross, desconto: Math.min(disc, sumGross), total, troco }, ok: !issues.some((i) => i.level === 'erro') };
}
