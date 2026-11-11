# Country Guide: South Africa (ZAR)

> **Checked:** 2026-11-11  
> **Status:** Researched & Verified  
> **Target Asset:** ZAR / USDC  
> **Primary Authority:** South African Reserve Bank (SARB) & Financial Sector Conduct Authority (FSCA)

---

## 1. Currency and Central Bank

### 1.1 Issuing Authority
The official currency of South Africa is the **South African Rand** (ISO 4217: `ZAR`, symbol: `R`), issued and managed exclusively by the [South African Reserve Bank (SARB)](https://www.resbank.co.za) under the [South African Reserve Bank Act 90 of 1989](https://www.resbank.co.za/en/home/what-we-do/financial-surveillance).

### 1.2 Exchange Control Framework (FinSurv)
Cross-border movements of money in and out of South Africa are strictly governed by the **Exchange Control Regulations of 1961** (promulgated under the Currency and Exchanges Act 9 of 1933) and administered by the SARB Financial Surveillance Department ([FinSurv](https://www.resbank.co.za/en/home/what-we-do/financial-surveillance)).

All fiat and digital asset inflows and outflows through commercial channels must interface with **Authorised Dealers** (commercial banks licensed to buy/sell foreign exchange) or Authorised Dealers in Foreign Exchange with Limited Authority (ADLAs):

1. **Single Discretionary Allowance (SDA)**:
   - South African resident individuals (18 years and older) are entitled to a discretionary allowance of **ZAR 1,000,000 per calendar year** ([SARB Exchange Control Manual, Section B.4](https://www.resbank.co.za/en/home/what-we-do/financial-surveillance/financial-surveillance-guidelines)).
   - No prior tax clearance from the [South African Revenue Service (SARS)](https://www.sars.gov.za) is required for transfers within this limit, but Authorised Dealers report all volumes to SARB’s Balance of Payments (BOP) database.
2. **Foreign Investment Allowance (FIA / Foreign Capital Allowance)**:
   - Residents may invest up to **ZAR 10,000,000 per calendar year** offshore.
   - Requires a prior **Tax Compliance Status (TCS) PIN** issued by SARS validating tax compliance and verification of source of funds.
3. **Cross-Border Crypto Asset Transfers**:
   - As per SARB FinSurv guidance, exporting capital by purchasing crypto assets locally with ZAR and transferring them to an unhosted or foreign hosted wallet constitutes an offshore capital export that falls squarely under an individual's SDA or FIA limits.
4. **Non-Resident Inflows & Repatriation**:
   - Foreign individuals and corporations may remit capital into South Africa freely without exchange control restrictions. Capital can be repatriated along with verified profits provided the original inward remittance was routed through an Authorised Dealer with standard BOP category reporting.

---

## 2. Digital Asset Regulation

### 2.1 The Regulatory Regime (FSCA & FAIS Act)
South Africa has established an active, functional licensing and supervision regime for crypto asset service providers:

- **Financial Product Declaration**: On 19 October 2022, the [Financial Sector Conduct Authority (FSCA)](https://www.fsca.co.za) published [General Notice 1350 of 2022](https://www.fsca.co.za/Regulatory%20Frameworks/Temp/FSCA%20General%20Notice%201350%20of%202022.pdf), officially declaring crypto assets as a **financial product** under Section 1(1) of the [Financial Advisory and Intermediary Services Act, 2002 (FAIS Act)](https://www.fsca.co.za).
- **CASP Licensing Requirement**: Entities offering advice, intermediary services, custody, or exchange/ramp services in respect of crypto assets are classified as **Crypto Asset Service Providers (CASPs)** and must hold an approved Financial Services Provider (FSP) license from the FSCA.
- **Current Licensing Status**: The FSCA commenced licensing approvals in 2024. Over **138 CASPs** (including major platforms like Luno, VALR, AltCoinTrader, Zignaly, and Ovex) operate under supervised Category I / Category II FSP licenses.

### 2.2 Anti-Money Laundering & Travel Rule (FIC)
- **Accountable Institution Designation**: The [Financial Intelligence Centre (FIC)](https://www.fic.gov.za) designated CASPs as Item 22 "Accountable Institutions" under Schedule 1 of the [Financial Intelligence Centre Act 38 of 2001 (FICA)](https://www.fic.gov.za/legislation/amendments-and-regulations).
- **Mandatory Reporting**: Cash transactions above **ZAR 24,999.99** must be reported to the FIC within 3 business days.
- **FATF Travel Rule Implementation**: In line with the Intergovernmental Fintech Working Group ([IFWG](https://www.ifwg.co.za)) and FATF Recommendation 16, CASPs are required to transmit originator and beneficiary information on all cross-border virtual asset transfers exceeding ZAR 25,000.

### 2.3 Taxation (SARS)
- The [South African Revenue Service (SARS)](https://www.sars.gov.za/types-of-tax/crypto-assets-tax/) does not view crypto assets as legal tender, but as assets subject to ordinary tax principles:
  - **Income Tax**: If held or traded on revenue account (short-term algorithmic trading, mining, yield).
  - **Capital Gains Tax (CGT)**: If held as a long-term capital investment (Eighth Schedule to the Income Tax Act).
  - **VAT Exemption**: Financial services involving crypto assets are exempt from Value-Added Tax under Section 12(a) of the VAT Act.

---

## 3. Payout Rails

South Africa possesses an advanced, highly centralized national payment infrastructure governed by the [Payments Association of South Africa (PASA)](https://www.pasa.org.za) under SARB oversight.

| Rail / System | Brand Name | Clearing Time | Typical Settlement Speed | Brand Names in Anchor `types` |
|---|---|---|---|---|
| **PayShap** (RPP) | `PayShap` | Real-time | < 10 seconds | `payshap`, `instant_payment`, `proxy_id` |
| **Real-Time Clearing (RTC)** | `Immediate Payment` / `RTC` / `Instant EFT` | Real-time | 10–60 seconds | `bank_transfer`, `instant_eft`, `rtc` |
| **Standard EFT** | `EFT` / `ACH Transfer` | Batch | 24–48 hours (business days) | `bank_transfer`, `eft` |
| **ATM Cash Out** | `eWallet`, `CashSend`, `Instant Money` | Instant voucher | Immediate at ATM | `cash_pickup`, `cash_voucher` |

### 3.1 PayShap (Rapid Payments Programme)
- Launched in March 2023 by [BankservAfrica](https://www.bankservafrica.com) and the SARB, PayShap is South Africa's modern low-value instant interbank rail.
- **Identifiers**: Supports account routing via standard account number + branch code, or via **ShapID** (a registered proxy identifier, predominantly a recipient's mobile phone number).
- **Core Characteristic**: Irrevocable real-time gross settlement via the SARB SAMOS core.

### 3.2 Real-Time Clearing (RTC / Immediate EFT)
- Available 24/7/365 across all tier-1 retail commercial banks (Standard Bank, First National Bank (FNB), Absa, Nedbank, Capitec, Discovery Bank, TymeBank, and Investec).
- The industry-standard rail for high-value on/off ramp fiat settlements.

### 3.3 Cash Vouchers (ATM Payouts)
- Widely used for informal or unbanked remittances. Senders initiate a withdrawal via mobile banking, generating a 10-digit PIN sent by SMS to the recipient, who collects cash at an ATM without a debit card.
- Commercial names: FNB eWallet, Absa CashSend, Standard Bank Instant Money, Nedbank Send-iMali.

---

## 4. KYC Requirements

Governed strictly by **FICA (Financial Intelligence Centre Act 38 of 2001)**:

### 4.1 Verification Artifacts
1. **Proof of Identity (PoI)**:
   - South African citizens/residents: 13-digit green barcoded ID book or South African Smart ID card.
   - Foreign nationals: Valid unexpired national passport with valid immigration/work endorsement.
2. **Proof of Residence (PoR)**:
   - Formal utility bill (water/electricity), municipal rates invoice, or formal bank statement dated within the preceding 3 months showing the physical residential address (PO Box addresses are explicitly disallowed under FICA).
3. **Biometric Liveness**:
   - Modern ramp interfaces in South Africa mandate automated selfie liveness matching against the Department of Home Affairs (DHA) National Population Register database.

### 4.2 Typical On/Off Ramp Tiering
- **Tier 1 (Basic / Micro-transactions)**: Mobile phone verification (RICA) + self-declared national ID. Payout limit capped at R3,000/day.
- **Tier 2 (Standard Retail)**: Verified government ID + biometric liveness. Limits up to R50,000–R100,000/month.
- **Tier 3 (Enhanced / Full FICA)**: Verified ID + verified Proof of Residence + source of wealth documentation. Unlocks annual limits up to the R1,000,000 SDA ceiling.

---

## 5. Typical Limits

| Rail | Min Transaction | Max Per Transaction | Daily Limit | Monthly / Annual Constraint |
|---|---|---|---|---|
| **PayShap** | R10.00 | **R3,000.00** (system cap) | R5,000 – R25,000 | Rail hard-capped at R3,000 per push |
| **Immediate EFT (RTC)** | R50.00 | R50,000 – R250,000 | R100,000 – R500,000 | Configurable per bank profile |
| **Standard EFT** | R1.00 | Bank account balance | R500,000+ | Subject to SDA (R1M) if cross-border |
| **Cardless ATM CashSend** | R50.00 | R3,000 – R5,000 | R3,000 – R5,000 | ATM dispense constraints |

---

## 6. Stellar Anchors Serving ZAR

Audit conducted on **2026-11-11** by direct resolution and inspection of `.well-known/stellar.toml` endpoints:

| Anchor / Domain | Advertised SEP Protocols | ZAR Asset Support | Verified Findings & Status |
|---|---|---|---|
| **`mykobo.co`** | `TRANSFER_SERVER_SEP0024` | ❌ None | Anchors EURC to EUR. No ZAR currency listed. |
| **`cowrie.exchange`** | `TRANSFER_SERVER` (SEP-6) | ❌ None | Issues NGNT (Nigerian Naira). Does not issue ZAR. |
| **`luno.com`** | None (Proprietary API) | ❌ None on Stellar | Licensed CASP in South Africa; operates proprietary off-chain APIs; does not publish public Stellar SEP endpoints. |
| **`valr.com`** | None (Proprietary API) | ❌ None on Stellar | Licensed CASP; operates high-liquidity order books via REST/WebSocket; does not publish public Stellar anchor endpoints. |
| **`yellowcard.io`** | SEP-31 (Partner API) | ❌ No SEP-24 | Operates OTC institutional cross-border corridors; does not publish a public `TRANSFER_SERVER_SEP0024` endpoint with ZAR fiat pairs on its public `stellar.toml`. |
| **`testanchor.stellar.org`** | `TRANSFER_SERVER_SEP0024` | ❌ Test assets only | SDF reference test anchor (USD/CAD). |

### Summary on Stellar ZAR Infrastructure
As of **2026-11-11**, **no live, production anchor currently advertises `TRANSFER_SERVER_SEP0024` with ZAR fiat settlement on Stellar mainnet**. 

This verifies the baseline stated in `backend/src/services/anchors.seed.ts`: South Africa remains a mock-adapter corridor until a licensed local CASP (or a regional player like Yellow Card/Luno) integrates and exposes a public SEP-24 interactive transfer server.

---

## 7. Implications for Slipway

### 7.1 Primary Payment Method Mapping
When designing the South African corridor adapter in Slipway:

- **`PaymentMethod.BANK_TRANSFER`** is the mandatory primary rail.
  - In South Africa, interbank EFT and Real-Time Clearing (RTC) account for the overwhelming majority of electronic value transfers.
  - The adapter must recognize local bank routing codes: South African banks utilize standard 6-digit universal branch codes (e.g., FNB: `250655`, Standard Bank: `051001`, Absa: `632005`, Nedbank: `198765`, Capitec: `470010`).
- **`PaymentMethod.INSTANT_PAYMENT`**:
  - Should map specifically to **PayShap** when the withdrawal amount is $\le \text{ZAR } 3,000$.
  - Receiver identification can accept either a standard bank account or a registered mobile proxy (`ShapID`).
- **`PaymentMethod.CASH_PICKUP`**:
  - If a future anchor partners with an ATM voucher aggregator (such as Stitch or Peach Payments), this maps to cardless cash send vouchers (eWallet / CashSend).

### 7.2 Polling Method & Latency
- **Default Corridor Poll Configuration**:
  - `country: 'ZA'`
  - `fiat: 'ZAR'`
  - `assetCode: 'USDC'`
  - `direction: 'withdraw'`
  - `pollMethod: 'bank_transfer'`
- **Polling Intervals**:
  - PayShap / RTC: 10–15 seconds (typical settlement occurs within 30 seconds).
  - Standard batch EFT: 30–60 seconds (with notifications alerting the user of standard next-business-day batch windows).

---

## 8. Primary Sources & References

1. **South African Reserve Bank (SARB)**:
   - [SARB Exchange Control Regulations](https://www.resbank.co.za/en/home/what-we-do/financial-surveillance) (Checked: 2026-11-11)
   - [Financial Surveillance Guidelines & Discretionary Allowances](https://www.resbank.co.za/en/home/what-we-do/financial-surveillance/financial-surveillance-guidelines) (Checked: 2026-11-11)
2. **Financial Sector Conduct Authority (FSCA)**:
   - [General Notice 1350 of 2022: Declaration of Crypto Assets as a Financial Product](https://www.fsca.co.za) (Checked: 2026-11-11)
   - [FSCA Register of Licensed Crypto Asset Service Providers (CASPs)](https://www.fsca.co.za/Firms/Pages/default.aspx) (Checked: 2026-11-11)
3. **Financial Intelligence Centre (FIC)**:
   - [FIC Act 38 of 2001 (FICA) Schedule 1 Accountable Institutions](https://www.fic.gov.za/legislation/amendments-and-regulations) (Checked: 2026-11-11)
4. **BankservAfrica & National Payment System**:
   - [BankservAfrica PayShap Product Specifications](https://www.bankservafrica.com) (Checked: 2026-11-11)
   - [Payments Association of South Africa (PASA) Clearing Rules](https://www.pasa.org.za) (Checked: 2026-11-11)
5. **South African Revenue Service (SARS)**:
   - [SARS Crypto Assets Tax Compliance Guidance](https://www.sars.gov.za/types-of-tax/crypto-assets-tax/) (Checked: 2026-11-11)
6. **Stellar Anchor TOML Endpoints**:
   - `https://testanchor.stellar.org/.well-known/stellar.toml` (Checked: 2026-11-11)
   - `https://mykobo.co/.well-known/stellar.toml` (Checked: 2026-11-11)
   - `https://cowrie.exchange/.well-known/stellar.toml` (Checked: 2026-11-11)
