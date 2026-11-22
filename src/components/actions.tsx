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
import { useConfirm, type ConfirmOptions } from "./shared/confirm-dialog";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

/**
 * Runs a write only after the user confirms it. The action returns the note to
 * show on success; a failure is reported the same way instead of being lost.
 */
function useGuarded(onNote: (text: string) => void) {
  const confirm = useConfirm();
  return async (question: ConfirmOptions, action: () => Promise<string>) => {
    if (!(await confirm(question))) return;
    try {
      onNote(await action());
    } catch (err) {
      onNote(err instanceof Error ? err.message : String(err));
    }
  };
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[14px] bg-card p-4">
      <p className="mb-2 text-sm font-semibold text-heading">{title}</p>
      {children}
    </div>
  );
}

export function OrderActions({ row, onNote }: { row: Row | null; onNote: (t: string) => void }) {
  const [reason, setReason] = useState("shipped");
  const guarded = useGuarded(onNote);
  if (!row) return <Box title="Order actions"><p className="text-xs text-subtle">Select an order.</p></Box>;
  const data = row.data;
  const badge = warehouseDeliveryBadgeLabel(String(data.custom_shipping_request_status ?? data.ready_shipping_request_status ?? ""));
  const otp = customerShipmentOtpLabel({
    pickupOtp: String(data.pickup_otp ?? ""),
    otpVerificationStatus: String(data.otp_verification_status ?? ""),
    deliveryStatus: String(data.order_status ?? ""),
  });
  const orderName = String(data.order_id ?? row.id);
  const run = (question: ConfirmOptions, fn: () => Promise<unknown>, ok: string) =>
    guarded(question, async () => `${ok} ${JSON.stringify(await fn()).slice(0, 180)}`);
  return (
    <Box title="Order actions">
      <p className="text-xs text-muted-foreground">Reservation: {String(data.inventory_reservation_status ?? "none")}</p>
      {badge && <p className="text-xs">{badge}</p>}
      {otp && <p className="text-xs">{otp}</p>}
      <div className="mt-2 flex flex-col gap-2">
        <Button variant="outline" size="sm" onClick={() => run({ title: "Reserve warehouse stock?", description: `This asks the warehouse to reserve stock for order ${orderName}.`, confirmLabel: "Reserve stock" }, () => reserveWarehouseStock(row.id), "Reserved")}>Reserve warehouse stock</Button>
        <label className="text-xs">Release reason
          <Input className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <Button size="sm" onClick={() => run({ title: "Release the reserved stock?", description: `This releases the stock reserved for order ${orderName}, with the reason “${reason}”.`, confirmLabel: "Release stock" }, () => releaseWarehouseStock({ orderId: row.id, reason }), "Released")}>
          Release stock ({reason})
        </Button>
        <Button variant="outline" size="sm" onClick={() => run({ title: "Create a shipping label?", description: `This sends a delivery request for order ${orderName} to the warehouse. It cannot be undone from here.`, confirmLabel: "Create label" }, () => storeValleyProxy({ method: "POST", path: "/orders", body: { external_request_id: String(data.order_id ?? row.id) } }), "Delivery queued")}>
          Create shipping label
        </Button>
        <Button variant="outline" size="sm" onClick={() => guarded({ title: "Mark this order as shipped?", description: `The status of order ${orderName} is set to shipped.`, confirmLabel: "Mark shipped" }, async () => {
          await updateDoc(doc(getFirebase().db, "orders", row.id), { order_status: "shipped", updated_at: new Date() });
          return "Marked shipped";
        })}>
          Mark shipped
        </Button>
      </div>
    </Box>
  );
}

export function InventoryActions({ row, onNote }: { row: Row | null; onNote: (t: string) => void }) {
  const guarded = useGuarded(onNote);
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
        <Button variant="outline" size="sm" onClick={() => guarded({ title: "Sync the warehouse inventory?", description: "This runs the warehouse inventory sync for the whole catalogue.", confirmLabel: "Sync inventory" }, async () => JSON.stringify(await syncStoreValleyInventory()).slice(0, 180))}>Sync warehouse inventory</Button>
        <Button variant="outline" size="sm" onClick={() => guarded({ title: "Backfill reservations?", description: "This runs the reservation backfill across all orders.", confirmLabel: "Backfill" }, async () => JSON.stringify(await backfillWarehouseReservations()).slice(0, 160))}>Backfill reservations</Button>
        <Button variant="outline" size="sm" onClick={() => guarded({ title: "Backfill deliveries?", description: "This runs the delivery backfill across all orders.", confirmLabel: "Backfill" }, async () => JSON.stringify(await backfillStoreValleyDeliveries()).slice(0, 160))}>Backfill deliveries</Button>
        {canResend && (
          <Button variant="outline" size="sm" onClick={() => guarded({ title: "Resend the pickup OTP?", description: "This asks the warehouse to send the pickup code for this request again.", confirmLabel: "Resend OTP" }, async () => {
            await resendPickupOtp({ request_id: row?.id });
            return "OTP resent";
          })}>
            Resend pickup OTP
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => guarded({ title: "Raise an admin restock?", description: `A restock request for one unit of ${String(data.product_name ?? data.product_id ?? "this item")} is created.`, confirmLabel: "Raise restock" }, async () => {
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
            return `Restock ${id} created. Designer accept required: ${designerMustAccept({ requestType: "Restock", raisedBy: "admin", inventoryRequestId: payload.invtrackId })}`;
          })}
        >
          Raise admin restock
        </Button>
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
  const guarded = useGuarded(onNote);
  if (!row) return null;
  const who = String(row.data.display_name ?? row.data.email ?? row.id);
  const setStatus = (status: string) =>
    guarded({ title: `Set the status to ${status}?`, description: `${who} is ${String(row.data.status ?? "without a status")} now. The change applies straight away.`, confirmLabel: `Set to ${status}` }, async () => {
      await updateDoc(doc(getFirebase().db, collectionName, row.id), { status, updated_at: new Date() });
      return `Status set to ${status}`;
    });
  return (
    <Box title="User status">
      <p className="text-xs">{String(row.data.user_role ?? "")} · {String(row.data.status ?? "")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {["Published", "Pending", "Rejected"].map((status) => (
          <Button key={status} variant="outline" size="sm" onClick={() => setStatus(status)}>{status}</Button>
        ))}
      </div>
    </Box>
  );
}

export function ReturnActions({ row, onNote }: { row: Row | null; onNote: (t: string) => void }) {
  const guarded = useGuarded(onNote);
  if (!row) return null;
  const data = row.data;
  const returnName = String(data.return_request_id ?? row.id);
  return (
    <Box title="Return">
      <div className="flex flex-col gap-2">
        <Button
          size="sm"
          onClick={() => guarded({ title: "Approve this return?", description: `Return ${returnName} is marked Approved.`, confirmLabel: "Approve return" }, async () => {
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
            void payload;
            return shopperReturnApproveMessage({ succeeded: true });
          })}
        >
          Approve return
        </Button>
        <Button variant="outline" size="sm" onClick={() => guarded({ title: "Reject this return?", description: `Return ${returnName} is marked Rejected.`, confirmLabel: "Reject return", destructive: true }, async () => {
          await updateDoc(doc(getFirebase().db, "return_requests", row.id), { status: "Rejected", updated_at: new Date() });
          return shopperReturnApproveMessage({ succeeded: false, message: "Rejected" });
        })}>
          Reject
        </Button>
      </div>
    </Box>
  );
}

export function NotifyBox({ onNote }: { onNote: (t: string) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [refs, setRefs] = useState("");
  const guarded = useGuarded(onNote);
  const recipients = refs.split(",").map((s) => s.trim()).filter(Boolean);
  return (
    <Box title="Push notification">
      <Input className="mb-2" placeholder="Title" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea className="mb-2 h-20" placeholder="Message" aria-label="Message" value={body} onChange={(e) => setBody(e.target.value)} />
      <Input className="mb-2" placeholder="user refs, comma separated" aria-label="User refs, comma separated" value={refs} onChange={(e) => setRefs(e.target.value)} />
      <Button
        size="sm"
        onClick={() =>
          guarded({ title: "Send this push notification?", description: `It goes to ${recipients.length} ${recipients.length === 1 ? "person" : "people"} straight away and cannot be recalled.`, confirmLabel: "Send" }, async () => {
            await sendPushToUsers({ userRefs: recipients, title, body });
            await saveDoc("notification", null, { message: body, message_type: "push", notification_type: "admin", mark_as_read: false });
            return "Notification sent";
          })
        }
      >
        Send
      </Button>
    </Box>
  );
}

export function MediaUpload({ onNote }: { onNote: (t: string) => void }) {
  return (
    <Box title="Upload">
      <Input
        type="file"
        aria-label="File to upload"
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
  const guarded = useGuarded(onNote);
  if (!row) return <Box title="Permissions"><p className="text-xs text-subtle">Select a role.</p></Box>;
  const current = Array.isArray(row.data.permissions_list) ? (row.data.permissions_list as string[]) : picked;
  return (
    <Box title="Permissions">
      <div className="max-h-64 space-y-1 overflow-auto">
        {rows.map((perm) => {
          const key = String(perm.data.permission_key ?? perm.id);
          const on = (picked.length ? picked : current).includes(key);
          return (
            <label key={perm.id} className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={on}
                onCheckedChange={() => {
                  const base = picked.length ? picked : current;
                  setPicked(on ? base.filter((item) => item !== key) : [...base, key]);
                }}
              />
              {key}
            </label>
          );
        })}
      </div>
      <Button
        size="sm"
        className="mt-2"
        onClick={() =>
          guarded({ title: "Save these permissions?", description: `The role ${String(row.data.role_unique_key ?? row.id)} is saved with exactly the ${(picked.length ? picked : current).length} permissions ticked here. Staff with this role get them the next time they open the panel.`, confirmLabel: "Save permissions" }, async () => {
            await updateDoc(doc(getFirebase().db, "roles", row.id), { permissions_list: picked.length ? picked : current });
            return "Permissions saved";
          })
        }
      >
        Save permissions
      </Button>
    </Box>
  );
}
