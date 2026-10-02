'use client';

import { createClient } from '@/lib/supabase/client';
import { Icon } from '@/shared/components/ui';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { verifyOrderAccess, verifyOrderByGoogleIdentity } from './actions';

interface OrderAuthGateProps {
  token: string;
  businessName: string;
  orderNumber: string;
  /** When true, the server has already verified the user's identity
   * (Google customer auth match) — skip the client-side auth gate entirely,
   * unless a logout intent marker is present in sessionStorage. */
  serverPreAuth?: boolean;
  children: React.ReactNode;
}

const SESSION_TTL = 1 * 60 * 60 * 1000; // 1 Hora

export default function OrderAuthGate({
  token,
  businessName,
  orderNumber,
  serverPreAuth = false,
  children,
}: OrderAuthGateProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [dni, setDni] = useState('');
  const [inputOrderNumber, setInputOrderNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form fields when the user is kicked back to the auth gate
  // (e.g. after logout, the gate re-renders but React keeps the stale state)
  useEffect(() => {
    if (isAuthenticated === false) {
      setDni('');
      setInputOrderNumber('');
      setError(null);
    }
  }, [isAuthenticated]);

  const storageKey = `order_session_${token}`;

  // ─── Google Auth ───
  const params = useParams();
  const slug = params?.slug as string;
  const supabase = useMemo(() => createClient(), []);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  // Una vez autenticado con Google, guardamos user info + mostramos form para N° de orden
  const [googleUser, setGoogleUser] = useState<{
    authId: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  } | null>(null);
  const [googleOrderNumber, setGoogleOrderNumber] = useState('');

  const AUTH_ORIGIN =
    process.env.NEXT_PUBLIC_AUTH_ORIGIN ||
    (typeof window !== 'undefined' ? window.location.origin : '');

  /**
   * Check sessionStorage + localStorage for a valid logout intent
   * matching this token. Returns true if a non-expired marker exists.
   */
  const hasLogoutIntent = useCallback((): boolean => {
    // sessionStorage check (same-tab)
    const ssIntent = sessionStorage.getItem('order_logout_intent');
    if (ssIntent === token) return true;

    // localStorage check (cross-tab / after tab close)
    try {
      const lsRaw = localStorage.getItem('order_logout_intent');
      if (lsRaw) {
        const parsed = JSON.parse(lsRaw);
        if (parsed.token === token && parsed.expiresAt > Date.now()) {
          return true;
        }
        // Expired or wrong token — clean up
        localStorage.removeItem('order_logout_intent');
      }
    } catch {
      localStorage.removeItem('order_logout_intent');
    }

    return false;
  }, [token]);

  /** Clear logout intent marker from both stores — call AFTER successful auth */
  const clearLogoutIntent = useCallback(() => {
    const intent = sessionStorage.getItem('order_logout_intent');
    if (intent === token) {
      sessionStorage.removeItem('order_logout_intent');
    }
    localStorage.removeItem('order_logout_intent');
  }, [token]);

  // ─── Check for existing Supabase session (auto-link from checkout) ───
  useEffect(() => {
    const checkGoogleAuth = async () => {
      // If there's a logout intent matching this token, SKIP auto-link.
      // Checks both sessionStorage (same-tab) and localStorage (cross-tab).
      if (hasLogoutIntent()) {
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user?.app_metadata?.provider === 'google') {
          const authId = session.user.id;
          const res = await verifyOrderByGoogleIdentity(token, authId);
          if (res.success) {
            const sessionData = {
              method: 'google',
              authId,
              expiresAt: Date.now() + SESSION_TTL,
            };
            localStorage.setItem(storageKey, JSON.stringify(sessionData));
            clearLogoutIntent();
            setIsAuthenticated(true);
          }
        }
      } catch (err) {
        console.error('[OrderAuthGate] Error checking Google auth:', err);
      }
    };

    // Only run after initial DNI check determined no session
    // We run this in a microtask after the first check
    const timeoutId = setTimeout(checkGoogleAuth, 100);
    return () => clearTimeout(timeoutId);
  }, [token, supabase, storageKey]);

  useEffect(() => {
    const checkAuth = () => {
      // 0. Server-side pre-auth: if page.tsx verified the user matches
      //    the order's Google identity, skip client gate. BUT check for
      //    logout intent first — explicit logout overrides serverPreAuth.
      //    Uses hasLogoutIntent() which checks both sessionStorage and
      //    localStorage (cross-tab persistence).
      if (serverPreAuth && !hasLogoutIntent()) {
        setIsAuthenticated(true);
        return;
      }

      // If there was a logout intent that matches THIS token, clear it
      // and fall through to the full auth check below
      if (hasLogoutIntent()) {
        clearLogoutIntent();
      }

      // 1. Verificar si hay sesión válida en LocalStorage
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const { expiresAt } = parsed;
          if (Date.now() < expiresAt) {
            setIsAuthenticated(true);
            return;
          } else {
            localStorage.removeItem(storageKey);
          }
        } catch (e) {
          console.error('[OrderAuthGate] Error parsing session:', e);
          localStorage.removeItem(storageKey);
        }
      }

      // 2. Si no hay sesión, verificar si el DNI viene por URL (Auto-Auth)
      const dniFromUrl = searchParams.get('dni');
      if (dniFromUrl && dniFromUrl.length >= 8) {
        const performAutoAuth = async () => {
          setLoading(true);
          try {
            const res = await verifyOrderAccess(token, dniFromUrl);
            if (res.success) {
              const sessionData = {
                dni: dniFromUrl,
                expiresAt: Date.now() + SESSION_TTL,
              };
              localStorage.setItem(storageKey, JSON.stringify(sessionData));
              setIsAuthenticated(true);

              const newParams = new URLSearchParams(searchParams.toString());
              newParams.delete('dni');
              const query = newParams.toString() ? `?${newParams.toString()}` : '';
              router.replace(`${pathname}${query}`);
            } else {
              setIsAuthenticated(false);
            }
          } catch (err) {
            console.error('[OrderAuthGate] Auto-auth error:', err);
            setIsAuthenticated(false);
          } finally {
            setLoading(false);
          }
        };
        performAutoAuth();
        return;
      }

      setIsAuthenticated(false);
    };

    checkAuth();
  }, [storageKey, searchParams, token, pathname, router]);

  // ─── Listen for auth tokens from popup ───
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      if (event.origin !== AUTH_ORIGIN) return;

      if (event.data?.type === 'AUTH_SUCCESS' && event.data?.slug === slug) {
        setIsGoogleLoading(true);
        setGoogleError(null);

        try {
          // Set the session from the popup tokens
          await supabase.auth.setSession({
            access_token: event.data.access_token,
            refresh_token: event.data.refresh_token,
          });

          // Get the user info — mostramos avatar + nombre + email
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.user?.app_metadata?.provider === 'google') {
            const user = session.user;
            setGoogleUser({
              authId: user.id,
              name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuario',
              email: user.email || '',
              avatarUrl: user.user_metadata?.avatar_url || null,
            });
          } else {
            setGoogleError('No se pudo obtener tu información de Google.');
          }
        } catch (err) {
          console.error('[OrderAuthGate] Google auth error:', err);
          setGoogleError('Error al verificar tu identidad con Google.');
        } finally {
          setIsGoogleLoading(false);
        }
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [slug, token, supabase, AUTH_ORIGIN, storageKey]);

  // ─── Open Google sign-in popup ───
  const handleGoogleVerify = useCallback(() => {
    const popupUrl = new URL(`${AUTH_ORIGIN}/auth/customer`);
    popupUrl.searchParams.set('slug', slug);
    popupUrl.searchParams.set('name', businessName);
    popupUrl.searchParams.set('origin', window.location.origin);

    const popup = window.open(popupUrl.toString(), 'customer-auth', 'width=600,height=700,popup=1');

    if (!popup || popup.closed) {
      console.warn('[OrderAuthGate] Popup was blocked');
      return;
    }

    setIsGoogleLoading(true);

    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        setIsGoogleLoading(false);
      }
    }, 500);
  }, [slug, businessName, AUTH_ORIGIN]);

  // ─── Verify with Google + order number ───
  const handleGoogleOrderVerify = async () => {
    const cleanOrderNumber = googleOrderNumber.trim();
    if (!googleUser || !cleanOrderNumber) return;

    setLoading(true);
    setGoogleError(null);

    try {
      const res = await verifyOrderByGoogleIdentity(token, googleUser.authId, cleanOrderNumber);

      if (res.success) {
        const sessionData = {
          method: 'google',
          authId: googleUser.authId,
          expiresAt: Date.now() + SESSION_TTL,
        };
        localStorage.setItem(storageKey, JSON.stringify(sessionData));
        clearLogoutIntent();
        setIsAuthenticated(true);
        return;
      }

      // ─── Manejar razones específicas de fallo ───
      switch (res.reason) {
        case 'no_google_link':
          // La orden existe pero fue creada sin Google → volver a DNI con mensaje
          setInputOrderNumber(cleanOrderNumber); // conservar el N° que ya puso
          setError(
            'Esta compra fue realizada sin una cuenta de Google. ' +
              'Para acceder, usá DNI + N° de orden.',
          );
          // Resetear Google flow para mostrar el formulario de DNI
          setGoogleUser(null);
          setGoogleOrderNumber('');
          break;

        case 'wrong_account':
          setGoogleError(
            'Esta orden está vinculada a otra cuenta de Google. ' +
              'Usá "Otra cuenta" para cambiarla.',
          );
          break;

        case 'wrong_order':
          setGoogleError('El N° de orden no coincide con tu cuenta de Google.');
          break;

        default:
          setGoogleError('No se encontró ninguna orden con tu cuenta de Google.');
      }
    } catch (err) {
      setGoogleError('Ocurrió un problema al verificar. Intentá nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Reset Google flow → volver a la pantalla inicial ───
  const handleResetGoogle = useCallback(() => {
    setGoogleUser(null);
    setGoogleOrderNumber('');
    setGoogleError(null);
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDni = dni.trim();
    const cleanOrderNumber = inputOrderNumber.trim();

    if (cleanDni.length < 8) {
      setError('Por favor, ingresá un DNI válido.');
      return;
    }
    if (!cleanOrderNumber) {
      setError('Por favor, ingresá el N° de orden.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await verifyOrderAccess(token, cleanDni, cleanOrderNumber);
      if (res.success) {
        const sessionData = {
          dni: cleanDni,
          orderNumber: cleanOrderNumber,
          expiresAt: Date.now() + SESSION_TTL,
        };
        localStorage.setItem(storageKey, JSON.stringify(sessionData));
        clearLogoutIntent();
        setIsAuthenticated(true);
      } else {
        setError('El DNI o N° de orden no coinciden con esta orden.');
      }
    } catch (err) {
      setError('Ocurrió un problema al verificar el acceso. Intentá nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated === null || (loading && !isAuthenticated)) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--md-sys-color-surface)',
          gap: '2rem',
        }}
      >
        <div
          style={{
            width: '40px',
            height: '40px',
            border: '3px solid var(--md-sys-color-primary-container)',
            borderTopColor: 'var(--md-sys-color-primary)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }}
        />
        <p
          style={{
            fontSize: '0.75rem',
            fontWeight: 900,
            letterSpacing: '0.2em',
            color: 'var(--md-sys-color-on-surface)',
            opacity: 0.6,
          }}
        >
          ESTABLECIENDO CONEXIÓN SEGURA
        </p>
        <style
          dangerouslySetInnerHTML={{
            __html: `
          @keyframes spin { to { transform: rotate(360deg); } }
        `,
          }}
        />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          backgroundColor: 'var(--md-sys-color-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          backgroundImage:
            'radial-gradient(circle at 50% 50%, var(--md-sys-color-primary-container) 0%, transparent 70%)',
          backgroundSize: '100% 100%',
          opacity: 0.98,
        }}
      >
        <div
          style={{
            maxWidth: '480px',
            width: '100%',
            backgroundColor: 'var(--md-sys-color-surface-container-highest)',
            borderRadius: '48px',
            padding: '3.5rem 2.5rem',
            textAlign: 'center',
            border: '1px solid var(--md-sys-color-outline-variant)',
            boxShadow: '0 40px 80px rgba(0,0,0,0.12)',
            backdropFilter: 'blur(20px)',
          }}
        >
          {/* ─── GOOGLE AUTH: user card + order number ─── */}
          {googleUser ? (
            <>
              {/* User Avatar + Info */}
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  margin: '0 auto 1.5rem',
                  border: '3px solid var(--md-sys-color-primary-container)',
                  background: 'var(--md-sys-color-surface-container-high)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {googleUser.avatarUrl ? (
                  <img
                    src={googleUser.avatarUrl}
                    alt={googleUser.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <Icon size={40}>person</Icon>
                )}
              </div>

              <h2
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 950,
                  marginBottom: '0.25rem',
                  letterSpacing: '-0.03em',
                  color: 'var(--md-sys-color-on-surface)',
                }}
              >
                {googleUser.name}
              </h2>
              <p
                style={{
                  fontSize: '0.85rem',
                  opacity: 0.6,
                  marginBottom: '1.5rem',
                  fontWeight: 600,
                }}
              >
                {googleUser.email}
              </p>

              <p
                style={{
                  fontSize: '0.9rem',
                  opacity: 0.7,
                  marginBottom: '1.5rem',
                  lineHeight: 1.5,
                  padding: '0 0.5rem',
                }}
              >
                Ingresá el <b>N° de orden</b> de tu compra en <b>{businessName}</b> para confirmar
                el acceso.
              </p>

              {/* Order Number Only */}
              <div style={{ textAlign: 'left', marginBottom: '1rem' }}>
                <label
                  style={{
                    fontSize: '11px',
                    fontWeight: 900,
                    textTransform: 'uppercase',
                    paddingLeft: '1.25rem',
                    color: 'var(--md-sys-color-tertiary)',
                    display: 'block',
                    marginBottom: '8px',
                    letterSpacing: '0.05em',
                  }}
                >
                  N° de Orden
                </label>
                <input
                  type="text"
                  value={googleOrderNumber}
                  onChange={(e) => setGoogleOrderNumber(e.target.value)}
                  placeholder={orderNumber || 'Ej: ORD-001234'}
                  maxLength={30}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '1.25rem 1.5rem',
                    borderRadius: '24px',
                    border: '2px solid var(--md-sys-color-outline-variant)',
                    background: 'var(--md-sys-color-surface)',
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    color: 'var(--md-sys-color-on-surface)',
                    outline: 'none',
                    transition: 'all 0.3s ease',
                    textAlign: 'center',
                    letterSpacing: '0.1em',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = 'var(--md-sys-color-tertiary)')}
                  onBlur={(e) =>
                    (e.target.style.borderColor = 'var(--md-sys-color-outline-variant)')
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && googleOrderNumber.trim()) {
                      handleGoogleOrderVerify();
                    }
                  }}
                />
              </div>

              {googleError && (
                <div
                  style={{
                    background: 'var(--md-sys-color-error-container)',
                    color: 'var(--md-sys-color-on-error-container)',
                    padding: '0.75rem 1rem',
                    borderRadius: '16px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    justifyContent: 'center',
                    marginBottom: '1.5rem',
                  }}
                >
                  <Icon size={16}>error</Icon>
                  {googleError}
                </div>
              )}

              <button
                onClick={handleGoogleOrderVerify}
                disabled={loading || !googleOrderNumber.trim()}
                style={{
                  width: '100%',
                  background: 'var(--md-sys-color-primary)',
                  color: 'white',
                  border: 'none',
                  padding: '1.5rem',
                  borderRadius: '100px',
                  fontWeight: 950,
                  fontSize: '1rem',
                  textTransform: 'uppercase',
                  cursor: loading || !googleOrderNumber.trim() ? 'not-allowed' : 'pointer',
                  opacity: loading || !googleOrderNumber.trim() ? 0.5 : 1,
                  transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: googleOrderNumber.trim()
                    ? '0 15px 30px rgba(var(--md-sys-color-primary-rgb), 0.3)'
                    : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  marginBottom: '1rem',
                }}
              >
                {loading ? (
                  'VERIFICANDO...'
                ) : (
                  <>
                    ACCEDER AL SEGUIMIENTO
                    <Icon>arrow_forward</Icon>
                  </>
                )}
              </button>

              {/* Link para usar otra cuenta */}
              <button
                onClick={handleResetGoogle}
                disabled={loading}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--md-sys-color-primary)',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textUnderlineOffset: '3px',
                  padding: '0.5rem',
                }}
              >
                Usar otra cuenta de Google o DNI
              </button>
            </>
          ) : (
            <>
              {/* ─── DEFAULT: Google Button + DNI form ─── */}
              <div
                style={{
                  width: 96,
                  height: 96,
                  background:
                    'linear-gradient(135deg, var(--md-sys-color-primary) 0%, var(--md-sys-color-tertiary) 100%)',
                  color: 'white',
                  borderRadius: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 2.5rem',
                  boxShadow: '0 20px 40px rgba(var(--md-sys-color-primary-rgb), 0.3)',
                  transform: 'rotate(-5deg)',
                }}
              >
                <Icon size={48}>verified_user</Icon>
              </div>

              <h2
                style={{
                  fontSize: '2rem',
                  fontWeight: 950,
                  marginBottom: '1rem',
                  letterSpacing: '-0.04em',
                  lineHeight: 1.1,
                  color: 'var(--md-sys-color-on-surface)',
                }}
              >
                Verificá tu Identidad
              </h2>

              <p
                style={{
                  fontSize: '1rem',
                  opacity: 0.7,
                  marginBottom: '2rem',
                  lineHeight: 1.5,
                  padding: '0 1rem',
                }}
              >
                Para ver los detalles de tu compra en <b>{businessName}</b>, ingresá el DNI del
                comprador y el <b>N° de orden</b>, o identificate con Google si compraste con esa
                cuenta.
              </p>

              {/* Google Verify Button */}
              <button
                type="button"
                onClick={handleGoogleVerify}
                disabled={isGoogleLoading}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  padding: '14px 16px',
                  borderRadius: '100px',
                  border: '1px solid var(--md-sys-color-outline-variant)',
                  background: 'var(--md-sys-color-surface)',
                  cursor: isGoogleLoading ? 'wait' : 'pointer',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  color: 'var(--md-sys-color-on-surface)',
                  transition: 'all 0.2s',
                  opacity: isGoogleLoading ? 0.7 : 1,
                  marginBottom: googleError ? '0.5rem' : '1.5rem',
                }}
                onMouseEnter={(e) => {
                  if (!isGoogleLoading)
                    e.currentTarget.style.background = 'var(--md-sys-color-surface-container-high)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--md-sys-color-surface)';
                }}
              >
                {isGoogleLoading ? (
                  <>
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        border: '2px solid var(--md-sys-color-outline)',
                        borderTopColor: 'var(--md-sys-color-primary)',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                      }}
                    />
                    Verificando con Google…
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="18" height="18">
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
                    Acceder con Google
                  </>
                )}
              </button>

              {googleError && (
                <div
                  style={{
                    background: 'var(--md-sys-color-error-container)',
                    color: 'var(--md-sys-color-on-error-container)',
                    padding: '0.75rem 1rem',
                    borderRadius: '16px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    justifyContent: 'center',
                    marginBottom: '1.5rem',
                  }}
                >
                  <Icon size={16}>error</Icon>
                  {googleError}
                </div>
              )}

              {/* Divider */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '1.5rem',
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: '1px',
                    background: 'var(--md-sys-color-outline-variant)',
                  }}
                />
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--md-sys-color-on-surface-variant)',
                    opacity: 0.5,
                    textTransform: 'uppercase',
                  }}
                >
                  o ingresá tus datos
                </span>
                <div
                  style={{
                    flex: 1,
                    height: '1px',
                    background: 'var(--md-sys-color-outline-variant)',
                  }}
                />
              </div>

              <form
                onSubmit={handleVerify}
                style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
              >
                {/* DNI Field */}
                <div style={{ textAlign: 'left', position: 'relative' }}>
                  <label
                    style={{
                      fontSize: '11px',
                      fontWeight: 900,
                      textTransform: 'uppercase',
                      paddingLeft: '1.25rem',
                      color: 'var(--md-sys-color-primary)',
                      display: 'block',
                      marginBottom: '8px',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Documento de Identidad (DNI)
                  </label>
                  <input
                    type="text"
                    value={dni}
                    onChange={(e) => setDni(e.target.value.replace(/\D/g, ''))}
                    placeholder="00000000"
                    maxLength={12}
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '1.25rem 1.5rem',
                      borderRadius: '24px',
                      border: '2px solid var(--md-sys-color-outline-variant)',
                      background: 'var(--md-sys-color-surface)',
                      fontSize: '1.25rem',
                      fontWeight: 700,
                      color: 'var(--md-sys-color-on-surface)',
                      outline: 'none',
                      transition: 'all 0.3s ease',
                      textAlign: 'center',
                      letterSpacing: '0.2em',
                    }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--md-sys-color-primary)')}
                    onBlur={(e) =>
                      (e.target.style.borderColor = 'var(--md-sys-color-outline-variant)')
                    }
                  />
                </div>

                {/* Order Number Field */}
                <div style={{ textAlign: 'left', position: 'relative' }}>
                  <label
                    style={{
                      fontSize: '11px',
                      fontWeight: 900,
                      textTransform: 'uppercase',
                      paddingLeft: '1.25rem',
                      color: 'var(--md-sys-color-tertiary)',
                      display: 'block',
                      marginBottom: '8px',
                      letterSpacing: '0.05em',
                    }}
                  >
                    N° de Orden
                  </label>
                  <input
                    type="text"
                    value={inputOrderNumber}
                    onChange={(e) => setInputOrderNumber(e.target.value)}
                    placeholder="Ej: ORD-001234"
                    maxLength={30}
                    style={{
                      width: '100%',
                      padding: '1.25rem 1.5rem',
                      borderRadius: '24px',
                      border: '2px solid var(--md-sys-color-outline-variant)',
                      background: 'var(--md-sys-color-surface)',
                      fontSize: '1.1rem',
                      fontWeight: 700,
                      color: 'var(--md-sys-color-on-surface)',
                      outline: 'none',
                      transition: 'all 0.3s ease',
                      textAlign: 'center',
                      letterSpacing: '0.1em',
                    }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--md-sys-color-tertiary)')}
                    onBlur={(e) =>
                      (e.target.style.borderColor = 'var(--md-sys-color-outline-variant)')
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && googleOrderNumber.trim()) {
                        handleGoogleOrderVerify();
                      }
                    }}
                  />
                </div>

                {error && (
                  <div
                    style={{
                      background: 'var(--md-sys-color-error-container)',
                      color: 'var(--md-sys-color-on-error-container)',
                      padding: '1rem',
                      borderRadius: '16px',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon size={18}>error</Icon>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || dni.length < 8 || !inputOrderNumber.trim()}
                  style={{
                    background: 'var(--md-sys-color-primary)',
                    color: 'white',
                    border: 'none',
                    padding: '1.5rem',
                    borderRadius: '100px',
                    fontWeight: 950,
                    fontSize: '1rem',
                    textTransform: 'uppercase',
                    cursor:
                      loading || dni.length < 8 || !inputOrderNumber.trim()
                        ? 'not-allowed'
                        : 'pointer',
                    opacity: loading || dni.length < 8 || !inputOrderNumber.trim() ? 0.5 : 1,
                    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow:
                      dni.length >= 8 && inputOrderNumber.trim()
                        ? '0 15px 30px rgba(var(--md-sys-color-primary-rgb), 0.3)'
                        : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px',
                  }}
                >
                  {loading ? (
                    'VERIFICANDO...'
                  ) : (
                    <>
                      ACCEDER AL SEGUIMIENTO
                      <Icon>arrow_forward</Icon>
                    </>
                  )}
                </button>
              </form>
            </>
          )}

          <p style={{ marginTop: '2.5rem', fontSize: '0.75rem', opacity: 0.5, fontWeight: 700 }}>
            <Icon size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }}>
              lock
            </Icon>
            Conexión cifrada de punto a punto
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
