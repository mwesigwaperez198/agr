/** Buyer opportunities, messaging, and notifications with a PostgreSQL-backed runtime store. */
import { randomUUID } from 'node:crypto';
import { users } from './auth.js';
import { query } from './db.js';

export type BuyerRequestRecord = {
  id: string; buyerId: string; product: string; category: string; quantity: number; unit: string;
  minimumUnitPrice: number | null; maximumUnitPrice: number | null; district: string; description: string;
  requiredBy: string; expiresAt: string; status: 'open'|'closed'|'fulfilled'|'expired'; createdAt: string; updatedAt: string;
};
export type BuyerRequestResponse = {
  id: string; requestId: string; farmerId: string; quantity: number; unitPrice: number; message: string;
  listingId: string | null; status: 'submitted'|'accepted'|'rejected'|'withdrawn'|'expired'; createdAt: string; updatedAt: string;
};
export type Conversation = {
  id: string; participantIds: [string,string]; contextType: 'listing'|'order'|'buyer_request'; contextId: string;
  createdAt: string; updatedAt: string;
};
export type Message = { id: string; conversationId: string; senderId: string; body: string; createdAt: string; readBy: string[] };
export type AccountNotification = {
  id: string; ownerId: string; group: 'orders'|'market'|'messages'|'system'; title: string; body: string;
  actionUrl: string; readAt: string | null; createdAt: string;
};

const now = () => new Date().toISOString();
const requests: BuyerRequestRecord[] = [
  { id:'req_1', buyerId:'usr_buyer_002', product:'Robusta FAQ', category:'coffee', quantity:2000, unit:'kg', minimumUnitPrice:10200, maximumUnitPrice:11000, district:'Kampala', description:'Clean Robusta FAQ with traceable district and recent harvest information.', requiredBy:'2026-08-23', expiresAt:'2026-08-22T20:59:59.000Z', status:'open', createdAt:'2026-08-16T05:20:00.000Z', updatedAt:'2026-08-16T05:20:00.000Z' },
  { id:'req_2', buyerId:'usr_buyer_demo', product:'Washed Arabica AA', category:'coffee', quantity:1500, unit:'kg', minimumUnitPrice:null, maximumUnitPrice:null, district:'Mbale', description:'Washed Arabica lots with clear processing and grading details.', requiredBy:'2026-08-30', expiresAt:'2026-08-29T20:59:59.000Z', status:'open', createdAt:'2026-08-16T03:00:00.000Z', updatedAt:'2026-08-16T03:00:00.000Z' },
  { id:'req_3', buyerId:'usr_buyer_demo', product:'Matooke', category:'crops', quantity:120, unit:'bunches', minimumUnitPrice:24000, maximumUnitPrice:28000, district:'Kampala', description:'Fresh, market-ready bunches with reliable collection timing.', requiredBy:'2026-08-20', expiresAt:'2026-08-19T20:59:59.000Z', status:'open', createdAt:'2026-08-15T08:00:00.000Z', updatedAt:'2026-08-15T08:00:00.000Z' },
];
const responses: BuyerRequestResponse[] = [];
const conversations: Conversation[] = [];
const messages: Message[] = [];
const notifications: AccountNotification[] = [];

if (process.env.NODE_ENV === 'production') requests.splice(0, requests.length);

export async function hydrateEngagement() {
  const result = await query<{ kind: string; payload: any }>('select kind, payload from communication.runtime_state');
  for (const row of result?.rows || []) {
    if (row.kind === 'requests') requests.push(...(row.payload || []));
    if (row.kind === 'responses') responses.push(...(row.payload || []));
    if (row.kind === 'conversations') conversations.push(...(row.payload || []));
    if (row.kind === 'messages') messages.push(...(row.payload || []));
    if (row.kind === 'notifications') notifications.push(...(row.payload || []));
  }
  return Boolean(result);
}

function persistEngagement() {
  const records = [
    ['requests', requests], ['responses', responses], ['conversations', conversations],
    ['messages', messages], ['notifications', notifications],
  ] as const;
  void Promise.all(records.map(([kind, payload]) => query(`insert into communication.runtime_state(kind, payload, updated_at) values ($1,$2::jsonb,now()) on conflict (kind) do update set payload=excluded.payload, updated_at=now()`, [kind, JSON.stringify(payload)]))).catch(() => undefined);
}

function userProjection(id: string) {
  const user=users.find(candidate=>candidate.id===id);
  return user ? { id:user.id, name:user.name, initials:user.avatar, verified:user.verified, district:user.district } : { id, name:'Platform participant', initials:'AP', verified:false, district:'' };
}
function requestState(record: BuyerRequestRecord) {
  if (record.status === 'open' && new Date(record.expiresAt).getTime() <= Date.now()) {
    record.status='expired'; record.updatedAt=now();
    for (const response of responses.filter(item=>item.requestId===record.id&&item.status==='submitted')) { response.status='expired'; response.updatedAt=record.updatedAt; }
  }
  return record.status;
}
export function publicBuyerRequest(record: BuyerRequestRecord, viewerId?: string) {
  const buyer=userProjection(record.buyerId); const ownResponse=viewerId ? responses.find(item=>item.requestId===record.id&&item.farmerId===viewerId&&item.status!=='withdrawn') : undefined;
  return { ...record, status:requestState(record), buyer, responseCount:responses.filter(item=>item.requestId===record.id&&item.status!=='withdrawn').length, ownResponse:ownResponse||null };
}
export function listBuyerRequests(filters: { category?:string; district?:string; q?:string; status?:string }, viewerId?:string) {
  let result=requests.filter(record=>filters.status==='all'||!filters.status ? requestState(record)==='open' : requestState(record)===filters.status);
  if(filters.category&&filters.category!=='all') result=result.filter(record=>record.category===filters.category);
  if(filters.district) result=result.filter(record=>record.district.toLowerCase().includes(filters.district!.toLowerCase()));
  if(filters.q){const q=filters.q.toLowerCase();result=result.filter(record=>`${record.product} ${record.description} ${record.district}`.toLowerCase().includes(q));}
  return result.map(record=>publicBuyerRequest(record,viewerId));
}
export function listOwnedBuyerRequests(buyerId:string){return requests.filter(record=>record.buyerId===buyerId).map(record=>({...publicBuyerRequest(record),responses:responses.filter(item=>item.requestId===record.id).map(response=>({...response,farmer:userProjection(response.farmerId)}))}));}
export function createBuyerRequest(buyerId:string,input:Omit<BuyerRequestRecord,'id'|'buyerId'|'status'|'createdAt'|'updatedAt'>){const timestamp=now();const record:BuyerRequestRecord={id:`req_${randomUUID().slice(0,12)}`,buyerId,...input,status:'open',createdAt:timestamp,updatedAt:timestamp};requests.unshift(record);persistEngagement();return publicBuyerRequest(record);}
export function closeBuyerRequest(buyerId:string,id:string,status:'closed'|'fulfilled'){const record=requests.find(item=>item.id===id&&item.buyerId===buyerId);if(!record)return null;if(requestState(record)!=='open')return {error:'INVALID_REQUEST_STATE' as const};record.status=status;record.updatedAt=now();for(const response of responses.filter(item=>item.requestId===id&&item.status==='submitted'))response.status=status==='fulfilled'?'rejected':'expired';persistEngagement();return {data:publicBuyerRequest(record)};}
export function respondToBuyerRequest(farmerId:string,id:string,input:{quantity:number;unitPrice:number;message:string;listingId?:string|null}){
  const record=requests.find(item=>item.id===id);if(!record)return {error:'NOT_FOUND' as const};if(requestState(record)!=='open')return {error:'REQUEST_NOT_OPEN' as const};
  if(responses.some(item=>item.requestId===id&&item.farmerId===farmerId&&item.status!=='withdrawn'))return {error:'DUPLICATE_RESPONSE' as const};
  const timestamp=now();const response:BuyerRequestResponse={id:`resp_${randomUUID().slice(0,12)}`,requestId:id,farmerId,quantity:input.quantity,unitPrice:input.unitPrice,message:input.message,listingId:input.listingId||null,status:'submitted',createdAt:timestamp,updatedAt:timestamp};responses.unshift(response);
  notify(record.buyerId,'market','New farmer response',`${userProjection(farmerId).name} responded to ${record.product}.`,`/buyer/requests`);
  persistEngagement();
  return {data:{...response,request:publicBuyerRequest(record,farmerId)}};
}
export function withdrawBuyerResponse(farmerId:string,responseId:string){const response=responses.find(item=>item.id===responseId&&item.farmerId===farmerId);if(!response)return null;if(response.status!=='submitted')return {error:'INVALID_RESPONSE_STATE' as const};response.status='withdrawn';response.updatedAt=now();persistEngagement();return {data:response};}
export function decideBuyerResponse(buyerId:string,responseId:string,decision:'accepted'|'rejected'){
  const response=responses.find(item=>item.id===responseId);if(!response)return {error:'NOT_FOUND' as const};const request=requests.find(item=>item.id===response.requestId&&item.buyerId===buyerId);if(!request)return {error:'NOT_OWNER' as const};if(requestState(request)!=='open'||response.status!=='submitted')return {error:'INVALID_RESPONSE_STATE' as const};response.status=decision;response.updatedAt=now();if(decision==='accepted'){request.status='fulfilled';request.updatedAt=now();for(const other of responses.filter(item=>item.requestId===request.id&&item.id!==response.id&&item.status==='submitted'))other.status='rejected';}
  notify(response.farmerId,'market',`Response ${decision}`,`Your response to ${request.product} was ${decision}.`,`/opportunities`);persistEngagement();return {data:response};
}
export function findResponse(id:string){return responses.find(item=>item.id===id);}

export function notify(ownerId:string,group:AccountNotification['group'],title:string,body:string,actionUrl:string){const record:AccountNotification={id:`note_${randomUUID().slice(0,12)}`,ownerId,group,title,body,actionUrl,readAt:null,createdAt:now()};notifications.unshift(record);persistEngagement();return record;}
export function accountNotifications(ownerId:string,group?:string,unreadOnly=false){return notifications.filter(item=>item.ownerId===ownerId&&(group==='all'||!group||item.group===group)&&(!unreadOnly||!item.readAt)).map(item=>({...item,unread:!item.readAt,createdLabel:new Date(item.createdAt).toLocaleString('en-UG',{timeZone:'Africa/Kampala'})}));}
export function markNotification(ownerId:string,id:string){const record=notifications.find(item=>item.id===id&&item.ownerId===ownerId);if(!record)return null;if(!record.readAt)record.readAt=now();persistEngagement();return record;}
export function markAllNotifications(ownerId:string){const timestamp=now();for(const record of notifications)if(record.ownerId===ownerId&&!record.readAt)record.readAt=timestamp;persistEngagement();}

function orderedParticipants(first:string,second:string):[string,string]{return [first,second].sort() as [string,string];}
export function createContextConversation(actorId:string,role:string,input:{listing?:any;order?:any;responseId?:string}){
  let otherId='';let contextType:Conversation['contextType'];let contextId='';
  if(input.order){if(![input.order.buyerId,input.order.sellerId].includes(actorId))return {error:'NOT_PARTICIPANT' as const};otherId=input.order.buyerId===actorId?input.order.sellerId:input.order.buyerId;contextType='order';contextId=input.order.id;}
  else if(input.listing){if(role!=='BUYER')return {error:'BUYER_REQUIRED' as const};otherId=input.listing.sellerId;contextType='listing';contextId=input.listing.id;}
  else if(input.responseId){const response=findResponse(input.responseId);if(!response)return {error:'NOT_FOUND' as const};const request=requests.find(item=>item.id===response.requestId)!;if(![request.buyerId,response.farmerId].includes(actorId))return {error:'NOT_PARTICIPANT' as const};otherId=request.buyerId===actorId?response.farmerId:request.buyerId;contextType='buyer_request';contextId=response.id;}
  else return {error:'CONTEXT_REQUIRED' as const};
  if(actorId===otherId)return {error:'SELF_CONVERSATION' as const};const participants=orderedParticipants(actorId,otherId);let conversation=conversations.find(item=>item.contextType===contextType&&item.contextId===contextId&&item.participantIds[0]===participants[0]&&item.participantIds[1]===participants[1]);
  if(!conversation){const timestamp=now();conversation={id:`conv_${randomUUID().slice(0,12)}`,participantIds:participants,contextType,contextId,createdAt:timestamp,updatedAt:timestamp};conversations.unshift(conversation);persistEngagement();}return {data:conversation};
}
export function conversationProjection(conversation:Conversation,viewerId:string){const otherId=conversation.participantIds.find(id=>id!==viewerId)!;const thread=messages.filter(message=>message.conversationId===conversation.id);const last=thread.at(-1)||null;return {...conversation,otherParticipant:userProjection(otherId),lastMessage:last?{body:last.body,createdAt:last.createdAt,senderId:last.senderId}:null,unreadCount:thread.filter(message=>message.senderId!==viewerId&&!message.readBy.includes(viewerId)).length};}
export function listConversations(viewerId:string){return conversations.filter(item=>item.participantIds.includes(viewerId)).map(item=>conversationProjection(item,viewerId)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
export function ownedConversation(viewerId:string,id:string){return conversations.find(item=>item.id===id&&item.participantIds.includes(viewerId));}
export function listMessages(viewerId:string,conversationId:string){const conversation=ownedConversation(viewerId,conversationId);if(!conversation)return null;return messages.filter(item=>item.conversationId===conversationId).map(item=>({...item,sender:item.senderId===viewerId?'self':userProjection(item.senderId)}));}
export function sendMessage(viewerId:string,conversationId:string,body:string){const conversation=ownedConversation(viewerId,conversationId);if(!conversation)return null;const record:Message={id:`msg_${randomUUID().slice(0,12)}`,conversationId,senderId:viewerId,body,createdAt:now(),readBy:[viewerId]};messages.push(record);conversation.updatedAt=record.createdAt;const recipientId=conversation.participantIds.find(id=>id!==viewerId)!;notify(recipientId,'messages',`Message from ${userProjection(viewerId).name}`,body.slice(0,140),`/messages?conversation=${conversation.id}`);persistEngagement();return record;}
export function markConversationRead(viewerId:string,conversationId:string){const conversation=ownedConversation(viewerId,conversationId);if(!conversation)return false;for(const message of messages)if(message.conversationId===conversationId&&!message.readBy.includes(viewerId))message.readBy.push(viewerId);persistEngagement();return true;}
