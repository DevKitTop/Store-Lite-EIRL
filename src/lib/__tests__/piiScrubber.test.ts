import { describe, expect, it } from 'vitest';

import { scrubPII } from '../piiScrubber';

describe('scrubPII', () => {
  describe('email scrubbing', () => {
    it('redacts email address in a string', () => {
      const result = scrubPII('User email: test@example.com');
      expect(result).toBe('User email: [REDACTED_EMAIL]');
    });

    it('redacts multiple email addresses', () => {
      const result = scrubPII('Contact a@b.com or c@d.org');
      expect(result).toBe('Contact [REDACTED_EMAIL] or [REDACTED_EMAIL]');
    });

    it('handles emails with subdomains', () => {
      const result = scrubPII('mail user@mail.example.co.uk');
      expect(result).toBe('mail [REDACTED_EMAIL]');
    });

    it('handles emails with plus addressing', () => {
      const result = scrubPII('send to user+tag@domain.com');
      expect(result).toBe('send to [REDACTED_EMAIL]');
    });
  });

  describe('phone scrubbing', () => {
    it('redacts international phone number', () => {
      const result = scrubPII('Call +1234567890');
      expect(result).toBe('Call [REDACTED_PHONE]');
    });

    it('redacts phone number with dashes', () => {
      const result = scrubPII('Phone: 123-456-7890');
      expect(result).toBe('Phone: [REDACTED_PHONE]');
    });

    it('redacts phone number with parentheses', () => {
      const result = scrubPII('Call (123) 456-7890');
      expect(result).toBe('Call [REDACTED_PHONE]');
    });

    it('redacts phone with spaces', () => {
      const result = scrubPII('Dial +1 234 567 890');
      expect(result).toBe('Dial [REDACTED_PHONE]');
    });
  });

  describe('object scrubbing', () => {
    it('scrubs PII from object values', () => {
      const data = { message: 'User test@example.com logged in' };
      const result = scrubPII(data);
      expect(result).toEqual({ message: 'User [REDACTED_EMAIL] logged in' });
    });

    it('scrubs PII from nested object values', () => {
      const data = {
        context: {
          email: 'user@company.org',
          action: 'login',
        },
      };
      const result = scrubPII(data);
      expect(result).toEqual({
        context: {
          email: '[REDACTED_EMAIL]',
          action: 'login',
        },
      });
    });

    it('handles mixed PII types in one object', () => {
      const data = {
        msg: 'Contact a@b.com or call +1234567890',
      };
      const result = scrubPII(data);
      expect(result).toEqual({
        msg: 'Contact [REDACTED_EMAIL] or call [REDACTED_PHONE]',
      });
    });
  });

  describe('edge cases', () => {
    it('returns non-string non-object input unchanged', () => {
      expect(scrubPII(42)).toBe(42);
      expect(scrubPII(null)).toBe(null);
      expect(scrubPII(undefined)).toBe(undefined);
    });

    it('returns string with no PII unchanged', () => {
      expect(scrubPII('Hello world')).toBe('Hello world');
    });

    it('returns object with no PII unchanged', () => {
      const data = { action: 'click', count: 5 };
      expect(scrubPII(data)).toEqual(data);
    });

    it('does not treat fake emails without TLD as emails', () => {
      const result = scrubPII('Not an email: @broken');
      expect(result).toBe('Not an email: @broken');
    });
  });

  describe('identifier preservation (B-07)', () => {
    it('does not corrupt a UUID', () => {
      const uuid = '650e8400-e29b-41d4-a716-446655440001';
      expect(scrubPII(`sale ${uuid} fulfilled`)).toBe(`sale ${uuid} fulfilled`);
    });

    it('keeps a UUID while still redacting a phone in the same message', () => {
      const uuid = '44665544-0001-4000-8000-000000000000';
      expect(scrubPII(`biz ${uuid} call 123-456-7890`)).toBe(`biz ${uuid} call [REDACTED_PHONE]`);
    });

    it('keeps multiple UUIDs distinct and ordered', () => {
      const a = '11111111-1111-4111-8111-111111111111';
      const b = '22222222-2222-4222-8222-222222222222';
      expect(scrubPII(`${a} / ${b}`)).toBe(`${a} / ${b}`);
    });

    it('preserves UUIDs inside object values', () => {
      const uuid = '9f8e7d6c-5b4a-4321-8100-123456789abc';
      const result = scrubPII({ businessId: uuid, email: 'a@b.com' });
      expect(result).toEqual({ businessId: uuid, email: '[REDACTED_EMAIL]' });
    });

    // Regression: protecting a UUID BEFORE scrubbing emails broke EMAIL_REGEX
    // because the placeholder's `<`/`>` are not local-part legal, so an email
    // whose local part embedded a UUID leaked verbatim. Order is now
    // email-first, and these pin it.
    describe('does not under-redact emails that embed a UUID', () => {
      const uuid = '650e8400-e29b-41d4-a716-446655440001';

      it('redacts an email whose local part is a UUID', () => {
        expect(scrubPII(`${uuid}@example.com`)).toBe('[REDACTED_EMAIL]');
      });

      it('redacts ticket-<uuid>@domain and support+<uuid>@domain', () => {
        expect(scrubPII(`ticket-${uuid}@example.com`)).toBe('[REDACTED_EMAIL]');
        expect(scrubPII(`support+${uuid}@example.com`)).toBe('[REDACTED_EMAIL]');
      });

      it('redacts a UUID-local email inside object values', () => {
        expect(scrubPII({ contact: `${uuid}@example.com` })).toEqual({
          contact: '[REDACTED_EMAIL]',
        });
      });

      it('preserves a literal placeholder-looking token instead of deleting it', () => {
        expect(scrubPII('note <<<UUID_0>>> here')).toBe('note <<<UUID_0>>> here');
      });
    });
  });
});
