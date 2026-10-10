import type { RawSms } from '../../types';
import { dltCategory, gateSms } from '../filter';

const sms = (body: string, address = 'AX-HDFCBK-S'): RawSms => ({ id: '1', address, body, date: 0 });

describe('dltCategory', () => {
  it('reads the TRAI suffix', () => {
    expect(dltCategory('AX-HDFCBK-S')).toBe('S');
    expect(dltCategory('VM-SBIUPI-T')).toBe('T');
    expect(dltCategory('JD-AMAZON-P')).toBe('P');
    expect(dltCategory('CP-GOVTIN-G')).toBe('G');
    expect(dltCategory('VM-HDFCBK')).toBeUndefined();
    expect(dltCategory('+919876543210')).toBeUndefined();
  });
});

describe('gateSms', () => {
  it('keeps transaction alerts from -S / -T / legacy senders', () => {
    const body = 'Rs.349.00 debited from a/c **1234 on 08-10-26 to VPA shop@okaxis (UPI Ref No 123456789012)';
    expect(gateSms(sms(body, 'AX-HDFCBK-S'))).toEqual({ keep: true });
    expect(gateSms(sms(body, 'VM-HDFCBK-T'))).toEqual({ keep: true });
    expect(gateSms(sms(body, 'VM-HDFCBK'))).toEqual({ keep: true });
  });

  it('drops promotional (-P) and government (-G) senders', () => {
    const body = 'Rs.349.00 debited from a/c **1234';
    expect(gateSms(sms(body, 'AX-HDFCBK-P'))).toEqual({ keep: false, reason: 'promo_sender' });
    expect(gateSms(sms(body, 'VK-GOVTIN-G'))).toEqual({ keep: false, reason: 'promo_sender' });
  });

  it('drops OTPs', () => {
    expect(
      gateSms(sms('123456 is your OTP for txn of Rs 500.00 at AMAZON on HDFC Bank card XX1234. Do not share.')),
    ).toEqual({
      keep: false,
      reason: 'otp',
    });
    expect(
      gateSms(
        sms('Your Amex SafeKey One-Time Password for INR 213.50, at X CORP- PAID FEATURES is 000000.', 'TX-MYAMEX-S'),
      ),
    ).toEqual({ keep: false, reason: 'otp' });
    expect(gateSms(sms('OTP for transaction of Rs.1,200 to be debited from a/c XX1234 is 482910'))).toEqual({
      keep: false,
      reason: 'otp',
    });
  });

  it('keeps a real debit whose footer warns about OTPs', () => {
    expect(
      gateSms(
        sms('Rs.500 debited from A/c XX1234 on 13Sep25 to SHOP. Never share your OTP with anyone. -SBI', 'VM-SBIINB-S'),
      ),
    ).toEqual({ keep: true });
  });

  it('drops promotions', () => {
    expect(
      gateSms(sms('Get up to Rs.5,00,000 instant loan at 10.5%! Apply now: https://x.example', 'AX-HDFCBK-S')),
    ).toEqual({
      keep: false,
      reason: 'promotional',
    });
    expect(gateSms(sms('Exclusive offer: 10% discount up to Rs 1500 on your credit card this weekend'))).toEqual({
      keep: false,
      reason: 'promotional',
    });
  });

  it('drops payment requests', () => {
    expect(
      gateSms(
        sms('JOHN DOE has requested money from you on Google Pay. On approving, Rs 500 will be debited from your a/c'),
      ),
    ).toEqual({ keep: false, reason: 'payment_request' });
    expect(gateSms(sms('You have a UPI collect request of Rs.250.00 from shop@ybl. Approve in your UPI app.'))).toEqual(
      {
        keep: false,
        reason: 'payment_request',
      },
    );
  });

  it('drops due reminders and future debits', () => {
    expect(
      gateSms(
        sms(
          'Payment of INR 1577 on Kotak Credit Card xx2222 is due on 13-07-26. Min due: INR 100. Ignore if paid',
          'VM-KOTAKB-S',
        ),
      ),
    ).toEqual({ keep: false, reason: 'reminder' });
    expect(gateSms(sms('Your HDFC Bank Credit Card bill of Rs.12,345.00 is due on 05-11-26. Pay now.'))).toEqual({
      keep: false,
      reason: 'reminder',
    });
    expect(
      gateSms(
        sms('INR 587.64 for Airtel will be auto-debited via Axis Bank Card no. XX1234 by 27-07-26.', 'AD-AXISBK-S'),
      ),
    ).toEqual({ keep: false, reason: 'reminder' });
    expect(gateSms(sms('Rs.199.00 will be debited from your a/c XX1234 on 01-11-26 for NETFLIX mandate'))).toEqual({
      keep: false,
      reason: 'reminder',
    });
  });

  it('keeps a payment that mentions a due date', () => {
    expect(
      gateSms(sms('Sent Rs.5000.00 from HDFC Bank A/C *1234 to LOAN CO for EMI due on 05-11-26. Ref 123456789012')),
    ).toEqual({
      keep: true,
    });
  });

  it('drops non-financial messages and fund blocks', () => {
    expect(gateSms(sms('Your account statement for September is ready. Login to NetBanking to view.'))).toEqual({
      keep: false,
      reason: 'non_financial',
    });
    expect(
      gateSms(
        sms(
          'Your ASBA application for ACME IPO is received and Application value of Rs 14972 is blocked in your account',
          'AD-IDFCFB-S',
        ),
      ),
    ).toEqual({ keep: false, reason: 'non_financial' });
  });

  it('keeps balance-only messages', () => {
    expect(gateSms(sms('Available Bal in HDFC Bank A/c XX1234 as on 08-OCT-26 is INR 12,345.67'))).toEqual({
      keep: true,
    });
  });
});

describe('spam that imitates a credit alert', () => {
  const sms = (address: string, body: string) => ({ id: '1', address, body, date: 0 });
  it.each([
    ['ABLOAN', 'Looking for cash? Get Loan of Rs 5 Lac Instantly credited to your account. Install Now'],
    [
      'BAJEMIP',
      'Congrats! Your Insta EMI Card limit is upgraded 7 cr+ card users | Up to ₹3,00,000 | EMIs from ₹999 | No Annual Fee Claim now !',
    ],
    [
      'RUMMYC',
      'Congrats 9000000000, Rs.65,000 is Credited to your A/C. Join Now to Withdraw directly: https://example.in/x',
    ],
    ['BP-MFYNEW', 'Dear Customer, Your Account can be credited with Rs.100000 Check Balance:- example.in/x MFNEWA'],
    [
      'QP-PRUCSH',
      'Payment Received? Amount of Rs.90594 can be successfully Transferred in your Rummy Account on 25 Nov. Register to withdraw now',
    ],
    [
      'VK-GAMERM',
      'Dear Customer, Rs.10,000 is credited to your wallet a/c, Your Ref.id - 347XXX Download Rush App T&C Apply',
    ],
    [
      'QP-MYELEV',
      'Dear, Rs.1500 Welcome Bonus credited to My11circle account. IND vs SL T20 Match. Prize Pool - Rs.2,57,00,000',
    ],
  ])('%s is dropped', (address, body) => {
    expect(gateSms(sms(address, body))).toEqual({ keep: false, reason: 'promotional' });
  });

  it('keeps real alerts that mention loans or withdrawals', () => {
    expect(
      gateSms(
        sms('VM-HDFCBK-S', 'Rs.5000.00 debited from A/c XX1234 on 05-10-26 towards LOAN EMI. Avl bal INR 9,000.00'),
      ).keep,
    ).toBe(true);
    expect(
      gateSms(
        sms('VD-BOBTXN', 'Rs.1500 withdrawn from A/c ...1234 at ATM TID X1/C Ref.123456789012 Avlbl Amt:Rs.9000.07'),
      ).keep,
    ).toBe(true);
  });
});
