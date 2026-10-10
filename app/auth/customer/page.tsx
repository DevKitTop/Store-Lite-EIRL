'use client';

import ConsentCheckbox from '@/features/auth/ConsentCheckbox';
import { createClient } from '@/lib/supabase/client';
import { isAllowedAuthReturnOrigin } from '@/shared/utils/url';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import styles from './page.module.css';

/**
 * Customer Auth Popup
 *
 * Opens in a popup from ANY store domain to this CENTRAL auth domain.
 * Shows ONLY the store branding (name + logo), NO SaaS branding at all.
 *
 * Flow:
 *   1st load (no code) → check session →
 *     - HAS session → show account confirmation (continue / switch)
 *     - NO session → show Google sign-in button
 *   2nd load (has code) → exchangeCodeForSession → postMessage tokens → close
 *
 * @query slug — store slug
 * @query name — store display name
 * @query logo — store logo URL (optional)
 * @query origin — store domain (for postMessage security)
 * @query code — OAuth authorization code (present on callback)
 */

interface SessionUserInfo {
  name: string;
  email: string;
  avatarUrl: string | null;
}

function CustomerAuthContent() {
  const searchParams = useSearchParams();
  const slug = searchParams.get('slug');
  const storeName = searchParams.get('name');
  const storeLogo = searchParams.get('logo');
  const storeOrigin = searchParams.get('origin');
  const code = searchParams.get('code');
  // `storeOrigin` is allowlist INPUT only — it is never passed raw to
  // postMessage. Resolved once per render: null ⇒ close without emitting.
  const returnOrigin = storeOrigin && isAllowedAuthReturnOrigin(storeOrigin) ? storeOrigin : null;
  const processedRef = useRef(false);
  // Store tokens in a ref so we can send them when user clicks "Continue"
  const pendingTokensRef = useRef<{ access_token: string; refresh_token: string } | null>(null);

  const [step, setStep] = useState<'loading' | 'ready' | 'authenticating' | 'session_confirmed'>(
    'loading',
  );
  const [consented, setConsented] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUserInfo | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  // Initialize Supabase client once
  if (!supabaseRef.current) {
    supabaseRef.current = createClient();
  }

  // ─── Handle OAuth callback (page loaded with code) ───
  useEffect(() => {
    if (processedRef.current) return;
    if (!code || !slug || !storeOrigin) return;
    if (!returnOrigin) {
      console.error('[CustomerAuth] origin rejected:', storeOrigin);
      window.close();
      return;
    }
    processedRef.current = true;
    setStep('authenticating');

    const supabase = supabaseRef.current!;

    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ data, error }: Awaited<ReturnType<typeof supabase.auth.exchangeCodeForSession>>) => {
        if (error || !data.session) {
          console.error('[CustomerAuth] Error exchanging code:', error);
          window.opener?.postMessage({ type: 'AUTH_ERROR', error: error?.message }, returnOrigin);
          window.close();
          return;
        }

        // Send tokens to the store window via postMessage
        window.opener?.postMessage(
          {
            type: 'AUTH_SUCCESS',
            slug,
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          },
          returnOrigin,
        );

        window.close();
      });
  }, [code, slug, storeOrigin, returnOrigin]);

  // ─── First load — check for existing session ───
  useEffect(() => {
    if (code || processedRef.current) return;

    if (!slug || !storeOrigin) {
      console.warn('[CustomerAuth] Missing required params');
      window.close();
      return;
    }

    if (!returnOrigin) {
      console.error('[CustomerAuth] origin rejected:', storeOrigin);
      window.close();
      return;
    }

    const supabase = supabaseRef.current!;

    supabase.auth
      .getSession()
      .then(({ data }: Awaited<ReturnType<typeof supabase.auth.getSession>>) => {
        if (data.session) {
          // User is already authenticated — show confirmation instead of
          // silently sending tokens. Let them decide which account to use.
          const user = data.session.user;
          pendingTokensRef.current = {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          };
          setSessionUser({
            name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuario',
            email: user.email || '',
            avatarUrl: user.user_metadata?.avatar_url || null,
          });
          setStep('session_confirmed');
        } else {
          // No session — show the Google sign-in button
          setStep('ready');
        }
      });
  }, [code, slug, storeOrigin, returnOrigin]);

  // ─── Continue with the current session ───
  const handleContinueWithCurrent = useCallback(() => {
    const tokens = pendingTokensRef.current;
    if (!tokens || !slug || !storeOrigin) return;

    // Defense in depth: the confirmation screen only renders when this gate
    // already passed, but a denied origin must never emit.
    if (!returnOrigin) {
      console.error('[CustomerAuth] origin rejected:', storeOrigin);
      window.close();
      return;
    }

    window.opener?.postMessage(
      {
        type: 'AUTH_SUCCESS',
        slug,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      },
      returnOrigin,
    );

    window.close();
  }, [slug, storeOrigin, returnOrigin]);

  // ─── Switch to a different Google account ───
  const handleSwitchAccount = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    // Sign out from Supabase in the popup so getSession() returns null
    // on next load, forcing the Google account picker to appear.
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[CustomerAuth] Error signing out:', err);
    }

    pendingTokensRef.current = null;
    setSessionUser(null);
    setStep('ready');
  }, []);

  // ─── Start OAuth flow (Google sign-in) ───
  const handleGoogleSignIn = useCallback(() => {
    const supabase = supabaseRef.current;
    if (!supabase || !slug || !storeName || !storeOrigin) return;

    setStep('authenticating');

    // Build redirectTo that returns to THIS page with all store params preserved
    const redirectTo = new URL(`${window.location.origin}/auth/customer`);
    redirectTo.searchParams.set('slug', slug);
    redirectTo.searchParams.set('name', storeName);
    if (storeLogo) redirectTo.searchParams.set('logo', storeLogo);
    redirectTo.searchParams.set('origin', storeOrigin);

    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo.toString(),
      },
    });
  }, [slug, storeName, storeLogo, storeOrigin]);

  // ─── Render ───

  if (step === 'authenticating') {
    return (
      <div className={styles.container}>
        <div className={styles.loadingContainer}>
          <div className={styles.spinner} />
          <p className={styles.loadingText}>Conectando con Google…</p>
        </div>
      </div>
    );
  }

  // ─── Session confirmed: show account info + continue / switch ───
  if (step === 'session_confirmed' && sessionUser) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          {/* Store Logo */}
          {storeLogo ? (
            <Image
              src={storeLogo}
              alt={storeName || ''}
              className={styles.storeLogo}
              width={64}
              height={64}
            />
          ) : (
            <div className={styles.storeLogoFallback}>
              <span className="material-symbols-outlined">store</span>
            </div>
          )}

          {/* Store Name */}
          <h1 className={styles.storeName}>{storeName || 'Tienda'}</h1>
          <p className={styles.description}>
            Chatea con {storeName || 'la tienda'} para consultar sobre productos y pedidos.
          </p>

          <div className={styles.divider} />

          {/* Current account info */}
          <p className={styles.confirmLabel}>Vas a chatear como:</p>
          <div className={styles.accountCard}>
            <div className={styles.accountAvatar}>
              {sessionUser.avatarUrl ? (
                <Image
                  src={sessionUser.avatarUrl}
                  alt=""
                  className={styles.accountAvatarImg}
                  width={44}
                  height={44}
                />
              ) : (
                <span className="material-symbols-outlined">person</span>
              )}
            </div>
            <div className={styles.accountInfo}>
              <p className={styles.accountName}>{sessionUser.name}</p>
              <p className={styles.accountEmail}>{sessionUser.email}</p>
            </div>
          </div>

          {/* Continue button */}
          <button className={styles.continueButton} onClick={handleContinueWithCurrent}>
            Continuar
          </button>

          {/* Switch account */}
          <div className={styles.switchDivider}>
            <span className={styles.switchDividerLine} />
            <span className={styles.switchDividerText}>o</span>
            <span className={styles.switchDividerLine} />
          </div>

          <button className={styles.switchButton} onClick={handleSwitchAccount}>
            Usar otra cuenta de Google
          </button>

          <p className={styles.privacyNote}>
            Solo compartiremos tu nombre, correo y foto de perfil con {storeName || 'la tienda'}.
          </p>
        </div>
      </div>
    );
  }

  // ─── Loading / Ready: store branding + Google sign-in ───
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {/* Store Logo */}
        {storeLogo ? (
          <Image
            src={storeLogo}
            alt={storeName || ''}
            className={styles.storeLogo}
            width={64}
            height={64}
          />
        ) : (
          <div className={styles.storeLogoFallback}>
            <span className="material-symbols-outlined">store</span>
          </div>
        )}

        {/* Store Name */}
        <h1 className={styles.storeName}>{storeName || 'Tienda'}</h1>

        {/* Description */}
        <p className={styles.description}>
          Chatea con {storeName || 'la tienda'} para consultar sobre productos y pedidos.
        </p>

        <div className={styles.divider} />

        {step === 'loading' ? (
          <div className={styles.spinnerWrap}>
            <div className={styles.spinner} />
          </div>
        ) : (
          <>
            {/* Consent Checkbox */}
            <ConsentCheckbox onConsentChange={setConsented} storeName={storeName ?? undefined} />

            {/* Google Sign-In Button */}
            <button
              className={styles.googleButton}
              onClick={handleGoogleSignIn}
              disabled={!consented}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" className={styles.googleIcon}>
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continuar con Google
            </button>

            {/* Privacy note */}
            <p className={styles.privacyNote}>
              Solo compartiremos tu nombre, correo y foto de perfil con {storeName || 'la tienda'}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Wrapped in Suspense because useSearchParams() requires it
 */
export default function CustomerAuthPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.container}>
          <div className={styles.loadingContainer}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>Cargando…</p>
          </div>
        </div>
      }
    >
      <CustomerAuthContent />
    </Suspense>
  );
}
