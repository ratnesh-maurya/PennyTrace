// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `BankParserFactory.kt`, Indian parsers only, in upstream order.
// Order matters: the first parser whose canHandle() matches AND whose parse()
// returns a result wins (content-aware dispatch), e.g. HDFC MF before HDFC.

import type { BankParser } from './engine/BankParser';
import { HdfcMutualFundParser } from './banks/hdfcMutualFund';
import { NaviMutualFundParser } from './banks/naviMutualFund';
import { HdfcBankParser } from './banks/hdfc';
import { SbiBankParser } from './banks/sbi';
import { SaraswatBankParser } from './banks/saraswat';
import { DbsBankParser } from './banks/dbs';
import { IndianBankParser } from './banks/indianBank';
import { FederalBankParser } from './banks/federal';
import { JuspayParser } from './banks/juspay';
import { CashfreeParser } from './banks/cashfree';
import { SliceParser } from './banks/slice';
import { CredParser } from './banks/cred';
import { LazyPayParser } from './banks/lazypay';
import { UtkarshBankParser } from './banks/utkarsh';
import { IciciBankParser } from './banks/icici';
import { KarnatakaBankParser } from './banks/karnataka';
import { KeralaGraminBankParser } from './banks/keralaGramin';
import { KeralaBankParser } from './banks/keralaBank';
import { IdbiBankParser } from './banks/idbi';
import { JupiterBankParser } from './banks/jupiter';
import { AxisBankParser } from './banks/axis';
import { PnbBankParser } from './banks/pnb';
import { PunjabSindBankParser } from './banks/punjabSind';
import { CanaraBankParser } from './banks/canara';
import { BankOfBarodaParser } from './banks/bankOfBaroda';
import { BankOfIndiaParser } from './banks/bankOfIndia';
import { JioPaymentsBankParser } from './banks/jioPaymentsBank';
import { NsdlPaymentsBankParser } from './banks/nsdlPaymentsBank';
import { JanaSmallFinanceBankParser } from './banks/jana';
import { KotakBankParser } from './banks/kotak';
import { IdfcFirstBankParser } from './banks/idfcFirst';
import { UnionBankParser } from './banks/unionBank';
import { HsbcBankParser } from './banks/hsbc';
import { CentralBankOfIndiaParser } from './banks/centralBank';
import { SouthIndianBankParser } from './banks/southIndian';
import { JkBankParser } from './banks/jkBank';
import { JioPayParser } from './banks/jioPay';
import { IppbParser } from './banks/ippb';
import { CityUnionBankParser } from './banks/cityUnion';
import { IndianOverseasBankParser } from './banks/iob';
import { AirtelPaymentsBankParser } from './banks/airtelPaymentsBank';
import { IndusIndBankParser } from './banks/indusind';
import { AmexBankParser } from './banks/amex';
import { OneCardParser } from './banks/onecard';
import { PluxeeParser } from './banks/pluxee';
import { UcoBankParser } from './banks/uco';
import { AuBankParser } from './banks/auBank';
import { YesBankParser } from './banks/yes';
import { BandhanBankParser } from './banks/bandhan';
import { DhanlaxmiBankParser } from './banks/dhanlaxmi';
import { IndiaPostParser } from './banks/indiaPost';
import { StandardCharteredBankParser } from './banks/standardChartered';
import { EquitasBankParser } from './banks/equitas';
import { GreaterBankParser } from './banks/greaterBank';

export const BANK_PARSERS: readonly BankParser[] = [
  new HdfcMutualFundParser(),
  new NaviMutualFundParser(),
  new HdfcBankParser(),
  new SbiBankParser(),
  new SaraswatBankParser(),
  new DbsBankParser(),
  new IndianBankParser(),
  new FederalBankParser(),
  new JuspayParser(),
  new CashfreeParser(),
  new SliceParser(),
  new CredParser(),
  new LazyPayParser(),
  new UtkarshBankParser(),
  new IciciBankParser(),
  new KarnatakaBankParser(),
  new KeralaGraminBankParser(),
  new KeralaBankParser(),
  new IdbiBankParser(),
  new JupiterBankParser(),
  new AxisBankParser(),
  new PnbBankParser(),
  new PunjabSindBankParser(),
  new CanaraBankParser(),
  new BankOfBarodaParser(),
  new BankOfIndiaParser(),
  new JioPaymentsBankParser(),
  new NsdlPaymentsBankParser(),
  new JanaSmallFinanceBankParser(),
  new KotakBankParser(),
  new IdfcFirstBankParser(),
  new UnionBankParser(),
  new HsbcBankParser(),
  new CentralBankOfIndiaParser(),
  new SouthIndianBankParser(),
  new JkBankParser(),
  new JioPayParser(),
  new IppbParser(),
  new CityUnionBankParser(),
  new IndianOverseasBankParser(),
  new AirtelPaymentsBankParser(),
  new IndusIndBankParser(),
  new AmexBankParser(),
  new OneCardParser(),
  new PluxeeParser(),
  new UcoBankParser(),
  new AuBankParser(),
  new YesBankParser(),
  new BandhanBankParser(),
  new DhanlaxmiBankParser(),
  new IndiaPostParser(),
  new StandardCharteredBankParser(),
  new EquitasBankParser(),
  new GreaterBankParser(),
];

/** Every parser whose canHandle matches the sender, in priority order. */
export function parsersForSender(sender: string): BankParser[] {
  return BANK_PARSERS.filter(p => p.canHandle(sender));
}
