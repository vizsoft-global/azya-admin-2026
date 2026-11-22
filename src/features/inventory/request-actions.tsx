"use client";

import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BusyOverlay } from "@/components/shared/busy-overlay";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { isReadyRestock } from "@/lib/store-valley/restock";
import { cancelEnquiry, cancelRequest, patchRequest, receiveEnquiry } from "./data";
import { cancelRestoresStock } from "./enquiry";
import type { RequestView } from "./model";
import { AcceptDialog, EditRequestDialog, EnquiryDialog, PickupDialog } from "./request-dialogs";
import { approveBlockedReason, approvePatch, archivePatch, declinePatch, mustDesignerAccept, readyPatch, requestTitle, type RequestAction } from "./requests";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const pieces = (count: number) => `${count} ${count === 1 ? "piece" : "pieces"}`;

/**
 * Runs a request action: asks first where the step cannot be undone, writes,
 * and reports the result. `dialogs` must be rendered once by the page.
 */
export function useRequestActions(requests: RequestView[]) {
  const confirm = useConfirm();
  const [accepting, setAccepting] = useState<RequestView | null>(null);
  const [editing, setEditing] = useState<RequestView | null>(null);
  const [enquiring, setEnquiring] = useState<RequestView | null>(null);
  const [pickup, setPickup] = useState<{ selectedId: string | null } | null>(null);
  const [busy, setBusy] = useState("");

  const write = useCallback(async (label: string, done: string, failed: string, work: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await work();
      toast.success(done);
    } catch (error) {
      toast.error(`${failed}: ${message(error)}`);
    } finally {
      setBusy("");
    }
  }, []);

  const run = useCallback(
    async (action: RequestAction, view: RequestView) => {
      const title = requestTitle(view);
      const what = `${view.quantity} × ${view.productName || view.productId}`;
      switch (action) {
        case "accept":
          setAccepting(view);
          return;
        case "edit":
          setEditing(view);
          return;
        case "raiseEnquiry":
          setEnquiring(view);
          return;
        case "pickup":
          setPickup({ selectedId: view.id });
          return;
        case "approve": {
          const blocked = approveBlockedReason(view);
          if (blocked) {
            toast.error(blocked);
            return;
          }
          const ok = await confirm({
            title: `Approve ${title}?`,
            description: mustDesignerAccept(view)
              ? `${what}. The designer has not accepted this request yet; approving moves it to Accepted without their ready date.`
              : `${what}. The request moves to Accepted and the designer can mark it ready to pick up.`,
            confirmLabel: "Approve",
          });
          if (ok) await write("Approving…", "Request approved.", "The request was not approved", () => patchRequest(view.id, approvePatch()));
          return;
        }
        case "decline": {
          const ok = await confirm({ title: `Decline ${title}?`, description: `${what}. The request moves to Declined and stops there.`, confirmLabel: "Decline", destructive: true });
          if (ok) await write("Declining…", "Request declined.", "The request was not declined", () => patchRequest(view.id, declinePatch()));
          return;
        }
        case "archive": {
          const ok = await confirm({ title: `Delete ${title}?`, description: "The request is moved to Archived and can no longer be approved or accepted. The record is kept.", confirmLabel: "Delete", destructive: true });
          if (ok) await write("Deleting…", "Request moved to Archived.", "The request was not deleted", () => patchRequest(view.id, archivePatch()));
          return;
        }
        case "ready": {
          const ok = await confirm({ title: "Mark this restock as ready to pick up?", description: `${what}. Next you create the pickup request so the warehouse sends a driver.`, confirmLabel: "Mark ready" });
          if (ok) await write("Saving…", "Marked ready to pick up. Create the pickup request when you are ready for the driver.", "The restock was not marked ready", () => patchRequest(view.id, readyPatch()));
          return;
        }
        case "cancel": {
          const ok = await confirm({
            title: `Cancel ${title}?`,
            description: view.delivery.refId
              ? `${what}. A pickup is already booked, so the warehouse is asked to cancel it first. If it refuses, the request stays as it is. This cannot be undone.`
              : `${what}. The request moves to Archived. This cannot be undone.`,
            confirmLabel: "Cancel request",
            cancelLabel: "Keep it",
            destructive: true,
          });
          if (ok) await write("Cancelling…", "Request cancelled.", "The request was not cancelled", () => cancelRequest(view));
          return;
        }
        case "cancelEnquiry": {
          const held = pieces(view.enquiry.affectedQty);
          const ok = await confirm({
            title: `Cancel enquiry ${view.enquiry.id}?`,
            description: cancelRestoresStock(view)
              ? `The return shipment is cancelled with the warehouse and the ${held} held as unavailable go back into stock. This cannot be undone.`
              : `No return shipment was booked. The enquiry is closed, but the ${held} held as unavailable are not released automatically: the stock record stays as it is. This cannot be undone.`,
            confirmLabel: "Cancel enquiry",
            cancelLabel: "Keep it",
            destructive: true,
          });
          if (ok) await write("Cancelling…", "Enquiry cancelled.", "The enquiry was not cancelled", () => cancelEnquiry(view));
          return;
        }
        case "receiveEnquiry": {
          const ok = await confirm({
            title: "Did you receive the returned pieces?",
            description: `${pieces(view.enquiry.affectedQty)} for enquiry ${view.enquiry.id}. They stop counting as unavailable and the enquiry is closed.`,
            confirmLabel: "Yes, received",
          });
          if (ok) await write("Saving…", "Enquiry closed.", "The enquiry was not closed", () => receiveEnquiry(view));
          return;
        }
      }
    },
    [confirm, write],
  );

  const ready = requests.filter((view) => view.requestStatus === "Accepted" && isReadyRestock({ requestType: view.requestType, fulfillStatus: view.fulfillStatus }));

  const dialogs: ReactNode = (
    <>
      <AcceptDialog view={accepting} onClose={() => setAccepting(null)} />
      <EditRequestDialog view={editing} onClose={() => setEditing(null)} />
      <EnquiryDialog view={enquiring} onClose={() => setEnquiring(null)} />
      <PickupDialog open={pickup != null} ready={ready} selectedId={pickup?.selectedId ?? null} onClose={() => setPickup(null)} />
      <BusyOverlay open={busy !== ""} label={busy || "Saving…"} />
    </>
  );

  return { run, dialogs, readyCount: ready.length, openPickup: () => setPickup({ selectedId: null }) };
}
