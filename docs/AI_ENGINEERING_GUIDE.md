# Store Lite Engineering Guide

## Arquitectura

UI
→ src/shared/components
→ src/features/\*/components

Domain
→ src/features/\*

Infrastructure
→ src/core
→ src/lib

Routes
→ app

---

## Reglas

No colocar fetch dentro de componentes visuales.

No colocar lógica de negocio dentro de page.tsx.

No acceder directamente a la base de datos desde UI.

---

## Server Actions

Ubicación:

app/actions

Responsabilidad:

- validar
- llamar casos de uso
- devolver resultado

No contener lógica de negocio compleja.

---

## Componentes

Server Component por defecto.

Client Component solamente cuando exista:

- estado local
- eventos
- useEffect
- hooks del navegador

---

## Convenciones

ProductCard.tsx

useProduct.ts

product.service.ts

product.controller.ts

product.repository.ts

---

## Flujo recomendado

UI
→ Action
→ Service
→ Repository
→ Database
