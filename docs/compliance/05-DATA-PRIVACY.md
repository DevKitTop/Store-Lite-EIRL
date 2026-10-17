# Data Privacy

## Objective

Purpose.

---

## Scope

This document covers the minimum privacy controls needed for handling personal data in Store Lite.

This document does not replace a full privacy program or final legal drafting.

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
- [02-LEGAL-CHECKLIST-PERU.md](02-LEGAL-CHECKLIST-PERU.md)
- [04-SECURITY-CHECKLIST.md](04-SECURITY-CHECKLIST.md)
- [13-ACCOUNT-DELETION.md](13-ACCOUNT-DELETION.md)
- [14-USER-CONSENT.md](14-USER-CONSENT.md)

---

## Checklist

- [ ] Identify the personal data categories processed by the MVP.
- [ ] Confirm which data is required for core product functionality.
- [ ] Confirm that sensitive data is minimized and stored securely.
- [ ] Confirm data retention and deletion handling is documented.
- [ ] Confirm privacy-relevant access is limited and logged.
- [ ] Confirm a process exists for handling privacy-related requests.

---

## Risk

- Legal Risk: Privacy obligations may apply to the data processed by the product.
- Technical Risk: Excessive data collection or weak access controls can increase incident impact.
- Operational Risk: Lack of documented data handling can delay support and legal response.

---

## Implementation

### Code

- Backend: Minimize collection and enforce access restrictions.
- Frontend: Avoid unnecessary personal data exposure in UI and logs.
- Database: Review schema design for data minimization and retention.
- API: Ensure requests and responses do not expose unnecessary personal data.

### Platform

- Supabase: Review database roles and storage access.
- Storage: Confirm file uploads are reviewed for sensitivity.
- Environment Variables: Ensure privacy-relevant secrets are not exposed.

### Documentation

- Placeholder: Data inventory for MVP personal data.
- Placeholder: Retention schedule for customer and order data.
- Placeholder: Privacy request handling note.

### Process

- Manual: Review new personal data fields before release.
- Manual: Review data deletion and export requests.
- Manual: Maintain a simple privacy review checklist for product changes.

---

## Pending Questions

- Which personal data categories will be processed by the MVP?
- What retention periods will be adopted for customer, order, and payment-related data?
- Who will handle privacy requests during launch?

---

## Decisions

- None yet.

---

## Notes

Validation note: privacy obligations and required controls should be validated by qualified legal counsel for the operating model and jurisdiction.
