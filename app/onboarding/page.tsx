'use client';

import { AnalyticsEvents } from '@/lib/analytics/taxonomy';
import { Button, Card, Icon } from '@/shared/components/ui';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { posthog } from 'posthog-js';
import { useEffect, useRef, useState } from 'react';
import styles from './onboarding.module.css';

interface OnboardingUser {
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [user, setUser] = useState<OnboardingUser | null>(null);
  const [hasBusinesses, setHasBusinesses] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const trackedRef = useRef(false);

  useEffect(() => {
    // Fetch current user info + business state from auth
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/auth/user');
        if (response.ok) {
          const data = await response.json();
          if (data.user) {
            setUser(data.user);
          }
          setHasBusinesses(data.hasBusinesses ?? false);
        }
      } catch (error) {
        console.error('Error fetching user:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUser();
  }, []);

  useEffect(() => {
    if (trackedRef.current) return;
    if (!user) return;

    trackedRef.current = true;
    try {
      if (typeof posthog?.capture === 'function') {
        posthog.capture(AnalyticsEvents.USER_REGISTERED);
      }
    } catch {
      // Analytics should never block user flow
    }
  }, [user]);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <Icon size={48}>sync</Icon>
          <p>Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        {/* Welcome Header */}
        <div className={styles.header}>
          {user?.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt="Avatar"
              className={styles.avatar}
              width={96}
              height={96}
            />
          ) : (
            <div className={styles.avatarPlaceholder}>
              <Icon size={48}>person</Icon>
            </div>
          )}
          <h1 className={styles.title}>
            ¡Bienvenido{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}!
          </h1>
          <p className={styles.subtitle}>¿Qué te gustaría hacer hoy?</p>
        </div>

        {/* Options */}
        <div className={styles.options}>
          {/* Create Business */}
          <Card variant="outlined" className={styles.optionCard}>
            <div className={styles.optionIcon}>
              <Icon size={32}>add_business</Icon>
            </div>
            <h2 className={styles.optionTitle}>
              {hasBusinesses ? 'Crear otro negocio' : 'Crear mi negocio'}
            </h2>
            <p className={styles.optionDescription}>
              {hasBusinesses
                ? 'Suma un nuevo negocio a tu panel y gestiona todas tus tiendas desde un solo lugar.'
                : 'Lanza tu propia tienda virtual y comienza a vender productos digitales.'}
            </p>
            <Button
              variant="filled"
              onClick={() => router.push('/create-business')}
              className={styles.optionButton}
            >
              <Icon slot="icon" size={20}>
                arrow_forward
              </Icon>
              Crear negocio
            </Button>
          </Card>

          {/* Join Team */}
          <Card variant="outlined" className={styles.optionCard}>
            <div className={styles.optionIcon}>
              <Icon size={32}>group_add</Icon>
            </div>
            <h2 className={styles.optionTitle}>Unirme a un equipo</h2>
            <p className={styles.optionDescription}>
              Si ya tienes un código de invitación, únete a un negocio existente.
            </p>
            <Button
              variant="outlined"
              onClick={() => router.push('/join')}
              className={styles.optionButton}
            >
              <Icon slot="icon" size={20}>
                login
              </Icon>
              Unirme a un equipo
            </Button>
          </Card>
        </div>

        {/* Skip for later */}
        <div className={styles.skip}>
          <Button variant="text" onClick={() => router.push('/list-business')}>
            Ir a mis negocios después
          </Button>
        </div>
      </div>
    </div>
  );
}
