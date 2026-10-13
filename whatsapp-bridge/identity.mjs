// Comparação restrita ao celular brasileiro antigo (8 dígitos) e ao mesmo
// celular com o nono dígito. Não remover dígitos de LIDs, fixos ou outros países.
const ddds = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
export function canonicalNumber(number) {
  if (typeof number !== 'string') return '';
  const match = /^55(\d{2})9([6-9]\d{7})$/.exec(number);
  return match && ddds.has(match[1]) ? '55'+match[1]+match[2] : number;
}
export const normalizeJid = jid => typeof jid === 'string' ? jid.replace(/:\d+(?=@)/,'') : '';
export function identityJid(jid) {
  const value = normalizeJid(jid);
  const match = /^(\d+)@s\.whatsapp\.net$/.exec(value);
  return match ? canonicalNumber(match[1])+'@s.whatsapp.net' : value;
}
export function numberVariants(number) {
  const canonical = canonicalNumber(number);
  const match = /^55(\d{2})([6-9]\d{7})$/.exec(canonical);
  return [...new Set([number,canonical,...(match && ddds.has(match[1]) ? ['55'+match[1]+'9'+match[2]] : [])])];
}
