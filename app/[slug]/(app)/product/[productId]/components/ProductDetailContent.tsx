import { env } from '@/config/env';
import { resolvePublicBusinessRoute } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import {
  businessTeamMembers,
  productLikes,
  products as productsTable,
  profiles,
} from '@/core/database/schema';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import { getMemberPermissions } from '@/lib/permissions/checkPermission';
import { createServerClient } from '@supabase/ssr';
import { and, eq, inArray, ne, notInArray, or } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';

import {
  formatPrice,
  getCurrencyByCountry,
  parsePriceValue,
} from '@/features/storage/utils/currency';
import { Icon } from '@/shared/components/ui/data-display/Icon';
import { getBusinessPath } from '@/shared/utils/url';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import BackButton from './BackButton';
import LikeSection from './LikeSection';
import styles from './ProductDetail.module.css';
import ProductGallery from './ProductGallery';
import PurchaseActions from './PurchaseActions';
import RelatedProductsSection from './RelatedProductsSection';
import { SellerContactSection } from './SellerContactSection';

interface ProductDetailContentProps {
  slug: string;
  productId: string;
  isModal?: boolean;
  hasPaymentGateway?: boolean;
  isPaymentConfigured?: boolean;
  culqiPublicKey?: string;
}

export default async function ProductDetailContent({
  slug,
  productId,
  isModal = false,
  isPaymentConfigured = false,
  culqiPublicKey,
}: ProductDetailContentProps) {
  const cookieStore = await cookies();
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const businessDetail = (await resolvePublicBusinessRoute(slug))?.business;

  if (!businessDetail) {
    return notFound();
  }

  const rawProduct = await db.query.products.findFirst({
    where: and(
      eq(productsTable.businessId, businessDetail.id),
      or(eq(productsTable.id, productId), eq(productsTable.slug, productId)),
    ),
    with: {
      category: {
        columns: {
          name: true,
        },
      },
      media: {
        orderBy: (media, { asc }) => [asc(media.displayOrder)],
        columns: {
          mediaUrl: true,
          displayOrder: true,
        },
      },
    },
  });

  if (!rawProduct) {
    return notFound();
  }

  // Obtenemos los entitlements centrales para este negocio
  const entitlements = await getBusinessEntitlements(businessDetail.id);
  const { hasPaymentGateway } = entitlements;

  // Ownership comes from the membership check, not from a column: the business
  // row is now a public projection and no longer carries the owner linkage.
  const { isOwner } = await getMemberPermissions(businessDetail.id, user?.id);

  const product = {
    id: rawProduct.id,
    name: rawProduct.title,
    category: rawProduct.category?.name || 'Sin categoria',
    stock: rawProduct.stock,
    price: String(rawProduct.price),
    status: rawProduct.isAvailable ? 'ACTIVO' : 'NO ACTIVO',
    slug: rawProduct.slug,
    seoTitle: rawProduct.seoTitle,
    seoDescription: rawProduct.seoDescription,
    image: rawProduct.media[0]?.mediaUrl || '',
    images: rawProduct.media.map((m) => m.mediaUrl),
    description: rawProduct.description || '',
    currency: rawProduct.currency,
    displayOrder: rawProduct.displayOrder,
    createdAt: rawProduct.createdAt,
    brand: rawProduct.brand,
    tags: rawProduct.tags,
    shippingInfo: rawProduct.shippingInfo,
    saleStatus: rawProduct.saleStatus,
    secondPrice: rawProduct.secondPrice ? String(rawProduct.secondPrice) : null,
    metadata: (rawProduct.metadata as Record<string, unknown>) || {},
  };

  const metadataEntries = Object.entries(product.metadata).filter(([key, value]) => {
    if (key === '_public') return false;
    return value !== undefined && value !== null && value !== '';
  });
  const publicMetadataKeys = Array.isArray(product.metadata._public)
    ? (product.metadata._public as string[])
    : metadataEntries.map(([key]) => key);
  const publicMetadataEntries = metadataEntries.filter(([key]) => publicMetadataKeys.includes(key));

  // Deny access to inactive products for non-owners
  if (product.status === 'NO ACTIVO' && !isOwner) {
    return notFound();
  }

  const numericPrice = parsePriceValue(product.price);
  const currencyInfo = getCurrencyByCountry(product.currency);

  const mappedSymbol = product.currency === 'PEN' ? 'S/ ' : `${currencyInfo.symbol} `;
  const finalPrice = formatPrice(numericPrice, mappedSymbol);

  // Consideramos pagos habilitados solo si el plan lo permite Y las llaves están configuradas
  const paymentsEnabled = hasPaymentGateway && isPaymentConfigured;

  // Consultamos si el usuario actual ya le dio like al producto (por IP)
  const headersList = await headers();
  const xForwardedFor = headersList.get('x-forwarded-for');
  const xRealIp = headersList.get('x-real-ip');
  const rawIp = xForwardedFor ? xForwardedFor.split(',')[0] : xRealIp || 'unknown';
  const ipAddress = rawIp.trim() || 'unknown';

  const existingLike = await db
    .select({ id: productLikes.id })
    .from(productLikes)
    .where(and(eq(productLikes.productId, product.id), eq(productLikes.ipAddress, ipAddress)))
    .limit(1);

  const hasLiked = existingLike.length > 0;
  const likesCount = rawProduct.stars ?? 0;

  // Consultamos los miembros del equipo del negocio
  const teamMembers = await db
    .select({
      id: businessTeamMembers.id,
      role: businessTeamMembers.role,
      userId: profiles.id,
      name: profiles.fullName,
      email: profiles.email,
      phone: profiles.phone,
      avatarUrl: profiles.avatarUrl,
    })
    .from(businessTeamMembers)
    .innerJoin(profiles, eq(businessTeamMembers.userId, profiles.id))
    .where(eq(businessTeamMembers.businessId, businessDetail.id));

  // ── Productos Relacionados ──
  // Prioridad: misma marca → misma categoría → cualquier otro producto del negocio
  const RELATED_COUNT = 4;
  const baseRelatedWhere = and(
    eq(productsTable.businessId, businessDetail.id),
    eq(productsTable.isAvailable, true),
    ne(productsTable.id, rawProduct.id),
  );

  const relatedProducts: (typeof rawProduct)[] = [];
  const relatedIds = new Set<string>([rawProduct.id]);

  // 1) Misma marca — más antiguos primero + más likes
  if (rawProduct.brand && relatedProducts.length < RELATED_COUNT) {
    const brandProducts = await db.query.products.findMany({
      where: and(baseRelatedWhere, eq(productsTable.brand, rawProduct.brand)),
      orderBy: (p, { asc, desc }) => [asc(p.createdAt), desc(p.stars)],
      with: {
        category: { columns: { name: true } },
        media: {
          orderBy: (m, { asc }) => [asc(m.displayOrder)],
          columns: { mediaUrl: true, displayOrder: true },
        },
      },
      limit: RELATED_COUNT,
    });
    for (const p of brandProducts) {
      if (!relatedIds.has(p.id)) {
        relatedIds.add(p.id);
        relatedProducts.push(p);
      }
    }
  }

  // 2) Misma categoría
  if (rawProduct.categoryId && relatedProducts.length < RELATED_COUNT) {
    const missing = RELATED_COUNT - relatedProducts.length;
    const catProducts = await db.query.products.findMany({
      where: and(
        baseRelatedWhere,
        eq(productsTable.categoryId, rawProduct.categoryId),
        notInArray(productsTable.id, [...relatedIds]),
      ),
      orderBy: (p, { asc, desc }) => [asc(p.createdAt), desc(p.stars)],
      with: {
        category: { columns: { name: true } },
        media: {
          orderBy: (m, { asc }) => [asc(m.displayOrder)],
          columns: { mediaUrl: true, displayOrder: true },
        },
      },
      limit: missing,
    });
    for (const p of catProducts) {
      if (!relatedIds.has(p.id)) {
        relatedIds.add(p.id);
        relatedProducts.push(p);
      }
    }
  }

  // 3) Cualquier otro
  if (relatedProducts.length < RELATED_COUNT) {
    const missing = RELATED_COUNT - relatedProducts.length;
    const anyProducts = await db.query.products.findMany({
      where: and(baseRelatedWhere, notInArray(productsTable.id, [...relatedIds])),
      orderBy: (p, { asc, desc }) => [asc(p.createdAt), desc(p.stars)],
      with: {
        category: { columns: { name: true } },
        media: {
          orderBy: (m, { asc }) => [asc(m.displayOrder)],
          columns: { mediaUrl: true, displayOrder: true },
        },
      },
      limit: missing,
    });
    for (const p of anyProducts) {
      if (!relatedIds.has(p.id)) {
        relatedProducts.push(p);
      }
    }
  }

  // Likes de productos relacionados
  const relatedLikesMap = new Map<string, { count: number; hasLiked: boolean }>();
  if (relatedProducts.length > 0) {
    const relatedLikesData = await db
      .select({ productId: productLikes.productId, id: productLikes.id })
      .from(productLikes)
      .where(
        and(
          inArray(
            productLikes.productId,
            relatedProducts.map((p) => p.id),
          ),
          eq(productLikes.ipAddress, ipAddress),
        ),
      );

    const likedSet = new Set(relatedLikesData.map((l) => l.productId));
    for (const rp of relatedProducts) {
      relatedLikesMap.set(rp.id, {
        count: rp.stars ?? 0,
        hasLiked: likedSet.has(rp.id),
      });
    }
  }

  // Mapeamos los relacionados al formato del componente
  const relatedProductsData = relatedProducts.map((rp) => {
    const likeInfo = relatedLikesMap.get(rp.id) ?? { count: 0, hasLiked: false };
    return {
      id: rp.id,
      title: rp.title,
      price: String(rp.price),
      currency: rp.currency,
      secondPrice: rp.secondPrice ? String(rp.secondPrice) : null,
      stock: rp.stock,
      image: rp.media[0]?.mediaUrl ?? '',
      images: rp.media.map((m) => m.mediaUrl),
      description: rp.description ?? '',
      categoryName: rp.category?.name ?? 'Producto',
      likesCount: likeInfo.count,
      hasLiked: likeInfo.hasLiked,
    };
  });

  return (
    <div className={`${styles.pageContainer} ${isModal ? styles.modalContent : ''}`}>
      {!isModal && (
        <div className={styles.backButtonWrapper}>
          <BackButton
            href={isOwner ? getBusinessPath(slug, '/storage') : getBusinessPath(slug)}
            style={{ width: '56px', height: '56px' }}
          />
        </div>
      )}
      {/* BEGIN: Product Overview Section */}
      <section className={styles.productMain}>
        <ProductGallery images={product.images} productName={product.name} />

        <div className={styles.productInfoSidebar}>
          <div>
            <h1 className={styles.productTitle}>{product.name}</h1>
          </div>

          <div className={`${styles.priceBlock} ${product.stock === 0 ? styles.priceDimmed : ''}`}>
            {product.secondPrice ? (
              <div className={styles.priceWithDiscount}>
                <p className={styles.productPrice}>
                  {formatPrice(Number(product.secondPrice), mappedSymbol)}
                </p>
                <p className={styles.originalPrice}>{formatPrice(numericPrice, mappedSymbol)}</p>
                {numericPrice > 0 && (
                  <span className={styles.discountBadge}>
                    -
                    {Math.round(
                      ((numericPrice - Number(product.secondPrice)) / numericPrice) * 100,
                    )}
                    %
                  </span>
                )}
              </div>
            ) : (
              <p className={styles.productPrice}>{finalPrice}</p>
            )}
            {product.stock === 0 && <p className={styles.stockStatusOutOfStock}>AGOTADO</p>}
            {product.stock > 0 && product.stock <= 5 && (
              <p className={styles.stockStatusLowStock}>
                ¡Últimos! Quedan {product.stock} unidades
              </p>
            )}
          </div>

          {/* Metadata: brand, saleStatus, tags */}
          {(product.brand ||
            (product.saleStatus && product.saleStatus !== 'NORMAL') ||
            (product.tags && product.tags.length > 0)) && (
            <div className={styles.metadataRow}>
              {product.brand && (
                <span className={styles.badgeBrand}>{product.brand.toUpperCase()}</span>
              )}
              {product.saleStatus === 'MAS_VENDIDO' && (
                <span className={styles.badgeHot}>MÁS VENDIDO</span>
              )}
              {product.saleStatus === 'NUEVO_PRODUCTO' && (
                <span className={styles.badgeNew}>NUEVO</span>
              )}
              {product.tags && product.tags.length > 0 && (
                <div className={styles.tagsRow}>
                  {product.tags.map((tag, idx) => (
                    <span key={`${tag}-${idx}`} className={styles.tagChip}>
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={styles.accordion}>
            <div className={styles.accordionHeader}>
              <span className={styles.accordionHeaderTitle}>Descripción</span>
            </div>
            {product.description ? (
              <p className={styles.accordionContentText}>{product.description}</p>
            ) : (
              <p className={styles.accordionContentTextEmpty}>Sin descripción disponible.</p>
            )}
          </div>

          {publicMetadataEntries.length > 0 && (
            <div className={styles.accordion}>
              <div className={styles.accordionHeader}>
                <span className={styles.accordionHeaderTitle}>Información adicional</span>
              </div>
              <div className={styles.extraMetadataGrid}>
                {publicMetadataEntries.map(([key, value]) => (
                  <div key={key} className={styles.extraMetadataItem}>
                    <span className={styles.extraMetadataKey}>{key}</span>
                    <span className={styles.extraMetadataValue}>{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {product.stock > 0 || isOwner ? (
            <PurchaseActions
              product={product}
              business={businessDetail}
              hasPaymentGateway={paymentsEnabled}
              culqiPublicKey={culqiPublicKey || entitlements.culqiPublicKey}
              isOwner={isOwner}
              likesCount={likesCount}
              hasLiked={hasLiked}
              productId={product.id}
              businessSlug={slug}
            />
          ) : (
            <div className={styles.outOfStockRow}>
              <button className={styles.outOfStockButton} disabled>
                SIN STOCK
              </button>
              <LikeSection
                productId={product.id}
                businessSlug={slug}
                initialLikesCount={likesCount}
                initialHasLiked={hasLiked}
              />
            </div>
          )}

          <div className={styles.accordion}>
            <div className={styles.accordionHeader}>
              <span className={styles.accordionHeaderTitle}>Disponibilidad</span>
            </div>
            <div className={styles.shippingGrid}>
              <div className={styles.shippingItem}>
                <div className={styles.shippingIconContainer}>
                  <span className={styles.shippingIcon}>📋</span>
                </div>
                <div>
                  <p className={styles.shippingInfoTitle}>Disponibilidad</p>
                  <p className={styles.shippingInfoValue}>
                    {product.stock > 0
                      ? `${product.stock} unidad${product.stock !== 1 ? 'es' : ''}`
                      : 'Agotado'}
                  </p>
                </div>
              </div>
              {businessDetail.whatsappNumber && (
                <div className={styles.shippingItem}>
                  <div className={styles.shippingIconContainer}>
                    <span className={styles.shippingIcon}>📞</span>
                  </div>
                  <div>
                    <p className={styles.shippingInfoTitle}>Consultas</p>
                    <p className={styles.shippingInfoValue}>
                      <a
                        href={`https://wa.me/${businessDetail.whatsappNumber.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.whatsappInline}
                      >
                        {businessDetail.whatsappNumber}
                        <Icon size={14} style={{ opacity: 0.5 }}>
                          open_in_new
                        </Icon>
                      </a>
                    </p>
                  </div>
                </div>
              )}
              {(() => {
                // Si hay direccón, se muestra solo la direccón
                // Si no, se muestran los datos geográficos (departamento, provincia, distrito)
                let locationValue = '';
                if (businessDetail.address) {
                  locationValue = businessDetail.address;
                } else {
                  const parts = [];
                  if (businessDetail.departamento) parts.push(businessDetail.departamento);
                  if (businessDetail.provincia) parts.push(businessDetail.provincia);
                  if (businessDetail.distrito) parts.push(businessDetail.distrito);
                  if (businessDetail.city) parts.push(businessDetail.city);
                  if (parts.length > 0) locationValue = parts.join(', ');
                }
                return locationValue ? (
                  <div className={styles.shippingItem}>
                    <div className={styles.shippingIconContainer}>
                      <span className={styles.shippingIcon}>📍</span>
                    </div>
                    <div>
                      <p className={styles.shippingInfoTitle}>Ubicación</p>
                      <p className={styles.shippingInfoValue}>{locationValue}</p>
                    </div>
                  </div>
                ) : null;
              })()}
              {businessDetail.email && (
                <div className={styles.shippingItem}>
                  <div className={styles.shippingIconContainer}>
                    <span className={styles.shippingIcon}>✉️</span>
                  </div>
                  <div>
                    <p className={styles.shippingInfoTitle}>Email</p>
                    <p className={styles.shippingInfoValue}>{businessDetail.email}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {!isModal && (
        <RelatedProductsSection slug={slug} products={relatedProductsData} isOwner={isOwner} />
      )}

      {/* BEGIN: How to Buy Section */}
      <section className={styles.purchaseProcessSection}>
        <h2 className={styles.purchaseProcessTitle}>
          <Icon size={28} style={{ verticalAlign: 'middle', marginRight: '10px' }}>
            info
          </Icon>
          ¿Cómo comprar?
        </h2>

        {paymentsEnabled ? (
          <div className={styles.processSteps}>
            <div className={styles.processStep}>
              <span className={styles.stepNumber}>1</span>
              <div>
                <p className={styles.stepTitle}>Elige cómo recibirlo</p>
                <p className={styles.stepDesc}>
                  Recoge en <strong>tienda</strong> (gratis) o solicita <strong>envío</strong> a tu
                  ubicación: la entrega se coordina directamente con el negocio.
                </p>
              </div>
            </div>
            <div className={styles.processStep}>
              <span className={styles.stepNumber}>2</span>
              <div>
                <p className={styles.stepTitle}>Ingresa tus datos de contacto</p>
                <p className={styles.stepDesc}>
                  <strong>DNI</strong>, <strong>correo electrónico</strong> y dirección de entrega.
                  Datos válidos = el negocio puede ubicarte ante cualquier eventualidad.
                </p>
              </div>
            </div>
            <div className={styles.processStep}>
              <span className={styles.stepNumber}>3</span>
              <div>
                <p className={styles.stepTitle}>Paga seguro con Culqi</p>
                <p className={styles.stepDesc}>
                  Tarjeta, Yape, Billetera, Banca Móvil o Agente &mdash; pasarela 100% segura con
                  cifrado SSL 256-bit.
                </p>
              </div>
            </div>
            <details className={styles.processDetails} open>
              <summary className={styles.processSummary}>
                <div className={styles.processStep} style={{ flex: 1, cursor: 'pointer' }}>
                  <span className={styles.stepNumber}>4</span>
                  <div style={{ flex: 1 }}>
                    <p className={styles.stepTitle}>
                      Recibe tu comprobante
                      <span className={styles.importantBadge}>IMPORTANTE</span>
                    </p>
                    <p className={styles.stepDesc}>
                      Confirmación al instante, descarga tu <strong>ticket</strong> y sigue tu
                      pedido paso a paso.
                    </p>
                  </div>
                  <Icon size={20} className={styles.chevron}>
                    expand_more
                  </Icon>
                </div>
              </summary>

              <div className={styles.subStepsWrapper}>
                <div className={styles.processStepSub}>
                  <span className={styles.stepNumberSub}>4.1</span>
                  <div>
                    <p className={styles.stepTitle}>Sigue tu pedido</p>
                    <p className={styles.stepDesc}>
                      Ingresa a la página del negocio y haz clic en <strong>VER PEDIDO</strong>.
                      Desde allí podrás dar seguimiento al estado de tu orden en tiempo real.
                    </p>
                  </div>
                </div>
                <div className={styles.processStepSub}>
                  <span className={styles.stepNumberSub}>4.2</span>
                  <div>
                    <p className={styles.stepTitle}>Confirma el envío</p>
                    <p className={styles.stepDesc}>
                      El vendedor registrará el <strong>ticket de envío</strong> en tu orden.
                      Revísalo, verifica que los datos sean correctos y confírmalo para autorizar el
                      despacho.
                    </p>
                  </div>
                </div>
                <div className={styles.processStepSub}>
                  <span className={styles.stepNumberSub}>4.3</span>
                  <div>
                    <p className={styles.stepTitle}>Rastrea tu entrega</p>
                    <p className={styles.stepDesc}>
                      El vendedor te notificará cuando el producto esté en ruta.
                    </p>
                  </div>
                </div>
                <div className={styles.processStepSub}>
                  <span className={styles.stepNumberSub}>4.4</span>
                  <div>
                    <p className={styles.stepTitle}>Finaliza tu compra</p>
                    <p className={styles.stepDesc}>
                      Cuando recibas el producto, acepta la <strong>FINALIZACIÓN</strong> que te
                      enviará el vendedor. Esto cierra tu compra de manera exitosa.
                    </p>
                  </div>
                </div>
                <div className={styles.processStepSub}>
                  <span className={styles.stepNumberSub}>4.5</span>
                  <div>
                    <p className={styles.stepTitle}>Reporta incidencias</p>
                    <p className={styles.stepDesc}>
                      Si algo no está bien, repórtalo durante <strong>VERIFICAR</strong> o{' '}
                      <strong>FINALIZAR</strong>. El vendedor recibirá tu notificación y podrá
                      asistirte.
                    </p>
                  </div>
                </div>
              </div>
            </details>

            {/* Step 5 — Closing */}
            <div className={styles.stepClosing}>
              <span className={styles.stepClosingCircle}>5</span>
              <div>
                <p className={styles.stepTitle}>¡Compra exitosa!</p>
                <p className={styles.stepDesc}>
                  Tanto el vendedor como tú quedan satisfechos con la transacción.{' '}
                  <strong>¡Felicitaciones por tu compra en {businessDetail.name}!</strong> Esperamos
                  verte de nuevo pronto &mdash; tu satisfacción es lo más importante para nosotros.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.processSteps}>
            <div className={styles.processStep}>
              <span className={styles.stepNumber}>1</span>
              <div>
                <p className={styles.stepTitle}>Agrega al carrito</p>
                <p className={styles.stepDesc}>
                  Añade el producto y presiona <strong>&quot;Contactar Negocio&quot;</strong>.
                </p>
              </div>
            </div>
            <div className={styles.processStep}>
              <span className={styles.stepNumber}>2</span>
              <div>
                <p className={styles.stepTitle}>Coordina por WhatsApp</p>
                <p className={styles.stepDesc}>
                  Acuerda el método de pago y la entrega directamente con el vendedor.
                </p>
              </div>
            </div>
            <div className={styles.processStep}>
              <span className={styles.stepNumber}>3</span>
              <div>
                <p className={styles.stepTitle}>Recibe tu producto</p>
                <p className={styles.stepDesc}>
                  Una vez coordinado, recibe tu pedido según lo acordado con el negocio.
                </p>
              </div>
            </div>
          </div>
        )}

        {paymentsEnabled && (
          <div className={styles.processFooter}>
            <span className={styles.processFooterIcon}>
              <Icon size={16}>verified_user</Icon>
            </span>
            <p className={styles.processFooterText}>
              Pago procesado por <strong>Culqi</strong> &mdash; tus datos financieros viajan
              cifrados y nunca los almacenamos. Compra respaldada por la pasarela líder en
              Latinoamérica.
            </p>
          </div>
        )}
      </section>

      {/* BEGIN: Business Contact Info Section */}
      <section className={styles.businessContactSection}>
        <h2 className={styles.businessContactTitle}>
          <Icon size={28} style={{ verticalAlign: 'middle', marginRight: '10px' }}>
            headset_mic
          </Icon>
          Atención al Cliente
        </h2>

        {/* Public seller contact: business identity + real RUC + contact channels.
            Legal representative identity (name/role) is NEVER rendered here (Ley 29733). */}
        <SellerContactSection business={businessDetail} />

        {/* Block 3: Team (only if has members) */}
        {teamMembers.length > 0 && (
          <div className={styles.contactBlock} style={{ marginTop: '2rem' }}>
            <p className={styles.contactBlockTitle}>
              <Icon size={18} style={{ verticalAlign: 'middle', marginRight: '6px' }}>
                group
              </Icon>
              Equipo de Trabajo
              <span className={styles.teamCount}>
                {teamMembers.length} miembro{teamMembers.length !== 1 ? 's' : ''}
              </span>
            </p>
            <div className={styles.teamGrid}>
              {teamMembers.map((member) => (
                <div key={member.id} className={styles.teamCard}>
                  <div className={styles.teamCardHeader}>
                    <span className={styles.teamAvatar}>
                      {member.avatarUrl ? (
                        <Image
                          src={member.avatarUrl}
                          alt=""
                          className={styles.teamAvatarImg}
                          width={36}
                          height={36}
                        />
                      ) : (
                        member.name.charAt(0).toUpperCase()
                      )}
                    </span>
                    <div>
                      <p className={styles.teamMemberName}>{member.name}</p>
                      <span
                        className={`${styles.teamRoleBadge} ${
                          member.role === 'admin' ? styles.teamRoleAdmin : styles.teamRoleMember
                        }`}
                      >
                        {member.role === 'admin' ? 'Admin' : 'Miembro'}
                      </span>
                    </div>
                  </div>
                  <div className={styles.teamCardBody}>
                    {member.email && (
                      <span className={styles.teamDetail}>
                        <Icon size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }}>
                          mail
                        </Icon>
                        {member.email}
                      </span>
                    )}
                    {member.phone && (
                      <span className={styles.teamDetail}>
                        <Icon size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }}>
                          phone
                        </Icon>
                        <a
                          href={`https://wa.me/${member.phone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.whatsappInline}
                        >
                          {member.phone}
                          <Icon size={14} style={{ opacity: 0.5 }}>
                            open_in_new
                          </Icon>
                        </a>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
