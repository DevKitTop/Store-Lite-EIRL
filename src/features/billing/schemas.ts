import { BUYER_NAME_ERROR_MESSAGE, isTwoWordName } from '@/shared/payments/buyerName';
import { z } from 'zod';

const customerAuthSchema = z.object({
  provider: z.string(),
  authId: z.string().min(1, 'authId es requerido'),
  name: z.string().optional(),
  email: z.string().email().optional(),
  avatarUrl: z.string().nullable().optional(),
});

export const chargeRequestSchema = z
  .object({
    token: z.string().min(1, 'El token de Culqi es obligatorio').optional(),
    culqiOrderId: z.string().min(1, 'El ID de orden de Culqi es obligatorio').optional(),
    amount: z.number().int().min(100, 'El monto mínimo es S/ 1.00 (100 céntimos)'),
    currency: z.string().default('PEN'),
    email: z.string().email('Email no válido').optional().or(z.literal('')),
    phone: z.string().optional().nullable(),
    customerName: z
      .string()
      .trim()
      .min(3, 'El nombre del cliente debe tener al menos 3 caracteres')
      .optional(),
    businessId: z.string().uuid('ID de negocio inválido'),
    productId: z.string().uuid('ID de producto inválido'),
    customerAuth: customerAuthSchema.optional(),
    metadata: z
      .object({
        orderNumber: z.string().optional(),
        shippingInfo: z
          .object({
            courier: z.string().optional(),
            department: z.string().optional(),
            province: z.string().optional(),
            district: z.string().optional(),
            address: z.string().optional(),
            agency: z.string().optional(),
            reference: z.string().optional(),
            phone: z.string().optional(),
            dni: z.string().optional(),
          })
          .optional(),
        cartItems: z
          .array(
            z.object({
              id: z.string().uuid(),
              quantity: z.number().int().min(1),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .refine((data) => data.token || data.culqiOrderId, {
    message: 'Se requiere token o culqiOrderId',
  })
  .refine((data) => !data.customerName || isTwoWordName(data.customerName), {
    message: BUYER_NAME_ERROR_MESSAGE,
    path: ['customerName'],
  });

export type ChargeRequestInput = z.infer<typeof chargeRequestSchema>;

export const createOrderRequestSchema = z
  .object({
    amount: z.number().int().min(100, 'Monto mínimo S/ 1.00 (100 céntimos)'),
    currency: z.string().default('PEN'),
    email: z.string().email('Email no válido'),
    phone: z.string().optional().nullable(),
    customerName: z
      .string()
      .trim()
      .min(3, 'El nombre del cliente debe tener al menos 3 caracteres')
      .optional(),
    businessId: z.string().uuid('ID de negocio inválido'),
    productId: z.string().uuid('ID de producto inválido').optional(),
    description: z.string().optional(),
  })
  .refine((data) => !data.customerName || isTwoWordName(data.customerName), {
    message: BUYER_NAME_ERROR_MESSAGE,
    path: ['customerName'],
  });
export type CreateOrderRequestInput = z.infer<typeof createOrderRequestSchema>;

export const trackOrderSchema = z.object({
  dni: z.string().min(1, 'DNI es requerido'),
  orderNumber: z.string().min(1, 'Número de orden es requerido'),
});
export type TrackOrderInput = z.infer<typeof trackOrderSchema>;

export const lookupOrderSchema = z.object({
  dni: z.string().regex(/^\d{8}$/, 'El DNI debe tener exactamente 8 dígitos numéricos'),
  orderNumber: z
    .string()
    .min(1, 'El número de orden es requerido')
    .transform((val) => (val.startsWith('#') ? val.slice(1) : val)),
  businessSlug: z.string().min(1, 'El slug del negocio es requerido'),
  // Optional: only present on the "I already have this order open" retry path.
  // When absent the caller is doing a fresh DNI+order lookup (no cookie gate);
  // when present the route additionally requires a matching signed order-access
  // cookie before it will echo the tracking token back.
  trackingToken: z.string().min(1, 'El token de seguimiento es requerido').optional(),
});
export type LookupOrderInput = z.infer<typeof lookupOrderSchema>;
