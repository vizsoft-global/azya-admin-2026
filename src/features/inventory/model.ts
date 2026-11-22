import { toDate, toNumber } from "@/lib/format";
import { tx } from "@/lib/i18n/tx";

/**
 * Plain readers for the two collections this area works on, with the field
 * names exactly as the Flutter admin and the customer app store them:
 * `inventory` (one stock record per product) and `inventorymovementlog`
 * (one record per restock / return request, which also carries its enquiry).
 */

/** A Firestore row as the shared hooks return it. */
export type Row = { id: string; data: Record<string, unknown> };

/** Write markers. Builders stay free of Firebase; `data.ts` turns these into the real field values. */
export const NOW = { $op: "now" } as const;
export const DELETE = { $op: "delete" } as const;
export const inc = (by: number) => ({ $op: "inc", by }) as const;
/** Appends entries to a list field without touching the ones already there. */
export const union = (...values: unknown[]) => ({ $op: "union", values }) as const;
export type Patch = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));
const int = (value: unknown) => Math.trunc(toNumber(value) ?? 0);
const map = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** Document id of a stored reference (`product_ref`, `inventory_ref` …), or "". */
export function refId(value: unknown): string {
  const id = map(value).id;
  return typeof id === "string" ? id : "";
}

/** An address as stored on a user's shipping / pickup address and on the warehouse settings. */
export type AddressView = {
  name: string;
  phone: string;
  email: string;
  line1: string;
  city: string;
  state: string;
  country: string;
  building: string;
  block: string;
  latitude?: number;
  longitude?: number;
};

export function readAddress(value: unknown): AddressView {
  const data = map(value);
  const point = map(data.lat_long);
  const latitude = typeof point.latitude === "number" ? point.latitude : undefined;
  const longitude = typeof point.longitude === "number" ? point.longitude : undefined;
  return {
    name: text(data.shipping_name).trim(),
    phone: text(data.shipping_phone).trim(),
    email: text(data.shipping_email).trim(),
    line1: text(data.address_line_1).trim(),
    city: text(data.city).trim(),
    state: text(data.state).trim(),
    country: text(data.country).trim(),
    building: text(data.building).trim(),
    block: text(data.block).trim(),
    latitude,
    longitude,
  };
}

export function addressLine(address: AddressView) {
  return [address.building, address.block && tx("Block {block}", { block: address.block }), address.line1, address.city, address.state, address.country].filter(Boolean).join(", ");
}

export type DeliveryInfoView = {
  ref: unknown;
  refId: string;
  deliveryId: string;
  trackingId: string;
  pickupOtp: string;
  /** `status` on the delivery info holds the OTP state ("verified" once the driver confirmed it). */
  otpStatus: string;
  packageCount: number;
  notes: string;
  pickup: AddressView;
  dropOff: AddressView;
};

function readDeliveryInfo(value: unknown): DeliveryInfoView {
  const data = map(value);
  return {
    ref: data.delivery_ref ?? null,
    refId: refId(data.delivery_ref),
    deliveryId: text(data.delivery_id),
    trackingId: text(data.delivery_tracking_id),
    pickupOtp: text(data.pickup_otp),
    otpStatus: text(data.status),
    packageCount: int(data.packageCount),
    notes: text(data.notes),
    pickup: readAddress(data.pickup_address),
    dropOff: readAddress(data.delivery_address),
  };
}

export type EnquiryView = {
  id: string;
  status: string;
  issueType: string;
  affectedQty: number;
  fulfillStatus: string;
  images: string[];
};

export type RequestView = {
  /** Firestore document id. */
  id: string;
  movementLogId: string;
  /** "inbound" (restock) or "outbound" (return to designer). */
  direction: string;
  productId: string;
  productName: string;
  productRef: unknown;
  inventoryRef: unknown;
  inventoryDocId: string;
  quantity: number;
  designerUid: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  requestId: string;
  requestStatus: string;
  fulfillStatus: string;
  requestType: string;
  raisedBy: string;
  adminPreferredDate: Date | null;
  adminNotes: string;
  /** Stored as `designer_preferred_notes`, but it is the designer's date. */
  designerDate: Date | null;
  designerNotes: string;
  delivery: DeliveryInfoView;
  enquiry: EnquiryView;
  enquiryDelivery: DeliveryInfoView;
  /** True once the received pieces were added to stock from this panel (`stock_received_at` is set). */
  stockReceived: boolean;
  /** `stock_received_quantity`: how many pieces that step added. */
  stockReceivedQuantity: number;
  /**
   * `request_info.stock_returned_quantity` / `stock_on_hand_returned_quantity`: what approving a return to
   * designer in this panel took out of `stock` and `stock_on_hand`. Null on returns approved in the old admin.
   */
  stockReturned: number | null;
  stockOnHandReturned: number | null;
  /** `movement_info[]`: dated notes on the record (stock received, stock adjusted). */
  movements: { at: Date | null; text: string }[];
};

export function readRequest(row: Row): RequestView {
  const data = row.data;
  const info = map(data.request_info);
  const enquiry = map(data.enquiry_info);
  return {
    id: row.id,
    movementLogId: text(data.movement_log_id),
    direction: text(data.status),
    productId: text(data.product_id),
    productName: text(data.product_name),
    productRef: data.product_ref ?? null,
    inventoryRef: data.inventory_ref ?? null,
    inventoryDocId: refId(data.inventory_ref),
    quantity: int(data.product_quantity),
    designerUid: text(data.designer_uid),
    createdAt: toDate(data.created_at),
    updatedAt: toDate(data.update_at),
    requestId: text(info.inventory_request_id),
    requestStatus: text(info.request_status),
    fulfillStatus: text(info.fulfill_status),
    requestType: text(info.request_type),
    raisedBy: text(info.raised_by),
    adminPreferredDate: toDate(info.admin_preferred_date),
    adminNotes: text(info.admin_notes),
    designerDate: toDate(info.designer_preferred_notes),
    designerNotes: text(info.designer_notes),
    delivery: readDeliveryInfo(data.request_delivery_info),
    enquiry: {
      id: text(enquiry.enquiry_id),
      status: text(enquiry.status),
      issueType: text(enquiry.issue_type),
      affectedQty: int(enquiry.affected_quanity),
      fulfillStatus: text(enquiry.fulfill_status),
      images: Array.isArray(enquiry.images) ? enquiry.images.filter((item): item is string => typeof item === "string" && item !== "") : [],
    },
    enquiryDelivery: readDeliveryInfo(data.enquiry_delivery_info),
    stockReceived: data.stock_received_at != null,
    stockReceivedQuantity: int(data.stock_received_quantity),
    stockReturned: info.stock_returned_quantity == null ? null : int(info.stock_returned_quantity),
    stockOnHandReturned: info.stock_on_hand_returned_quantity == null ? null : int(info.stock_on_hand_returned_quantity),
    movements: (Array.isArray(data.movement_info) ? data.movement_info : []).map((entry) => ({ at: toDate(map(entry).movement_date), text: text(map(entry).movement_info) })),
  };
}

export type InventoryView = {
  id: string;
  inventoryId: string;
  productId: string;
  productRef: unknown;
  productDocId: string;
  sku: string;
  productType: string;
  status: string;
  stockStatus: string;
  stockSource: string;
  isPreferredVendor: boolean;
  designerUid: string;
  stock: number;
  stockOnHand: number;
  stockReserved: number;
  stockUnavailable: number;
  threshold: number;
  availableForOrder: number;
  shippedDays: number;
  updatedAt: Date | null;
  lastCountedAt: Date | null;
  restockRequestId: string;
  enquiryRequestId: string;
};

export function readInventory(row: Row): InventoryView {
  const data = row.data;
  return {
    id: row.id,
    inventoryId: text(data.inventory_id),
    productId: text(data.product_id),
    productRef: data.product_ref ?? null,
    productDocId: refId(data.product_ref),
    sku: text(data.product_sku),
    productType: text(data.product_type),
    status: text(data.status),
    stockStatus: text(data.stock_status),
    stockSource: text(data.stock_source),
    isPreferredVendor: data.is_preferred_vendor === true,
    designerUid: text(data.designer_uid),
    stock: int(data.stock),
    stockOnHand: int(data.stock_on_hand),
    stockReserved: int(data.stock_reserved),
    stockUnavailable: int(data.stock_unavailable),
    threshold: int(data.threshold_stock),
    availableForOrder: int(data.available_for_order),
    shippedDays: int(data.shipped_number_days),
    updatedAt: toDate(data.updated_at),
    lastCountedAt: toDate(data.last_counted_at),
    restockRequestId: refId(data.restock_request_raised_ref),
    enquiryRequestId: refId(data.enquiry_raised_ref),
  };
}

/** What a product record contributes to this area: its name, picture, designer and stock record. */
export type ProductView = {
  id: string;
  productId: string;
  name: string;
  nameAr: string;
  /** `product_info.name` as stored: the name the Flutter admin copies onto requests and notices. */
  storedName: string;
  image: string;
  designerUid: string;
  designerRef: unknown;
  inventoryRef: unknown;
  inventoryDocId: string;
  isPreferredVendor: boolean;
};

export function readProduct(row: Row): ProductView {
  const data = row.data;
  const info = map(data.product_info);
  const custom = map(map(data.product_info_custom_translate).name);
  const translated = map(map(data.product_info_translate).name);
  const stock = map(data.product);
  const authorizer = map(data.product_authorizer);
  const name = text(custom.en) || text(translated.en) || text(info.name);
  return {
    id: row.id,
    productId: text(data.product_id),
    name,
    nameAr: text(custom.ar) || text(translated.ar),
    storedName: text(info.name),
    image: text(info.feature_image) || text(info.icon_image),
    designerUid: text(authorizer.product_designer_id),
    designerRef: authorizer.product_designer_ref ?? null,
    inventoryRef: stock.inventory_ref ?? null,
    inventoryDocId: refId(stock.inventory_ref),
    isPreferredVendor: stock.is_preferred_vendor === true,
  };
}

/** The name the Flutter admin writes on a request: `product_info.name`, untranslated. */
export function storedProductName(row: Row) {
  return text(map(row.data.product_info).name);
}
