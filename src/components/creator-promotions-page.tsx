"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Timestamp, collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { cellText, useCollection } from "@/lib/firestore-ui";
import {
  CREATOR_FILTERS,
  MAIL_COLLECTION,
  PROMOTION_TABS,
  PROMOTION_TYPES,
  PROMOTION_TYPE_CONTEXT,
  REVIEW_PERMISSION,
  USERS_COLLECTION,
  approvalDatesProblem,
  approvalMail,
  approvalRecipient,
  approveChanges,
  canReview,
  creatorUid,
  dayInput,
  dayText,
  flattenPromotions,
  matchesSearch,
  matchesType,
  parseDay,
  planReview,
  promotionCounts,
  promotionLabel,
  promotionLinkProblem,
  promotionWindow,
  promotionsUpdate,
  readPromotion,
  readPromotionDuration,
  rejectChanges,
  replacePromotion,
  safeUrl,
  statusLabel,
  suggestedEndDay,
  tabFor,
  typeLabel,
  type PromotionEntry,
  type PromotionProduct,
  type PromotionTab,
  type PromotionTypeFilter,
} from "@/lib/creator-promotions";
import type { UploadedFile } from "@/lib/designer-enrollment";
import { rich } from "@/lib/i18n/rich";
import { tx, txIn } from "@/lib/i18n/tx";
import { promoLink } from "@/lib/share-links";
import { useAuth } from "./auth-provider";
import { StatusBadge } from "./shared/status-badge";
import { buttonVariants } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Detail, FileTile, ImageViewer } from "./designer-enrollment-page";

const chipOn = buttonVariants({ size: "sm" });
const chipOff = buttonVariants({ variant: "outline", size: "sm" });
const dark = buttonVariants({ size: "sm" });
const light = buttonVariants({ variant: "outline", size: "sm" });
const th = "px-3 py-2 text-start text-xs font-medium whitespace-nowrap text-muted-foreground";
const td = "px-3 py-2 text-[13px] text-foreground";

/** Where an active promotion stands against its dates, in a word. */
function windowNote(entry: PromotionEntry, now: Date): string {
  if (entry.status !== "active") return "";
  const where = promotionWindow(entry.startDate, entry.endDate, now);
  if (where === "upcoming") return tx("not started yet");
  if (where === "ended") return tx("ended");
  return "";
}

/** Creator promotions: see what creators are promoting, then approve or reject the ones waiting. */
export function CreatorPromotionsPage() {
  const { allowed } = useAuth();
  const { rows, loading, error, hasMore, loadMore } = useCollection(USERS_COLLECTION, 500, CREATOR_FILTERS);
  const [tab, setTab] = useState<PromotionTab>("pending");
  const [type, setType] = useState<PromotionTypeFilter>("all");
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [now] = useState(() => new Date());

  const entries = useMemo(() => flattenPromotions(rows), [rows]);
  const ofType = useMemo(() => entries.filter((entry) => matchesType(entry, type)), [entries, type]);
  const counts = useMemo(() => promotionCounts(ofType), [ofType]);
  const shown = useMemo(() => ofType.filter((entry) => tabFor(entry.status) === tab && matchesSearch(entry, q)), [ofType, tab, q]);
  const open = entries.find((entry) => entry.key === openKey) ?? null;
  const tabLabel = tx(PROMOTION_TABS.find((item) => item.tab === tab)?.label ?? "");

  if (open) {
    return (
      <PromotionReview
        key={open.key}
        entry={open}
        canEdit={allowed(REVIEW_PERMISSION)}
        now={now}
        onBack={() => setOpenKey(null)}
        onDone={(text) => {
          setOpenKey(null);
          setNote(text);
        }}
      />
    );
  }

  return (
    <section className="rounded-[14px] bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {PROMOTION_TABS.filter((item) => item.tab !== "other" || counts.other > 0 || tab === "other").map((item) => (
          <button key={item.tab} className={tab === item.tab ? chipOn : chipOff} aria-pressed={tab === item.tab} onClick={() => setTab(item.tab)}>
            {tx(item.label)} {counts[item.tab]}
          </button>
        ))}
        <Select value={type} onValueChange={(value) => setType(value as PromotionTypeFilter)}>
          <SelectTrigger aria-label={tx("Promotion type")} className="ms-auto w-auto min-w-[132px] bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {PROMOTION_TYPES.map((item) => <SelectItem key={item.type} value={item.type}>{txIn(PROMOTION_TYPE_CONTEXT, item.label)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={tx("Search promotion, code, creator or product")}
          aria-label={tx("Search creator promotions")}
          className="sm:w-64"
        />
      </div>

      {note && <p className="mt-3 break-words text-xs text-muted-foreground" role="status">{note}</p>}
      {error && <p className="mt-3 text-xs text-destructive">{tx("Creator promotions could not be loaded: {error}", { error })}</p>}
      {loading && <p className="mt-3 text-xs text-subtle">{tx("Loading…")}</p>}

      {!loading && !error && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className={th}>{tx("Promotion ID")}</th>
                <th className={th}>{tx("Creator")}</th>
                <th className={th}>{tx("Caption")}</th>
                <th className={th}>{tx("Type")}</th>
                <th className={th}>{tx("Created")}</th>
                <th className={th}>{tx("Runs")}</th>
                <th className={th}>{tx("Status")}</th>
                <th className={th}>{tx("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => {
                const dates = [dayText(entry.startDate), dayText(entry.endDate)];
                const extra = windowNote(entry, now);
                return (
                  <tr key={entry.key} className="border-b border-border">
                    <td className={td}>{entry.promotionId}</td>
                    <td className={td}>
                      {entry.creator.name || entry.creator.email}
                      {entry.creator.creatorId && <span className="block text-xs text-muted-foreground">{entry.creator.creatorId}</span>}
                    </td>
                    <td className={`${td} max-w-[260px] truncate`} title={entry.caption}>{entry.caption}</td>
                    <td className={td}>{typeLabel(entry.type)}</td>
                    <td className={td}>{cellText(entry.createdAt)}</td>
                    <td className={td}>{dates.some(Boolean) ? tx("{start} to {end}", { start: dates[0] || "?", end: dates[1] || "?" }) : ""}</td>
                    <td className={td}>
                      <StatusBadge value={statusLabel(entry.status)} />
                      {extra && <span className="mt-0.5 block text-xs text-muted-foreground">{extra}</span>}
                    </td>
                    <td className={td}>
                      <button className={canReview(entry.status) ? dark : light} onClick={() => { setNote(""); setOpenKey(entry.key); }}>
                        {canReview(entry.status) ? tx("Review") : tx("View")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && (
            <p className="py-6 text-center text-xs text-subtle">
              {q.trim() ? tx("No promotion in this tab matches your search.") : tx("No promotions are in {tab} right now.", { tab: tabLabel })}
            </p>
          )}
        </div>
      )}

      {hasMore && (
        <div className="mt-3 flex items-center gap-2">
          <button className={light} onClick={loadMore}>{tx("Load more creators")}</button>
          <span className="text-xs text-subtle">{tx("Counts cover the creators loaded so far.")}</span>
        </div>
      )}
    </section>
  );
}

function PromotionReview({
  entry,
  canEdit,
  now,
  onBack,
  onDone,
}: {
  entry: PromotionEntry;
  canEdit: boolean;
  now: Date;
  onBack: () => void;
  onDone: (text: string) => void;
}) {
  const { user, profile } = useAuth();
  const [step, setStep] = useState<"idle" | "approve" | "reject">("idle");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [viewing, setViewing] = useState<UploadedFile | null>(null);

  const label = promotionLabel(entry);
  const creatorName = entry.creator.name || entry.creator.email || tx("this creator");
  const reviewable = canReview(entry.status);
  const linkProblem = promotionLinkProblem(entry.creator.uid, entry.promotionId);
  const nextLink = promoLink(entry.creator.uid, entry.promotionId);
  const storedLink = safeUrl(entry.url);
  const extra = windowNote(entry, now);
  const pictures: UploadedFile[] = entry.images.map((url, index) => ({ name: tx("Picture {number}", { number: index + 1 }), url, isImage: true }));

  /** The admin's own `users` record, which the Flutter admin stores as who reviewed the promotion. */
  function reviewerRef() {
    const id = profile?.id ?? user?.uid;
    if (!id) throw new Error(tx("you are not signed in"));
    return doc(getFirebase().db, USERS_COLLECTION, id);
  }

  async function approve(start: string, end: string) {
    const startDate = parseDay(start);
    const endDate = parseDay(end);
    if (!startDate || !endDate || approvalDatesProblem(start, end)) return;
    setBusy(true);
    setProblem("");
    try {
      const { db } = getFirebase();
      const approvedBy = reviewerRef();
      const userRef = doc(db, USERS_COLLECTION, entry.creator.docId);
      const mailRef = doc(collection(db, MAIL_COLLECTION));

      // Read and write in one transaction, so a promotion the creator adds meanwhile is never lost from the list.
      const result = await runTransaction(db, async (txn) => {
        const snap = await txn.get(userRef);
        const data = snap.data();
        if (!data) throw new Error(tx("the creator's record no longer exists"));
        const plan = planReview(data, entry.promotionId);
        if ("problem" in plan) throw new Error(plan.problem);
        const uid = creatorUid(snap.id, data);
        const link = promoLink(uid, entry.promotionId);
        if (!link) throw new Error(promotionLinkProblem(uid, entry.promotionId));

        const changes = approveChanges({
          approvedBy,
          startDate: Timestamp.fromDate(startDate),
          endDate: Timestamp.fromDate(endDate),
          url: link,
        });
        txn.update(userRef, promotionsUpdate(replacePromotion(plan.list, plan.index, changes)));

        const recipient = approvalRecipient(data);
        if (recipient.email) {
          const productName = readPromotion(plan.item).products[0]?.name ?? "";
          txn.set(mailRef, approvalMail({ ...recipient, promotionId: entry.promotionId, productName, link, now: serverTimestamp() }));
        }
        return { link, email: recipient.email };
      });

      onDone(
        result.email
          ? tx("Approved {label} from {creator}. It runs {start} to {end} and its link is {link}. An approval email to {email} has been queued.", { label, creator: creatorName, start, end, link: result.link, email: result.email })
          : tx("Approved {label} from {creator}. It runs {start} to {end} and its link is {link}. No approval email was queued because the creator has no email address.", { label, creator: creatorName, start, end, link: result.link }),
      );
    } catch (err) {
      setProblem(tx("{name} was not approved: {reason}.", { name: label, reason: err instanceof Error ? err.message : tx("something went wrong") }));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setProblem("");
    try {
      const { db } = getFirebase();
      const approvedBy = reviewerRef();
      const userRef = doc(db, USERS_COLLECTION, entry.creator.docId);
      await runTransaction(db, async (txn) => {
        const data = (await txn.get(userRef)).data();
        if (!data) throw new Error(tx("the creator's record no longer exists"));
        const plan = planReview(data, entry.promotionId);
        if ("problem" in plan) throw new Error(plan.problem);
        txn.update(userRef, promotionsUpdate(replacePromotion(plan.list, plan.index, rejectChanges({ approvedBy }))));
      });
      onDone(tx("Rejected {label} from {creator}.", { label, creator: creatorName }));
    } catch (err) {
      setProblem(tx("{name} was not rejected: {reason}.", { name: label, reason: err instanceof Error ? err.message : tx("something went wrong") }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[14px] bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button className={light} onClick={onBack} disabled={busy}>{tx("← All promotions")}</button>
          {entry.creator.photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={entry.creator.photo} alt="" className="size-10 shrink-0 rounded-full bg-muted object-cover" />
          )}
          <div className="min-w-0 flex-1 basis-56">
            <p className="truncate text-sm font-semibold text-heading">{entry.caption || label}</p>
            <p className="text-xs text-muted-foreground">
              {[entry.promotionId, tx("{type} promotion", { type: typeLabel(entry.type) }), tx("by {name}", { name: creatorName }), tx(statusLabel(entry.status)), extra].filter(Boolean).join(" · ")}
            </p>
          </div>
          {canEdit && reviewable && step === "idle" && (
            <div className="flex items-center gap-2">
              <button className={dark} disabled={busy} onClick={() => { setProblem(""); setStep("approve"); }}>{tx("Approve")}</button>
              <button className={light} disabled={busy} onClick={() => { setProblem(""); setStep("reject"); }}>{tx("Reject")}</button>
            </div>
          )}
        </div>

        {!canEdit && reviewable && (
          <p className="mt-3 text-xs text-muted-foreground">{tx("You can view this promotion, but your role cannot approve or reject creator promotions.")}</p>
        )}

        {canEdit && reviewable && step === "approve" && (
          nextLink ? (
            <ApproveForm label={label} link={nextLink} busy={busy} onApprove={approve} onCancel={() => setStep("idle")} />
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3">
              <span className="min-w-0 flex-1 basis-56 text-xs text-destructive" role="alert">
                {tx("This promotion cannot be approved: {reason}.", { reason: linkProblem })}
              </span>
              <button className={light} onClick={() => setStep("idle")}>{tx("Close")}</button>
            </div>
          )
        )}

        {canEdit && reviewable && step === "reject" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3">
            <span className="min-w-0 flex-1 basis-56 text-xs">
              {tx("Reject {label} from {creator}? It will not go live, and it cannot be approved afterwards.", { label, creator: creatorName })}
            </span>
            <button className={dark} disabled={busy} onClick={reject}>{busy ? tx("Rejecting…") : tx("Reject promotion")}</button>
            <button className={light} disabled={busy} onClick={() => setStep("idle")}>{tx("Cancel")}</button>
          </div>
        )}

        {problem && <p className="mt-3 break-words text-xs text-destructive" role="alert">{problem}</p>}
      </section>

      <section className="rounded-[14px] bg-card p-4">
        <p className="text-sm font-semibold text-heading">{tx("Promotion")}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label={tx("Promotion ID")} value={entry.promotionId} />
          <Detail label={tx("Type")} value={typeLabel(entry.type)} />
          <Detail label={tx("Status")} value={[tx(statusLabel(entry.status)), extra].filter(Boolean).join(tx(", "))} />
          <Detail label={tx("Promotion code")} value={entry.code} ltr />
          <Detail label={tx("Created")} value={cellText(entry.createdAt)} />
          <Detail label={tx("Start date")} value={dayText(entry.startDate)} />
          <Detail label={tx("End date")} value={dayText(entry.endDate)} />
          {entry.sales !== null && <Detail label={tx("Sales")} value={String(entry.sales)} />}
          {entry.earnings !== null && <Detail label={tx("Earnings")} value={String(entry.earnings)} />}
          {entry.withdrawals !== null && <Detail label={tx("Withdrawals")} value={String(entry.withdrawals)} />}
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs text-muted-foreground">{tx("Promotion link")}</dt>
            <dd className="mt-0.5 break-all text-[13px]" dir="ltr">
              {storedLink ? (
                <a href={storedLink} target="_blank" rel="noopener noreferrer" className="underline">{storedLink}</a>
              ) : (
                entry.url || <span className="text-subtle">{reviewable ? tx("Made when the promotion is approved") : tx("Not stored")}</span>
              )}
            </dd>
          </div>
          <Detail label={tx("Caption")} value={entry.caption} wide />
          <Detail label={tx("Description")} value={entry.description} wide />
        </dl>
      </section>

      <section className="rounded-[14px] bg-card p-4">
        <p className="text-sm font-semibold text-heading">{tx("Creator")}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label={tx("Name")} value={entry.creator.name} />
          <Detail label={tx("Creator ID")} value={entry.creator.creatorId} />
          <Detail label={tx("Email")} value={entry.creator.email} />
          <Detail label={tx("Phone")} value={entry.creator.phone} ltr />
        </dl>
      </section>

      <section className="rounded-[14px] bg-card p-4">
        <p className="text-sm font-semibold text-heading">{tx("Pictures and video")}</p>
        {pictures.length === 0 && entry.videos.length === 0 && <p className="mt-3 text-xs text-subtle">{tx("No pictures or video were added.")}</p>}
        {pictures.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3">
            {pictures.map((file) => <FileTile key={file.url} file={file} onView={setViewing} />)}
          </div>
        )}
        {entry.videos.map((url, index) => (
          <div key={url} className="mt-3">
            <video src={url} controls preload="metadata" className="max-h-80 w-full max-w-md rounded-lg bg-black" />
            <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[13px] underline">
              {entry.videos.length > 1 ? tx("Open video {number} in a new tab", { number: index + 1 }) : tx("Open video in a new tab")}
            </a>
          </div>
        ))}
      </section>

      <section className="rounded-[14px] bg-card p-4">
        <p className="text-sm font-semibold text-heading">{tx("Products in this promotion")}</p>
        {entry.products.length === 0 && <p className="mt-3 text-xs text-subtle">{tx("No products are attached.")}</p>}
        {entry.products.length > 0 && (
          <ul className="mt-3 space-y-3">
            {entry.products.map((product, index) => <ProductRow key={`${product.productId}-${index}`} product={product} />)}
          </ul>
        )}
      </section>

      {viewing && <ImageViewer file={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function ApproveForm({
  label,
  link,
  busy,
  onApprove,
  onCancel,
}: {
  label: string;
  link: string;
  busy: boolean;
  onApprove: (start: string, end: string) => void;
  onCancel: () => void;
}) {
  const { rows, loading } = useCollection("settings", 5, { type: "Company" });
  const duration = readPromotionDuration(rows[0]?.data);
  const [start, setStart] = useState(() => dayInput(new Date()));
  // Until an end date is typed, it follows the start date by the number of days set in Settings.
  const [typedEnd, setTypedEnd] = useState<string | null>(null);
  const end = typedEnd ?? suggestedEndDay(start, duration);
  const datesProblem = approvalDatesProblem(start, end);

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-muted p-3">
      <p className="text-xs font-medium">{tx("Approve {label}? Choose when it runs.", { label })}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs text-muted-foreground">
          {tx("Start date")}
          <Input type="date" value={start} onChange={(event) => setStart(event.target.value)} className="mt-1 w-auto text-foreground" />
        </label>
        <label className="block text-xs text-muted-foreground">
          {tx("End date")}
          <Input type="date" value={end} min={start || undefined} onChange={(event) => setTypedEnd(event.target.value)} className="mt-1 w-auto text-foreground" />
        </label>
        {duration !== null && typedEnd === null && (
          <span className="pb-1.5 text-xs text-subtle">{tx("Custom promotions run {count} days unless you change the end date.", { count: duration })}</span>
        )}
      </div>
      <p className="break-all text-xs text-muted-foreground">
        {rich(tx("The creator's link will be {link}"), { link: <span dir="ltr">{link}</span> })}
      </p>
      {datesProblem && !loading && <p className="text-xs text-destructive">{datesProblem}</p>}
      <div className="flex items-center gap-2">
        <button className={dark} disabled={busy || Boolean(datesProblem)} onClick={() => onApprove(start, end)}>
          {busy ? tx("Approving…") : tx("Approve promotion")}
        </button>
        <button className={light} disabled={busy} onClick={onCancel}>{tx("Cancel")}</button>
      </div>
    </div>
  );
}

function ProductRow({ product }: { product: PromotionProduct }) {
  return (
    <li className="flex items-start gap-3">
      {product.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.image} alt="" loading="lazy" className="size-14 shrink-0 rounded-lg bg-muted object-cover" />
      ) : (
        <span className="size-14 shrink-0 rounded-lg bg-muted" />
      )}
      <div className="min-w-0">
        <p className="break-words text-[13px] font-medium">{product.name || tx("Unnamed product")}</p>
        {product.description && <p className="line-clamp-2 break-words text-xs text-muted-foreground">{product.description}</p>}
        {product.productId && (
          <Link href={`/product-edit?id=${encodeURIComponent(product.productId)}`} className="text-xs underline">
            {tx("Open in product editor")}
          </Link>
        )}
      </div>
    </li>
  );
}
