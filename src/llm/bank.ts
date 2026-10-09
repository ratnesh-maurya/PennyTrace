/**
 * Sender → bank id, for LLM-parsed and template-parsed events. Pure.
 * A deliberately small map: bank parsers in src/core own the real detection.
 */

/** `AX-HDFCBK-S` / `VM-HDFCBK` / `HDFCBK` → `HDFCBK`; `+919812345678` → `9812345678`. */
export function senderKey(address: string): string {
  const upper = address.trim().toUpperCase();
  const parts = upper.split('-');
  if (parts.length >= 2 && /^[A-Z0-9]{2}$/.test(parts[0])) {
    return parts[1];
  }
  return upper.replace(/^\+?91(?=\d{10}$)/, '');
}

/** Checked in order; first substring hit wins. */
const SENDER_BANKS: readonly [string, string][] = [
  ['HDFC', 'hdfc'],
  ['ICICI', 'icici'],
  ['SBI', 'sbi'],
  ['AXIS', 'axis'],
  ['KOTAK', 'kotak'],
  ['IDFC', 'idfc'],
  ['YESB', 'yes'],
  ['INDUS', 'indusind'],
  ['FEDBNK', 'federal'],
  ['FEDERAL', 'federal'],
  ['PNB', 'pnb'],
  ['BOB', 'bob'],
  ['BARODA', 'bob'],
  ['CANBNK', 'canara'],
  ['CANARA', 'canara'],
  ['UNIONB', 'union'],
  ['IDBI', 'idbi'],
  ['RBL', 'rbl'],
  ['AUBANK', 'au'],
  ['AUSFB', 'au'],
  ['PAYTM', 'paytm'],
  ['AIRBNK', 'airtel'],
  ['JUPITR', 'jupiter'],
  ['FIBANK', 'fi'],
  ['BOIIND', 'boi'],
  ['CENTBK', 'central'],
  ['IOBCHN', 'iob'],
  ['INDBNK', 'indian'],
];

export function bankFromSender(address: string): string {
  const key = senderKey(address);
  for (const [needle, bank] of SENDER_BANKS) {
    if (key.includes(needle)) {
      return bank;
    }
  }
  return 'unknown';
}
