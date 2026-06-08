// A fixed, fake cart used only by Developer mode to exercise the approval flow
// (overlays + a real test email) WITHOUT touching a real Amazon order. The item
// shape matches what parseCart produces after enrichment, so the demo email and
// guardian page render with the same rich detail as a live purchase.
export const SAMPLE_CART = {
  total: 47.98,
  items: [
    {
      asin: 'B0DEVSAMP1',
      title: 'Anker USB-C to USB-C Cable (6 ft, 100W), USB 2.0 Type-C Charging Cable',
      price: 9.99,
      qty: 1,
      image: 'https://m.media-amazon.com/images/I/61IZ6Cm2W4L._AC_SL1500_.jpg',
      url: 'https://www.amazon.com/dp/B0DEVSAMP1',
      rating: 4.7,
      reviewCount: 18432,
    },
    {
      asin: 'B0DEVSAMP2',
      title: 'Logitech M720 Triathlon Multi-Device Wireless Mouse, Bluetooth, USB Unifying Receiver',
      price: 37.99,
      qty: 1,
      image: 'https://m.media-amazon.com/images/I/618Xw6dKp8L._AC_SL1500_.jpg',
      url: 'https://www.amazon.com/dp/B0DEVSAMP2',
      rating: 4.5,
      reviewCount: 9210,
    },
  ],
};
