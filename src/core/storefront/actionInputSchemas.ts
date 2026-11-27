import { z } from 'zod';

export const STOREFRONT_THEME_PAYLOAD_MAX_BYTES = 50_000;

function serializedByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? Number.POSITIVE_INFINITY : serialized.length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export const businessSlugLengthSchema = z.string().min(10).max(30);

export const businessSlugCharactersSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .refine((slug) => !slug.endsWith('-'), {
    message: 'Business slug must not end with a hyphen.',
  });

export const storefrontSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const storefrontColorSchemeSchema = z.enum(['light', 'dark']);

export const storefrontThemePayloadSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Theme payload must not be empty.',
      });
      return;
    }

    if (serializedByteLength(value) > STOREFRONT_THEME_PAYLOAD_MAX_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Theme payload exceeds the maximum allowed size.',
      });
    }
  });
