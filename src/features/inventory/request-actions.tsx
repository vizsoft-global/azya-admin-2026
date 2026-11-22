"use client";

import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BusyOverlay } from "@/components/shared/busy-overlay";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { isReadyRestock } from "@/lib/store-valley/restock";
import { isReturnToDesigner } from "@/lib/store-valley/request-type";
import { useRoleScope } from "@/lib/use-role-scope";
import { bookDesignerDelivery, cancelEnquiry, cancelRequest, patchRequest, receiveEnquiry } from "./data";
import { cancelRestoresStock } from "./enquiry";
import type { RequestView } from "./model";
import { AcceptDialog, EditRequestDialog, EnquiryDialog, PickupDialog, ReceiveDialog } from "./request-dialogs";
import { approvePatch, archivePatch, declinePatch, heldQuantity, mustDesignerAccept, readyPatch, requestTitle, returnHoldsStock, type RequestAction } from "./requests";
import { tx } from "@/lib/i18n/tx";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** "1 piece" / "12 pieces", as one counted phrase to place inside a sentence. */
export const piecesText = (count: number) => (count === 1 ? tx("1 piece") : tx("{count} pieces", { count }));

/**
 * Runs a request action: asks first where the step cannot be undone, writes,
 * and reports the result. `dialogs` must be rendered once by the page.
 */
export function useRequestActions(requests: RequestView[]) {
  const confirm = useConfirm();
  const scope = useRoleScope();
  const [accepting, setAccepting] = useState<RequestView | null>(null);
  const [receiving, setReceiving] = useState<RequestView | null>(null);
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
        case "receive":
          setReceiving(view);
          return;
        case "bookReturn": {
          const ok = await confirm({
            title: tx("Book the return shipment for {id}?", { id: view.enquiry.id }),
            description: tx(
              "The warehouse is asked to deliver {pieces} of {product} to the designer's address on their profile, with a one-time code. The pieces stay held as unavailable until the designer confirms they arrived.",
              { pieces: piecesText(view.enquiry.affectedQty), product: view.productName || view.productId },
            ),
            confirmLabel: tx("Book shipment"),
          });
          if (ok)
            await write(tx("Booking the shipment…"), tx("Return shipment booked. The designer marks the enquiry received when the pieces arrive."), tx("The return shipment was not booked"), () =>
              bookDesignerDelivery(view, "enquiry", scope),
            );
          return;
        }
        case "approve": {
          if (isReturnToDesigner(view.requestType)) {
            const held = piecesText(heldQuantity(view));
            const ok = await confirm({
              title: tx("Approve {id}?", { id: title }),
              description: tx(
                "{what}. Approving books a warehouse delivery to the designer's address on their profile, with a one-time code. {pieces} are held as unavailable until the warehouse reports them delivered.",
                { what, pieces: held },
              ),
              confirmLabel: tx("Approve and book delivery"),
            });
            if (ok)
              await write(tx("Booking the delivery…"), tx("Return approved and delivery booked. {pieces} are now held as unavailable.", { pieces: held }), tx("The return was not approved"), () =>
                bookDesignerDelivery(view, "return", scope),
              );
            return;
          }
          const ok = await confirm({
            title: tx("Approve {id}?", { id: title }),
            description: mustDesignerAccept(view)
              ? tx("{what}. The designer has not accepted this request yet; approving moves it to Accepted without their ready date.", { what })
              : tx("{what}. The request moves to Accepted and the designer can mark it ready to pick up.", { what }),
            confirmLabel: tx("Approve"),
          });
          if (ok) await write(tx("Approving…"), tx("Request approved."), tx("The request was not approved"), () => patchRequest(view.id, approvePatch()));
          return;
        }
        case "decline": {
          const ok = await confirm({
            title: tx("Decline {id}?", { id: title }),
            description: tx("{what}. The request moves to Declined and stops there.", { what }),
            confirmLabel: tx("Decline"),
            destructive: true,
          });
          if (ok) await write(tx("Declining…"), tx("Request declined."), tx("The request was not declined"), () => patchRequest(view.id, declinePatch()));
          return;
        }
        case "archive": {
          const ok = await confirm({
            title: tx("Delete {id}?", { id: title }),
            description: tx("The request is moved to Archived and can no longer be approved or accepted. The record is kept."),
            confirmLabel: tx("Delete"),
            destructive: true,
          });
          if (ok) await write(tx("Deleting…"), tx("Request moved to Archived."), tx("The request was not deleted"), () => patchRequest(view.id, archivePatch()));
          return;
        }
        case "ready": {
          const ok = await confirm({
            title: tx("Mark this restock as ready to pick up?"),
            description: tx("{what}. Next you create the pickup request so the warehouse sends a driver.", { what }),
            confirmLabel: tx("Mark ready"),
          });
          if (ok)
            await write(tx("Saving…"), tx("Marked ready to pick up. Create the pickup request when you are ready for the driver."), tx("The restock was not marked ready"), () =>
              patchRequest(view.id, readyPatch()),
            );
          return;
        }
        case "cancel": {
          const held = piecesText(heldQuantity(view));
          const ok = await confirm({
            title: tx("Cancel {id}?", { id: title }),
            description: returnHoldsStock(view)
              ? tx(
                  "{what}. A delivery back to the designer is already booked, so the warehouse is asked to cancel it first. If it refuses, the request stays as it is. Once cancelled, {pieces} held for this return become available to order again. This cannot be undone.",
                  { what, pieces: held },
                )
              : view.delivery.refId
                ? tx("{what}. A pickup is already booked, so the warehouse is asked to cancel it first. If it refuses, the request stays as it is. Stock numbers are not changed. This cannot be undone.", { what })
                : tx("{what}. The request moves to Archived. Stock numbers are not changed. This cannot be undone.", { what }),
            confirmLabel: tx("Cancel request"),
            cancelLabel: tx("Do not cancel"),
            destructive: true,
          });
          if (ok)
            await write(
              tx("Cancelling…"),
              returnHoldsStock(view) ? tx("Request cancelled. {pieces} are available to order again.", { pieces: held }) : tx("Request cancelled."),
              tx("The request was not cancelled"),
              () => cancelRequest(view),
            );
          return;
        }
        case "cancelEnquiry": {
          const held = piecesText(view.enquiry.affectedQty);
          const ok = await confirm({
            title: tx("Cancel enquiry {id}?", { id: view.enquiry.id }),
            description: cancelRestoresStock(view)
              ? tx("The return shipment is cancelled with the warehouse and {pieces} held as unavailable go back into stock. This cannot be undone.", { pieces: held })
              : tx(
                  "No return shipment was booked. The enquiry is closed, but {pieces} held as unavailable are not released automatically: the stock record stays as it is. This cannot be undone.",
                  { pieces: held },
                ),
            confirmLabel: tx("Cancel enquiry"),
            cancelLabel: tx("Do not cancel"),
            destructive: true,
          });
          if (ok) await write(tx("Cancelling…"), tx("Enquiry cancelled."), tx("The enquiry was not cancelled"), () => cancelEnquiry(view));
          return;
        }
        case "receiveEnquiry": {
          const ok = await confirm({
            title: tx("Did you receive the returned pieces?"),
            description: tx("{pieces} for enquiry {id}. They stop counting as unavailable and the enquiry is closed.", { pieces: piecesText(view.enquiry.affectedQty), id: view.enquiry.id }),
            confirmLabel: tx("Yes, received"),
          });
          if (ok) await write(tx("Saving…"), tx("Enquiry closed."), tx("The enquiry was not closed"), () => receiveEnquiry(view));
          return;
        }
      }
    },
    [confirm, write, scope],
  );

  const ready = requests.filter((view) => view.requestStatus === "Accepted" && isReadyRestock({ requestType: view.requestType, fulfillStatus: view.fulfillStatus }));

  const dialogs: ReactNode = (
    <>
      <AcceptDialog view={accepting} onClose={() => setAccepting(null)} />
      <EditRequestDialog view={editing} onClose={() => setEditing(null)} />
      <EnquiryDialog view={enquiring} onClose={() => setEnquiring(null)} />
      <ReceiveDialog view={receiving} onClose={() => setReceiving(null)} />
      <PickupDialog open={pickup != null} ready={ready} selectedId={pickup?.selectedId ?? null} onClose={() => setPickup(null)} />
      <BusyOverlay open={busy !== ""} label={busy || tx("Saving…")} />
    </>
  );

  return { run, dialogs, readyCount: ready.length, openPickup: () => setPickup({ selectedId: null }) };
}
