"use client";

import { httpsCallable } from "firebase/functions";
import { getFirebase } from "./firebase";
import { StoreValleyConfig } from "./store-valley/config";

export async function callFunction<T = Record<string, unknown>>(
  name: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const callable = httpsCallable(getFirebase().functions, name);
  const result = await callable(data);
  if (result.data && typeof result.data === "object") {
    return result.data as T;
  }
  return { data: result.data } as T;
}

export function releaseWarehouseStock(input: {
  orderId: string;
  reason: string;
  productIds?: string[];
}) {
  return callFunction(StoreValleyConfig.releaseWarehouseStockCallableName, {
    order_id: input.orderId,
    reason: input.reason,
    ...(input.productIds ? { product_ids: input.productIds } : {}),
  });
}

export function reserveWarehouseStock(orderId: string) {
  return callFunction(StoreValleyConfig.reserveWarehouseStockCallableName, {
    order_id: orderId,
  });
}

export function backfillWarehouseReservations() {
  return callFunction(StoreValleyConfig.backfillWarehouseReservationsCallableName, {});
}

export function retryStoreValleyDelivery(orderId: string) {
  return callFunction(StoreValleyConfig.retryStoreValleyDeliveryCallableName, {
    order_id: orderId,
  });
}

export function backfillStoreValleyDeliveries() {
  return callFunction(StoreValleyConfig.backfillStoreValleyDeliveriesCallableName, {});
}

export function syncStoreValleyInventory() {
  return callFunction(StoreValleyConfig.syncInventoryCallableName, {});
}

export function resendPickupOtp(input: Record<string, unknown>) {
  return callFunction(StoreValleyConfig.resendPickupOtpCallableName, input);
}

export function storeValleyProxy(input: {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  notifyCustomer?: Record<string, unknown>;
}) {
  return callFunction(StoreValleyConfig.proxyCallableName, {
    method: input.method,
    path: input.path,
    ...(input.body ? { body: stripNulls(input.body) } : {}),
    ...(input.query ? { query: input.query } : {}),
    ...(input.notifyCustomer ? { notifyCustomer: input.notifyCustomer } : {}),
  });
}

export function sendPushToUser(input: { userRef: string; title: string; body: string }) {
  return callFunction("sendPushNotificationToUser", input);
}

export function sendPushToUsers(input: { userRefs: string[]; title: string; body: string }) {
  return callFunction("sendPushNotificationToUsers", input);
}

export function sendPushToMultiple(input: { tokens: string[]; title: string; body: string }) {
  return callFunction("sendPushNotificationToMultipleUsers", input);
}

export function generateDynamicReport(input: Record<string, unknown> = {}) {
  return callFunction("generateDynamicReport", input);
}

function stripNulls(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      out[key] = value
        .filter((item) => item != null)
        .map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? stripNulls(item as Record<string, unknown>)
            : item,
        );
    } else if (typeof value === "object") {
      out[key] = stripNulls(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}
