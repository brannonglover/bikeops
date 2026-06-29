export type Stage =
  | "PENDING_APPROVAL"
  | "BOOKED_IN"
  | "RECEIVED"
  | "WORKING_ON"
  | "WAITING_ON_CUSTOMER"
  | "WAITING_ON_PARTS"
  | "BIKE_READY"
  | "COMPLETED"
  | "CANCELLED";

export type PaymentStatus = "UNPAID" | "PENDING" | "PAID" | "REFUNDED";
export type DeliveryType = "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE";
export type BikeType = "REGULAR" | "E_BIKE";
export type MessageSender = "STAFF" | "CUSTOMER";

export interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  bikes: Bike[];
  createdAt: string;
  updatedAt: string;
}

export interface Bike {
  id: string;
  make: string;
  model: string | null;
  bikeType: BikeType | null;
  nickname: string | null;
  imageUrl: string | null;
  customerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobBike {
  id: string;
  jobId: string;
  make: string;
  model: string | null;
  bikeType: BikeType | null;
  nickname: string | null;
  imageUrl: string | null;
  bikeId: string | null;
  bike: Bike | null;
  sortOrder: number;
  completedAt: string | null;
  waitingOnPartsAt: string | null;
  createdAt: string;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  price: string;
  slug: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobService {
  id: string;
  jobId: string;
  serviceId: string | null;
  service: Service | null;
  customServiceName?: string | null;
  quantity: number;
  unitPrice: string;
  notes: string | null;
  jobBikeId?: string | null;
  jobBike?: { id: string; make: string; model: string; nickname: string | null } | null;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: string;
  stockQuantity: number;
  supplier: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobProduct {
  id: string;
  jobId: string;
  productId: string;
  product: Product;
  quantity: number;
  unitPrice: string;
  notes: string | null;
  jobBikeId?: string | null;
  jobBike?: { id: string; make: string; model: string; nickname: string | null } | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  jobId: string;
  stripePaymentIntentId: string | null;
  amount: string;
  currency: string;
  status: string;
  paymentMethod: string | null;
  createdAt: string;
}

export interface Job {
  id: string;
  bikeMake: string;
  bikeModel: string | null;
  jobBikes: JobBike[];
  workingOnJobBikeId: string | null;
  stage: Stage;
  deliveryType: DeliveryType;
  dropOffDate: string | null;
  pickupDate: string | null;
  collectionAddress: string | null;
  collectionPickupWindowFrom: string | null;
  collectionPickupWindowTo: string | null;
  collectionReturnWindowFrom: string | null;
  collectionReturnWindowTo: string | null;
  customerId: string | null;
  customer: Customer | null;
  notes: string | null;
  internalNotes: string | null;
  customerNotes: string | null;
  cancellationReason: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  paymentStatus: PaymentStatus;
  /** Sum of successful payments applied toward the job total (excludes card processing surcharge). */
  totalPaid?: number;
  jobServices: JobService[];
  jobProducts: JobProduct[];
  createdAt: string;
  updatedAt: string;
}

export interface MessageAttachment {
  id: string;
  messageId: string | null;
  url: string;
  filename: string;
  mimeType: string;
  createdAt: string;
}

export interface MessageReaction {
  id: string;
  messageId: string;
  emoji: string;
  reactorType: MessageSender;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  sender: MessageSender;
  body: string | null;
  attachments: MessageAttachment[];
  reactions: MessageReaction[];
  createdAt: string;
  editedAt: string | null;
  /**
   * Client-only delivery state for optimistic UI (not persisted).
   * Mirrors the web app's "sending/delivered" indicator.
   */
  clientDeliveryState?: "SENDING" | "DELIVERED" | "FAILED";
}

export interface Conversation {
  id: string;
  customerId: string;
  customer: Customer;
  jobId: string | null;
  job: Job | null;
  messages: ChatMessage[];
  archived: boolean;
  customerTypingAt: string | null;
  staffLastReadAt: string | null;
  customerLastReadAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Stats {
  bikes: { day: number; week: number; month: number; year: number };
  revenue: { day: number; week: number; month: number; year: number };
  shopRevenue: { day: number; week: number; month: number; year: number };
  stripeRevenue?: { day: number; week: number; month: number; year: number };
  cashRevenue?: { day: number; week: number; month: number; year: number };
  importedRevenue: { day: number; week: number; month: number; year: number };
  lastYear?: {
    calendarYear: number;
    revenue: number;
    shopRevenue: number;
    stripeRevenue: number;
    cashRevenue: number;
    importedRevenue: number;
  };
  topServices: { name: string; count: number; revenue: number }[];
}

export interface EmailTemplate {
  id: string;
  slug: string;
  name: string;
  subject: string;
  bodyHtml: string;
  triggerType: string;
  stage: Stage | null;
  deliveryType: DeliveryType | null;
  delayDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export const STAGE_LABELS: Record<Stage, string> = {
  PENDING_APPROVAL: "Pending Approval",
  BOOKED_IN: "Booked In",
  RECEIVED: "Received",
  WORKING_ON: "Working On",
  WAITING_ON_CUSTOMER: "Waiting on Customer",
  WAITING_ON_PARTS: "Waiting on Parts",
  BIKE_READY: "Bike Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const STAGE_COLORS: Record<Stage, string> = {
  PENDING_APPROVAL: "#f59e0b",
  BOOKED_IN: "#3b82f6",
  RECEIVED: "#8b5cf6",
  WORKING_ON: "#f97316",
  WAITING_ON_CUSTOMER: "#8b5cf6",
  WAITING_ON_PARTS: "#ef4444",
  BIKE_READY: "#10b981",
  COMPLETED: "#6b7280",
  CANCELLED: "#dc2626",
};

export const STAGES: Stage[] = [
  "PENDING_APPROVAL",
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
  "BIKE_READY",
  "COMPLETED",
  "CANCELLED",
];

export const DISPLAY_STAGES: Stage[] = STAGES.filter((s) => s !== "CANCELLED");
