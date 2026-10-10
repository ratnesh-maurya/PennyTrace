import { formatINR, parseAmountToPaise } from '../money';
import { fingerprint } from '../sms/fingerprint';

describe('money', () => {
  it('parses Indian grouped amounts into paise', () => {
    expect(parseAmountToPaise('Rs.1,23,456.7')).toBe(12345670);
    expect(parseAmountToPaise('INR 349')).toBe(34900);
    expect(parseAmountToPaise('no number')).toBeUndefined();
  });

  it('formats with en-IN grouping and a true minus sign', () => {
    expect(formatINR(4946000)).toBe('₹49,460');
    expect(formatINR(-274000)).toBe('−₹2,740');
    expect(formatINR(400000, { signed: true })).toBe('+₹4,000');
  });
});

describe('fingerprint', () => {
  it('ignores operator prefix and whitespace differences', () => {
    expect(fingerprint('AX-HDFCBK-S', 'Rs 10  debited')).toBe(fingerprint('VM-HDFCBK', 'Rs 10 debited'));
    expect(fingerprint('AX-HDFCBK', 'Rs 10 debited')).not.toBe(fingerprint('AX-HDFCBK', 'Rs 11 debited'));
  });
});
