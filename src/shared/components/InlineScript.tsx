'use client';

/**
 * An inline script that survives hydration without React's warning.
 *
 * React 19 warns when it renders a `<script>` on the client: a script inserted
 * by React never executes. That is a real warning for dynamically added
 * scripts, and noise for this one — an inline boot script that must run while
 * the browser parses `<head>`, before the first paint.
 *
 * Next's documented pattern for it: emit `type="text/javascript"` on the
 * server, where the HTML parser executes it, and `type="text/plain"` during the
 * client render, where it must do nothing. `suppressHydrationWarning` covers the
 * type difference between the two.
 *
 * See "Preventing flash before hydration" in the Next.js docs.
 */
export function InlineScript({ html, nonce }: { html: string; nonce?: string }) {
  return (
    <script
      type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
