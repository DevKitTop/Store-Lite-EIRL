'use client';

import { clearBusinessSessionData, useBusinessSession } from '@/hooks/useBusinessSession';
import { useSidebarState } from '@/hooks/useSidebarState';
import { Sidebar } from '@/shared/components/navigation';
import Navbar from '@/shared/components/navigation/Navbar';
import PwaInstallPrompt from '@/shared/components/pwa/PwaInstallPrompt';
import { CircularProgress } from '@/shared/components/ui/feedback/Progress';
import '@/styles/components/layout.css';
import '@/styles/components/navbar.css';
import '@/styles/components/sidebar.css';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const USE_SIDEBAR_V2 = process.env.NEXT_PUBLIC_SIDEBAR_V2 === 'true';

interface AppLayoutProps {
  children: React.ReactNode;
  showNavbarByDefault?: boolean;
  navbarPlanName?: string;
  navbarBusinessId?: string;
  navbarBusinessName?: string;
  navbarBusinessLogoUrl?: string;
  navbarBusinessCoverUrl?: string;
}

/** Determine content wrapper class based on sidebar state and feature flag */
function getContentWrapperClass(
  showNavbar: boolean,
  useSidebarV2: boolean,
  sidebarState: ReturnType<typeof useSidebarState>['state'],
  legacyCollapsed: boolean,
): string {
  if (!showNavbar) return 'content-wrapper--hidden';

  if (useSidebarV2) {
    switch (sidebarState) {
      case 'expanded':
        return 'content-wrapper--v2-expanded';
      case 'collapsed':
        return 'content-wrapper--v2-collapsed';
      case 'mobile-open':
        return 'content-wrapper--v2-mobile-open';
      default:
        return 'content-wrapper--v2-collapsed';
    }
  }

  // Legacy Navbar path
  return legacyCollapsed ? 'content-wrapper--collapsed' : 'content-wrapper--expanded';
}

/** Render sidebar based on feature flag */
function renderSidebar({
  showNavbar,
  useSidebarV2,
  sidebarState,
  toggleSidebar,
  setSidebarState,
  legacyCollapsed,
  toggleLegacyCollapsed,
  navbarPlanName,
  navbarBusinessId,
  navbarBusinessName,
  navbarBusinessLogoUrl,
  navbarBusinessCoverUrl,
  pathname,
  isChatPage,
}: {
  showNavbar: boolean;
  useSidebarV2: boolean;
  sidebarState: ReturnType<typeof useSidebarState>['state'];
  toggleSidebar: () => void;
  setSidebarState: (state: ReturnType<typeof useSidebarState>['state']) => void;
  legacyCollapsed: boolean;
  toggleLegacyCollapsed: () => void;
  navbarPlanName?: string;
  navbarBusinessId?: string;
  navbarBusinessName?: string;
  navbarBusinessLogoUrl?: string;
  navbarBusinessCoverUrl?: string;
  pathname: string;
  isChatPage: boolean;
}) {
  if (!showNavbar) return null;

  if (useSidebarV2) {
    return (
      <Sidebar
        state={sidebarState}
        onToggle={toggleSidebar}
        onCloseMobile={() => setSidebarState('collapsed')}
        planName={navbarPlanName ?? ''}
        businessId={navbarBusinessId ?? ''}
        slug={pathname?.split('/')[1] ?? ''}
        pathname={pathname ?? ''}
        isChatPage={isChatPage}
      />
    );
  }

  // Legacy Navbar fallback
  return (
    <Navbar
      isCollapsed={legacyCollapsed}
      onToggle={toggleLegacyCollapsed}
      planName={navbarPlanName}
      businessId={navbarBusinessId}
      businessName={navbarBusinessName}
      businessLogoUrl={navbarBusinessLogoUrl}
      businessCoverUrl={navbarBusinessCoverUrl}
    />
  );
}

export default function AppLayout({
  children,
  showNavbarByDefault = false,
  navbarPlanName,
  navbarBusinessId,
  navbarBusinessName,
  navbarBusinessLogoUrl,
  navbarBusinessCoverUrl,
}: AppLayoutProps) {
  // Business session management - only for detecting when session is killed from another tab
  const { sessionKilledFromOtherTab, resetSessionKilledFlag } = useBusinessSession();

  // Legacy Navbar collapsed state management (starts false for hydration safety)
  const [legacyCollapsed, setLegacyCollapsed] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('navbarCollapsed');
      if (stored !== null) {
        setLegacyCollapsed(stored === 'true');
      }
    }
  }, []);

  const toggleLegacyCollapsed = () => {
    setLegacyCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('navbarCollapsed', String(next));
      }
      return next;
    });
  };

  // Cross-tab sync for legacy navbar state
  useEffect(() => {
    if (!USE_SIDEBAR_V2 && typeof window !== 'undefined') {
      const handleStorage = (e: StorageEvent) => {
        if (e.key === 'navbarCollapsed' && e.newValue !== null) {
          setLegacyCollapsed(e.newValue === 'true');
        }
      };
      window.addEventListener('storage', handleStorage);
      return () => window.removeEventListener('storage', handleStorage);
    }
  }, []);

  // Sidebar state management with persistence and cross-tab sync
  const {
    state: sidebarState,
    toggle: toggleSidebar,
    setState: setSidebarState,
    registerStorageListener: registerSidebarStorageListener,
  } = useSidebarState('collapsed');

  const [isGlobalLoading, setIsGlobalLoading] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    setIsGlobalLoading(false);
  }, [pathname]);

  const isChatPage = pathname?.includes('/chat') || pathname?.endsWith('/chat');

  // Fresh auth cleanup (defense layers B + D): when auth callback redirects with ?fresh_auth=true
  useEffect(() => {
    if (pathname === '/list-business' && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('fresh_auth')) {
        clearBusinessSessionData();
        window.history.replaceState({}, '', '/list-business');
      }
    }
  }, [pathname]);

  const showNavbar =
    showNavbarByDefault && pathname !== '/list-business' && !pathname?.startsWith('/auth');

  const contentWrapperClass = getContentWrapperClass(
    showNavbar,
    USE_SIDEBAR_V2,
    sidebarState,
    legacyCollapsed,
  );

  // If session was killed from another tab (user closed business there), redirect to list
  useEffect(() => {
    if (sessionKilledFromOtherTab && !pathname?.startsWith('/list-business')) {
      resetSessionKilledFlag();
      router.push('/list-business');
    }
  }, [sessionKilledFromOtherTab, pathname, router, resetSessionKilledFlag]);

  // Register cross-tab sync for sidebar state
  useEffect(() => {
    if (USE_SIDEBAR_V2) {
      const cleanup = registerSidebarStorageListener();
      return cleanup;
    }
  }, [registerSidebarStorageListener]);

  return (
    <>
      <div className={`layout ${isChatPage ? 'layout--chat' : ''}`}>
        {/*
        The "styles.xxx" was incorrect because it wasn't importing CSS modules.
        Using global classes that we will define in layout.css or equivalent.
      */}

        {renderSidebar({
          showNavbar,
          useSidebarV2: USE_SIDEBAR_V2,
          sidebarState,
          toggleSidebar,
          setSidebarState,
          legacyCollapsed,
          toggleLegacyCollapsed,
          navbarPlanName,
          navbarBusinessId,
          navbarBusinessName,
          navbarBusinessLogoUrl,
          navbarBusinessCoverUrl,
          pathname,
          isChatPage,
        })}

        <div className={`content-wrapper ${contentWrapperClass}`}>
          <main className={`main-area ${isChatPage ? 'main-area--chat' : ''}`}>{children}</main>
        </div>

        {isGlobalLoading && (
          <div className="loadingOverlay">
            <CircularProgress />
            <p className="loadingText">Cargando...</p>
          </div>
        )}

        {showNavbar && <PwaInstallPrompt />}
      </div>
    </>
  );
}
