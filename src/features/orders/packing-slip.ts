import { tx, txKey } from "@/lib/i18n/tx";
import type { RoleScope } from "@/lib/role-scope";
import { orderLinesInScope } from "@/lib/role-scope";
import {
  dict,
  dicts,
  isWarehouseLine,
  lineImage,
  lineKey,
  lineMeasurements,
  lineName,
  linePickup,
  lineQty,
  lineSku,
  openShipmentFor,
  orderForScope,
  readAddress,
  shipments,
  text,
  type Address,
  type Dict,
} from "./model";

/*
 * What goes on a packing slip. A slip is for packing a parcel, so it never
 * carries prices, totals or payment details.
 *
 * Staff pack for the customer and get the delivery name, phone and address.
 * A designer's parcel is not addressed by the designer: a Store Valley courier
 * collects it from the designer's pickup address and already holds the
 * customer's address in the pickup request. So a designer's slip lists only the
 * designer's own lines that are collected from them, names the courier as the
 * hand-over and gives the pickup tracking number, and has no customer name,
 * phone or address. (Designer-to-warehouse parcels belong to restock, not to
 * orders.) The designer's own lines that are already in the warehouse are
 * packed there and are only counted.
 */

/** Names of the options on a line. The line stores ids; the names live in `attributes` and `brands`. */
export type OptionNames = { attributes: Record<string, string>; terms: Record<string, string> };

export type SlipLine = {
  key: string;
  name: string;
  sku: string;
  kind: "Ready-made" | "Custom-made";
  /** "Size: M", "Colour: Black". */
  options: string[];
  /** Body measurements of a custom-made line. */
  measurements: string[];
  quantity: number;
  image: string;
  from: "warehouse" | "designer";
};

export type SlipDestination = {
  kind: "customer" | "courier";
  heading: string;
  name: string;
  phone: string;
  /** Address, one part per entry, in the order it is written. */
  address: string[];
  /** Parts a courier needs that the order does not have. */
  missing: string[];
  note: string;
};

export type PackingSlip = {
  audience: "staff" | "designer";
  orderNumber: string;
  placed: unknown;
  destination: SlipDestination;
  /** Store Valley tracking numbers of the open deliveries or pickups for these lines. */
  tracking: string[];
  lines: SlipLine[];
  lineCount: number;
  itemCount: number;
  /** A designer's own lines that ship from the warehouse and are not on this slip. */
  packedElsewhere: number;
};

/** The option ids of a line, as stored (`cart_item_attribute[]`), for looking their names up. */
export function lineOptionRefs(line: Dict): { attributeId: unknown; termId: unknown }[] {
  return dicts(line.cart_item_attribute)
    .map((item) => ({ attributeId: item.attributes_id, termId: item.attributes_default_term_id }))
    .filter((item) => text(item.attributeId) || text(item.termId));
}

function lineOptions(line: Dict, names: OptionNames) {
  return lineOptionRefs(line).map(({ attributeId, termId }) => {
    const label = names.attributes[text(attributeId)] || tx("Option");
    const value = names.terms[text(termId)] || text(termId) || tx("not chosen");
    return `${label}: ${value}`;
  });
}

/**
 * The display name of an `attributes` or `brands` record: the edited
 * translation, else the automatic one, else the original name.
 */
export function optionName(record: Dict, prefix: "attribute" | "brand", lang: "en" | "ar") {
  const pick = (key: string) => text(dict(dict(record[key]).name)[lang]);
  return pick(`${prefix}_info_custom_translate`) || pick(`${prefix}_info_translate`) || text(dict(record[`${prefix}_info`]).name);
}

function addressParts(address: Address) {
  return [address.line1, address.line2, address.block && tx("Block {block}", { block: address.block }), address.building && tx("Building {building}", { building: address.building }), [address.city, address.state].filter(Boolean).join(tx(", ")), [address.country, address.postalCode].filter(Boolean).join(" ")].filter(Boolean) as string[];
}

function missingParts(address: Address) {
  return [!address.name && tx("name"), !address.phone && tx("phone number"), !address.line1 && tx("street"), !address.city && tx("city")].filter(Boolean) as string[];
}

function customerDestination(order: Dict): SlipDestination {
  const address = readAddress(order.shipping_address);
  const missing = missingParts(address);
  return {
    kind: "customer",
    heading: tx("Ship to"),
    name: address.name,
    phone: address.phone,
    address: addressParts(address),
    missing,
    note: missing.length ? tx("The order has no {parts} for delivery. Check with the customer before sending.", { parts: missing.join(tx(", ")) }) : "",
  };
}

function courierDestination(lines: Dict[], tracking: string[]): SlipDestination {
  const pickup = readAddress(lines.map((line) => linePickup(line).pickup_address).find((value) => text(dict(value).address_line_1)));
  const marked = Boolean(pickup.line1);
  return {
    kind: "courier",
    heading: tx("Hand to the Store Valley courier"),
    name: marked ? pickup.name : "",
    phone: "",
    address: marked ? addressParts(pickup) : [],
    missing: [],
    note: !marked
      ? tx("The courier is booked when you mark the item ready for pickup. Write the order number on the parcel.")
      : tracking.length
        ? tx("Collected from your pickup address above. Write the order number and the tracking number on the parcel; the courier holds the delivery address.")
        : tx("Collected from your pickup address above once the pickup is booked. Write the order number on the parcel; the courier holds the delivery address."),
  };
}

const NO_NAMES: OptionNames = { attributes: {}, terms: {} };

/**
 * The packing slip of an order for the signed-in person, or null when they may
 * not see the order. `names` resolves option ids to names; without it the stored
 * ids are shown.
 */
export function packingSlip(order: Dict | null | undefined, scope: RoleScope, names: OptionNames = NO_NAMES): PackingSlip | null {
  const seen = orderForScope(scope, order);
  if (!seen) return null;
  const own = orderLinesInScope<Dict>(scope, seen);
  const packed = scope.isDesigner ? own.filter((line) => !isWarehouseLine(line)) : own;

  const tracking = new Set<string>();
  const productIds = new Set(packed.map((line) => text(line.product_id)));
  for (const shipment of shipments(seen)) if (!shipment.cancelled && shipment.trackingId && shipment.productIds.some((id) => productIds.has(id))) tracking.add(shipment.trackingId);
  for (const line of packed) {
    const pickupTracking = text(linePickup(line).delivery_tracking_id);
    if (pickupTracking && !openShipmentFor(seen, text(line.product_id))) tracking.add(pickupTracking);
  }

  const lines: SlipLine[] = packed.map((line) => ({
    key: lineKey(line),
    name: lineName(line),
    sku: lineSku(line),
    kind: text(line.product_main_type).toLowerCase() === "custom" ? txKey("Custom-made") : txKey("Ready-made"),
    options: lineOptions(line, names),
    measurements: lineMeasurements(line),
    quantity: lineQty(line) || 1,
    image: lineImage(line),
    from: isWarehouseLine(line) ? "warehouse" : "designer",
  }));

  return {
    audience: scope.isDesigner ? "designer" : "staff",
    orderNumber: text(seen.order_id),
    placed: seen.created_at,
    destination: scope.isDesigner ? courierDestination(packed, [...tracking]) : customerDestination(seen),
    tracking: [...tracking],
    lines,
    lineCount: lines.length,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    packedElsewhere: own.length - packed.length,
  };
}
