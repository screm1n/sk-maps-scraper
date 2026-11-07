/**
 * Lead score 0..100. Computed on read, never stored: changing a weight reorders the whole
 * queue instantly. `fatores` lets the UI explain every point.
 */

export const PESOS = {
  camadaA: 30,
  camadaB: 40, // above A on purpose: has an audience and social proof for the pitch
  siteFraco: 15,
  celular: 15,
  fixo: 5,
  semTelefone: -30,
  avaliacoesPoucas: 10,
  avaliacoesMedias: 15,
  avaliacoesMuitas: 20,
  notaAlta: 10,
  comEmail: 5,
  naoReivindicado: 12,
};

/**
 * @param {{camada: string, siteFraco?: boolean, tipoTelefone: string|null, qtdAvaliacoes: number,
 *          nota: number|null, temEmail?: boolean}} lead
 */
export function notaDoLead(lead, pesos = PESOS) {
  // A real own website leaves the queue: not a lead, already served.
  if (lead.camada === "C" && !lead.siteFraco) {
    return { total: 0, fatores: [{ nome: "camada", pontos: 0, detalhe: "tem site próprio" }] };
  }

  const fatores = [];
  const add = (nome, pontos, detalhe) => { if (pontos) fatores.push({ nome, pontos, detalhe }); };

  if (lead.camada === "A") add("camada", pesos.camadaA, "sem nenhuma presença online");
  else if (lead.camada === "B") add("camada", pesos.camadaB, "rede social ou agendamento, sem site");
  else add("camada", pesos.siteFraco, "site em hospedagem gratuita");

  if (lead.tipoTelefone === "celular") add("telefone", pesos.celular, "celular, dá WhatsApp");
  else if (lead.tipoTelefone === "indefinido") add("telefone", pesos.celular - 5, "número que pode ter WhatsApp");
  else if (lead.tipoTelefone === "fixo") add("telefone", pesos.fixo, "só telefone fixo");
  else add("telefone", pesos.semTelefone, "sem telefone utilizável");

  const av = lead.qtdAvaliacoes || 0;
  if (av > 100) add("avaliacoes", pesos.avaliacoesMuitas, `${av} avaliações, negócio rodando`);
  else if (av > 20) add("avaliacoes", pesos.avaliacoesMedias, `${av} avaliações`);
  else if (av >= 1) add("avaliacoes", pesos.avaliacoesPoucas, `${av} avaliações`);

  if (lead.nota != null && lead.nota >= 4.3) add("nota", pesos.notaAlta, `nota ${lead.nota}, negócio bom sem site`);
  if (lead.temEmail) add("email", pesos.comEmail, "tem e-mail, dá pra seguir por e-mail");
  if (lead.naoReivindicado) add("google", pesos.naoReivindicado, "ficha do Google sem dono, ninguém cuida");

  const bruto = fatores.reduce((s, f) => s + f.pontos, 0);
  return { total: Math.max(0, Math.min(100, bruto)), fatores };
}
