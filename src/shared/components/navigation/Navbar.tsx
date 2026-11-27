'use client';

import { requestStorefrontThemeSync } from '@/core/storefront/viewerScheme';
import { clearBusinessSessionData, STORAGE_KEY } from '@/hooks/useBusinessSession';
import { createClient } from '@/lib/supabase/client';
import { useTheme } from '@/shared/context/ThemeContext';
import { getBusinessPath } from '@/shared/utils/url';
import '@/styles/components/navbar.css';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { usePermissions } from '../../../../app/[slug]/(app)/context/PermissionsContext';
import { Icon } from '../ui';
import { NavbarNotificationsBadge } from './NavbarNotificationsBadge';

interface NavbarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  planName?: string;
  businessId?: string;
  businessName?: string;
  businessLogoUrl?: string;
  businessCoverUrl?: string;
}

const PLAN_LABELS: Record<string, string> = {
  basico: 'Básico',
  emprendedor: 'Emprendedor',
  business_pro: 'Business PRO',
  enterprise_pro: 'Enterprise PRO',
};

interface NavLinkItem {
  id: string;
  icon: string;
  label: string;
  path: string;
}

interface NavActionItem {
  id: string;
  icon: string;
  label: string;
  action: 'toggle-theme';
}

type NavItem = NavLinkItem | NavActionItem;

function isLinkItem(item: NavItem): item is NavLinkItem {
  return 'path' in item;
}

function formatPlanName(planName: string): string {
  const normalizedPlan = planName.trim().toLowerCase();
  return PLAN_LABELS[normalizedPlan] ?? planName.replace(/_/g, ' ').replace(/\bpro\b/gi, 'PRO');
}

export default function Navbar({
  isCollapsed,
  onToggle,
  planName = 'Básico',
  businessId,
  businessName,
  businessLogoUrl,
  businessCoverUrl,
}: NavbarProps) {
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug as string;
  const { can, isOwner } = usePermissions();
  const { effectiveTheme, setTheme } = useTheme();

  const toggleTheme = () => {
    const next = effectiveTheme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (slug) requestStorefrontThemeSync(slug, next);
  };

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Viewport detection for mobile "Más" menu
  useEffect(() => {
    const checkViewport = () => {
      setIsMobileViewport(window.innerWidth <= 768);
    };
    checkViewport();
    window.addEventListener('resize', checkViewport);
    return () => window.removeEventListener('resize', checkViewport);
  }, []);

  // Close mobile "Más" popup on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (mobileMoreRef.current && !mobileMoreRef.current.contains(event.target as Node)) {
        setIsMobileMoreOpen(false);
      }
    };
    if (isMobileMoreOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMobileMoreOpen]);

  useEffect(() => {
    if (slug) {
      localStorage.setItem('selectedBusinessSlug', slug);
      // Also set the active business session
      const session = {
        slug,
        openedAt: Date.now(),
        tabId: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
  }, [slug]);

  const handleLogout = async () => {
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error al cerrar sesión:', error);
    } else {
      router.push('/auth');
    }
  };

  const handleCloseStore = () => {
    clearBusinessSessionData();
    router.push('/list-business');
  };

  // Section configuration with collapsible state
  const SECTIONS_STORAGE_KEY = `navbar_sections_${businessId || 'default'}`;

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    principal: true,
    gestion: true,
    configuracion: true,
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(SECTIONS_STORAGE_KEY);
      if (stored) {
        try {
          setExpandedSections(JSON.parse(stored));
        } catch {
          // Ignore parse errors
        }
      }
    }
  }, [SECTIONS_STORAGE_KEY]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(expandedSections));
    }
  }, [expandedSections, SECTIONS_STORAGE_KEY]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  // Define sections with their items
  const sections: { id: string; title: string; icon: string; items: NavItem[] }[] = [
    {
      id: 'principal',
      title: 'Principal',
      icon: 'apps',
      items: [
        { id: 'home', icon: 'home', label: 'Inicio', path: getBusinessPath(slug) },
        { id: 'chat', icon: 'chat', label: 'Mensajes', path: getBusinessPath(slug, '/chat') },
        {
          id: 'notifications',
          icon: 'notifications',
          label: 'Notificaciones',
          path: getBusinessPath(slug, '/notifications'),
        },
      ],
    },
    {
      id: 'gestion',
      title: 'Gestión',
      icon: 'inventory_2',
      items: [
        {
          id: 'storage',
          icon: 'package_2',
          label: 'Almacén',
          path: getBusinessPath(slug, '/storage'),
        },
        {
          id: 'dashboard',
          icon: 'dashboard',
          label: 'Dashboard',
          path: getBusinessPath(slug, '/dashboard'),
        },
      ],
    },
    {
      id: 'configuracion',
      title: 'Configuración',
      icon: 'tune',
      items: [
        {
          id: 'theme',
          icon: effectiveTheme === 'dark' ? 'light_mode' : 'dark_mode',
          label: 'Tema',
          action: 'toggle-theme',
        },
        {
          id: 'feedback',
          icon: 'feedback',
          label: 'Ayuda',
          path: getBusinessPath(slug, '/ayuda'),
        },
        {
          id: 'settings',
          icon: 'settings',
          label: 'Ajustes',
          path: getBusinessPath(slug, '/settings'),
        },
      ],
    },
  ];

  const isActive = (path: string) => {
    if (path === `/${slug}` && pathname === `/${slug}`) {
      return true;
    }
    if (path !== `/${slug}` && pathname.startsWith(path)) {
      return true;
    }
    if (path === `/${slug}/storage` && pathname.startsWith(`/${slug}/product/`)) {
      return true;
    }
    return false;
  };

  // Filter items based on permissions and plan
  const getVisibleItems = (items: NavItem[]) => {
    return items.filter((item) => {
      if (item.id === 'dashboard' && planName === 'lite') return false;
      if (isOwner) return true;
      if (item.id === 'chat') return can('chat.view');
      if (item.id === 'notifications') return can('notifications.view');
      if (item.id === 'storage') return can('products.view') || can('categories.view');
      if (item.id === 'dashboard') return can('dashboard.view');
      return true;
    });
  };

  // Mobile render logic extracted to avoid IIFE in JSX
  const renderMobileItems = () => {
    const allVisibleItems = sections.flatMap((s) => getVisibleItems(s.items)).filter(isLinkItem);
    const hasChat = allVisibleItems.some((i) => i.id === 'chat');
    const hasNotifications = allVisibleItems.some((i) => i.id === 'notifications');

    const itemsToRender =
      hasChat && hasNotifications
        ? allVisibleItems
            .filter((i) => i.id !== 'chat' && i.id !== 'notifications')
            .concat({
              id: 'more',
              icon: 'more_horiz',
              label: 'Más',
              path: '#',
            })
        : allVisibleItems;

    return itemsToRender.map((item) => {
      if (item.id === 'more') {
        return (
          <div ref={mobileMoreRef} key="more" className="navbar__mobile-more-container">
            <button
              className={`navbar__item navbar__item--more ${isMobileMoreOpen ? 'navbar__item--active' : ''}`}
              onClick={() => setIsMobileMoreOpen(!isMobileMoreOpen)}
              aria-label="Más"
              title="Más"
              suppressHydrationWarning
            >
              <span className="navbar__item-icon-wrapper">
                <md-icon className="navbar__item-icon" suppressHydrationWarning>
                  chat
                </md-icon>
              </span>
            </button>
            {isMobileMoreOpen && (
              <div className="navbar__mobile-popup">
                <Link
                  href={getBusinessPath(slug, '/chat')}
                  className="navbar__mobile-popup-item"
                  onClick={() => setIsMobileMoreOpen(false)}
                  suppressHydrationWarning
                >
                  <md-icon>chat</md-icon>
                  <span>Mensajes</span>
                </Link>
                <Link
                  href={getBusinessPath(slug, '/notifications')}
                  className="navbar__mobile-popup-item"
                  onClick={() => setIsMobileMoreOpen(false)}
                  suppressHydrationWarning
                >
                  <md-icon>notifications</md-icon>
                  <span>Notificaciones</span>
                </Link>
                <button
                  className="navbar__mobile-popup-item"
                  onClick={toggleTheme}
                  aria-label="Tema"
                  title="Tema"
                  suppressHydrationWarning
                >
                  <md-icon suppressHydrationWarning>
                    {effectiveTheme === 'dark' ? 'light_mode' : 'dark_mode'}
                  </md-icon>
                  <span>Tema</span>
                </button>
                <Link
                  href={getBusinessPath(slug, '/ayuda')}
                  className="navbar__mobile-popup-item"
                  onClick={() => setIsMobileMoreOpen(false)}
                  suppressHydrationWarning
                >
                  <md-icon>feedback</md-icon>
                  <span>Ayuda</span>
                </Link>
              </div>
            )}
          </div>
        );
      }

      return (
        <Link
          key={item.id}
          href={item.path}
          className={`navbar__item navbar__item--${item.id} ${isActive(item.path) ? 'navbar__item--active' : ''}`}
          aria-label={item.label}
          title={item.label}
          suppressHydrationWarning
        >
          <span className="navbar__item-icon-wrapper">
            <md-icon className="navbar__item-icon" suppressHydrationWarning>
              {item.icon}
            </md-icon>
            {item.id === 'notifications' && businessId && <NavbarNotificationsBadge />}
          </span>
          {!isCollapsed && (
            <span className="navbar__item-label" suppressHydrationWarning>
              {item.label}
            </span>
          )}
        </Link>
      );
    });
  };

  return (
    <nav className={`navbar ${isCollapsed ? 'navbar--collapsed' : 'navbar--expanded'}`}>
      <div className="navbar__content">
        <div className="navbar__header">
          {!isCollapsed && businessName && (
            <div className="navbar__business-header">
              <div className="navbar__business-media">
                {businessLogoUrl && (
                  <img src={businessLogoUrl} alt={businessName} className="navbar__business-logo" />
                )}
                {businessCoverUrl && (
                  <img
                    src={businessCoverUrl}
                    alt=""
                    aria-hidden="true"
                    className="navbar__business-cover"
                  />
                )}
              </div>
              <button
                className="navbar__item--toggle-small navbar__item--toggle-business"
                onClick={onToggle}
                aria-label="Contraer"
                title="Contraer"
              >
                <Icon size={18}>chevron_left</Icon>
              </button>
              <div className="navbar__business-text">
                <span className="navbar__business-name">{businessName}</span>
                <div className="navbar__plan-row">
                  <span className="navbar__plan-badge-small">
                    <Icon size={14} aria-hidden="true">
                      star
                    </Icon>
                    {formatPlanName(planName)}
                  </span>
                  <span className="navbar__status-active">
                    <span className="navbar__status-dot" aria-hidden="true" />
                    ACTIVO
                  </span>
                </div>
              </div>
            </div>
          )}
          {isCollapsed && (
            <div className="navbar__collapsed-brand">
              {businessLogoUrl && (
                <img
                  src={businessLogoUrl}
                  alt={businessName ?? 'Negocio'}
                  className="navbar__business-logo navbar__business-logo--collapsed"
                />
              )}
              <button
                className="navbar__item--toggle-small navbar__item--toggle-collapsed"
                onClick={onToggle}
                aria-label="Expandir"
                title="Expandir"
              >
                <Icon size={20}>chevron_right</Icon>
              </button>
            </div>
          )}
        </div>

        <div className="navbar__divider" />

        <div className="navbar__items">
          {!isMobileViewport
            ? // Desktop: Sections with collapsible headers
              sections.map((section) => {
                const visibleItems = getVisibleItems(section.items);
                if (visibleItems.length === 0) return null;

                const isExpanded = expandedSections[section.id] !== false;

                return (
                  <div key={section.id} className="navbar__section">
                    <button
                      className={`navbar__section-header ${!isExpanded ? 'navbar__section-header--collapsed' : ''}`}
                      onClick={() => toggleSection(section.id)}
                      aria-expanded={isExpanded}
                      title={isExpanded ? `Ocultar ${section.title}` : `Mostrar ${section.title}`}
                      suppressHydrationWarning
                    >
                      <md-icon className="navbar__section-icon" suppressHydrationWarning>
                        {section.icon}
                      </md-icon>
                      {!isCollapsed && (
                        <span className="navbar__section-title" suppressHydrationWarning>
                          {section.title}
                        </span>
                      )}
                      {!isCollapsed && (
                        <Icon
                          className={`navbar__section-chevron ${!isExpanded ? 'rotated' : ''}`}
                          size={16}
                        >
                          expand_more
                        </Icon>
                      )}
                    </button>
                    {isExpanded && (
                      <div className="navbar__section-items">
                        {visibleItems.map((item) =>
                          isLinkItem(item) ? (
                            <Link
                              key={item.id}
                              href={item.path}
                              className={`navbar__item navbar__item--${item.id} ${isActive(item.path) ? 'navbar__item--active' : ''}`}
                              aria-label={item.label}
                              title={item.label}
                              suppressHydrationWarning
                            >
                              <span className="navbar__item-icon-wrapper">
                                <md-icon className="navbar__item-icon" suppressHydrationWarning>
                                  {item.icon}
                                </md-icon>
                                {item.id === 'notifications' && businessId && (
                                  <NavbarNotificationsBadge />
                                )}
                              </span>
                              {!isCollapsed && (
                                <span className="navbar__item-label" suppressHydrationWarning>
                                  {item.label}
                                </span>
                              )}
                            </Link>
                          ) : (
                            <button
                              key={item.id}
                              className={`navbar__item navbar__item--action ${effectiveTheme === 'dark' ? 'navbar__item--action-dark' : ''}`}
                              onClick={toggleTheme}
                              aria-label={item.label}
                              title={`${item.label} — ${effectiveTheme === 'dark' ? 'cambiar a claro' : 'cambiar a oscuro'}`}
                              suppressHydrationWarning
                            >
                              <span className="navbar__item-icon-wrapper">
                                <md-icon className="navbar__item-icon" suppressHydrationWarning>
                                  {item.icon}
                                </md-icon>
                              </span>
                              {!isCollapsed && (
                                <span className="navbar__item-label" suppressHydrationWarning>
                                  {item.label}
                                </span>
                              )}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            : // Mobile: simplified - show all visible items, group chat/notifications into "Más"
              renderMobileItems()}
        </div>

        <div className="navbar__divider" />

        <div className="navbar__actions">
          <div className="navbar__account-actions" ref={dropdownRef}>
            <button
              className="navbar__item navbar__item--logout"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              title="Cerrar sesión"
            >
              <span className="navbar__item-icon-wrapper">
                <Icon size={24} className="navbar__item-icon">
                  power_settings_new
                </Icon>
              </span>
              {!isCollapsed && (
                <span className="navbar__item-label" suppressHydrationWarning>
                  Cerrar sesión
                </span>
              )}
            </button>

            {isDropdownOpen && (
              <div className="navbar__dropdown-menu">
                <button onClick={handleCloseStore} className="navbar__dropdown-item">
                  <Icon size={20}>store</Icon>
                  <span className="navbar__dropdown-label">Cerrar tienda</span>
                </button>
                <button onClick={handleLogout} className="navbar__dropdown-item">
                  <Icon size={20}>power_settings_new</Icon>
                  <span className="navbar__dropdown-label">Cerrar sesión</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
