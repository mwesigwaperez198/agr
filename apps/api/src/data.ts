export const settings = {
  appName: 'HarvestLink',
  tagline: 'Connecting Farmers to Markets',
  aiName: 'AgriGuide',
  primaryColor: '#135c3a',
  secondaryColor: '#d39a2c',
  currency: 'UGX',
  defaultLanguage: 'en',
  supportedLanguages: [
    { code: 'en', name: 'English', nativeName: 'English', voice: true, voiceProvider: 'Browser / device', fallback: 'en', enabled: true, publicationStatus: 'approved', completion: 100 },
    { code: 'lg', name: 'Luganda', nativeName: 'Luganda', voice: 'device-dependent', voiceProvider: 'Browser / device when available', fallback: 'en', enabled: true, publicationStatus: 'draft', completion: 100 },
    { code: 'nyn', name: 'Runyankole', nativeName: 'Runyankole', voice: false, voiceProvider: 'Not configured', fallback: 'en', enabled: false, publicationStatus: 'planned', completion: 0 },
    { code: 'ach', name: 'Acholi', nativeName: 'Acholi', voice: false, voiceProvider: 'Not configured', fallback: 'en', enabled: false, publicationStatus: 'planned', completion: 0 },
  ],
  commissionBasisPoints: 500,
  paymentFeeBasisPoints: 150,
  dataSaverDefault: false,
  supportPhone: '+256 800 123 400',
  country: 'Uganda',
  timezone: 'Africa/Kampala',
  maintenanceMode: false,
  systemBanner: '',
  marketplaceEnabled: true,
  aiEnabled: true,
  aiImageEnabled: true,
  aiVoiceEnabled: true,
  aiAuthenticatedDailyLimit: 100,
  aiRateLimitPerFiveMinutes: 20,
  notificationsEnabled: true,
  coffeeHubEnabled: true,
  buyerRequestsEnabled: true,
  guestAccess: {
    marketplace: true,
    ai: true,
    aiDailyLimit: 3,
    imageAnalysis: true,
    imageDailyLimit: 1,
    voice: true,
    articles: true,
    productViewing: true,
    farmerProfiles: true,
    search: true,
    cart: true,
  },
};

export const categories = [
  { id: 'cat_coffee', name: 'Coffee', slug: 'coffee', icon: 'coffee', kind: 'coffee', count: 148 },
  { id: 'cat_crops', name: 'Food crops', slug: 'crops', icon: 'sprout', kind: 'crop', count: 96 },
  { id: 'cat_animals', name: 'Animals', slug: 'animals', icon: 'cow', kind: 'animal', count: 62 },
  { id: 'cat_inputs', name: 'Seeds & inputs', slug: 'inputs', icon: 'package', kind: 'input', count: 41 },
  { id: 'cat_equipment', name: 'Equipment', slug: 'equipment', icon: 'tractor', kind: 'equipment', count: 27 },
];

export let listings = [
  {
    id: 'lst_sarah_robusta', sellerId: 'usr_farmer_demo', seller: 'Sarah Nakato', sellerInitials: 'SN', verified: true, trusted: false,
    title: 'Sorted Robusta coffee cherries', category: 'coffee', coffeeType: 'Robusta', process: 'Fresh cherry', grade: 'Ripe select',
    description: 'Carefully hand-picked Robusta cherries from my Mukono farm, sorted to remove green and damaged cherries. Ready for buyer collection.',
    quantity: 420, unit: 'kg', price: 7400, currency: 'UGX', negotiable: true, location: 'Mukono', distance: 'Your listing',
    image: '/images/robusta-cherries.jpg', featured: false, postedAt: 'Today', harvestDate: '16 Aug 2026', rating: 4.8, reviews: 27,
    delivery: ['Pickup', 'Local delivery'], moisture: null, available: true, status: 'published', views: 86, interestedBuyers: 4,
  },
  {
    id: 'lst_robusta_mukono', sellerId: 'usr_001', seller: 'Musa Kato', sellerInitials: 'MK', verified: true, trusted: true,
    title: 'Fresh Robusta coffee cherries', category: 'coffee', coffeeType: 'Robusta', process: 'Fresh cherry', grade: 'Select',
    description: 'Hand-picked ripe Robusta cherries from our family farm. Sorted the same day and ready for collection or local delivery.',
    quantity: 500, unit: 'kg', price: 7200, currency: 'UGX', negotiable: true, location: 'Mukono', distance: '18 km',
    image: '/images/robusta-cherries.jpg', featured: true, postedAt: '2h ago', harvestDate: '16 Aug 2026', rating: 4.9, reviews: 38,
    delivery: ['Pickup', 'Local delivery'], moisture: null, available: true,
  },
  {
    id: 'lst_arabica_mbale', sellerId: 'usr_002', seller: 'Nabumali Coffee Group', sellerInitials: 'NC', verified: true, trusted: true,
    title: 'Washed Arabica green coffee', category: 'coffee', coffeeType: 'Arabica', process: 'Washed', grade: 'AA',
    description: 'High-altitude Bugisu Arabica, fully washed and carefully graded. Packed in clean 60 kg natural fibre bags.',
    quantity: 1200, unit: 'kg', price: 14500, currency: 'UGX', negotiable: false, location: 'Mbale', distance: '221 km',
    image: '/images/arabica-green.jpg', featured: false, postedAt: '5h ago', harvestDate: '10 Aug 2026', rating: 4.8, reviews: 61,
    delivery: ['Pickup', 'Arrange transport'], moisture: 11.4, available: true,
  },
  {
    id: 'lst_dried_masaka', sellerId: 'usr_003', seller: 'Kijjabwemi Farmers', sellerInitials: 'KF', verified: true, trusted: false,
    title: 'FAQ Robusta, sun-dried', category: 'coffee', coffeeType: 'Robusta', process: 'Natural', grade: 'FAQ',
    description: 'Clean sun-dried Robusta coffee from Masaka. Consistent lot with traceable farmer group records.',
    quantity: 800, unit: 'kg', price: 10100, currency: 'UGX', negotiable: true, location: 'Masaka', distance: '132 km',
    image: '/images/coffee-farmer-hero.jpg', featured: false, postedAt: 'Yesterday', harvestDate: '06 Aug 2026', rating: 4.6, reviews: 19,
    delivery: ['Pickup'], moisture: 12.1, available: true,
  },
  {
    id: 'lst_matooke_luwero', sellerId: 'usr_004', seller: 'Grace Namuli', sellerInitials: 'GN', verified: true, trusted: false,
    title: 'Fresh matooke bunches', category: 'crops', coffeeType: null, process: null, grade: 'Farm fresh',
    description: 'Healthy large matooke bunches harvested to order. Bulk orders welcome.',
    quantity: 85, unit: 'bunch', price: 26000, currency: 'UGX', negotiable: true, location: 'Luwero', distance: '74 km',
    image: '/images/banana-harvest.jpg', featured: false, postedAt: '3h ago', harvestDate: 'On request', rating: 4.7, reviews: 22,
    delivery: ['Pickup', 'Kampala delivery'], moisture: null, available: true,
  },
  {
    id: 'lst_honey_wakiso', sellerId: 'usr_005', seller: 'Buwama Apiaries', sellerInitials: 'BA', verified: true, trusted: true,
    title: 'Pure forest honey', category: 'animals', coffeeType: null, process: 'Raw filtered', grade: 'Food grade',
    description: 'Pure Ugandan honey in sealed 20 litre food-safe buckets. No added sugar.',
    quantity: 240, unit: 'litre', price: 18000, currency: 'UGX', negotiable: false, location: 'Wakiso', distance: '29 km',
    image: null, featured: false, postedAt: '1d ago', harvestDate: 'July 2026', rating: 4.9, reviews: 46,
    delivery: ['Pickup', 'Delivery'], moisture: null, available: true, placeholder: '🍯', color: '#d8932f',
  },
  {
    id: 'lst_eggs_mityana', sellerId: 'usr_006', seller: 'Mityana Layers Farm', sellerInitials: 'ML', verified: false, trusted: false,
    title: 'Fresh table eggs', category: 'animals', coffeeType: null, process: null, grade: 'Large',
    description: 'Fresh graded table eggs available weekly. Packed in trays of 30.',
    quantity: 320, unit: 'tray', price: 13500, currency: 'UGX', negotiable: true, location: 'Mityana', distance: '68 km',
    image: null, featured: false, postedAt: '2d ago', harvestDate: 'Daily', rating: 4.5, reviews: 12,
    delivery: ['Pickup'], moisture: null, available: true, placeholder: '🥚', color: '#9a6537',
  },
];

export let marketPrices = [
  { id: 'price_1', product: 'Robusta FAQ', category: 'coffee', amount: 10800, unit: 'kg', currency: 'UGX', location: 'Kampala', change: 4.2, source: 'Verified platform market desk', observedAt: '2026-08-16T06:30:00Z', freshness: 'Updated today' },
  { id: 'price_2', product: 'Arabica parchment', category: 'coffee', amount: 13200, unit: 'kg', currency: 'UGX', location: 'Mbale', change: 1.8, source: 'Verified platform market desk', observedAt: '2026-08-16T06:30:00Z', freshness: 'Updated today' },
  { id: 'price_3', product: 'Robusta cherries', category: 'coffee', amount: 7100, unit: 'kg', currency: 'UGX', location: 'Mukono', change: -0.7, source: 'Mukono collection-point average', observedAt: '2026-08-16T05:45:00Z', freshness: 'Updated today' },
];

export const buyerRequests = [
  { id: 'req_1', buyer: 'Lake Victoria Coffee Exports', initials: 'LV', verified: true, product: 'Robusta FAQ', quantity: '2,000 kg', location: 'Kampala', priceRange: 'UGX 10,200–11,000/kg', requiredBy: '23 Aug', responses: 7, postedAt: '48 min ago' },
  { id: 'req_2', buyer: 'Bugisu Specialty Traders', initials: 'BS', verified: true, product: 'Washed Arabica AA', quantity: '1,500 kg', location: 'Mbale', priceRange: 'Open to offers', requiredBy: '30 Aug', responses: 3, postedAt: '3h ago' },
  { id: 'req_3', buyer: 'Kampala Fresh Foods', initials: 'KF', verified: true, product: 'Matooke', quantity: '120 bunches', location: 'Kampala', priceRange: 'UGX 24,000–28,000', requiredBy: '20 Aug', responses: 12, postedAt: 'Yesterday' },
];

export const articles = [
  { id: 'art_1', slug: 'coffee-pruning-after-harvest', category: 'Coffee care', title: 'Pruning coffee after harvest: 5 practical steps', readTime: '4 min', image: '/images/coffee-farmer-hero.jpg', excerpt: 'Keep productive stems, improve airflow and prepare your trees for the next cycle.', expertReviewed: true },
  { id: 'art_2', slug: 'drying-coffee-cleanly', category: 'Post-harvest', title: 'Dry coffee cleanly during uncertain rain', readTime: '6 min', image: '/images/arabica-green.jpg', excerpt: 'Simple drying and storage checks that protect quality and price.', expertReviewed: true },
  { id: 'art_3', slug: 'spot-banana-weevil', category: 'Crop health', title: 'Early signs of banana weevil damage', readTime: '3 min', image: '/images/banana-harvest.jpg', excerpt: 'What to inspect at the base of the plant and when to seek field support.', expertReviewed: true },
];

export let advertisements = [
  { id: 'ad_1', title: 'Clean coffee bags available in Mukono', body: 'Food-safe natural fibre bags for careful coffee storage and transport.', sponsor: 'Verified agricultural supplier', cta: 'View farm inputs', actionUrl: '/market?category=inputs', disclosure: 'Sponsored' },
];

export let alerts = [
  { id: 'alert_1', type: 'weather', severity: 'warning', title: 'Heavy rain possible in Central Region', body: 'Check drainage around young coffee and keep harvested coffee covered.', publishedAt: 'Today, 7:15 AM' },
];

export const notifications = [
  {
    id: 'not_1', group: 'market', title: 'Robusta price moved up 4.2%',
    body: 'The verified Kampala reference price is now UGX 10,800 per kg.',
    time: '32m', createdLabel: 'Today, 8:12 AM', unread: true, actionUrl: '/coffee',
  },
  {
    id: 'not_2', group: 'orders', title: 'A buyer viewed your coffee listing',
    body: 'Lake Victoria Coffee Exports viewed your Robusta coffee listing.',
    time: '2h', createdLabel: 'Today, 6:44 AM', unread: true, actionUrl: '/market/lst_robusta_mukono',
  },
  {
    id: 'not_3', group: 'agriculture', title: 'New coffee pruning guide',
    body: 'Learn five practical steps for pruning coffee safely after harvest.',
    time: '1d', createdLabel: 'Yesterday, 3:20 PM', unread: false, actionUrl: '/coffee',
  },
  {
    id: 'not_4', group: 'orders', title: 'Order payment confirmed',
    body: 'Payment for order HL-2026-00142 was verified. Prepare the produce for pickup.',
    time: '3h', createdLabel: 'Today, 5:18 AM', unread: true, actionUrl: '/profile',
  },
  {
    id: 'not_5', group: 'messages', title: 'New message from Nabunya Traders',
    body: '“Is the full 500 kg lot still available for collection this week?”',
    time: '5h', createdLabel: 'Today, 3:07 AM', unread: true, actionUrl: '/market/lst_robusta_mukono',
  },
  {
    id: 'not_6', group: 'ai', title: 'Your crop guidance is ready',
    body: 'AgriGuide finished reviewing the coffee leaf question you submitted.',
    time: '8h', createdLabel: 'Yesterday, 11:52 PM', unread: false, actionUrl: '/ai',
  },
  {
    id: 'not_7', group: 'system', title: 'Farmer verification approved',
    body: 'Your profile now displays the Verified Farmer badge to buyers.',
    time: '2d', createdLabel: 'Friday, 2:10 PM', unread: false, actionUrl: '/profile',
  },
  {
    id: 'not_8', group: 'agriculture', title: 'Heavy rain preparation reminder',
    body: 'Check drainage near young coffee and protect drying produce in Mukono.',
    time: '2d', createdLabel: 'Friday, 8:00 AM', unread: false, actionUrl: '/',
  },
];

export const buyerNotifications = [
  { id: 'bnot_1', group: 'orders', title: 'Your coffee order is being prepared', body: 'Sarah confirmed order HL-2026-00142 and is preparing 100 kg for pickup.', time: '18m', createdLabel: 'Today, 8:26 AM', unread: true, actionUrl: '/orders' },
  { id: 'bnot_2', group: 'messages', title: 'New message from Musa Kato', body: '“The Robusta lot is available for inspection tomorrow morning.”', time: '2h', createdLabel: 'Today, 6:31 AM', unread: true, actionUrl: '/messages' },
  { id: 'bnot_3', group: 'market', title: 'A saved coffee listing changed price', body: 'Fresh Robusta coffee cherries are now UGX 7,200 per kg.', time: '5h', createdLabel: 'Today, 3:18 AM', unread: false, actionUrl: '/market/lst_robusta_mukono' },
  { id: 'bnot_4', group: 'orders', title: 'Payment receipt available', body: 'Your payment for order HL-2026-00138 was verified successfully.', time: '1d', createdLabel: 'Yesterday, 1:11 PM', unread: false, actionUrl: '/orders' },
];

export const adminNotifications = [
  { id: 'anot_1', group: 'system', title: '6 farmer verifications need review', body: 'The oldest verification request has been waiting for 19 hours.', time: '12m', createdLabel: 'Today, 8:32 AM', unread: true, actionUrl: '/admin/users' },
  { id: 'anot_2', group: 'orders', title: 'Payment amount mismatch flagged', body: 'Provider event for HL-2026-00139 did not match the locked order total.', time: '44m', createdLabel: 'Today, 8:00 AM', unread: true, actionUrl: '/admin/finance' },
  { id: 'anot_3', group: 'system', title: 'New marketplace report', body: 'A coffee listing was reported for potentially misleading quality information.', time: '2h', createdLabel: 'Today, 6:42 AM', unread: true, actionUrl: '/admin/moderation' },
  { id: 'anot_4', group: 'ai', title: 'AI safety review completed', body: 'The weekly agriculture answer evaluation is ready for expert review.', time: '1d', createdLabel: 'Yesterday, 4:20 PM', unread: false, actionUrl: '/admin/ai' },
];

export const notificationsByRole: Record<string, any[]> = {
  FARMER_SELLER: notifications,
  BUYER: buyerNotifications,
  ADMIN: adminNotifications,
};

export const roleProfiles: Record<string, any> = {
  usr_farmer_demo: {
    type: 'farmer', verifiedLevel: 'verified_farmer', farming: ['Coffee', 'Bananas'], yearsFarming: 8,
    rating: 4.8, completedTransactions: 27, coffeeSpecialization: 'Robusta', farmType: 'Family smallholding',
    balance: { available: 1240000, pending: 380000, currency: 'UGX' },
  },
  usr_buyer_demo: {
    type: 'buyer', verifiedLevel: 'verified_buyer', businessName: 'Okello Fresh Foods',
    buyerType: 'Produce wholesaler', interests: ['Coffee', 'Bananas', 'Honey'], rating: 4.7,
    completedTransactions: 19, savedProducts: 6, openOrders: 3,
  },
  usr_admin_demo: {
    type: 'admin', title: 'Platform Administrator', permissionGroup: 'Super Admin',
    twoFactorRequired: true, lastSecurityReview: '12 Aug 2026',
  },
};

export const seedOrders = [
  {
    id: 'ord_seed_1', reference: 'HL-2026-00142', buyerId: 'usr_buyer_demo', buyerName: 'Daniel Okello',
    sellerId: 'usr_farmer_demo', sellerName: 'Sarah Nakato', status: 'processing',
    listing: { id: 'lst_sarah_robusta', title: 'Sorted Robusta coffee cherries', unit: 'kg', unitPrice: 7400 },
    quantity: 100, currency: 'UGX', gross: 740000, platformFee: 37000, paymentFee: 11100,
    buyerTotal: 751100, sellerNet: 703000, deliveryMethod: 'pickup', createdAt: '2026-08-16T06:10:00Z', updatedLabel: '18 min ago',
  },
  {
    id: 'ord_seed_2', reference: 'HL-2026-00138', buyerId: 'usr_buyer_demo', buyerName: 'Daniel Okello',
    sellerId: 'usr_002', sellerName: 'Nabumali Coffee Group', status: 'delivered',
    listing: { id: 'lst_arabica_mbale', title: 'Washed Arabica green coffee', unit: 'kg', unitPrice: 14500 },
    quantity: 60, currency: 'UGX', gross: 870000, platformFee: 43500, paymentFee: 13050,
    buyerTotal: 883050, sellerNet: 826500, deliveryMethod: 'delivery', createdAt: '2026-08-12T10:30:00Z', updatedLabel: 'Yesterday',
  },
  {
    id: 'ord_seed_3', reference: 'HL-2026-00131', buyerId: 'usr_buyer_002', buyerName: 'Lake Victoria Coffee Exports',
    sellerId: 'usr_farmer_demo', sellerName: 'Sarah Nakato', status: 'completed',
    listing: { id: 'lst_sarah_robusta', title: 'Sorted Robusta coffee cherries', unit: 'kg', unitPrice: 7200 },
    quantity: 300, currency: 'UGX', gross: 2160000, platformFee: 108000, paymentFee: 32400,
    buyerTotal: 2192400, sellerNet: 2052000, deliveryMethod: 'pickup', createdAt: '2026-08-05T08:15:00Z', updatedLabel: '8 Aug 2026',
  },
  {
    id: 'ord_seed_4', reference: 'HL-2026-00122', buyerId: 'usr_buyer_002', buyerName: 'Lake Victoria Coffee Exports',
    sellerId: 'usr_farmer_demo', sellerName: 'Sarah Nakato', status: 'completed',
    listing: { id: 'lst_sarah_robusta', title: 'Fresh Robusta coffee cherries', unit: 'kg', unitPrice: 7000 },
    quantity: 180, currency: 'UGX', gross: 1260000, platformFee: 63000, paymentFee: 18900,
    buyerTotal: 1278900, sellerNet: 1197000, deliveryMethod: 'pickup', createdAt: '2026-07-27T09:00:00Z', updatedLabel: '30 Jul 2026',
  },
];

export const farmerEarnings = {
  totals: { totalSales: 4160000, pending: 703000, available: 1240000, completedSales: 2, platformFees: 208000, paymentFees: 62400, withdrawals: 2200000 },
  transactions: [
    { id: 'txn_1', orderReference: 'HL-2026-00142', product: 'Sorted Robusta coffee cherries', gross: 740000, platformFee: 37000, paymentFee: 11100, sellerNet: 703000, status: 'pending', date: '16 Aug 2026' },
    { id: 'txn_2', orderReference: 'HL-2026-00131', product: 'Sorted Robusta coffee cherries', gross: 2160000, platformFee: 108000, paymentFee: 32400, sellerNet: 2052000, status: 'available', date: '8 Aug 2026' },
    { id: 'txn_3', orderReference: 'HL-2026-00122', product: 'Fresh Robusta coffee cherries', gross: 1260000, platformFee: 63000, paymentFee: 18900, sellerNet: 1197000, status: 'withdrawn', date: '30 Jul 2026' },
  ],
};

export const buyerSavedListingIds = ['lst_robusta_mukono', 'lst_arabica_mbale', 'lst_honey_wakiso'];

export const adminStats = {
  users: 12480,
  farmers: 8240,
  buyers: 1870,
  activeListings: 374,
  totalOrders: 4380,
  completedOrders: 3921,
  activeAdvertisements: 18,
  ordersThisMonth: 286,
  grossSales: 184600000,
  platformRevenue: 9230000,
  paymentFees: 2769000,
  sellerPayouts: 161400000,
  refunds: 1320000,
  netPlatformRevenue: 5141000,
  pendingSettlements: 22600000,
  aiQuestions: 18420,
};
