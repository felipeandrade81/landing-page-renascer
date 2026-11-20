import { Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, PreconditionFailedException, Post, Put, Req, UnprocessableEntityException } from '@nestjs/common';
import { AuthUser, Roles } from '../auth';
import { PrismaService } from '../prisma.service';
import { Company, Issue, TaxData, buildNfce, c2, cnpjOk, validateCompany, validateTax } from './fiscal-core';
import { FocusEnv, FocusNfeClient, FocusResult } from './focusnfe.client';
import { productToTax } from './product-tax';

const METHODS: Record<string, string> = { DINHEIRO: 'Dinheiro', PIX: 'PIX', DEBITO: 'Débito', CREDITO_VISTA: 'Crédito', CREDITO_PARCELADO: 'Crédito' };
const erro = (where: string, msg: string): Issue => ({ level: 'erro', where, msg });

@Injectable()
export class FiscalNfceService {
  constructor(private prisma: PrismaService) {}

  settings() { return this.prisma.fiscalSettings.upsert({ where: { id: 'main' }, update: {}, create: { id: 'main' } }); }

  private companyIn(c: any): Company {
    return { cnpj: c.cnpj, razao: c.legalName, fantasia: c.tradeName ?? undefined, ie: c.stateRegistration ?? undefined, crt: c.crt ?? undefined, logradouro: c.street ?? undefined, numero: c.streetNumber ?? undefined, bairro: c.district ?? undefined, municipio: c.city ?? undefined, uf: c.uf ?? undefined, cep: c.zip ?? undefined };
  }

  /** Cliente do provedor. Sobrescreva em testes. */
  makeClient(token: string, env: FocusEnv) { return new FocusNfeClient(token, env); }

  private client(settings: any) {
    if (settings.provider !== 'FOCUSNFE') throw new ConflictException(`O provedor ${settings.provider} ainda não está implementado (use FOCUSNFE)`);
    const prod = settings.environment === 'PRODUCAO';
    if (prod && process.env.FISCAL_ALLOW_PRODUCTION !== '1') throw new ForbiddenException('Produção bloqueada: só libere (FISCAL_ALLOW_PRODUCTION=1) depois de homologar com o contador');
    const name = prod ? 'FOCUSNFE_TOKEN_PRODUCAO' : 'FOCUSNFE_TOKEN_HOMOLOGACAO', token = process.env[name];
    if (!token) throw new PreconditionFailedException(`Token da FocusNFe ausente: defina ${name} no servidor`);
    return this.makeClient(token, prod ? 'producao' : 'homologacao');
  }

  private async load(saleId: string) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId }, include: { items: { include: { product: true } }, invoice: true, transactions: true } });
    if (!sale) throw new NotFoundException('Venda não encontrada');
    return sale;
  }

  /** Monta o JSON da NFC-e a partir da venda gravada e lista as pendências. Não envia nada. */
  async build(saleId: string) {
    const [sale, company, settings] = await Promise.all([this.load(saleId), this.prisma.company.findUnique({ where: { id: 'main' } }), this.settings()]);
    if (!company) throw new PreconditionFailedException('Cadastre os dados da empresa antes de emitir notas');
    const tax: Record<string, TaxData> = {};
    for (const it of sale.items) tax[it.product.sku] = (it.taxSnapshot as TaxData | null) ?? productToTax(it.product);
    const byMethod = new Map<string, number>();
    for (const t of sale.transactions) if (t.type === 'RECEITA' && t.method) { const m = METHODS[t.method] ?? String(t.method); byMethod.set(m, c2((byMethod.get(m) ?? 0) + Number(t.amount))); }
    const r = buildNfce({
      company: this.companyIn(company), tax,
      sale: { id: sale.number, items: sale.items.map((i) => ({ code: i.product.sku, name: i.product.name, qty: Number(i.quantity), unitPrice: Number(i.unitPrice), unit: i.product.unit })), discount: Number(sale.discount), payments: [...byMethod].map(([method, value]) => ({ method, value })), troco: 0, at: sale.createdAt },
    });
    if (sale.channel !== 'VAREJO') r.issues.push(erro('Venda', 'NFC-e é para venda ao consumidor (varejo). Venda de atacado usa NF-e (modelo 55), ainda não integrada.'));
    if (['BOLETO', 'PRAZO'].includes(String(sale.paymentMethod))) r.issues.push(erro('Pagamento', 'Venda a prazo/boleto não pode ser NFC-e: use NF-e (modelo 55).'));
    return { sale, settings, company, payload: r.payload, issues: r.issues, totals: r.totals, ok: !r.issues.some((i) => i.level === 'erro') };
  }

  async preview(saleId: string) {
    const b = await this.build(saleId);
    return { ok: b.ok, issues: b.issues, payload: b.payload, totals: b.totals, environment: b.settings.environment, provider: b.settings.provider };
  }

  async emit(saleId: string, user: AuthUser) {
    const b = await this.build(saleId), inv = b.sale.invoice;
    if (!inv || inv.model !== 'NFCE_65') throw new ConflictException('Esta venda não tem NFC-e pendente');
    if (inv.status === 'AUTORIZADA') return { already: true, state: 'autorizada', message: 'A nota já estava autorizada', invoice: inv };
    if (!b.ok) throw new UnprocessableEntityException({ message: 'Dados fiscais incompletos: corrija antes de emitir', issues: b.issues });
    const client = this.client(b.settings), ref = inv.providerRef ?? `nfce-${inv.id}`; // mesma ref em toda tentativa: reenviar não duplica
    await this.prisma.invoice.update({ where: { id: inv.id }, data: { providerRef: ref, payload: b.payload as any } });
    return this.apply(inv.id, saleId, await client.emitNfce(ref, b.payload), user);
  }

  async status(saleId: string) {
    const inv = (await this.load(saleId)).invoice;
    if (!inv?.providerRef) throw new ConflictException('Esta nota ainda não foi enviada ao provedor');
    return this.apply(inv.id, saleId, await this.client(await this.settings()).getNfce(inv.providerRef));
  }

  async cancel(saleId: string, body: any, user: AuthUser) {
    const why = String(body?.justification ?? '').trim();
    if (why.length < 15) throw new UnprocessableEntityException('A justificativa precisa ter ao menos 15 caracteres');
    const inv = (await this.load(saleId)).invoice;
    if (!inv || inv.status !== 'AUTORIZADA' || !inv.providerRef) throw new ConflictException('Só nota autorizada pode ser cancelada');
    return this.apply(inv.id, saleId, await this.client(await this.settings()).cancelNfce(inv.providerRef, why), user);
  }

  private async apply(invoiceId: string, saleId: string, r: FocusResult, user?: AuthUser) {
    const inv = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const events = [...(Array.isArray(inv.events) ? (inv.events as any[]) : []), { tipo: 'Provedor', texto: `${r.state}: ${r.message}`, em: new Date().toISOString(), por: user?.name }];
    const base: any = { providerState: r.state, lastMessage: r.message.slice(0, 500), events };
    let data = base;
    if (r.state === 'autorizada') data = { ...base, status: 'AUTORIZADA', accessKey: r.key ?? inv.accessKey, protocol: r.protocol ?? inv.protocol, qrcodeUrl: r.qrcodeUrl, danfeUrl: r.danfeUrl, xmlUrl: r.xmlUrl, issuedAt: new Date(), rejectionReason: null };
    else if (r.state === 'rejeitada') data = { ...base, status: 'REJEITADA', rejectionReason: r.message.slice(0, 500) };
    else if (r.state === 'cancelada') data = { ...base, status: 'CANCELADA' };
    // 'processando' e 'erro' (rede/validação) não mudam o status: dá para consultar ou reenviar com a mesma ref
    const updated = await this.prisma.invoice.update({ where: { id: invoiceId }, data });
    if (r.state === 'autorizada') await this.prisma.sale.update({ where: { id: saleId }, data: { status: 'FATURADA' } });
    if (r.state === 'cancelada') await this.prisma.sale.update({ where: { id: saleId }, data: { status: 'CANCELADA' } });
    return { state: r.state, message: r.message, invoice: updated };
  }

  /** Painel de prontidão: o que já está pronto e o que falta para emitir. */
  async readiness() {
    const [company, settings, products] = await Promise.all([this.prisma.company.findUnique({ where: { id: 'main' } }), this.settings(), this.prisma.product.findMany({ where: { active: true } })]);
    const ck = (settings.checklist ?? {}) as Record<string, any>, prod = settings.environment === 'PRODUCAO';
    const companyIssues: Issue[] = company ? validateCompany(this.companyIn(company)) : [erro('Empresa', 'Empresa não cadastrada')];
    const pending = products.map((p) => ({ sku: p.sku, name: p.name, issues: validateTax(productToTax(p), company?.crt ?? undefined, p.name).filter((i) => i.level === 'erro').map((i) => i.msg) })).filter((x) => x.issues.length);
    const tokenName = prod ? 'FOCUSNFE_TOKEN_PRODUCAO' : 'FOCUSNFE_TOKEN_HOMOLOGACAO';
    const checks = [
      { id: 'cnpj', label: 'CNPJ ativo', ok: !!company && cnpjOk(company.cnpj) && /ativa/i.test(company.status ?? ''), detail: company?.status ?? 'sem situação cadastral' },
      { id: 'ie', label: 'Inscrição estadual informada', ok: !!company?.stateRegistration },
      { id: 'ieHab', label: 'IE habilitada na SEFAZ para emitir NFC-e (confirmação manual)', ok: !!ck.ieHab },
      { id: 'crt', label: 'Regime tributário (CRT) definido', ok: !!company?.crt },
      { id: 'emitente', label: 'Endereço completo do emitente', ok: !companyIssues.some((i) => /endere|CEP|UF|Logradouro|Número|Bairro|Município/i.test(i.msg)) },
      { id: 'cert', label: 'Certificado digital A1/A3 instalado no provedor (manual)', ok: !!ck.cert, detail: ck.certVal ? `validade: ${ck.certVal}` : undefined },
      { id: 'credHom', label: 'Credenciamento na SEFAZ em homologação (manual)', ok: !!ck.credHom },
      { id: 'credProd', label: 'Credenciamento na SEFAZ em produção (manual)', ok: !!ck.credProd },
      { id: 'csc', label: 'CSC (ID e token) gerado na SEFAZ e cadastrado no provedor', ok: !!settings.cscId && !!ck.cscToken },
      { id: 'token', label: `Token do provedor no servidor (${tokenName})`, ok: !!process.env[tokenName] },
      { id: 'matriz', label: 'Matriz fiscal de todos os produtos ativos', ok: pending.length === 0, detail: pending.length ? `${pending.length} produto(s) incompleto(s)` : undefined },
    ];
    return { environment: settings.environment, provider: settings.provider, readyForHomologation: checks.filter((c) => c.id !== 'credProd').every((c) => c.ok), readyForProduction: checks.every((c) => c.ok), checks, pendingProducts: pending, companyIssues };
  }

  async saveSettings(body: any) {
    const b = body ?? {}, data: any = {};
    if (b.environment !== undefined) { if (!['HOMOLOGACAO', 'PRODUCAO'].includes(b.environment)) throw new UnprocessableEntityException('Ambiente inválido'); data.environment = b.environment; }
    if (b.provider !== undefined) { if (!['FOCUSNFE', 'NFEIO', 'MOCK'].includes(b.provider)) throw new UnprocessableEntityException('Provedor inválido'); data.provider = b.provider; }
    if (b.series !== undefined) { const n = Number(b.series); if (!Number.isInteger(n) || n < 1 || n > 999) throw new UnprocessableEntityException('Série inválida (1 a 999)'); data.series = n; }
    if (b.cscId !== undefined) { const v = String(b.cscId).trim(); if (v && !/^\d{1,6}$/.test(v)) throw new UnprocessableEntityException('ID do CSC deve ser numérico'); data.cscId = v || null; }
    if (b.checklist !== undefined && typeof b.checklist === 'object') data.checklist = b.checklist;
    if (data.environment === 'PRODUCAO') { const r = await this.readiness(); if (!r.readyForProduction) throw new ConflictException({ message: 'Ainda faltam itens para liberar a produção', checks: r.checks.filter((c) => !c.ok) }); }
    return this.prisma.fiscalSettings.upsert({ where: { id: 'main' }, update: data, create: { id: 'main', ...data } });
  }
}

const OPERACAO = ['GERENTE', 'FINANCEIRO', 'VENDEDOR', 'CAIXA', 'TECNICO_CAIXA'] as const;

@Controller('fiscal')
export class FiscalNfceController {
  constructor(private s: FiscalNfceService) {}
  @Roles('GERENTE', 'FINANCEIRO') @Get('readiness') readiness() { return this.s.readiness(); }
  @Roles('GERENTE', 'FINANCEIRO') @Get('settings') settings() { return this.s.settings(); }
  @Roles('GERENTE', 'FINANCEIRO') @Put('settings') save(@Body() b: unknown) { return this.s.saveSettings(b); }
  @Roles(...OPERACAO) @Get('sales/:id/nfce/preview') preview(@Param('id') id: string) { return this.s.preview(id); }
  @Roles(...OPERACAO) @Post('sales/:id/nfce/emit') emit(@Param('id') id: string, @Body() _b: unknown, @Req() req: { user: AuthUser }) { return this.s.emit(id, req.user); }
  @Roles(...OPERACAO) @Get('sales/:id/nfce/status') status(@Param('id') id: string) { return this.s.status(id); }
  @Roles('GERENTE') @Post('sales/:id/nfce/cancel') cancel(@Param('id') id: string, @Body() b: unknown, @Req() req: { user: AuthUser }) { return this.s.cancel(id, b, req.user); }
}
