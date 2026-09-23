// Provedores de Pix. Interface:
//   createCharge({ txid, valor, descricao, expiresMinutes }) -> { txid, copiaECola }
//   getStatus(txid) -> 'pendente' | 'pago' | 'expirado' | 'falhou'
//   parseWebhook(body) -> { txid }  (o status é SEMPRE reconfirmado via getStatus)
//
// >>> O adaptador "http" é o ponto para plugar a sua API de Pix. Ajuste os 3 métodos
// >>> abaixo (URLs e nomes de campos) conforme a documentação dela.
import { config } from '../config.js';

// ---------------- Sua API de Pix ----------------
const httpProvider = {
  name: 'http',
  async createCharge({ txid, valor, descricao, expiresMinutes }) {
    const r = await fetch(`${config.pix.apiUrl}/cobrancas`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.pix.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid, valor: valor.toFixed(2), descricao, expiracao: expiresMinutes * 60 }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Pix API ${r.status}: ${data.message || JSON.stringify(data)}`);
    return { txid: data.txid || txid, copiaECola: data.pixCopiaECola || data.copia_e_cola || data.qrcode };
  },
  async getStatus(txid) {
    const r = await fetch(`${config.pix.apiUrl}/cobrancas/${encodeURIComponent(txid)}`, {
      headers: { Authorization: `Bearer ${config.pix.apiKey}` },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Pix API ${r.status}`);
    const s = String(data.status || '').toUpperCase();
    if (['CONCLUIDA', 'PAGA', 'PAID', 'APPROVED', 'RECEIVED'].includes(s)) return 'pago';
    if (['EXPIRADA', 'EXPIRED'].includes(s)) return 'expirado';
    if (s.startsWith('REMOVIDA') || ['CANCELED', 'FAILED'].includes(s)) return 'falhou';
    return 'pendente';
  },
  parseWebhook(body) {
    // Padrão BACEN: { pix: [{ txid, ... }] }; outros: { txid } ou { data: { txid } }
    const txid = body?.pix?.[0]?.txid || body?.txid || body?.data?.txid;
    return { txid };
  },
};

// ---------------- Mock (desenvolvimento) ----------------
const paid = new Set();
function crc16(str) {
  let crc = 0xffff;
  for (const c of Buffer.from(str, 'utf8')) {
    crc ^= c << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
const mockProvider = {
  name: 'mock',
  async createCharge({ txid, valor }) {
    const mai = tlv('00', 'br.gov.bcb.pix') + tlv('01', 'teste@xpointsolucoes.com.br');
    let p = tlv('00', '01') + tlv('26', mai) + tlv('52', '0000') + tlv('53', '986') + tlv('54', valor.toFixed(2))
      + tlv('58', 'BR') + tlv('59', 'MODELAGEM 3D TESTE') + tlv('60', 'CAMPINAS') + tlv('62', tlv('05', txid.slice(0, 25))) + '6304';
    p += crc16(p);
    return { txid, copiaECola: p };
  },
  async getStatus(txid) { return paid.has(txid) ? 'pago' : 'pendente'; },
  parseWebhook(body) { return { txid: body?.txid }; },
  simulatePaid(txid) { paid.add(txid); },
};

export function getPixProvider() {
  if (config.pix.provider === 'http') {
    if (!config.pix.apiUrl) throw new Error('PIX_API_URL não configurada');
    return httpProvider;
  }
  return mockProvider;
}
