# Legal Checklist Peru

## Objective

Purpose.

---

## Scope

This document captures the minimum legal review areas relevant to Store Lite as an MVP operating in Peru.

This document does not replace legal advice or final legal drafting.

---

## Priority

- Critical
- Important
- Future

---

## Status

- In Progress

---

## Related Documents

- [00-COMPLIANCE-INDEX.md](00-COMPLIANCE-INDEX.md)
- [05-DATA-PRIVACY.md](05-DATA-PRIVACY.md)
- [06-CONSUMER-PROTECTION.md](06-CONSUMER-PROTECTION.md)
- [07-PAYMENTS-AND-BILLING.md](07-PAYMENTS-AND-BILLING.md)

---

## Checklist

- [ ] Engage a qualified legal reviewer to validate Peruvian obligations.
- [ ] Confirm whether customer-facing disclosures are required for the MVP.
- [ ] Confirm whether payment and billing disclosures are required for the payment flow used.
- [ ] Confirm whether data handling notices are required for personal data processing.
- [ ] Confirm available complaint and support handling processes for customers.
- [ ] Validate whether any local registration or formal compliance step is required for the operating model.

---

## Risk

- Legal Risk: Unverified obligations may create material legal exposure.
- Technical Risk: Product changes may be required after legal review.
- Operational Risk: Missing legal validation may delay launch or increase remediation cost.

---

## Implementation

### Code

- Backend: Ensure legal-required disclosures can be surfaced from controlled product flows when required.
- Frontend: Ensure customer-facing notices can be presented in a consistent, reviewable manner.
- API: Ensure logs and records necessary for dispute or complaint handling are retained in a controlled way.

### Platform

- Domain: Confirm the production domain and contact channels are appropriate for customer communication.
- Payment Gateway: Confirm vendor documentation and support procedures are available.
- Environment Variables: Confirm secrets and approved configuration for legal-required communications are managed safely.

### Documentation

- Placeholder: Legal review memo for Peru.
- Placeholder: Customer complaint handling procedure.
- Placeholder: Disclosure review log.

### Process

- Manual: Coordinate legal validation before production release.
- Manual: Review the launch checklist against legal guidance.
- Manual: Keep a record of legal questions and answers.

---

## Pending Questions

- Which legal reviewer will validate the MVP before production?
- Which customer-facing disclosures are required for the intended product scope?
- Which local operational obligations apply to the chosen business model?

---

## Decisions

- None yet.

---

## Notes

Validation note: Peru-specific legal obligations should be independently verified by qualified counsel before launch.
