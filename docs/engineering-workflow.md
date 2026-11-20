# Engineering Workflow: Store Lite SaaS 🛠️

Este documento define el ciclo de vida de una tarea, desde la idea hasta que está corriendo en producción monitoreada. Seguir este flujo garantiza que el SaaS sea estable y profesional.

---

## 1. Inicio: Rama y Propósito

Nunca trabajes directo en `develop` o `main`.

- **Comando**: `git checkout -b tipo/nombre-de-la-tarea`
- **Tipos**: `feat/` (nueva funcionalidad), `fix/` (error), `chore/` (mantenimiento/deps), `docs/` (documentación).
- **Ejemplo**: `git checkout -b feat/login-google`

## 2. Desarrollo con Red de Seguridad

Mientras escribís código, usá las herramientas locales para no arrastrar errores.

- **Unit Testing**: Corré `pnpm test:unit:watch` en una terminal aparte. Cada vez que guardes un archivo, los tests se ejecutan. Si rompés algo, te enterás en 1 segundo.
- **Tipado**: Si ves subrayados rojos en VS Code, no los ignores. El CI va a fallar si TypeScript no está feliz.

## 3. El Momento del Commit (El Filtro Local)

Cuando termines la tarea, hacé el commit.

- **Comando**: `git add .` -> `git commit -m "tipo: descripción clara"`
- **¿Qué pasa acá?**
  1. **Husky**: Gatilla `lint-staged`.
  2. **Lint-Staged**: Formatea tu código y arregla problemas de estilo automáticos.
  3. **Commitlint**: Verifica que tu mensaje sea profesional (ej: `feat: add google auth`). Si ponés "un fix", el commit **va a fallar**.

## 4. Push y Pull Request (El Filtro Cloud)

Subí tus cambios y abrí un PR contra `develop`.

- **GitHub Actions**: En cuanto abras el PR, se disparan los jobs:
  - **Build Check**: Verifica que la app compile.
  - **Quality**: Corre el linter y type-check.
  - **Tests**: Corre Vitest y Playwright.
- **Título del PR = mensaje del squash commit**: Al mergear con squash, GitHub usa el **título del PR** como subject del commit en `develop`, y Commit Lint lo valida en ese push. El subject **debe arrancar en minúscula** después de `tipo(scope):`.
  - Correcto: `feat(pwa): implement fan-out/dedup`
  - Incorrecto: `feat: PWA fan-out/dedup` (arranca con mayúscula → `subject-case` falla)
  - El acrónimo puede ir después de la primera palabra: `feat: add PWA fan-out/dedup` sí pasa.
- **Regla de Oro**: Si algo está en rojo, **no se mergea**. Se arregla en la rama y se vuelve a subir.

## 5. Producción y Observabilidad (El Radar)

Una vez mergeado y desplegado (Vercel):

- **Sentry**: Entrá una vez al día o configurá alertas en Slack/Mail. Si un usuario tiene un error, Sentry te va a mostrar el "StackTrace" real gracias a los Source Maps que configuramos.
- **PostHog**: Mirá los "Live Events" y "Session Recordings". ¿El usuario entendió el nuevo botón? ¿Se quedó trabado? Acá es donde obtenés la verdad del producto.

---

## Resumen de Comandos Útiles

| Comando                | Propósito             | ¿Cuándo usarlo?                |
| ---------------------- | --------------------- | ------------------------------ |
| `pnpm dev`             | Levantar la app       | Durante el desarrollo          |
| `pnpm test:unit:watch` | Tests rápidos         | Mientras escribís lógica       |
| `pnpm test:e2e`        | Probar flujo completo | Antes de mandar un PR pesado   |
| `pnpm quality`         | Linter + Tipos        | Una última verificación manual |
