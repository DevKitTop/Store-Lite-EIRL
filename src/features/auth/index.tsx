'use client';

import { createClient } from '@/lib/supabase/client';
import { buildAuthCallbackUrl, extractRedirectFromSearch } from '@/shared/utils/redirectTarget';
import type { AuthContextType, AuthSession, AuthUser } from '@/types/auth';
import posthog from 'posthog-js';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const DEBUG_ABORTS = process.env.NEXT_PUBLIC_DEBUG_ABORTS === '1';

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (error.name === 'AbortError' || message.includes('abort') || message.includes('aborted')) {
      return true;
    }
  }

  if (typeof error === 'object' && error !== null) {
    const maybeName = 'name' in error ? String(error.name) : '';
    const maybeCode = 'code' in error ? String(error.code) : '';
    const maybeMessage = 'message' in error ? String(error.message).toLowerCase() : '';
    const maybeCause =
      'cause' in error && error.cause instanceof Error ? error.cause.message.toLowerCase() : '';

    return (
      maybeName === 'AbortError' ||
      maybeCode === 'ABORT_ERR' ||
      maybeCode === 'abort' ||
      maybeMessage.includes('abort') ||
      maybeMessage.includes('aborted') ||
      maybeCause.includes('abort')
    );
  }

  return false;
}

function authDebug(message: string, payload?: Record<string, unknown>) {
  if (!DEBUG_ABORTS) return;
  console.warn('[AuthDebug]', message, payload ?? {});
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);
  const profileRequestIdRef = useRef(0);
  const stableSessionRef = useRef<AuthSession | null>(null);
  const stableUserRef = useRef<AuthUser | null>(null);

  useEffect(() => {
    let isMounted = true;
    authDebug('effect:start');

    const setStableAuthState = (nextSession: AuthSession | null, nextUser: AuthUser | null) => {
      stableSessionRef.current = nextSession;
      stableUserRef.current = nextUser;
      setSession(nextSession);
      setUser(nextUser);
    };

    const applySession = (nextSession: AuthSession | null) => {
      if (!nextSession?.user) {
        profileRequestIdRef.current += 1;
        authDebug('applySession:no-user', { requestId: profileRequestIdRef.current });
        setStableAuthState(null, null);
        return;
      }

      const basicUser = { ...nextSession.user, profile: undefined } as AuthUser;
      setStableAuthState(nextSession, basicUser);
    };

    const fetchProfile = async (session: AuthSession) => {
      const requestId = ++profileRequestIdRef.current;
      const MAX_RETRIES = 3;
      authDebug('fetchProfile:start', { requestId, userId: session.user.id });

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          // CRITICAL: Sync session before RLS-sensitive queries
          // Without this, the Supabase client may not have the access token updated yet,
          // causing RLS to fail with an empty error object
          await supabase.auth.getSession();

          const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();

          if (!isMounted || requestId !== profileRequestIdRef.current) {
            authDebug('fetchProfile:stale', {
              requestId,
              currentRequestId: profileRequestIdRef.current,
            });
            return;
          }

          if (error) {
            // PGRST116 is 'no rows returned', which is expected if a user hasn't created a profile yet
            if (error.code === 'PGRST116') {
              authDebug('fetchProfile:no-profile-found');
              setStableAuthState(session, { ...session.user, profile: undefined } as AuthUser);
              return;
            }

            // Ignore abort-like errors caused by navigation/unmount races
            if (isAbortLikeError(error)) {
              authDebug('fetchProfile:abort-like-error', {
                requestId,
                code: error.code,
                message: error.message,
              });
              setStableAuthState(session, { ...session.user, profile: undefined } as AuthUser);
              return;
            }

            // Transient error (RLS race, session not ready) — retry with backoff
            if (attempt < MAX_RETRIES) {
              const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
              authDebug('fetchProfile:retry', { requestId, attempt, delay });
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }

            // Exhausted retries — log warning and proceed with session-only user
            const errorDetails =
              typeof error === 'object' && error !== null
                ? JSON.stringify(error, Object.getOwnPropertyNames(error))
                : String(error);
            console.warn(
              'Profile fetch failed after retries (user will use session-only auth):',
              errorDetails,
            );
            setStableAuthState(session, { ...session.user, profile: undefined } as AuthUser);
            return;
          }

          authDebug('fetchProfile:success', { requestId, hasProfile: Boolean(profile) });
          setStableAuthState(session, {
            ...session.user,
            profile: profile || undefined,
          } as AuthUser);
          return;
        } catch (error) {
          if (!isMounted || requestId !== profileRequestIdRef.current) {
            authDebug('fetchProfile:catch-stale', {
              requestId,
              currentRequestId: profileRequestIdRef.current,
            });
            return;
          }
          if (isAbortLikeError(error)) {
            authDebug('fetchProfile:catch-abort-like', { requestId });
            setStableAuthState(session, { ...session.user, profile: undefined } as AuthUser);
            return;
          }

          // Unexpected error — retry with backoff
          if (attempt < MAX_RETRIES) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          console.error('Unexpected error in profile fetch after retries:', error);
          setStableAuthState(session, { ...session.user, profile: undefined } as AuthUser);
          return;
        }
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: string, session: AuthSession | null) => {
      if (!isMounted) return;
      authDebug('onAuthStateChange', { event: _event, hasSession: Boolean(session) });

      if (session?.user) {
        applySession(session);

        if (_event === 'SIGNED_IN') {
          posthog.identify(session.user.id, {
            role: session.user.role,
          });
          posthog.capture('user_signed_in', {
            provider: session.user.app_metadata?.provider,
          });
        }

        // Supabase recomienda NO hacer awaits de otros métodos de Supabase dentro
        // del callback de onAuthStateChange. Se difiere para evitar deadlocks/races.
        setTimeout(() => {
          if (!isMounted) return;
          void fetchProfile(session);
        }, 0);
      } else {
        applySession(null);
      }
      setLoading(false);
    });

    return () => {
      isMounted = false;
      profileRequestIdRef.current += 1;
      authDebug('effect:cleanup', { requestId: profileRequestIdRef.current });
      subscription.unsubscribe();
    };
  }, [supabase]);

  const AUTH_ORIGIN =
    process.env.NEXT_PUBLIC_AUTH_ORIGIN ||
    (typeof window !== 'undefined' ? window.location.origin : '');

  /**
   * Builds the OAuth callback URL for the current page, carrying the
   * `?redirect=` target the storefront gate added when it blocked a deep link.
   * A hostile or absent target degrades to the plain callback (see
   * buildAuthCallbackUrl), so a crafted URL can never break sign-in.
   */
  const resolveAuthCallbackUrl = () =>
    buildAuthCallbackUrl(
      AUTH_ORIGIN,
      extractRedirectFromSearch(typeof window !== 'undefined' ? window.location.search : ''),
    );

  const signInWithGoogle = async () => {
    const redirectUrl = resolveAuthCallbackUrl();
    console.warn('🔗 Redirecting to:', redirectUrl);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
      },
    });
    if (error) {
      console.error('Login error:', error);
      throw error;
    }
  };

  const signInWithGoogleForChat = async (slug: string) => {
    // Usa un callback DEDICADO que NO crea profiles ni verifica businesses
    const redirectUrl = `${AUTH_ORIGIN}/auth/chat-callback?slug=${slug}`;
    console.warn('🔗 Redirecting to (chat callback):', redirectUrl);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
      },
    });
    if (error) {
      console.error('Login error:', error);
      throw error;
    }
  };

  const signInWithFacebook = async () => {
    // DEBUG: log exact origin resolution
    const envOrigin = process.env.NEXT_PUBLIC_AUTH_ORIGIN;
    const windowOrigin = typeof window !== 'undefined' ? window.location.origin : 'SSR';
    console.warn('🔍 [FB Debug] NEXT_PUBLIC_AUTH_ORIGIN:', envOrigin);
    console.warn('🔍 [FB Debug] window.location.origin:', windowOrigin);
    console.warn('🔍 [FB Debug] AUTH_ORIGIN resolved:', AUTH_ORIGIN);

    const redirectUrl = resolveAuthCallbackUrl();
    console.warn('🔗 [FB Debug] Final redirectUrl sent to Supabase:', redirectUrl);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: {
        redirectTo: redirectUrl,
      },
    });
    if (error) {
      console.error('Facebook login error:', error);
      throw error;
    }
  };

  const signOut = async () => {
    posthog.capture('user_signed_out');
    posthog.reset();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signInWithGoogle,
        signInWithGoogleForChat,
        signInWithFacebook,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  // Return a safe default instead of throwing, so public pages (e.g. /[slug])
  // don't crash when the context is briefly undefined during hydration or Fast Refresh.
  if (context === undefined) {
    return {
      user: null,
      session: null,
      loading: false,
      signInWithGoogle: async () => {
        console.warn('[useAuth] signInWithGoogle called outside AuthProvider');
      },
      signInWithGoogleForChat: async () => {
        console.warn('[useAuth] signInWithGoogleForChat called outside AuthProvider');
      },
      signInWithFacebook: async () => {
        console.warn('[useAuth] signInWithFacebook called outside AuthProvider');
      },
      signOut: async () => {
        console.warn('[useAuth] signOut called outside AuthProvider');
      },
    } satisfies AuthContextType;
  }
  return context;
};
