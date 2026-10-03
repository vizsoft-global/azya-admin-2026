"use client";

import { useState, type ReactNode } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebase } from "@/lib/firebase";
import {
  backfillStoreValleyDeliveries,
  backfillWarehouseReservations,
  releaseWarehouseStock,
  resendPickupOtp,
  reserveWarehouseStock,
  sendPushToUsers,
  storeValleyProxy,
  syncStoreValleyInventory,
} from "@/lib/functions";
import { availableForOrder } from "@/lib/store-valley/inventory";
import {
  canResendPickupOtp,
  customerShipmentOtpLabel,
  stepsFor,
} from "@/lib/store-valley/intake-tracking";
import { designerMustAccept, RestockRequestOrigin } from "@/lib/store-valley/restock";
import { buildRestockIntakePayload } from "@/lib/store-valley/payloads";
import { warehouseDeliveryBadgeLabel } from "@/lib/store-valley/delivery-status";
import { buildShopperReturnPayload, shopperReturnApproveMessage } from "@/lib/store-valley/payloads";
import { saveDoc, useCollection, type Row } from "@/lib/firestore-ui";

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[14px] bg-white p-4">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      {children}
    </div>
  );
}

export function OrderActions({ row, onNote }: { row: Row | null; onNote: (t: string) => void }) {
  const [reason, setReason] = useState("shipped");
  if (!row) return <Box title="Order actions"><p className="text-xs text-[#a9a9a9]">Select an order.</p></Box>;
  const data = row.data;
  const badge = warehouseDeliveryBadgeLabel(String(data.custom_shipping_request_status ?? data.ready_shipping_request_status ?? ""));
  const otp = customerShipmentOtpLabel({
    pickupOtp: String(data.pickup_otp ?? ""),
    otpVerificationStatus: String(data.otp_verification_status ?? ""),
    deliveryStatus: String(data.order_status ?? ""),
  });
  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      const result = await fn();
      onNote(`${ok} ${JSON.stringify(result).slice(0, 180)}`);
    } catch (err) {
      onNote(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <Box title="Order actions">
      <p className="text-xs text-[#757575]">Reservation: {String(data.inventory_reservation_status ?? "none")}</p>
      {badge && <p className="text-xs">{badge}</p>}
      {otp && <p className="text-xs">{otp}</p>}
      <div className="mt-2 flex flex-col gap-2">
        <button className="rounded-lg border border-[#e3e3e3] bg-white px-2.5 py-1 text-xs hover:bg-[#fafafa]" onClick={() => run(() => reserveWarehouseStock(row.id), "Reserved")}>Reserve warehouse stock</button>
        <label className="text-xs">Release reason
          <input className="mt-1 w-full rounded-lg border border-[#e3e3e3] bg-[#fafafa] px-2 py-1 outline-none" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button className="rounded-lg bg-[#1a1a1a] px-2.5 py-1 text-xs text-white hover:bg-black" onClick={() => run(() => releaseWarehouseStock({ orderId: row.id, reason }), "Released")}>
          Release stock ({reason})
        </button>
        <button className="rounded-lg border border-[#e3e3e3] bg-white px-2.5 py-1 text-xs hover:bg-[#fafafa]" onClick={() => run(() => storeValleyProxy({ method: "POST", path: "/orders", body: { external_request_id: String(data.order_id ?? row.id) } }), "Delivery queued")}>
          Create shipping label
        </button>
        <button className="rounded-lg border border-[#e3e3e3] bg-white px-2.5 py-1 text-xs hover:bg-[#fafafa]" onClick={() => updateDoc(doc(getFirebase().db, "orders", row.id), { order_status: "shipped", updated_at: new Date() }).then(() => onNote("Marked shipped"))}>
          Mark shipped
        </button>
      </div>
    </Box>
  );
}

export function InventoryActions({ row, onNote }: { row: Row | null; onNote: (t: string) => void }) {
  const data = row?.data ?? {};
  const available = availableForOrder({
    stored: Number(data.stock ?? data.stock_on_hand ?? 0),
    reserved: Number(data.stock_reserved ?? 0),
    unavailable: Number(data.stock_unavailable ?? 0),
  });
  const needsAccept = designerMustAccept({
    requestType: String(data.request_info && typeof data.request_info === "object" ? (data.request_info as { type?: string }).type ?? "Restock" : "Restock"),
    raisedBy: RestockRequestOrigin.admin,
    inventoryRequestId: String(data.movement_log_id ?? ""),
  });
  const otp = String(data.pickup_otp ?? "");
  const canResend = canResendPickupOtp({
    pickupOtp: otp,
    otpVerificationStatus: String(data.otp_verification_status ?? ""),
    intakeStatus: String(data.status ?? ""),
  });
  return (
    <Box title="Inventory / Store Valley">
      <p className="text-xs">Sellable available_for_order: {row ? available : "—"}</p>
      <p className="text-xs">Designer must accept (admin restock): {needsAccept ? "yes" : "no"}</p>
      <div className="mt-2 flex flex-col gap-2">
        <button className="rounded-lg border border-[#e3e3e3] bg-white px-2.5 py-1 text-xs hover:bg-[#fafafa]" onClick={() => syncStoreValleyInventory().then((r) => onNote(JSON.stringify(r).slice(0, 180))).catch((e) => onNote(e.message))}>Sync warehouse inventory</button>
        <button className="rounded-lg border border-[#e3e3e3] bg-white px-2.5 py-1 text-xs hover:bg-[#fafafa]" onClick={() => backfillWarehouseReservations().then((r) => onNote(JSON.stringify(r).slice(0, 160))).catch((e) => onNote(e.message))}>Backfill reservations</button>
        <button className="rounded-lg border border-[#e3e3e3] bg-white px-2.5 py-1 text-xs hover:bg-[#fafafa]" onClick={() => backfillStoreValleyDeliveries().then((r) => onNote(JSON.stringify(r).slice(0, 160))).catch((e) => onNote(e.message))}>Backfill deliveries</button>
        {canResend && (
          <button className="rounded-lg border border-[#e3e3e3] bg-white px-2.5 py-1 text-xs hover:bg-[#fafafa]" onClick={() => resendPickupOtp({ request_id: row?.id }).then(() => onNote("OTP resent")).catch((e) => onNote(e.message))}>
            Resend pickup OTP
          </button>
        )}
        <button
          className="rounded-lg bg-[#1a1a1a] px-2.5 py-1 text-xs text-white hover:bg-black"
          onClick={async () => {
            const payload = buildRestockIntakePayload({
              inventoryRequestId: `INVRSQ${Date.now()}`,
              productId: String(data.product_id ?? ""),
              productSku: String(data.product_sku ?? ""),
              productName: String(data.product_name ?? data.product_id ?? "item"),
              quantity: 1,
              designerId: String(data.designer_uid ?? ""),
              fromName: "Admin",
              fromPhone: "+96550000000",
              fromAddress: "WH Street",
              fromCity: "Kuwait City",
              fromCountry: "KW",
            });
            const id = await saveDoc("inventorymovementlog", null, {
              status: "Requested",
              movement_log_id: payload.invtrackId,
              product_id: payload.itemsListJson[0].skuNumber,
              product_quantity: payload.itemsListJson[0].quantity,
              raised_by: RestockRequestOrigin.admin,
              request_info: { type: "Restock" },
            });
            onNote(`Restock ${id} created. Designer accept required: ${designerMustAccept({ requestType: "Restock", raisedBy: "admin", inventoryRequestId: payload.invtrackId })}`);
          }}
        >
          Raise admin restock
        </button>
      </div>
      {row && (
        <ol className="mt-3 space-y-1 text-xs">
          {stepsFor(String(data.status ?? "intake_created")).map((step) => (
            <li key={step.status}>{step.label}</li>
          ))}
        </ol>
      )}
    </Box>
  );
}

export function UserActions({
  row,
  collectionName = "users",
  onNote,
}: {
  row: Row | null;
  collectionName?: string;
  onNote: (t: string) => void;
}) {
  if (!row) return null;
  async function setStatus(status: string) {
    await updateDoc(doc(getFirebase().db, collectionName, row!.id), { status, updated_at: new Date() });
    onNote(`Status set to ${status}`);
  }
  return (
    <Box title="User status">
      <p className="text-xs">{String(row.data.user_role ?? "")} · {String(row.data.status ?? "")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {["Published", "Pending", "Rejected"].map((status) => (
          <button key={status} className="rounded-lg border border-[#e3e3e3] bg-white px-2.5 py-1 text-xs hover:bg-[#fafafa]" onClick={() => setStatus(status)}>{status}</button>
        ))}
      </div>
    </Box>
  );
}

export function ReturnActions({ row, onNote }: { row: Row | null; onNote: (t: string) => void }) {
  if (!row) return null;
  const data = row.data;
  return (
    <Box title="Return">
      <div className="flex flex-col gap-2">
        <button
          className="rounded-lg bg-[#1a1a1a] px-2.5 py-1 text-xs text-white hover:bg-black"
          onClick={async () => {
            const payload = buildShopperReturnPayload({
              externalRequestId: `RET-${String(data.return_request_id ?? row.id)}-ready-order`,
              sourceOrderId: String(data.order_id ?? ""),
              originalSourceLocationId: "WH-KWT-MAIN",
              designerId: "",
              fromName: "Customer",
              fromPhone: "+96550000000",
              fromAddress: "Gulf Road",
              fromCity: "Salmiya",
              fromCountry: "KW",
              deliveryInstructions: String(data.return_reason ?? ""),
              items: Array.isArray(data.return_product_list) ? data.return_product_list as Record<string, unknown>[] : [],
            });
            await updateDoc(doc(getFirebase().db, "return_requests", row.id), { status: "Approved", updated_at: new Date() });
            onNote(shopperReturnApproveMessage({ succeeded: true }));
            void payload;
          }}
        >
          Approve return
        </button>
        <button className="rounded-lg border border-[#e3e3e3] bg-white px-2.5 py-1 text-xs hover:bg-[#fafafa]" onClick={() => updateDoc(doc(getFirebase().db, "return_requests", row.id), { status: "Rejected", updated_at: new Date() }).then(() => onNote(shopperReturnApproveMessage({ succeeded: false, message: "Rejected" })))}>
          Reject
        </button>
      </div>
    </Box>
  );
}

export function NotifyBox({ onNote }: { onNote: (t: string) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [refs, setRefs] = useState("");
  return (
    <Box title="Push notification">
      <input className="mb-2 w-full rounded border px-2 py-1 text-sm" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="mb-2 h-20 w-full rounded border px-2 py-1 text-sm" placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} />
      <input className="mb-2 w-full rounded border px-2 py-1 text-xs" placeholder="user refs, comma separated" value={refs} onChange={(e) => setRefs(e.target.value)} />
      <button
        className="rounded-lg bg-[#1a1a1a] px-2.5 py-1 text-xs text-white hover:bg-black"
        onClick={() =>
          sendPushToUsers({ userRefs: refs.split(",").map((s) => s.trim()).filter(Boolean), title, body })
            .then(async () => {
              await saveDoc("notification", null, { message: body, message_type: "push", notification_type: "admin", mark_as_read: false });
              onNote("Notification sent");
            })
            .catch((err) => onNote(err.message))
        }
      >
        Send
      </button>
    </Box>
  );
}

export function MediaUpload({ onNote }: { onNote: (t: string) => void }) {
  return (
    <Box title="Upload">
      <input
        type="file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const path = `media/${Date.now()}-${file.name}`;
          const storageRef = ref(getFirebase().storage, path);
          await uploadBytes(storageRef, file);
          const url = await getDownloadURL(storageRef);
          const collectionName = file.type.startsWith("video") ? "videos" : "images";
          const id = await saveDoc(collectionName, null, {
            image_name: file.name,
            video_name: file.name,
            feature_image: url,
            status: "Published",
          });
          onNote(`Uploaded to ${collectionName}/${id}`);
        }}
      />
    </Box>
  );
}

export function RoleEditor({ row, onNote }: { row: Row | null; onNote: (t: string) => void }) {
  const { rows } = useCollection("permissions", 200);
  const [picked, setPicked] = useState<string[]>([]);
  if (!row) return <Box title="Permissions"><p className="text-xs text-[#a9a9a9]">Select a role.</p></Box>;
  const current = Array.isArray(row.data.permissions_list) ? (row.data.permissions_list as string[]) : picked;
  return (
    <Box title="Permissions">
      <div className="max-h-64 space-y-1 overflow-auto">
        {rows.map((perm) => {
          const key = String(perm.data.permission_key ?? perm.id);
          const on = (picked.length ? picked : current).includes(key);
          return (
            <label key={perm.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={on}
                onChange={() => {
                  const base = picked.length ? picked : current;
                  setPicked(on ? base.filter((item) => item !== key) : [...base, key]);
                }}
              />
              {key}
            </label>
          );
        })}
      </div>
      <button
        className="mt-2 rounded-lg bg-[#1a1a1a] px-2.5 py-1 text-xs text-white hover:bg-black"
        onClick={() =>
          updateDoc(doc(getFirebase().db, "roles", row.id), { permissions_list: picked.length ? picked : current }).then(() =>
            onNote("Permissions saved"),
          )
        }
      >
        Save permissions
      </button>
    </Box>
  );
}
