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
import { promoLink } from "@/lib/share-links";
import { useAuth } from "./auth-provider";
import { Detail, FileTile, ImageViewer } from "./designer-enrollment-page";

const chip = "rounded-lg border px-2.5 py-1 text-xs";
const chipOn = `${chip} border-[#1a1a1a] bg-[#1a1a1a] text-white`;
const chipOff = `${chip} border-[#e3e3e3] bg-white hover:bg-[#fafafa]`;
const dark = "rounded-lg bg-[#1a1a1a] px-2.5 py-1 text-xs text-white hover:bg-black disabled:opacity-40";
const light = "rounded-lg border border-[#e3e3e3] bg-white px-2.5 py-1 text-xs hover:bg-[#fafafa] disabled:opacity-40";
const th = "px-3 py-2 text-left text-xs font-medium text-[#757575]";
const td = "px-3 py-2 text-[13px]";
const field = "rounded-lg border border-[#e3e3e3] bg-white px-2.5 py-1.5 text-xs text-[#1a1a1a]";

/** Where an active promotion stands against its dates, in a word. */
function windowNote(entry: PromotionEntry, now: Date): string {
  if (entry.status !== "active") return "";
  const where = promotionWindow(entry.startDate, entry.endDate, now);
  if (where === "upcoming") return "not started yet";
  if (where === "ended") return "ended";
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
  const tabLabel = PROMOTION_TABS.find((item) => item.tab === tab)?.label ?? "";

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
    <section className="rounded-[14px] bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        {PROMOTION_TABS.filter((item) => item.tab !== "other" || counts.other > 0 || tab === "other").map((item) => (
          <button key={item.tab} className={tab === item.tab ? chipOn : chipOff} onClick={() => setTab(item.tab)}>
            {item.label} {counts[item.tab]}
          </button>
        ))}
        <select
          value={type}
          onChange={(event) => setType(event.target.value as PromotionTypeFilter)}
          aria-label="Promotion type"
          className={`${field} ml-auto py-1`}
        >
          {PROMOTION_TYPES.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
        </select>
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search promotion, code, creator or product"
          aria-label="Search creator promotions"
          className="w-full rounded-lg border border-[#e3e3e3] px-2.5 py-1 text-xs sm:w-64"
        />
      </div>

      {note && <p className="mt-3 break-words text-xs text-[#757575]" role="status">{note}</p>}
      {error && <p className="mt-3 text-xs text-[#b42318]">Creator promotions could not be loaded: {error}</p>}
      {loading && <p className="mt-3 text-xs text-[#a9a9a9]">Loading…</p>}

      {!loading && !error && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="border-b border-[#f0f0f0]">
                <th className={th}>Promotion ID</th>
                <th className={th}>Creator</th>
                <th className={th}>Caption</th>
                <th className={th}>Type</th>
                <th className={th}>Created</th>
                <th className={th}>Runs</th>
                <th className={th}>Status</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => {
                const dates = [dayText(entry.startDate), dayText(entry.endDate)];
                const extra = windowNote(entry, now);
                return (
                  <tr key={entry.key} className="border-b border-[#f7f7f7]">
                    <td className={td}>{entry.promotionId}</td>
                    <td className={td}>
                      {entry.creator.name || entry.creator.email}
                      {entry.creator.creatorId && <span className="block text-xs text-[#757575]">{entry.creator.creatorId}</span>}
                    </td>
                    <td className={`${td} max-w-[260px] truncate`} title={entry.caption}>{entry.caption}</td>
                    <td className={td}>{typeLabel(entry.type)}</td>
                    <td className={td}>{cellText(entry.createdAt)}</td>
                    <td className={td}>{dates.some(Boolean) ? `${dates[0] || "?"} to ${dates[1] || "?"}` : ""}</td>
                    <td className={td}>
                      {statusLabel(entry.status)}
                      {extra && <span className="block text-xs text-[#757575]">{extra}</span>}
                    </td>
                    <td className={td}>
                      <button className={canReview(entry.status) ? dark : light} onClick={() => { setNote(""); setOpenKey(entry.key); }}>
                        {canReview(entry.status) ? "Review" : "View"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && (
            <p className="py-6 text-center text-xs text-[#a9a9a9]">
              {q.trim() ? "No promotion in this tab matches your search." : `No promotions are in ${tabLabel} right now.`}
            </p>
          )}
        </div>
      )}

      {hasMore && (
        <div className="mt-3 flex items-center gap-2">
          <button className={light} onClick={loadMore}>Load more creators</button>
          <span className="text-xs text-[#a9a9a9]">Counts cover the creators loaded so far.</span>
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
  const creatorName = entry.creator.name || entry.creator.email || "this creator";
  const reviewable = canReview(entry.status);
  const linkProblem = promotionLinkProblem(entry.creator.uid, entry.promotionId);
  const nextLink = promoLink(entry.creator.uid, entry.promotionId);
  const storedLink = safeUrl(entry.url);
  const extra = windowNote(entry, now);
  const pictures: UploadedFile[] = entry.images.map((url, index) => ({ name: `Picture ${index + 1}`, url, isImage: true }));

  /** The admin's own `users` record, which the Flutter admin stores as who reviewed the promotion. */
  function reviewerRef() {
    const id = profile?.id ?? user?.uid;
    if (!id) throw new Error("you are not signed in");
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
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(userRef);
        const data = snap.data();
        if (!data) throw new Error("the creator's record no longer exists");
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
        tx.update(userRef, promotionsUpdate(replacePromotion(plan.list, plan.index, changes)));

        const recipient = approvalRecipient(data);
        if (recipient.email) {
          const productName = readPromotion(plan.item).products[0]?.name ?? "";
          tx.set(mailRef, approvalMail({ ...recipient, promotionId: entry.promotionId, productName, link, now: serverTimestamp() }));
        }
        return { link, email: recipient.email };
      });

      onDone(
        `Approved ${label} from ${creatorName}. It runs ${start} to ${end} and its link is ${result.link}. ` +
          (result.email ? `An approval email to ${result.email} has been queued.` : "No approval email was queued because the creator has no email address."),
      );
    } catch (err) {
      setProblem(`${label} was not approved: ${err instanceof Error ? err.message : "something went wrong"}.`);
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
      await runTransaction(db, async (tx) => {
        const data = (await tx.get(userRef)).data();
        if (!data) throw new Error("the creator's record no longer exists");
        const plan = planReview(data, entry.promotionId);
        if ("problem" in plan) throw new Error(plan.problem);
        tx.update(userRef, promotionsUpdate(replacePromotion(plan.list, plan.index, rejectChanges({ approvedBy }))));
      });
      onDone(`Rejected ${label} from ${creatorName}.`);
    } catch (err) {
      setProblem(`${label} was not rejected: ${err instanceof Error ? err.message : "something went wrong"}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[14px] bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button className={light} onClick={onBack} disabled={busy}>← All promotions</button>
          {entry.creator.photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={entry.creator.photo} alt="" className="size-10 shrink-0 rounded-full bg-[#f1f1f1] object-cover" />
          )}
          <div className="min-w-0 flex-1 basis-56">
            <p className="truncate text-sm font-semibold">{entry.caption || label}</p>
            <p className="text-xs text-[#757575]">
              {[entry.promotionId, `${typeLabel(entry.type)} promotion`, `by ${creatorName}`, statusLabel(entry.status), extra].filter(Boolean).join(" · ")}
            </p>
          </div>
          {canEdit && reviewable && step === "idle" && (
            <div className="flex items-center gap-2">
              <button className={dark} disabled={busy} onClick={() => { setProblem(""); setStep("approve"); }}>Approve</button>
              <button className={light} disabled={busy} onClick={() => { setProblem(""); setStep("reject"); }}>Reject</button>
            </div>
          )}
        </div>

        {!canEdit && reviewable && (
          <p className="mt-3 text-xs text-[#757575]">You can view this promotion, but your role cannot approve or reject creator promotions.</p>
        )}

        {canEdit && reviewable && step === "approve" && (
          nextLink ? (
            <ApproveForm label={label} link={nextLink} busy={busy} onApprove={approve} onCancel={() => setStep("idle")} />
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[#fafafa] p-3">
              <span className="min-w-0 flex-1 basis-56 text-xs text-[#b42318]" role="alert">
                This promotion cannot be approved: {linkProblem}.
              </span>
              <button className={light} onClick={() => setStep("idle")}>Close</button>
            </div>
          )
        )}

        {canEdit && reviewable && step === "reject" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[#fafafa] p-3">
            <span className="min-w-0 flex-1 basis-56 text-xs">
              Reject {label} from {creatorName}? It will not go live, and it cannot be approved afterwards.
            </span>
            <button className={dark} disabled={busy} onClick={reject}>{busy ? "Rejecting…" : "Reject promotion"}</button>
            <button className={light} disabled={busy} onClick={() => setStep("idle")}>Cancel</button>
          </div>
        )}

        {problem && <p className="mt-3 break-words text-xs text-[#b42318]" role="alert">{problem}</p>}
      </section>

      <section className="rounded-[14px] bg-white p-4">
        <p className="text-sm font-semibold">Promotion</p>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Promotion ID" value={entry.promotionId} />
          <Detail label="Type" value={typeLabel(entry.type)} />
          <Detail label="Status" value={[statusLabel(entry.status), extra].filter(Boolean).join(", ")} />
          <Detail label="Promotion code" value={entry.code} ltr />
          <Detail label="Created" value={cellText(entry.createdAt)} />
          <Detail label="Start date" value={dayText(entry.startDate)} />
          <Detail label="End date" value={dayText(entry.endDate)} />
          {entry.sales !== null && <Detail label="Sales" value={String(entry.sales)} />}
          {entry.earnings !== null && <Detail label="Earnings" value={String(entry.earnings)} />}
          {entry.withdrawals !== null && <Detail label="Withdrawals" value={String(entry.withdrawals)} />}
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs text-[#757575]">Promotion link</dt>
            <dd className="mt-0.5 break-all text-[13px]" dir="ltr">
              {storedLink ? (
                <a href={storedLink} target="_blank" rel="noopener noreferrer" className="underline">{storedLink}</a>
              ) : (
                entry.url || <span className="text-[#a9a9a9]">{reviewable ? "Made when the promotion is approved" : "Not stored"}</span>
              )}
            </dd>
          </div>
          <Detail label="Caption" value={entry.caption} wide />
          <Detail label="Description" value={entry.description} wide />
        </dl>
      </section>

      <section className="rounded-[14px] bg-white p-4">
        <p className="text-sm font-semibold">Creator</p>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Name" value={entry.creator.name} />
          <Detail label="Creator ID" value={entry.creator.creatorId} />
          <Detail label="Email" value={entry.creator.email} />
          <Detail label="Phone" value={entry.creator.phone} ltr />
        </dl>
      </section>

      <section className="rounded-[14px] bg-white p-4">
        <p className="text-sm font-semibold">Pictures and video</p>
        {pictures.length === 0 && entry.videos.length === 0 && <p className="mt-3 text-xs text-[#a9a9a9]">No pictures or video were added.</p>}
        {pictures.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3">
            {pictures.map((file) => <FileTile key={file.url} file={file} onView={setViewing} />)}
          </div>
        )}
        {entry.videos.map((url, index) => (
          <div key={url} className="mt-3">
            <video src={url} controls preload="metadata" className="max-h-80 w-full max-w-md rounded-lg bg-black" />
            <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[13px] underline">
              Open video{entry.videos.length > 1 ? ` ${index + 1}` : ""} in a new tab
            </a>
          </div>
        ))}
      </section>

      <section className="rounded-[14px] bg-white p-4">
        <p className="text-sm font-semibold">Products in this promotion</p>
        {entry.products.length === 0 && <p className="mt-3 text-xs text-[#a9a9a9]">No products are attached.</p>}
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
    <div className="mt-3 space-y-2 rounded-lg bg-[#fafafa] p-3">
      <p className="text-xs font-medium">Approve {label}? Choose when it runs.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs text-[#757575]">
          Start date
          <input type="date" value={start} onChange={(event) => setStart(event.target.value)} className={`${field} mt-1 block`} />
        </label>
        <label className="block text-xs text-[#757575]">
          End date
          <input type="date" value={end} min={start || undefined} onChange={(event) => setTypedEnd(event.target.value)} className={`${field} mt-1 block`} />
        </label>
        {duration !== null && typedEnd === null && (
          <span className="pb-1.5 text-xs text-[#a9a9a9]">Custom promotions run {duration} days unless you change the end date.</span>
        )}
      </div>
      <p className="break-all text-xs text-[#757575]">
        The creator&apos;s link will be <span dir="ltr">{link}</span>
      </p>
      {datesProblem && !loading && <p className="text-xs text-[#b42318]">{datesProblem}</p>}
      <div className="flex items-center gap-2">
        <button className={dark} disabled={busy || Boolean(datesProblem)} onClick={() => onApprove(start, end)}>
          {busy ? "Approving…" : "Approve promotion"}
        </button>
        <button className={light} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ProductRow({ product }: { product: PromotionProduct }) {
  return (
    <li className="flex items-start gap-3">
      {product.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.image} alt="" loading="lazy" className="size-14 shrink-0 rounded-lg bg-[#f1f1f1] object-cover" />
      ) : (
        <span className="size-14 shrink-0 rounded-lg bg-[#f1f1f1]" />
      )}
      <div className="min-w-0">
        <p className="break-words text-[13px] font-medium">{product.name || "Unnamed product"}</p>
        {product.description && <p className="line-clamp-2 break-words text-xs text-[#757575]">{product.description}</p>}
        {product.productId && (
          <Link href={`/product-edit?id=${encodeURIComponent(product.productId)}`} className="text-xs underline">
            Open in product editor
          </Link>
        )}
      </div>
    </li>
  );
}
