import { roleHasPermission, type AuthUserRecord, type Role } from './auth.js';

type ListingResource = { sellerId: string };
type OrderResource = { buyerId: string; sellerId: string };
type ConversationResource = { participantIds: string[] };

export function dashboardForRole(role: Role) {
  if (role === 'ADMIN') return '/admin/dashboard';
  if (role === 'FARMER_SELLER') return '/farmer/dashboard';
  return '/buyer/dashboard';
}

export function canModifyListing(user: Pick<AuthUserRecord, 'id' | 'role' | 'status'>, listing: ListingResource) {
  if (user.status !== 'ACTIVE') return false;
  if (user.role === 'ADMIN') return roleHasPermission(user.role, 'marketplace.moderate');
  return user.role === 'FARMER_SELLER' && listing.sellerId === user.id && roleHasPermission(user.role, 'listings.update.own');
}

export function canDeleteListing(user: Pick<AuthUserRecord, 'id' | 'role' | 'status'>, listing: ListingResource) {
  if (user.status !== 'ACTIVE') return false;
  if (user.role === 'ADMIN') return roleHasPermission(user.role, 'marketplace.moderate');
  return user.role === 'FARMER_SELLER' && listing.sellerId === user.id && roleHasPermission(user.role, 'listings.delete.own');
}

export function canViewOrder(user: Pick<AuthUserRecord, 'id' | 'role' | 'status'>, order: OrderResource) {
  if (user.status !== 'ACTIVE') return false;
  if (user.role === 'ADMIN') return roleHasPermission(user.role, 'orders.read.all');
  if (user.role === 'FARMER_SELLER') return order.sellerId === user.id && roleHasPermission(user.role, 'orders.read.seller');
  return order.buyerId === user.id && roleHasPermission(user.role, 'orders.read.buyer');
}

export function canAccessConversation(user: Pick<AuthUserRecord, 'id' | 'status'>, conversation: ConversationResource) {
  return user.status === 'ACTIVE' && conversation.participantIds.includes(user.id);
}
