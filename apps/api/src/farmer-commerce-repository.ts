import type { FarmerReview, LedgerEntry, ListingDraft, Withdrawal } from './farmer-commerce.js';

/** Production adapter contract. Authenticated account IDs are supplied by the service layer, never the browser. */
export interface FarmerCommerceRepository {
  transaction<T>(work: (repository: FarmerCommerceRepository) => Promise<T>): Promise<T>;

  createDraft(ownerId: string): Promise<ListingDraft>;
  findOwnedDraftForUpdate(ownerId: string, draftId: string): Promise<ListingDraft | null>;
  saveDraftCompareAndSwap(ownerId: string, draftId: string, expectedVersion: number, changes: Partial<ListingDraft>): Promise<ListingDraft | null>;
  listOwnedDrafts(ownerId: string): Promise<ListingDraft[]>;
  deleteOwnedDraft(ownerId: string, draftId: string): Promise<boolean>;

  attachApprovedMedia(ownerId: string, draftId: string, orderedMediaIds: string[]): Promise<void>;
  publishDraft(ownerId: string, draftId: string, expectedVersion: number): Promise<{ listingId: string }>;
  updateOwnedListing(ownerId: string, listingId: string, changes: Record<string, unknown>): Promise<boolean>;
  reserveListingInventory(listingId: string, quantity: number): Promise<{ reservationId: string } | null>;
  releaseInventoryReservation(reservationId: string): Promise<void>;
  consumeInventoryReservation(reservationId: string): Promise<void>;

  insertOrderWithSnapshots(order: Record<string, unknown>, buyerId: string, idempotencyKeyHash: Buffer): Promise<Record<string, unknown>>;
  transitionSellerOrder(sellerId: string, orderId: string, expectedStatus: string, nextStatus: string): Promise<boolean>;
  completeBuyerOrderAndInsertLedger(buyerId: string, orderId: string): Promise<LedgerEntry | null>;
  listSellerLedger(sellerId: string, filters: Record<string, string | undefined>): Promise<LedgerEntry[]>;

  availableSellerBalanceForUpdate(sellerId: string): Promise<number>;
  createWithdrawalWithReservation(sellerId: string, withdrawal: Withdrawal, idempotencyKeyHash: Buffer): Promise<Withdrawal>;
  transitionWithdrawal(withdrawalId: string, expectedStatus: string, nextStatus: string, providerReference?: string): Promise<boolean>;

  insertCompletedOrderReview(buyerId: string, orderId: string, review: FarmerReview): Promise<FarmerReview>;
  appendAudit(event: Record<string, unknown>): Promise<void>;
}

/** Required production persistence boundary for opportunity and account communication routes. */
export interface FarmerEngagementRepository {
  transaction<T>(work: (repository: FarmerEngagementRepository) => Promise<T>): Promise<T>;

  updateOwnedFarmerProfile(ownerId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateOwnedBuyerProfile(ownerId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  listOpenBuyerRequests(filters: Record<string, string | undefined>, viewerId?: string): Promise<Record<string, unknown>[]>;
  createBuyerRequest(buyerId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  transitionOwnedBuyerRequest(buyerId: string, requestId: string, expectedState: 'open', nextState: 'closed' | 'fulfilled'): Promise<boolean>;
  insertUniqueFarmerResponse(farmerId: string, requestId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  transitionFarmerResponse(farmerId: string, responseId: string, expectedState: 'submitted', nextState: 'withdrawn'): Promise<boolean>;
  decideOwnedRequestResponse(buyerId: string, responseId: string, decision: 'accepted' | 'rejected'): Promise<boolean>;

  findOrCreateContextConversation(actorId: string, contextType: 'listing' | 'order' | 'buyer_request', contextId: string): Promise<Record<string, unknown>>;
  listParticipantConversations(participantId: string): Promise<Record<string, unknown>[]>;
  listParticipantMessages(participantId: string, conversationId: string): Promise<Record<string, unknown>[] | null>;
  insertParticipantMessage(senderId: string, conversationId: string, body: string): Promise<Record<string, unknown> | null>;
  markParticipantConversationRead(participantId: string, conversationId: string): Promise<boolean>;

  insertNotification(ownerId: string, notification: Record<string, unknown>): Promise<Record<string, unknown>>;
  listOwnedNotifications(ownerId: string, filters: Record<string, string | undefined>): Promise<Record<string, unknown>[]>;
  markOwnedNotificationRead(ownerId: string, notificationId: string): Promise<boolean>;
  markAllOwnedNotificationsRead(ownerId: string): Promise<number>;
  appendAudit(event: Record<string, unknown>): Promise<void>;
}

export interface ListingObjectStorage {
  createUploadIntent(ownerId: string, constraints: { maxBytes: number; allowedMimeTypes: string[] }): Promise<{ uploadId: string; expiresAt: string }>;
  finalizeQuarantinedUpload(ownerId: string, uploadId: string): Promise<{ mediaId: string; scanStatus: 'quarantined' | 'approved' | 'rejected' }>;
  deleteUnattachedMedia(ownerId: string, mediaId: string): Promise<boolean>;
}

export interface PayoutProvider {
  requestPayout(input: { withdrawalId: string; amount: number; currency: 'UGX'; encryptedDestinationReference: string }): Promise<{ providerTransactionId: string; status: 'accepted' | 'rejected' }>;
  verifySignedEvent(rawBody: Buffer, signature: string): Promise<{ providerEventId: string; providerTransactionId: string; status: 'completed' | 'failed' | 'reversed' }>;
}
