export const STOREFRONT_FONT_OPTIONS = [
  {
    value: 'google-sans',
    label: 'Predeterminado',
    description: 'Google Sans',
    cssValue:
      "var(--font-google-sans-flex), 'Google Sans', var(--mio-theme-text-font-family), sans-serif",
  },
  {
    value: 'inter',
    label: 'Inter',
    description: 'Inter',
    cssValue: 'var(--font-storefront-inter), var(--mio-theme-text-font-family), sans-serif',
  },
  {
    value: 'roboto',
    label: 'Roboto',
    description: 'Roboto',
    cssValue: 'var(--font-storefront-roboto), var(--mio-theme-text-font-family), sans-serif',
  },
  {
    value: 'poppins',
    label: 'Poppins',
    description: 'Poppins',
    cssValue: 'var(--font-storefront-poppins), var(--mio-theme-text-font-family), sans-serif',
  },
] as const satisfies readonly {
  value: string;
  label: string;
  description: string;
  cssValue: string;
}[];

export type StorefrontFontFamily = (typeof STOREFRONT_FONT_OPTIONS)[number]['value'];

export function isStorefrontFontFamily(value: unknown): value is StorefrontFontFamily {
  return (
    typeof value === 'string' && STOREFRONT_FONT_OPTIONS.some((option) => option.value === value)
  );
}

export function resolveStorefrontFontFamily(fontFamily: StorefrontFontFamily): string {
  return (
    STOREFRONT_FONT_OPTIONS.find((option) => option.value === fontFamily)?.cssValue ??
    STOREFRONT_FONT_OPTIONS[0].cssValue
  );
}
