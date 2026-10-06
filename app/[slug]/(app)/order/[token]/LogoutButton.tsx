'use client';

import { Icon } from '@/shared/components/ui';
import { getBusinessPath } from '@/shared/utils/url';
import { useRouter } from 'next/navigation';
import { clearOrderAccessCookie } from './actions';

export default function LogoutButton({
  token,
  businessSlug,
}: {
  token: string;
  businessSlug: string;
}) {
  const router = useRouter();

  const handleLogout = async () => {
    // Set logout intent in BOTH sessionStorage and localStorage.
    // sessionStorage: prevents auto-auth in the same tab (immediate).
    // localStorage:  persists across tab closes — without it, opening
    //                a new tab would bypass the gate via serverPreAuth.
    // The marker expires after 5 minutes to avoid stale locks.
    const marker = JSON.stringify({ token, expiresAt: Date.now() + 5 * 60 * 1000 });
    sessionStorage.setItem('order_logout_intent', token);
    localStorage.setItem('order_logout_intent', marker);
    localStorage.removeItem(`order_session_${token}`);

    // 🔒 SECURITY (R16): the markers above are client-side only. The signed
    // access cookie is httpOnly, so the browser cannot clear it from here —
    // without this server action the full-access cookie would outlive the logout
    // and the next request to this URL would still get the full order row.
    // Revocation is best-effort: a failed delete must not trap the buyer on a
    // page they asked to leave.
    try {
      await clearOrderAccessCookie(token);
    } catch (error) {
      console.error('[Logout] Could not revoke the order access cookie:', error);
    }

    router.push(getBusinessPath(businessSlug));
  };

  return (
    <button
      onClick={handleLogout}
      title="Cerrar sesión"
      style={{
        background: 'var(--md-sys-color-error-container)',
        border: '1px solid var(--md-sys-color-outline)',
        cursor: 'pointer',
        padding: '10px 16px',
        borderRadius: '16px',
        color: 'var(--md-sys-color-on-error-container)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        fontWeight: 700,
        fontSize: '0.8rem',
        transition: 'all 0.2s ease',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--md-sys-color-error)';
        e.currentTarget.style.color = 'white';
        e.currentTarget.style.borderColor = 'var(--md-sys-color-error)';
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(var(--md-sys-color-error-rgb), 0.3)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--md-sys-color-error-container)';
        e.currentTarget.style.color = 'var(--md-sys-color-on-error-container)';
        e.currentTarget.style.borderColor = 'var(--md-sys-color-outline)';
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <Icon size={20}>logout</Icon>
      Cerrar sesión
    </button>
  );
}
