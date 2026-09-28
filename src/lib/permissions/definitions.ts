// =====================================================
// PERMISSIONS — Definitions and Constants
// =====================================================
// Source of truth for all permission strings and role defaults
// =====================================================

export type Permission =
  | 'products.view'
  | 'products.create'
  | 'products.edit'
  | 'products.delete'
  | 'categories.view'
  | 'categories.create'
  | 'categories.edit'
  | 'categories.delete'
  | 'storefront.edit'
  | 'seo.edit'
  | 'chat.view'
  | 'chat.respond'
  | 'chat.delete'
  | 'dashboard.view'
  | 'orders.manage'
  | 'storage.upload'
  | 'storage.delete'
  | 'home.edit'
  | 'business.edit'
  | 'business.delete'
  | 'team.manage'
  | 'team.invite'
  | 'plan.view'
  | 'plan.change'
  | 'contact.edit'
  | 'legal.edit'
  | 'notifications.view'
  | 'feedback.submit'
  | 'feedback.view'
  | 'feedback.respond';

export type Role = 'owner' | 'admin' | 'member';

/**
 * Permisos por defecto para cada rol.
 * Miembros tienen acceso limitado (sin deletes, sin gestión de equipo).
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    'products.view',
    'products.create',
    'products.edit',
    'products.delete',
    'categories.view',
    'categories.create',
    'categories.edit',
    'categories.delete',
    'storefront.edit',
    'seo.edit',
    'chat.view',
    'chat.respond',
    'chat.delete',
    'dashboard.view',
    'orders.manage',
    'storage.upload',
    'storage.delete',
    'home.edit',
    'business.edit',
    'business.delete',
    'team.manage',
    'team.invite',
    'plan.view',
    'plan.change',
    'contact.edit',
    'legal.edit',
    'notifications.view',
    'feedback.submit',
    'feedback.view',
    'feedback.respond',
  ],

  admin: [
    'products.view',
    'products.create',
    'products.edit',
    'products.delete',
    'categories.view',
    'categories.create',
    'categories.edit',
    'categories.delete',
    'storefront.edit',
    'seo.edit',
    'chat.view',
    'chat.respond',
    'chat.delete',
    'dashboard.view',
    'orders.manage',
    'storage.upload',
    'storage.delete',
    'home.edit',
    'team.manage',
    'team.invite',
    'notifications.view',
    'feedback.submit',
    'feedback.view',
    'feedback.respond',
  ],

  member: [
    'products.view',
    'products.create',
    'products.edit',
    // NO products.delete
    'categories.view',
    'categories.create',
    'categories.edit',
    // NO categories.delete
    'storefront.edit',
    'seo.edit',
    'chat.view',
    'chat.respond',
    'dashboard.view',
    'orders.manage',
    'storage.upload',
    // NO storage.delete
    'home.edit',
    'notifications.view',
    'feedback.submit',
    'feedback.view',
    // NO feedback.respond — only owners and admins can respond
  ],
};

/**
 * Grupos de permisos para UI (matriz de permisos)
 */
export const PERMISSION_GROUPS: Record<
  string,
  { label: string; icon: string; permissions: Permission[] }
> = {
  products: {
    label: 'Productos',
    icon: 'inventory_2',
    permissions: ['products.view', 'products.create', 'products.edit', 'products.delete'],
  },
  categories: {
    label: 'Categorías',
    icon: 'category',
    permissions: ['categories.view', 'categories.create', 'categories.edit', 'categories.delete'],
  },
  storefront: {
    label: 'Storefront',
    icon: 'view_quilt',
    permissions: ['storefront.edit'],
  },
  seo: {
    label: 'SEO',
    icon: 'travel_explore',
    permissions: ['seo.edit'],
  },
  chat: {
    label: 'Chat',
    icon: 'chat',
    permissions: ['chat.view', 'chat.respond', 'chat.delete'],
  },
  dashboard: {
    label: 'Dashboard',
    icon: 'dashboard',
    permissions: ['dashboard.view'],
  },
  orders: {
    label: 'Pedidos',
    icon: 'local_shipping',
    permissions: ['orders.manage'],
  },
  storage: {
    label: 'Almacenamiento',
    icon: 'cloud_upload',
    permissions: ['storage.upload', 'storage.delete'],
  },
  home: {
    label: 'Página de Inicio',
    icon: 'home',
    permissions: ['home.edit'],
  },
  business: {
    label: 'Negocio',
    icon: 'store',
    permissions: ['business.edit', 'business.delete'],
  },
  team: {
    label: 'Equipo',
    icon: 'group',
    permissions: ['team.manage', 'team.invite'],
  },
  plan: {
    label: 'Plan',
    icon: 'workspace_premium',
    permissions: ['plan.view', 'plan.change'],
  },
  contact: {
    label: 'Contacto',
    icon: 'contact_page',
    permissions: ['contact.edit'],
  },
  legal: {
    label: 'Legal',
    icon: 'gavel',
    permissions: ['legal.edit'],
  },
  notifications: {
    label: 'Notificaciones',
    icon: 'notifications',
    permissions: ['notifications.view'],
  },
  feedback: {
    label: 'Feedback',
    icon: 'feedback',
    permissions: ['feedback.submit', 'feedback.view', 'feedback.respond'],
  },
};

/**
 * Metadatos de cada permiso para UI
 */
export const PERMISSION_LABELS: Record<Permission, { label: string; description: string }> = {
  'products.view': { label: 'Ver productos', description: 'Puede ver la lista de productos' },
  'products.create': { label: 'Crear productos', description: 'Puede crear nuevos productos' },
  'products.edit': {
    label: 'Editar productos',
    description: 'Puede modificar productos existentes',
  },
  'products.delete': { label: 'Eliminar productos', description: 'Puede eliminar productos' },
  'categories.view': { label: 'Ver categorías', description: 'Puede ver las categorías' },
  'categories.create': { label: 'Crear categorías', description: 'Puede crear nuevas categorías' },
  'categories.edit': {
    label: 'Editar categorías',
    description: 'Puede modificar categorías existentes',
  },
  'categories.delete': { label: 'Eliminar categorías', description: 'Puede eliminar categorías' },
  'storefront.edit': {
    label: 'Editar storefront',
    description: 'Puede personalizar colores y layout',
  },
  'seo.edit': { label: 'Editar SEO', description: 'Puede modificar configuración de SEO' },
  'chat.view': { label: 'Ver chat', description: 'Puede ver las conversaciones' },
  'chat.respond': { label: 'Responder chat', description: 'Puede responder a clientes' },
  'chat.delete': { label: 'Eliminar chats', description: 'Puede eliminar sesiones de chat' },
  'dashboard.view': { label: 'Ver dashboard', description: 'Puede ver métricas y estadísticas' },
  'orders.manage': {
    label: 'Gestionar pedidos',
    description: 'Puede avanzar y finalizar pedidos',
  },
  'storage.upload': { label: 'Subir archivos', description: 'Puede subir imágenes y archivos' },
  'storage.delete': { label: 'Eliminar archivos', description: 'Puede eliminar archivos subidos' },
  'home.edit': {
    label: 'Editar página de inicio',
    description: 'Puede modificar la página principal',
  },
  'business.edit': { label: 'Editar negocio', description: 'Puede cambiar nombre y configuración' },
  'business.delete': { label: 'Eliminar negocio', description: 'Puede eliminar el negocio' },
  'team.manage': { label: 'Gestionar equipo', description: 'Puede agregar y remover miembros' },
  'team.invite': { label: 'Invitar miembros', description: 'Puede generar códigos de invitación' },
  'plan.view': { label: 'Ver plan', description: 'Puede ver información del plan' },
  'plan.change': { label: 'Cambiar plan', description: 'Puede cambiar el plan de suscripción' },
  'contact.edit': {
    label: 'Editar contacto',
    description: 'Puede modificar información de contacto',
  },
  'legal.edit': { label: 'Editar legal', description: 'Puede modificar términos y políticas' },
  'notifications.view': {
    label: 'Ver notificaciones',
    description: 'Puede ver el centro de notificaciones',
  },
  'feedback.submit': {
    label: 'Enviar feedback',
    description: 'Puede enviar feedback y sugerencias',
  },
  'feedback.view': {
    label: 'Ver feedback',
    description: 'Puede ver historial de feedback',
  },
  'feedback.respond': {
    label: 'Responder feedback',
    description: 'Puede responder a tickets de feedback',
  },
};

/**
 * Verifica si un permiso es "sensible" (eliminación, configuración crítica)
 */
export const SENSITIVE_PERMISSIONS: Permission[] = [
  'products.delete',
  'categories.delete',
  'chat.delete',
  'storage.delete',
  'business.delete',
  'team.manage',
  'plan.change',
  'legal.edit',
];
