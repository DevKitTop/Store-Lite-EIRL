import { Heading, Section, Text } from '@react-email/components';
import { EmailButton } from './components/button';
import { Layout } from './components/layout';

interface WelcomeEmailProps {
  businessName: string;
  ownerName: string;
  settingsUrl: string;
  durationDays: number;
}

export function WelcomeEmail({
  businessName,
  ownerName,
  settingsUrl,
  durationDays,
}: WelcomeEmailProps) {
  return (
    <Layout previewText="Tu oferta de bienvenida está lista" businessName={businessName}>
      <Heading
        style={{
          fontSize: '24px',
          color: '#18181b',
          margin: '0 0 24px',
          textAlign: 'center',
          fontWeight: '700',
        }}
      >
        ¡Hola {ownerName}!
      </Heading>

      <Text
        style={{
          fontSize: '16px',
          color: '#3f3f4f',
          lineHeight: '1.8',
          margin: '0 0 24px',
        }}
      >
        Tu negocio ya está creado. Como usuario nuevo tenés {durationDays} días de Lite Pago sin
        cobro. Podés reclamar la oferta cuando quieras desde Opciones → Plan y Límites.
      </Text>

      <Text
        style={{
          fontSize: '16px',
          color: '#3f3f4f',
          lineHeight: '1.8',
        }}
      >
        <strong>Qué incluye:</strong>
      </Text>
      <Section style={{ paddingLeft: '20px' }}>
        <Text style={{ fontSize: '15px', color: '#3f3f4f', lineHeight: '1.8', margin: '4px 0' }}>
          • {durationDays} días de Lite Pago, sin pago ni tarjeta en Store Lite.
        </Text>
        <Text style={{ fontSize: '15px', color: '#3f3f4f', lineHeight: '1.8', margin: '4px 0' }}>
          • Hasta 50 productos en el catálogo.
        </Text>
        <Text style={{ fontSize: '15px', color: '#3f3f4f', lineHeight: '1.8', margin: '4px 0' }}>
          • Dashboard de métricas disponible durante la oferta.
        </Text>
      </Section>

      <Text
        style={{
          fontSize: '16px',
          color: '#3f3f4f',
          lineHeight: '1.8',
          marginTop: '24px',
        }}
      >
        Al vencer volvés a Lite: el catálogo queda en 50 productos, los excedentes se ocultan (no se
        borran) y el dashboard se desactiva. Te avisamos 5 días antes.
      </Text>

      <Section style={{ textAlign: 'center', marginTop: '28px' }}>
        <EmailButton href={settingsUrl}>Ver mi oferta</EmailButton>
      </Section>
    </Layout>
  );
}
