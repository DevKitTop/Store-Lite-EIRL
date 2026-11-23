import { Heading, Section, Text } from '@react-email/components';
import { EmailButton } from './components/button';
import { Layout } from './components/layout';

interface ReminderEmailProps {
  businessName: string;
  ownerName: string;
  planEndDate: string;
  daysRemaining: number;
  settingsUrl: string;
}

export function ReminderEmail({
  businessName,
  ownerName,
  planEndDate,
  daysRemaining,
  settingsUrl,
}: ReminderEmailProps) {
  return (
    <Layout previewText="Tu oferta de Lite Pago vence pronto" businessName={businessName}>
      <Heading
        style={{
          fontSize: '24px',
          color: '#18181b',
          margin: '0 0 24px',
          textAlign: 'center',
          fontWeight: '700',
        }}
      >
        Tu oferta vence en {daysRemaining} días
      </Heading>

      <Text
        style={{
          fontSize: '16px',
          color: '#3f3f4f',
          lineHeight: '1.8',
          margin: '0 0 24px',
        }}
      >
        Hola {ownerName}, te recordamos que tu mes gratis de Lite Pago termina el {planEndDate}.
      </Text>

      <Text
        style={{
          fontSize: '16px',
          color: '#3f3f4f',
          lineHeight: '1.8',
        }}
      >
        Al vencer volvés a Lite automáticamente: el catálogo queda en 50 productos, los excedentes
        se ocultan (no se borran) y el dashboard se desactiva. No tenés que hacer nada para que la
        transición ocurra.
      </Text>

      <Section style={{ textAlign: 'center', marginTop: '28px' }}>
        <EmailButton href={settingsUrl}>Ver Plan y Límites</EmailButton>
      </Section>
    </Layout>
  );
}
