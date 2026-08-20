import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../src/server.js';
import { saveListingMedia } from '../src/farmer-commerce.js';

function cookie(response: Awaited<ReturnType<typeof app.inject>>) {
  const header = response.headers['set-cookie']; const value = Array.isArray(header) ? header[0] : header;
  assert.ok(value); return value.split(';')[0];
}
async function login(identifier: string, password: string, otp?: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier, password, ...(otp ? { otp } : {}) } });
  assert.equal(response.statusCode, 200, response.body);
  return { cookie: cookie(response), csrf: response.json().data.csrfToken };
}
function png(width = 320, height = 240) {
  const bytes = Buffer.alloc(100); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes, 0); Buffer.from('IHDR').copy(bytes, 12);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes;
}
function multipartImage(bytes: Buffer, filename = 'coffee.png', mime = 'image/png') {
  const boundary = '----agri-test-boundary';
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

test.after(async () => { await app.close(); });

test('production commerce and media boundaries fail closed before durable adapters exist', async () => {
  const originalNodeEnv = process.env.NODE_ENV; const originalScanner = process.env.MEDIA_SCANNER_MODE;
  process.env.NODE_ENV = 'production'; delete process.env.MEDIA_SCANNER_MODE;
  try {
    const result = saveListingMedia('usr_farmer_demo', 'scanner-test.png', 'image/png', png()); assert.deepEqual(result, { error: 'MEDIA_SCANNER_UNAVAILABLE' });
    await app.ready(); const response = await app.inject({ method: 'GET', url: '/api/v1/listings' }); assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'FARMER_COMMERCE_REPOSITORY_NOT_DEPLOYED');
    const engagement = await app.inject({ method: 'GET', url: '/api/v1/buyer-requests' }); assert.equal(engagement.statusCode, 503); assert.equal(engagement.json().code, 'FARMER_COMMERCE_REPOSITORY_NOT_DEPLOYED');
    const ai = await app.inject({ method:'POST', url:'/api/v1/ai/ask', payload:{message:'Coffee leaves are yellow',language:'en',mode:'text'} }); assert.equal(ai.statusCode,503); assert.equal(ai.json().code,'AGRICULTURAL_AI_PROVIDER_NOT_DEPLOYED');
  }
  finally { if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv; if (originalScanner === undefined) delete process.env.MEDIA_SCANNER_MODE; else process.env.MEDIA_SCANNER_MODE = originalScanner; }
});

test('farmer product-to-sale-to-ledger APIs enforce ownership, immutable snapshots, lifecycle and real portfolio derivation', async () => {
  await app.ready();
  const farmer = await login('sarah@example.ug', 'FarmerDemo!2026');
  const buyer = await login('daniel@okellofoods.ug', 'BuyerDemo!2026');

  const unauthenticated = await app.inject({ method: 'GET', url: '/api/v1/farmer/dashboard' });
  assert.equal(unauthenticated.statusCode, 401);
  const wrongRole = await app.inject({ method: 'GET', url: '/api/v1/farmer/dashboard', headers: { cookie: buyer.cookie } });
  assert.equal(wrongRole.statusCode, 403);

  const uploadBody = multipartImage(png());
  const upload = await app.inject({ method: 'POST', url: '/api/v1/farmer/listing-images', headers: { ...uploadBody.headers, cookie: farmer.cookie, 'x-csrf-token': farmer.csrf }, payload: uploadBody.payload });
  assert.equal(upload.statusCode, 201, upload.body);
  assert.equal(upload.json().data.scanStatus, 'development_validated');
  const imageId = upload.json().data.id;
  const privateDraftImage = await app.inject({ method: 'GET', url: upload.json().data.url, headers: { cookie: buyer.cookie } });
  assert.equal(privateDraftImage.statusCode, 404, 'unattached draft media is not public');
  const ownerDraftImage = await app.inject({ method: 'GET', url: upload.json().data.url, headers: { cookie: farmer.cookie } });
  assert.equal(ownerDraftImage.statusCode, 200);

  const mismatchedBody = multipartImage(png(), 'coffee.jpg', 'image/png');
  const mismatch = await app.inject({ method: 'POST', url: '/api/v1/farmer/listing-images', headers: { ...mismatchedBody.headers, cookie: farmer.cookie, 'x-csrf-token': farmer.csrf }, payload: mismatchedBody.payload });
  assert.equal(mismatch.statusCode, 422);
  assert.equal(mismatch.json().code, 'IMAGE_EXTENSION_MISMATCH');

  const createdDraft = await app.inject({
    method: 'POST', url: '/api/v1/farmer/listing-drafts', headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf },
    payload: { title: 'Traceable Robusta coffee', category: 'coffee', crop: 'Coffee', coffeeType: 'Robusta', process: 'Natural', grade: 'Screen 15', description: 'Carefully sorted Robusta coffee from our Mukono farm.', harvestDate: 'August 2026', productionMethod: 'conventional', quantity: 20, unit: 'kg', price: 5000, pricingMode: 'negotiable', minimumAcceptablePrice: 4500, district: 'Mukono', subRegion: 'Central Region', approximateLocation: 'Mukono town area', imageIds: [imageId], currentStep: 5 },
  });
  assert.equal(createdDraft.statusCode, 201, createdDraft.body);
  const draft = createdDraft.json().data;

  const staleSave = await app.inject({ method: 'PATCH', url: `/api/v1/farmer/listing-drafts/${draft.id}`, headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf }, payload: { version: draft.version - 1, title: 'Stale overwrite' } });
  assert.equal(staleSave.statusCode, 409);
  assert.equal(staleSave.json().code, 'DRAFT_VERSION_CONFLICT');

  const buyerCannotReadDraft = await app.inject({ method: 'GET', url: `/api/v1/farmer/listing-drafts/${draft.id}`, headers: { cookie: buyer.cookie } });
  assert.equal(buyerCannotReadDraft.statusCode, 403);

  const quote = await app.inject({ method: 'POST', url: '/api/v1/farmer/listing-quote', headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf }, payload: { category: 'coffee', quantity: 20, price: 5000 } });
  assert.equal(quote.statusCode, 200, quote.body);
  assert.equal(quote.json().data.gross, 100000);
  assert.ok(quote.json().data.commissionRule.id);

  const publish = await app.inject({ method: 'POST', url: `/api/v1/farmer/listing-drafts/${draft.id}/publish`, headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf }, payload: { version: draft.version, confirmed: true } });
  assert.equal(publish.statusCode, 201, publish.body);
  const listing = publish.json().data;
  assert.equal(listing.status, 'published');
  const publicPublishedImage = await app.inject({ method: 'GET', url: listing.image });
  assert.equal(publicPublishedImage.statusCode, 200, 'published listing media is public');
  const filteredMarket = await app.inject({ method: 'GET', url: '/api/v1/listings?q=Traceable&category=coffee&coffeeType=Robusta&verified=true&priceMin=4000&priceMax=6000&quantityMin=10&sort=newest' });
  assert.equal(filteredMarket.statusCode, 200, filteredMarket.body);
  assert.ok(filteredMarket.json().data.some((item: any) => item.id === listing.id));

  const farmerCheckout = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf, 'idempotency-key': 'farmer-cannot-buy-1' }, payload: { listingId: listing.id, quantity: 2, deliveryMethod: 'pickup', paymentMethodId: 'pm_mtn_momo' } });
  assert.equal(farmerCheckout.statusCode, 403);

  const methods = await app.inject({ method: 'GET', url: '/api/v1/public/payment-methods' });
  const paymentMethodId = methods.json().data[0].id;
  const buyerQuote = await app.inject({ method: 'GET', url: `/api/v1/listings/${listing.id}/quote?quantity=2&paymentMethodId=${paymentMethodId}`, headers: { cookie: buyer.cookie } });
  assert.equal(buyerQuote.statusCode, 200, buyerQuote.body);
  assert.equal(buyerQuote.json().data.gross, 10_000);
  assert.ok(buyerQuote.json().data.commissionRule.id);
  const orderCreate = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { cookie: buyer.cookie, 'x-csrf-token': buyer.csrf, 'idempotency-key': 'commerce-slice-order-0001' }, payload: { listingId: listing.id, quantity: 2, deliveryMethod: 'pickup', paymentMethodId } });
  assert.equal(orderCreate.statusCode, 201, orderCreate.body);
  const order = orderCreate.json().data;
  const duplicateOrder = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { cookie: buyer.cookie, 'x-csrf-token': buyer.csrf, 'idempotency-key': 'commerce-slice-order-0001' }, payload: { listingId: listing.id, quantity: 2, deliveryMethod: 'pickup', paymentMethodId } });
  assert.equal(duplicateOrder.statusCode, 200); assert.equal(duplicateOrder.json().data.id, order.id);
  const orderKeyConflict = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { cookie: buyer.cookie, 'x-csrf-token': buyer.csrf, 'idempotency-key': 'commerce-slice-order-0001' }, payload: { listingId: listing.id, quantity: 3, deliveryMethod: 'pickup', paymentMethodId } });
  assert.equal(orderKeyConflict.statusCode, 409); assert.equal(orderKeyConflict.json().code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(order.listing.title, 'Traceable Robusta coffee');
  assert.ok(order.financialSnapshot.commissionRuleId);
  const quantityAfterReservation = (await app.inject({ method: 'GET', url: `/api/v1/listings/${listing.id}`, headers: { cookie: buyer.cookie } })).json().data.quantity;
  const cancellableCreate = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { cookie: buyer.cookie, 'x-csrf-token': buyer.csrf, 'idempotency-key': 'commerce-cancel-order-0001' }, payload: { listingId: listing.id, quantity: 1, deliveryMethod: 'pickup', paymentMethodId } });
  assert.equal(cancellableCreate.statusCode, 201, cancellableCreate.body);
  const cancelOrder = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${cancellableCreate.json().data.id}/cancel`, headers: { cookie: buyer.cookie, 'x-csrf-token': buyer.csrf }, payload: { reason: 'No longer required' } });
  assert.equal(cancelOrder.statusCode, 200, cancelOrder.body);
  const quantityAfterCancellation = (await app.inject({ method: 'GET', url: `/api/v1/listings/${listing.id}`, headers: { cookie: buyer.cookie } })).json().data.quantity;
  assert.equal(quantityAfterCancellation, quantityAfterReservation, 'unpaid cancellation releases reserved inventory');
  const saved = await app.inject({ method: 'POST', url: `/api/v1/buyer/saved/${listing.id}`, headers: { cookie: buyer.cookie, 'x-csrf-token': buyer.csrf } });
  assert.equal(saved.statusCode, 200, saved.body);
  const ownerProducts = await app.inject({ method: 'GET', url: '/api/v1/farmer/listings', headers: { cookie: farmer.cookie } });
  assert.ok(ownerProducts.json().data.find((item: any) => item.id === listing.id).interestedBuyers >= 1);
  const unsaved = await app.inject({ method: 'DELETE', url: `/api/v1/buyer/saved/${listing.id}`, headers: { cookie: buyer.cookie, 'x-csrf-token': buyer.csrf } });
  assert.equal(unsaved.statusCode, 200, unsaved.body);

  const edit = await app.inject({ method: 'PATCH', url: `/api/v1/listings/${listing.id}`, headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf }, payload: { title: 'Renamed current Robusta listing', price: 6500 } });
  assert.equal(edit.statusCode, 200, edit.body);
  const immutableOrder = await app.inject({ method: 'GET', url: `/api/v1/orders/${order.id}`, headers: { cookie: buyer.cookie } });
  assert.equal(immutableOrder.json().data.listing.title, 'Traceable Robusta coffee');
  assert.equal(immutableOrder.json().data.listing.unitPrice, 5000);

  const prematureComplete = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/complete`, headers: { cookie: buyer.cookie, 'x-csrf-token': buyer.csrf } });
  assert.equal(prematureComplete.statusCode, 409);

  const mismatchedPayment = await app.inject({ method: 'POST', url: '/api/v1/payments/sandbox/verify', headers: { cookie: buyer.cookie, 'x-csrf-token': buyer.csrf }, payload: { orderId: order.id, eventId: 'evt-commerce-bad-01', providerReference: 'provider-commerce-bad-01', amount: order.buyerTotal - 1 } });
  assert.equal(mismatchedPayment.statusCode, 409);
  assert.equal(mismatchedPayment.json().code, 'PAYMENT_AMOUNT_MISMATCH');
  const payment = await app.inject({ method: 'POST', url: '/api/v1/payments/sandbox/verify', headers: { cookie: buyer.cookie, 'x-csrf-token': buyer.csrf }, payload: { orderId: order.id, eventId: 'evt-commerce-0001', providerReference: 'provider-commerce-0001', amount: order.buyerTotal } });
  assert.equal(payment.statusCode, 200, payment.body);
  assert.equal(payment.json().data.status, 'payment_verified');

  const farmerCannotComplete = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/complete`, headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf } });
  assert.equal(farmerCannotComplete.statusCode, 403);
  for (const status of ['processing', 'ready_for_delivery', 'delivered']) {
    const transition = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf }, payload: { status } });
    assert.equal(transition.statusCode, 200, transition.body);
  }
  const complete = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/complete`, headers: { cookie: buyer.cookie, 'x-csrf-token': buyer.csrf } });
  assert.equal(complete.statusCode, 200, complete.body);
  assert.equal(complete.json().data.status, 'completed');

  const earnings = await app.inject({ method: 'GET', url: '/api/v1/farmer/earnings?period=all', headers: { cookie: farmer.cookie } });
  assert.equal(earnings.statusCode, 200, earnings.body);
  assert.ok(earnings.json().data.entries.some((entry: any) => entry.orderId === order.id));
  assert.equal(earnings.json().data.totals.netEarnings, earnings.json().data.entries.reduce((sum: number, entry: any) => sum + entry.net, 0));

  const review = await app.inject({ method: 'POST', url: `/api/v1/orders/${order.id}/review`, headers: { cookie: buyer.cookie, 'x-csrf-token': buyer.csrf }, payload: { rating: 5, comment: 'Product matched the listing snapshot.' } });
  assert.equal(review.statusCode, 201, review.body);
  const duplicateReview = await app.inject({ method: 'POST', url: `/api/v1/orders/${order.id}/review`, headers: { cookie: buyer.cookie, 'x-csrf-token': buyer.csrf }, payload: { rating: 4 } });
  assert.equal(duplicateReview.statusCode, 409);

  const highWithdrawal = await app.inject({ method: 'POST', url: '/api/v1/farmer/withdrawals', headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf, 'idempotency-key': 'withdraw-high-test-001' }, payload: { amount: 1_000_000, payoutMethodId: 'payout_mobile_primary', confirmation: '1000000', otp: '246810' } });
  assert.equal(highWithdrawal.statusCode, 403);
  assert.equal(highWithdrawal.json().code, 'TWO_FACTOR_REQUIRED');
  const withdrawal = await app.inject({ method: 'POST', url: '/api/v1/farmer/withdrawals', headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf, 'idempotency-key': 'withdraw-low-test-001' }, payload: { amount: 10_000, payoutMethodId: 'payout_mobile_primary' } });
  assert.equal(withdrawal.statusCode, 201, withdrawal.body);
  assert.equal(withdrawal.json().data.status, 'requested');
  assert.equal(withdrawal.json().data.providerTransactionId, null);
  const duplicateWithdrawal = await app.inject({ method: 'POST', url: '/api/v1/farmer/withdrawals', headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf, 'idempotency-key': 'withdraw-low-test-001' }, payload: { amount: 10_000, payoutMethodId: 'payout_mobile_primary' } });
  assert.equal(duplicateWithdrawal.statusCode, 200);
  assert.equal(duplicateWithdrawal.json().data.id, withdrawal.json().data.id);
  const idempotencyConflict = await app.inject({ method: 'POST', url: '/api/v1/farmer/withdrawals', headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf, 'idempotency-key': 'withdraw-low-test-001' }, payload: { amount: 11_000, payoutMethodId: 'payout_mobile_primary' } });
  assert.equal(idempotencyConflict.statusCode, 409);
  const insufficient = await app.inject({ method: 'POST', url: '/api/v1/farmer/withdrawals', headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf, 'idempotency-key': 'withdraw-too-high-001' }, payload: { amount: 999_000_000, payoutMethodId: 'payout_mobile_primary' } });
  assert.equal(insufficient.statusCode, 409);
  assert.equal(insufficient.json().code, 'INSUFFICIENT_BALANCE');

  const statement = await app.inject({ method: 'GET', url: '/api/v1/farmer/earnings/statement?format=csv', headers: { cookie: farmer.cookie } });
  assert.equal(statement.statusCode, 200, statement.body);
  assert.match(statement.headers['content-type'] || '', /text\/csv/);
  assert.ok(statement.body.includes(order.reference));
  const excel = await app.inject({ method: 'GET', url: '/api/v1/farmer/earnings/statement?format=xlsx', headers: { cookie: farmer.cookie } });
  assert.equal(excel.statusCode, 200); assert.equal(excel.rawPayload.subarray(0,2).toString(), 'PK');
  const pdf = await app.inject({ method: 'GET', url: '/api/v1/farmer/earnings/statement?format=pdf', headers: { cookie: farmer.cookie } });
  assert.equal(pdf.statusCode, 200); assert.equal(pdf.rawPayload.subarray(0,4).toString(), '%PDF');

  const disposableDraft = await app.inject({ method: 'POST', url: '/api/v1/farmer/listing-drafts', headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf }, payload: {} });
  const deleteDraft = await app.inject({ method: 'DELETE', url: `/api/v1/farmer/listing-drafts/${disposableDraft.json().data.id}`, headers: { cookie: farmer.cookie, 'x-csrf-token': farmer.csrf } });
  assert.equal(deleteDraft.statusCode, 200);
  const deletedDraft = await app.inject({ method: 'GET', url: `/api/v1/farmer/listing-drafts/${disposableDraft.json().data.id}`, headers: { cookie: farmer.cookie } });
  assert.equal(deletedDraft.statusCode, 404);
});

test('buyer opportunities, participant conversations and account notifications enforce state and ownership', async () => {
  const farmer = await login('sarah@example.ug', 'FarmerDemo!2026');
  const buyer = await login('daniel@okellofoods.ug', 'BuyerDemo!2026');
  const admin = await login('admin@harvestlink.ug', 'AdminDemo!2026', '246810');

  const opportunities = await app.inject({ method:'GET', url:'/api/v1/buyer-requests?category=coffee&status=open', headers:{cookie:farmer.cookie} });
  assert.equal(opportunities.statusCode,200,opportunities.body);
  const request = opportunities.json().data.find((item:any)=>item.id==='req_2'); assert.ok(request); assert.equal(request.buyer.id,'usr_buyer_demo'); assert.equal(request.ownResponse,null);

  const wrongRole = await app.inject({ method:'POST', url:'/api/v1/buyer-requests/req_2/responses', headers:{cookie:buyer.cookie,'x-csrf-token':buyer.csrf}, payload:{quantity:100,unitPrice:15000,message:'I can supply this product safely.'} });
  assert.equal(wrongRole.statusCode,403);
  const response = await app.inject({ method:'POST', url:'/api/v1/buyer-requests/req_2/responses', headers:{cookie:farmer.cookie,'x-csrf-token':farmer.csrf}, payload:{quantity:1000,unitPrice:14500,message:'I can supply traceable washed Arabica from my farm.'} });
  assert.equal(response.statusCode,201,response.body); const responseId=response.json().data.id;
  const duplicate = await app.inject({ method:'POST', url:'/api/v1/buyer-requests/req_2/responses', headers:{cookie:farmer.cookie,'x-csrf-token':farmer.csrf}, payload:{quantity:900,unitPrice:14000,message:'A second active response should be rejected.'} });
  assert.equal(duplicate.statusCode,409); assert.equal(duplicate.json().code,'DUPLICATE_RESPONSE');

  const buyerNotifications = await app.inject({ method:'GET', url:'/api/v1/notifications?group=market&unread=true', headers:{cookie:buyer.cookie} });
  assert.equal(buyerNotifications.statusCode,200,buyerNotifications.body); assert.ok(buyerNotifications.json().data.some((item:any)=>item.actionUrl==='/buyer/requests'));

  const conversation = await app.inject({ method:'POST', url:'/api/v1/conversations', headers:{cookie:farmer.cookie,'x-csrf-token':farmer.csrf}, payload:{responseId} });
  assert.equal(conversation.statusCode,201,conversation.body); const conversationId=conversation.json().data.id;
  const sameConversation = await app.inject({ method:'POST', url:'/api/v1/conversations', headers:{cookie:buyer.cookie,'x-csrf-token':buyer.csrf}, payload:{responseId} });
  assert.equal(sameConversation.statusCode,201,sameConversation.body); assert.equal(sameConversation.json().data.id,conversationId);
  const outsider = await app.inject({ method:'POST', url:'/api/v1/conversations', headers:{cookie:admin.cookie,'x-csrf-token':admin.csrf}, payload:{responseId} });
  assert.equal(outsider.statusCode,403);

  const sent = await app.inject({ method:'POST', url:`/api/v1/conversations/${conversationId}/messages`, headers:{cookie:farmer.cookie,'x-csrf-token':farmer.csrf}, payload:{body:'The coffee is ready for grading and collection planning.'} });
  assert.equal(sent.statusCode,201,sent.body);
  const buyerThread = await app.inject({ method:'GET', url:`/api/v1/conversations/${conversationId}/messages`, headers:{cookie:buyer.cookie} });
  assert.equal(buyerThread.statusCode,200,buyerThread.body); assert.equal(buyerThread.json().data.at(-1).body,'The coffee is ready for grading and collection planning.');
  const outsiderThread = await app.inject({ method:'GET', url:`/api/v1/conversations/${conversationId}/messages`, headers:{cookie:admin.cookie} });
  assert.equal(outsiderThread.statusCode,404);
  const read = await app.inject({ method:'POST', url:`/api/v1/conversations/${conversationId}/read`, headers:{cookie:buyer.cookie,'x-csrf-token':buyer.csrf} }); assert.equal(read.statusCode,200);
  const conversationList = await app.inject({ method:'GET', url:'/api/v1/conversations', headers:{cookie:buyer.cookie} }); assert.equal(conversationList.json().data.find((item:any)=>item.id===conversationId).unreadCount,0);

  const decision = await app.inject({ method:'PATCH', url:`/api/v1/buyer-request-responses/${responseId}/decision`, headers:{cookie:buyer.cookie,'x-csrf-token':buyer.csrf}, payload:{decision:'accepted'} });
  assert.equal(decision.statusCode,200,decision.body);
  const responseAfterFulfilment = await app.inject({ method:'POST', url:'/api/v1/buyer-requests/req_2/responses', headers:{cookie:farmer.cookie,'x-csrf-token':farmer.csrf}, payload:{quantity:100,unitPrice:14000,message:'The fulfilled request must reject another response.'} });
  assert.equal(responseAfterFulfilment.statusCode,409); assert.equal(responseAfterFulfilment.json().code,'REQUEST_NOT_OPEN');

  const invalidExpiry = await app.inject({ method:'POST', url:'/api/v1/buyer-requests', headers:{cookie:buyer.cookie,'x-csrf-token':buyer.csrf}, payload:{product:'Coffee',category:'coffee',quantity:10,unit:'kg',minimumUnitPrice:null,maximumUnitPrice:null,district:'Kampala',description:'A request with an invalid past expiry.',requiredBy:'2026-08-30',expiresAt:'2026-08-15T10:00:00.000Z'} });
  assert.equal(invalidExpiry.statusCode,422);
  const expiresAt=new Date(Date.now()+2*86_400_000).toISOString();const requiredBy=new Date(Date.now()+4*86_400_000).toISOString().slice(0,10);
  const createdRequest=await app.inject({method:'POST',url:'/api/v1/buyer-requests',headers:{cookie:buyer.cookie,'x-csrf-token':buyer.csrf},payload:{product:'Dry beans',category:'crops',quantity:500,unit:'kg',minimumUnitPrice:3500,maximumUnitPrice:4200,district:'Kampala',description:'Clean dry beans with reliable collection and grading details.',requiredBy,expiresAt}});assert.equal(createdRequest.statusCode,201,createdRequest.body);const createdRequestId=createdRequest.json().data.id;
  const ownRequests=await app.inject({method:'GET',url:'/api/v1/buyer/requests',headers:{cookie:buyer.cookie}});assert.ok(ownRequests.json().data.some((item:any)=>item.id===createdRequestId));
  const closedRequest=await app.inject({method:'PATCH',url:`/api/v1/buyer-requests/${createdRequestId}/state`,headers:{cookie:buyer.cookie,'x-csrf-token':buyer.csrf},payload:{status:'closed'}});assert.equal(closedRequest.statusCode,200,closedRequest.body);
  const closedResponse=await app.inject({method:'POST',url:`/api/v1/buyer-requests/${createdRequestId}/responses`,headers:{cookie:farmer.cookie,'x-csrf-token':farmer.csrf},payload:{quantity:100,unitPrice:3900,message:'This closed request must reject a farmer response.'}});assert.equal(closedResponse.statusCode,409);assert.equal(closedResponse.json().code,'REQUEST_NOT_OPEN');

  const farmerNotifications = await app.inject({ method:'GET', url:'/api/v1/notifications?unread=true', headers:{cookie:farmer.cookie} });
  assert.equal(farmerNotifications.statusCode,200,farmerNotifications.body); const farmerNote=farmerNotifications.json().data.find((item:any)=>item.title==='Response accepted'); assert.ok(farmerNote);
  const crossAccountRead = await app.inject({ method:'PATCH', url:`/api/v1/notifications/${farmerNote.id}/read`, headers:{cookie:buyer.cookie,'x-csrf-token':buyer.csrf} }); assert.equal(crossAccountRead.statusCode,404);
  const ownerRead = await app.inject({ method:'PATCH', url:`/api/v1/notifications/${farmerNote.id}/read`, headers:{cookie:farmer.cookie,'x-csrf-token':farmer.csrf} }); assert.equal(ownerRead.statusCode,200);

  const profileUpdate = await app.inject({ method:'PATCH', url:'/api/v1/profile', headers:{cookie:farmer.cookie,'x-csrf-token':farmer.csrf}, payload:{name:'Sarah Nakato',district:'Mukono',location:'Mukono town area, Central Region',farming:['Coffee','Bananas'],yearsFarming:9,coffeeSpecialization:'Robusta',farmType:'Family smallholding',bio:'We grow and sort coffee using traceable harvest records.'} });
  assert.equal(profileUpdate.statusCode,200,profileUpdate.body); assert.equal(profileUpdate.json().data.yearsFarming,9); assert.equal(profileUpdate.json().data.bio,'We grow and sort coffee using traceable harvest records.');
  const publicProfile=await app.inject({method:'GET',url:'/api/v1/public/farmers/usr_farmer_demo'});assert.equal(publicProfile.statusCode,200);assert.equal(publicProfile.json().data.bio,'We grow and sort coffee using traceable harvest records.');assert.equal(publicProfile.json().data.location,'Mukono','public profile exposes district rather than the stored approximate location string');
  const imageAi=await app.inject({method:'POST',url:'/api/v1/ai/ask',headers:{cookie:farmer.cookie,'x-csrf-token':farmer.csrf},payload:{message:'Analyze this coffee photo',language:'en',mode:'image'}});assert.equal(imageAi.statusCode,503);assert.equal(imageAi.json().code,'AI_IMAGE_PROVIDER_NOT_CONFIGURED');
  const wrongProfileShape = await app.inject({ method:'PATCH', url:'/api/v1/profile', headers:{cookie:buyer.cookie,'x-csrf-token':buyer.csrf}, payload:{name:'Daniel Okello',district:'Kampala',location:'Kampala',farming:['Coffee'],yearsFarming:2,coffeeSpecialization:null,farmType:'Farm',bio:''} }); assert.equal(wrongProfileShape.statusCode,422);
});
