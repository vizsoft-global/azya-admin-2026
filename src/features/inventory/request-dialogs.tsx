"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { Copy, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DateField, Field, NumberField, SelectField, TextareaField } from "@/components/shared/fields";
import { FormModal } from "@/components/shared/form-modal";
import { RefField, type RefLoader } from "@/components/shared/ref-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getFirebase } from "@/lib/firebase";
import { formatDate, toNumber } from "@/lib/format";
import { InventoryRequestType, isReturnToDesigner } from "@/lib/store-valley/request-type";
import { mergeSelectedReady } from "@/lib/store-valley/restock";
import { uploadFile } from "@/lib/upload";
import { useRoleScope } from "@/lib/use-role-scope";
import { createPickup, patchRequest, raiseEnquiry, raiseRequest, requestProductOf } from "./data";
import { ENQUIRY_ISSUES, enquiryProblem, MAX_ENQUIRY_IMAGES } from "./enquiry";
import { readProduct, type RequestView, type Row } from "./model";
import { pickupBatchProblem, pickupCreatedMessage } from "./pickup";
import { acceptPatch, archivePatch, editPatch, newRequestProblem, REQUEST_TYPE_OPTIONS, requestTitle } from "./requests";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const today = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

/** Products a request can be raised for: stock managed by Azyaa, and for a designer only their own. */
function productLoader(designerUid: string): RefLoader {
  return async () => {
    const { db } = getFirebase();
    const filter = designerUid ? where("product_authorizer.product_designer_id", "==", designerUid) : where("product.is_preferred_vendor", "==", true);
    const snap = await getDocs(query(collection(db, "products"), filter, limit(500)));
    return snap.docs
      .map((item) => readProduct({ id: item.id, data: item.data() }))
      .filter((product) => product.isPreferredVendor && product.productId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((product) => ({ value: product.id, label: product.name || product.productId, sublabel: product.productId, keywords: `${product.productId} ${product.nameAr}` }));
  };
}

/** Raise a restock or a return to designer. */
export function AddRequestDialog({ open, onOpenChange, presetType }: { open: boolean; onOpenChange: (open: boolean) => void; presetType?: string }) {
  const scope = useRoleScope();
  const loader = useMemo(() => productLoader(scope.isDesigner ? scope.uid : ""), [scope.isDesigner, scope.uid]);
  const [productDocId, setProductDocId] = useState<string | null>(null);
  const [product, setProduct] = useState<Row | null>(null);
  const [stock, setStock] = useState<{ inHand: number; availableForOrder: number } | null>(null);
  const [requestType, setRequestType] = useState<string>(presetType ?? InventoryRequestType.restock);
  const [quantity, setQuantity] = useState<number | null>(null);
  const [preferredDate, setPreferredDate] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProductDocId(null);
    setProduct(null);
    setStock(null);
    setRequestType(presetType ?? InventoryRequestType.restock);
    setQuantity(null);
    setPreferredDate(null);
    setNotes("");
    setProblem("");
  }, [open, presetType]);

  async function pick(id: string | null) {
    setProductDocId(id);
    setProduct(null);
    setStock(null);
    setProblem("");
    if (!id) return;
    try {
      const { db } = getFirebase();
      const snap = await getDoc(doc(db, "products", id));
      if (!snap.exists()) throw new Error("That product no longer exists.");
      const row = { id: snap.id, data: snap.data() };
      const stockRef = row.data.product?.inventory_ref;
      const stockSnap = stockRef ? await getDoc(stockRef) : null;
      const stockData = (stockSnap?.data() ?? {}) as Record<string, unknown>;
      setProduct(row);
      setStock({ inHand: Math.trunc(toNumber(stockData.stock_on_hand) ?? 0), availableForOrder: Math.trunc(toNumber(stockData.available_for_order) ?? 0) });
    } catch (error) {
      setProblem(`The product could not be loaded: ${message(error)}`);
    }
  }

  async function submit() {
    const found = newRequestProblem({
      productId: product ? String(product.data.product_id ?? "") : "",
      quantity,
      requestType,
      isDesigner: scope.isDesigner,
      preferredDate,
      availableForOrder: stock?.availableForOrder ?? 0,
    });
    if (found || !product || quantity == null) {
      setProblem(found ?? "Choose the product.");
      return;
    }
    const details = requestProductOf(product);
    if (!details.inventoryRef) {
      setProblem("This product has no stock record, so a request cannot be raised for it. Open the product and save it first.");
      return;
    }
    setSaving(true);
    try {
      await raiseRequest({ product: details, quantity, requestType, isDesigner: scope.isDesigner, preferredDate, notes: notes.trim() });
      toast.success(scope.isDesigner ? "Request raised. An administrator will review it." : "Request raised. It is waiting under Pending.");
      onOpenChange(false);
    } catch (error) {
      toast.error(`The request was not raised: ${message(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal open={open} onOpenChange={onOpenChange} title="Add request" description="Ask for stock to be sent to the warehouse, or for warehouse stock to go back to the designer." onSubmit={submit} submitting={saving} submitLabel="Submit request">
      <RefField
        label="Product"
        required
        collection="products"
        value={productDocId}
        onChange={(value) => void pick(value)}
        loadOptions={loader}
        placeholder="Select a product"
        searchPlaceholder="Search by name or product ID"
        hint="Only products whose stock is managed by Azyaa are listed."
      />
      {product && stock ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">
          Product ID <span className="font-mono text-foreground">{String(product.data.product_id ?? "")}</span> · in hand {stock.inHand} · warehouse available for order {stock.availableForOrder}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Request type" required value={requestType} onChange={setRequestType} options={REQUEST_TYPE_OPTIONS.map((value) => ({ value, label: value }))} />
        <NumberField label="Quantity" required integer min={1} value={quantity} onChange={setQuantity} />
      </div>
      {isReturnToDesigner(requestType) ? (
        <p className="text-[12px] text-muted-foreground">A return takes stock out of the warehouse. It waits under Pending for a super admin; approving it books the delivery back to the designer, which is still done in the old admin.</p>
      ) : null}
      {!scope.isDesigner ? <DateField label="Preferred arrival date" required min={today()} value={preferredDate} onChange={setPreferredDate} /> : null}
      <TextareaField label="Notes" rows={3} maxLength={300} value={notes} onChange={setNotes} />
      {problem ? <p role="alert" className="text-[12px] text-destructive">{problem}</p> : null}
    </FormModal>
  );
}

/** The designer accepts a request and says when the stock will be ready. */
export function AcceptDialog({ view, onClose }: { view: RequestView | null; onClose: () => void }) {
  const [date, setDate] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDate(null);
    setNotes("");
    setProblem("");
  }, [view?.id]);

  async function submit() {
    if (!view) return;
    if (!date) {
      setProblem("Choose the date the stock will be ready.");
      return;
    }
    setSaving(true);
    try {
      await patchRequest(view.id, acceptPatch({ date, notes: notes.trim() }));
      toast.success("Request accepted. Mark it ready to pick up when the stock is packed.");
      onClose();
    } catch (error) {
      toast.error(`The request was not accepted: ${message(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open={view != null}
      onOpenChange={(open) => !open && onClose()}
      title={view ? `Accept ${requestTitle(view)}` : "Accept request"}
      description={view ? `${view.quantity} × ${view.productName || view.productId}${view.adminPreferredDate ? ` · wanted by ${formatDate(view.adminPreferredDate)}` : ""}` : undefined}
      onSubmit={submit}
      submitting={saving}
      submitLabel="Accept"
      size="sm"
    >
      <DateField label="Ready date" required min={today()} value={date} onChange={setDate} error={problem || undefined} />
      <TextareaField label="Notes" rows={3} maxLength={300} value={notes} onChange={setNotes} />
    </FormModal>
  );
}

/** A super admin changes the quantity, date or notes of a pending request, or deletes it. */
export function EditRequestDialog({ view, onClose }: { view: RequestView | null; onClose: () => void }) {
  const confirm = useConfirm();
  const [quantity, setQuantity] = useState<number | null>(null);
  const [preferredDate, setPreferredDate] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setQuantity(view?.quantity ?? null);
    setPreferredDate(view?.adminPreferredDate ?? null);
    setNotes(view?.adminNotes ?? "");
    setProblem("");
  }, [view]);

  async function submit() {
    if (!view) return;
    if (quantity == null || !Number.isInteger(quantity) || quantity < 1) {
      setProblem("Enter a quantity of 1 or more.");
      return;
    }
    setSaving(true);
    try {
      await patchRequest(view.id, editPatch({ quantity, preferredDate, notes: notes.trim() }));
      toast.success("Request updated.");
      onClose();
    } catch (error) {
      toast.error(`The request was not updated: ${message(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!view) return;
    const ok = await confirm({
      title: `Delete ${requestTitle(view)}?`,
      description: "The request is moved to Archived and can no longer be approved or accepted. The record is kept.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await patchRequest(view.id, archivePatch());
      toast.success("Request moved to Archived.");
      onClose();
    } catch (error) {
      toast.error(`The request was not deleted: ${message(error)}`);
    }
  }

  return (
    <FormModal
      open={view != null}
      onOpenChange={(open) => !open && onClose()}
      title={view ? `Edit ${requestTitle(view)}` : "Edit request"}
      description={view ? `${view.requestType} · ${view.productName || view.productId}` : undefined}
      onSubmit={submit}
      submitting={saving}
      submitLabel="Update request"
      footerStart={
        <Button type="button" variant="destructive" onClick={() => void remove()} disabled={saving}>
          <Trash2 /> Delete
        </Button>
      }
    >
      <NumberField label="Quantity" required integer min={1} value={quantity} onChange={setQuantity} error={problem || undefined} />
      <DateField label="Preferred arrival date" value={preferredDate} onChange={setPreferredDate} />
      <TextareaField label="Notes" rows={3} maxLength={300} value={notes} onChange={setNotes} />
    </FormModal>
  );
}

/**
 * One warehouse pickup for the restocks the designer ticks. After the
 * warehouse accepts it, the OTP for the driver is shown once, with a copy button.
 */
export function PickupDialog({ ready, selectedId, open, onClose }: { ready: RequestView[]; selectedId: string | null; open: boolean; onClose: () => void }) {
  const scope = useRoleScope();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [result, setResult] = useState<{ otp: string; trackingId: string } | null>(null);

  const ordered = useMemo(() => {
    const ids = mergeSelectedReady({ readyIds: ready.map((view) => view.id), selectedId: selectedId ?? "", selectedIsReady: ready.some((view) => view.id === selectedId) });
    const byId = new Map(ready.map((view) => [view.id, view]));
    return ids.map((id) => byId.get(id)).filter((view): view is RequestView => Boolean(view));
    // The list is fixed while the dialog is open, so a live update cannot untick a row mid-way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedId]);

  useEffect(() => {
    if (!open) return;
    setPicked(new Set(selectedId ? [selectedId] : ordered.map((view) => view.id)));
    setProblem("");
    setResult(null);
  }, [open, selectedId, ordered]);

  async function submit() {
    const chosen = ordered.filter((view) => picked.has(view.id));
    const found = pickupBatchProblem(chosen);
    if (found) {
      setProblem(found);
      return;
    }
    setSaving(true);
    setProblem("");
    try {
      const answer = await createPickup(chosen, scope);
      setResult({ otp: answer.pickupOtp.trim(), trackingId: answer.trackingId });
      toast.success("Pickup request created.");
    } catch (error) {
      setProblem(message(error));
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pickup request created</DialogTitle>
            <DialogDescription>{pickupCreatedMessage(result.otp)}</DialogDescription>
          </DialogHeader>
          {result.otp ? (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3">
              <span dir="ltr" lang="en" className="font-mono text-2xl font-semibold tracking-[0.2em] text-heading">{result.otp}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(result.otp).then(() => toast.success("OTP copied."))}>
                <Copy /> Copy
              </Button>
            </div>
          ) : null}
          <p className="text-[12px] text-muted-foreground">
            The code was also sent to you by notification and email, and stays on the request until the driver confirms it.
            {result.trackingId ? ` Tracking ID ${result.trackingId}.` : ""}
          </p>
          <DialogFooter>
            <Button type="button" onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <FormModal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Create pickup request"
      description="One request is sent to the warehouse for everything you tick. The driver collects from the pickup address on your profile and asks you for a one-time code."
      onSubmit={submit}
      submitting={saving}
      submitDisabled={picked.size === 0}
      submitLabel={picked.size > 1 ? `Request pickup for ${picked.size} products` : "Request pickup"}
    >
      {ordered.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No restock is marked ready to pick up yet. Mark an accepted restock as ready first.</p>
      ) : (
        <ul className="grid gap-2">
          {ordered.map((view) => (
            <li key={view.id}>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <Checkbox
                  className="mt-0.5"
                  checked={picked.has(view.id)}
                  onCheckedChange={(checked) =>
                    setPicked((current) => {
                      const next = new Set(current);
                      if (checked === true) next.add(view.id);
                      else next.delete(view.id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-foreground">{view.productName || view.productId}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {requestTitle(view)} · {view.quantity} {view.quantity === 1 ? "piece" : "pieces"}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {problem ? <p role="alert" className="text-[12px] text-destructive">{problem}</p> : null}
    </FormModal>
  );
}

/** Raise an enquiry on a completed restock: short or damaged pieces. */
export function EnquiryDialog({ view, onClose }: { view: RequestView | null; onClose: () => void }) {
  const [issueType, setIssueType] = useState("");
  const [affected, setAffected] = useState<number | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setIssueType("");
    setAffected(null);
    setImages([]);
    setProblem("");
  }, [view?.id]);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_ENQUIRY_IMAGES - images.length;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) toast.error(`Only ${MAX_ENQUIRY_IMAGES} photos can be attached; the extra ones were left out.`);
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of chosen) urls.push(await uploadFile(file, "enquiries"));
      setImages((current) => [...current, ...urls]);
    } catch (error) {
      toast.error(`A photo was not uploaded: ${message(error)}`);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!view) return;
    const found = enquiryProblem({ issueType, affectedQty: affected, requestedQty: view.quantity });
    if (found || affected == null) {
      setProblem(found ?? "Enter the affected quantity.");
      return;
    }
    setSaving(true);
    try {
      await raiseEnquiry(view, { issueType, affectedQty: affected, images });
      toast.success(`Enquiry raised. ${affected} ${affected === 1 ? "piece is" : "pieces are"} now held as unavailable.`);
      onClose();
    } catch (error) {
      toast.error(`The enquiry was not raised: ${message(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open={view != null}
      onOpenChange={(open) => !open && onClose()}
      title="Raise enquiry"
      description={view ? `${requestTitle(view)} · ${view.productName || view.productId} · ${view.quantity} requested. The affected pieces are taken out of stock and held as unavailable until the enquiry is closed.` : undefined}
      onSubmit={submit}
      submitting={saving}
      submitDisabled={uploading}
      submitLabel="Submit enquiry"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Issue type" required value={issueType} onChange={setIssueType} options={ENQUIRY_ISSUES.map((value) => ({ value, label: value }))} />
        <NumberField label="Affected quantity" required integer min={1} max={view?.quantity || undefined} value={affected} onChange={setAffected} />
      </div>
      <Field label="Photos" hint={`Up to ${MAX_ENQUIRY_IMAGES} photos (JPG or PNG).`}>
        <div className="flex flex-wrap gap-2">
          {images.map((url) => (
            <span key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Enquiry photo" className="size-16 rounded-lg object-cover" />
              <button
                type="button"
                aria-label="Remove photo"
                className="absolute -end-1.5 -top-1.5 rounded-full bg-card p-0.5 text-muted-foreground shadow hover:text-destructive"
                onClick={() => setImages((current) => current.filter((item) => item !== url))}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          {images.length < MAX_ENQUIRY_IMAGES ? (
            <label className="flex size-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border text-[12px] text-muted-foreground hover:bg-muted">
              {uploading ? "…" : "Add"}
              <input type="file" accept="image/png,image/jpeg" multiple className="sr-only" disabled={uploading} onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} />
            </label>
          ) : null}
        </div>
      </Field>
      {problem ? <p role="alert" className="text-[12px] text-destructive">{problem}</p> : null}
    </FormModal>
  );
}
