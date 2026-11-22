export type StoreValleyAddress = {
  locationId?: string;
  name?: string;
  street: string;
  city: string;
  governorate?: string;
  district?: string;
  block?: string;
  building?: string;
  postalCode?: string;
  country?: string;
  contactName: string;
  contactPhone: string;
  latitude?: number;
  longitude?: number;
};

const ordinalBlock =
  /^(\d+)\s*,\s*(\d+)(?:st|nd|rd|th)?\s+block\s*,\s*(.+?)\s*,\s*(.+)$/i;
const namedBlock = /^(\d+)\s*,\s*block\s+(\d+)\s*,\s*(.+?)\s*,\s*(.+)$/i;
const stAndBlock = /^(\d+)\s+st\s*(\d+)\s*,\s*block\s+(\d+)$/i;

const areaAliases: Record<string, string> = {
  hawaliy: "Hawalli",
  hawally: "Hawalli",
  hawalli: "Hawalli",
  salmiya: "Salmiya",
  salmiyah: "Salmiya",
};

const areaGovernorate: Record<string, string> = {
  Hawalli: "Hawalli",
  Salmiya: "Hawalli",
  Jabriya: "Hawalli",
};

function optional(value?: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : undefined;
}

export function normalizePhone(phone: string) {
  const trimmed = phone.trim();
  if (!trimmed || trimmed === "-") return trimmed;
  let value = trimmed.replace(/[\s-]/g, "");
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (!value.startsWith("+")) {
    value = value.startsWith("965") ? `+${value}` : `+965${value}`;
  }
  return value;
}

function titleWord(word: string) {
  if (/^\d+(st|nd|rd|th)$/i.test(word)) return word.toLowerCase();
  if (!word) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

function formatStreet(raw: string) {
  const titled = raw.trim().split(/\s+/).map(titleWord).join(" ");
  if (/\b(street|road|avenue|blvd|lane)\b/i.test(titled)) return titled;
  const stNumber = /^st\s*(\d+)$/i.exec(titled);
  if (stNumber) return `Street ${stNumber[1]}`;
  return `${titled} Street`;
}

function canonicalArea(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return (
    areaAliases[trimmed.toLowerCase()] ??
    trimmed.split(/\s+/).map(titleWord).join(" ")
  );
}

function isGenericCity(city: string) {
  const normalized = city.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "kuwait" ||
    normalized === "kuwait city" ||
    normalized === "kuwaitcity"
  );
}

type Parsed = { building: string; block: string; street: string; area?: string };

function parseStreet(street: string): Parsed | null {
  if (!street) return null;
  const ordinal = ordinalBlock.exec(street);
  if (ordinal) {
    return {
      building: ordinal[1],
      block: ordinal[2],
      street: formatStreet(ordinal[3]),
      area: ordinal[4],
    };
  }
  const named = namedBlock.exec(street);
  if (named) {
    return {
      building: named[1],
      block: named[2],
      street: formatStreet(named[3]),
      area: named[4],
    };
  }
  const stBlock = stAndBlock.exec(street);
  if (stBlock) {
    return {
      building: stBlock[1],
      block: stBlock[3],
      street: formatStreet(`st ${stBlock[2]}`),
    };
  }
  return null;
}

export function addressFromParts(input: {
  street: string;
  city: string;
  contactName: string;
  contactPhone: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  building?: string;
  block?: string;
  governorate?: string;
}): StoreValleyAddress {
  const explicitBuilding = optional(input.building);
  const explicitBlock = optional(input.block);
  const explicitGovernorate = optional(input.governorate);
  const parsed =
    !explicitBuilding && !explicitBlock ? parseStreet(input.street.trim()) : null;
  const area = parsed ? canonicalArea(parsed.area ?? "") : undefined;
  const resolvedCity =
    isGenericCity(input.city) && area ? area : input.city.trim();
  const district = area || undefined;
  const resolvedGovernorate =
    explicitGovernorate ??
    (district ? (areaGovernorate[district] ?? district) : undefined);
  return {
    street: parsed?.street ?? input.street.trim(),
    city: resolvedCity,
    country: optional(input.country),
    governorate: resolvedGovernorate,
    district,
    block: explicitBlock ?? parsed?.block,
    building: explicitBuilding ?? parsed?.building,
    contactName: input.contactName.trim(),
    contactPhone: normalizePhone(input.contactPhone),
    latitude: input.latitude,
    longitude: input.longitude,
  };
}

export function addressToJson(address: StoreValleyAddress) {
  return {
    location_id: address.locationId ?? null,
    name: address.name ?? null,
    street: address.street,
    city: address.city,
    governorate: address.governorate ?? null,
    district: address.district ?? null,
    block: address.block ?? null,
    building: address.building ?? null,
    postal_code: address.postalCode ?? null,
    country: address.country ?? null,
    contact_name: address.contactName,
    contact_phone: address.contactPhone,
    latitude: address.latitude ?? null,
    longitude: address.longitude ?? null,
  };
}

export function prepareWarehouseIntakeBody(
  body: Record<string, unknown>,
  generatePickupOtp = true,
) {
  if (generatePickupOtp) {
    body.requires_otp_proof = true;
    delete body.delivery_otp;
  }
  if (body.special_instructions === "") delete body.special_instructions;
  return body;
}

export type LogisticsItem = {
  sku?: string;
  quantity: number;
  productId?: string;
  productName?: string;
};

export function itemsFromJson(itemsListJson: unknown): LogisticsItem[] {
  const raw = Array.isArray(itemsListJson)
    ? itemsListJson
    : itemsListJson && typeof itemsListJson === "object"
      ? [itemsListJson]
      : [];
  return raw.map((entry) => {
    const map = entry as Record<string, unknown>;
    const parsed = Number.parseInt(String(map.quantity ?? 1), 10);
    const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    const productId = String(map.skuNumber ?? map.product_id ?? "").trim();
    let sku = String(map.sku ?? "").trim();
    if (!sku || sku === "-") sku = "";
    const name = map.name ?? map.product_name;
    return {
      quantity,
      productId: productId || undefined,
      sku: sku || (productId ? undefined : name ? String(name) : undefined),
      productName: name == null ? undefined : String(name),
    };
  });
}

export function logisticsItemToJson(item: LogisticsItem) {
  return {
    sku: item.sku ?? null,
    quantity: item.quantity,
    product_id: item.productId ?? null,
    product_name: item.productName ?? null,
    condition_notes: null,
    packaging_notes: null,
  };
}

export function warehouseIntakeBody(request: {
  externalRequestId: string;
  warehouseId: string;
  designer: { designerId: string; name?: string; pickupAddress: StoreValleyAddress };
  items: LogisticsItem[];
  specialInstructions?: string;
}) {
  const body: Record<string, unknown> = {
    external_request_id: request.externalRequestId,
    warehouse_id: request.warehouseId,
    designer: {
      designer_id: request.designer.designerId,
      name: request.designer.name ?? null,
      pickup_address: addressToJson(request.designer.pickupAddress),
    },
    items: request.items.map(logisticsItemToJson),
    requested_pickup_at: null,
    special_instructions: request.specialInstructions ?? null,
    metadata: null,
  };
  if (request.specialInstructions === "") body.special_instructions = "";
  return prepareWarehouseIntakeBody(body);
}

/**
 * A warehouse delivery (`POST /orders`) exactly as the Flutter admin sends it for
 * stock leaving the warehouse: the SDK's `DeliveryRequest.toJson()` after
 * `StoreValleyService.createDelivery` asked for an OTP (`requires_otp_proof`
 * true, no `delivery_otp`: the proxy generates the code).
 */
export function deliveryRequestToJson(request: {
  clientOrderId: string;
  designerId: string;
  pickupLocationId: string;
  deliveryAddress: StoreValleyAddress;
  items: LogisticsItem[];
  specialInstructions?: string;
  orderKind?: "ready_made" | "custom_made";
  packagingProfile: string;
}) {
  return {
    client_order_id: request.clientOrderId,
    designer_id: request.designerId,
    pickup_location_id: request.pickupLocationId,
    delivery_address: addressToJson(request.deliveryAddress),
    items: request.items.map(logisticsItemToJson),
    stops: null,
    requires_collection: false,
    collection_amount: null,
    special_instructions: request.specialInstructions ?? null,
    order_kind: request.orderKind ?? "ready_made",
    inventory_source: "warehouse",
    packaging_profile: request.packagingProfile,
    requires_otp_proof: true,
    requires_photo_proof: true,
    metadata: null,
  };
}

export function pickupRequestToJson(request: {
  externalRequestId: string;
  designer: { designerId: string; name?: string; pickupAddress: StoreValleyAddress };
  deliveryAddress: StoreValleyAddress;
  items: LogisticsItem[];
  requiresOtpProof?: boolean;
}) {
  return {
    external_request_id: request.externalRequestId,
    source_order_id: null,
    pickup_purpose: "designer_order_fulfillment",
    order_kind: null,
    designer: {
      designer_id: request.designer.designerId,
      name: request.designer.name ?? null,
      pickup_address: addressToJson(request.designer.pickupAddress),
    },
    delivery_address: addressToJson(request.deliveryAddress),
    customer: null,
    items: request.items.map(logisticsItemToJson),
    requested_pickup_at: null,
    requires_collection: false,
    collection_amount: null,
    requires_otp_proof: request.requiresOtpProof ?? true,
    delivery_otp: null,
    requires_photo_proof: true,
    packaging_profile: null,
    special_instructions: null,
    metadata: null,
  };
}
