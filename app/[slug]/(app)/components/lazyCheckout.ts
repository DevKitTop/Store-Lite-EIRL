'use client';

import dynamic from 'next/dynamic';

// Checkout only mounts when a visitor opens the cart or starts a purchase, but
// it used to be imported statically, so every storefront visitor downloaded
// the checkout flow and the Culqi SDK before buying anything.
//
// No eager prefetch here on purpose: scheduling the chunk on `load` fires
// before the largest contentful paint on these pages and pushes the checkout
// code straight back onto the critical path.
export const LazyCheckout = dynamic(() => import('./Checkout'), {
  ssr: false,
  loading: () => null,
});
