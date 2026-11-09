// =====================================================
// CHAT-ONLY AUTH CALLBACK ROUTE HANDLER
// =====================================================
// Description: Minimal OAuth callback for chat customers.
// ONLY exchanges the code for a session and redirects
// back to the store. NO profile creation, NO business
// queries, NO onboarding redirects.
//
// Usage: Called by Supabase after Google OAuth from
// ChatDialog's "Continue with Google" button
// =====================================================

import { logger, toErrorDetail } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const slug = requestUrl.searchParams.get('slug');
  const origin = requestUrl.origin;

  // No code means something went wrong — just go back to the store
  if (!code || !slug) {
    logger.warn('ChatCallback: missing code or slug, redirecting to store', {
      code: !!code,
      slug,
    });
    return NextResponse.redirect(`${origin}/${slug ?? ''}`);
  }

  const supabase = await createClient();

  // Exchange the OAuth code for a Supabase session
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    logger.error('[ChatCallback] Error exchanging code:', { error: toErrorDetail(exchangeError) });
    // Don't show the user an error — just go back to the store
    return NextResponse.redirect(`${origin}/${slug}`);
  }

  // Success — redirect back to the store with chat_ready signal
  // The ChatDialog will detect this and auto-open the chat
  return NextResponse.redirect(`${origin}/${slug}?chat_ready=true`);
}
