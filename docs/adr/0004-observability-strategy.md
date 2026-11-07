# ADR 0004: Observabilidad y Monitoreo (Sentry + PostHog)

**Status**: Accepted (parcialmente superado por ADR 0005: las grabaciones de sesión de PostHog y las de Sentry quedaron revisadas y medidos sus costos)

## Contexto

En producción, no teníamos visibilidad de errores ni de cómo los usuarios interactuaban con la plataforma.

## Decisión

Integramos Sentry para el rastreo de errores y excepciones, y PostHog para analíticas de producto y grabaciones de sesión.

## Consecuencias

- **Positivas**: Resolución de bugs proactiva, datos reales para decisiones de producto.
- **Negativas**: Impacto mínimo en el tamaño del bundle, necesidad de gestionar secrets adicionales.
