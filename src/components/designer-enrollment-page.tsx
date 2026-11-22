"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  increment,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { cellText, useCollection } from "@/lib/firestore-ui";
import {
  ID_MAP_COLLECTION,
  ID_MAP_TYPE,
  MAIL_COLLECTION,
  PENDING_APPLICATION_FILTERS,
  SALES_HISTORY_COLLECTION,
  USERS_COLLECTION,
  applicantLabel,
  approvalMail,
  approvalRecipient,
  approveUpdate,
  canApprove,
  canReject,
  canSubmitRejection,
  designerIdFor,
  idCountersUpdate,
  matchesSearch,
  readApplication,
  readIdCounters,
  readRejectReasons,
  rejectUpdate,
  rejectionNeedsMessage,
  rejectionReason,
  safeUrl,
  salesHistoryRecord,
  type DesignerApplication,
  type UploadedFile,
} from "@/lib/designer-enrollment";
import { tx } from "@/lib/i18n/tx";
import { useAuth } from "./auth-provider";
import { buttonVariants } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";

const dark = buttonVariants({ size: "sm" });
const light = buttonVariants({ variant: "outline", size: "sm" });
const th = "px-3 py-2 text-start text-xs font-medium whitespace-nowrap text-muted-foreground";
const td = "px-3 py-2 text-[13px] text-foreground";

type Note = { text: string; failed?: boolean };
type Entry = DesignerApplication & { id: string };

/** Designer enrollment: review a pending application with its uploads, then approve or reject it. */
export function DesignerEnrollmentPage() {
  const { allowed } = useAuth();
  const { rows, loading, error, hasMore, loadMore } = useCollection(USERS_COLLECTION, 200, PENDING_APPLICATION_FILTERS);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  const applications = useMemo<Entry[]>(
    () =>
      rows
        .map((row) => ({ id: row.id, ...readApplication(row.data) }))
        .sort((a, b) => cellText(b.submittedAt).localeCompare(cellText(a.submittedAt))),
    [rows],
  );
  const shown = useMemo(() => applications.filter((item) => matchesSearch(item, q)), [applications, q]);
  const open = applications.find((item) => item.id === openId) ?? null;

  if (open) {
    return (
      <ApplicationReview
        key={open.id}
        application={open}
        canEdit={allowed("designer_edit")}
        onBack={() => setOpenId(null)}
        onDone={(text) => {
          setOpenId(null);
          setNote({ text });
        }}
      />
    );
  }

  return (
    <section className="rounded-[14px] bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-semibold text-heading">{tx("Designer applications waiting for review: {count}", { count: applications.length })}</p>
          <p className="text-xs text-muted-foreground">{tx("Open an application to see the form, portfolio and ID documents, then approve or reject it.")}</p>
        </div>
        <Input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={tx("Search name, email, phone or request ID")}
          aria-label={tx("Search designer applications")}
          className="sm:w-64"
        />
      </div>

      {note && <p className={`mt-3 text-xs ${note.failed ? "text-destructive" : "text-muted-foreground"}`} role="status">{note.text}</p>}
      {error && <p className="mt-3 text-xs text-destructive">{tx("Designer applications could not be loaded: {error}", { error })}</p>}
      {loading && <p className="mt-3 text-xs text-subtle">{tx("Loading…")}</p>}

      {!loading && !error && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className={th}>{tx("Request ID")}</th>
                <th className={th}>{tx("Name")}</th>
                <th className={th}>{tx("Email")}</th>
                <th className={th}>{tx("Phone")}</th>
                <th className={th}>{tx("Applying as")}</th>
                <th className={th}>{tx("Submitted")}</th>
                <th className={th}>{tx("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <tr key={item.id} className="border-b border-border">
                  <td className={td}>{item.requestId}</td>
                  <td className={td}>{item.name}</td>
                  <td className={td}>{item.email || item.accountEmail}</td>
                  <td className={td} dir="ltr">{item.phone}</td>
                  <td className={td}>{sellerType(item)}</td>
                  <td className={td}>{cellText(item.submittedAt)}</td>
                  <td className={td}>
                    <button className={dark} onClick={() => { setNote(null); setOpenId(item.id); }}>{tx("Review")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && (
            <p className="py-6 text-center text-xs text-subtle">
              {q.trim() ? tx("No application matches your search.") : tx("No designer applications are waiting for review.")}
            </p>
          )}
        </div>
      )}

      {hasMore && (
        <div className="mt-3 flex items-center gap-2">
          <button className={light} onClick={loadMore}>{tx("Load more")}</button>
          <span className="text-xs text-subtle">{tx("The count covers the applications loaded so far.")}</span>
        </div>
      )}
    </section>
  );
}

function sellerType(application: DesignerApplication): string {
  return application.licensedStore ? tx("Licensed store") : tx("Individual designer");
}

function ApplicationReview({
  application,
  canEdit,
  onBack,
  onDone,
}: {
  application: Entry;
  canEdit: boolean;
  onBack: () => void;
  onDone: (text: string) => void;
}) {
  const [step, setStep] = useState<"idle" | "approve" | "reject">("idle");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [viewing, setViewing] = useState<UploadedFile | null>(null);
  const name = applicantLabel(application);

  async function approve() {
    setBusy(true);
    setProblem("");
    try {
      const { db } = getFirebase();
      const counters = await getDocs(query(collection(db, ID_MAP_COLLECTION), where("type", "==", ID_MAP_TYPE), limit(1)));
      const counterRef = counters.docs[0]?.ref;
      if (!counterRef) throw new Error(tx("the record that hands out designer IDs was not found"));
      const userRef = doc(db, USERS_COLLECTION, application.id);
      const salesRef = doc(collection(db, SALES_HISTORY_COLLECTION));
      const mailRef = doc(collection(db, MAIL_COLLECTION));

      // One transaction, so two admins approving at once can never hand out the same designer ID.
      const result = await runTransaction(db, async (txn) => {
        const [counterSnap, userSnap] = await Promise.all([txn.get(counterRef), txn.get(userRef)]);
        const data = userSnap.data();
        if (!data) throw new Error(tx("this person's record no longer exists"));
        if (!canApprove(readApplication(data).status)) throw new Error(tx("the application has already been approved or rejected"));
        const next = readIdCounters(counterSnap.data());
        if (!next) throw new Error(tx("the record that hands out designer IDs has no next designer or sales history number"));

        const now = serverTimestamp();
        const designerId = designerIdFor(next.designerId);
        const recipient = approvalRecipient(data);
        txn.set(salesRef, salesHistoryRecord({ data, userRef, saleHistoryId: next.saleHistoryId, now }));
        txn.update(userRef, approveUpdate({ data, designerId, saleHistoryRef: salesRef, saleHistoryId: next.saleHistoryId, now }));
        txn.update(counterRef, idCountersUpdate(increment(1)));
        if (recipient.email) txn.set(mailRef, approvalMail({ ...recipient, now }));
        return { designerId, email: recipient.email };
      });

      onDone(
        result.email
          ? tx("Approved {name}. Their designer ID is {id} and an approval email to {email} has been queued.", { name, id: result.designerId, email: result.email })
          : tx("Approved {name}. Their designer ID is {id}. No approval email was sent because the application has no email address.", { name, id: result.designerId }),
      );
    } catch (err) {
      setProblem(tx("{name} was not approved: {reason}.", { name, reason: err instanceof Error ? err.message : tx("something went wrong") }));
      setStep("idle");
    } finally {
      setBusy(false);
    }
  }

  async function reject(reason: string, message: string) {
    setBusy(true);
    setProblem("");
    try {
      const { db } = getFirebase();
      const userRef = doc(db, USERS_COLLECTION, application.id);
      await runTransaction(db, async (txn) => {
        const data = (await txn.get(userRef)).data();
        if (!data) throw new Error(tx("this person's record no longer exists"));
        if (!canReject(readApplication(data).status)) throw new Error(tx("the application has already been approved or rejected"));
        txn.update(userRef, rejectUpdate({ reason, message, now: serverTimestamp() }));
      });
      onDone(tx("Rejected the application from {name}.", { name }));
    } catch (err) {
      setProblem(tx("The application was not rejected: {reason}.", { reason: err instanceof Error ? err.message : tx("something went wrong") }));
    } finally {
      setBusy(false);
    }
  }

  const portfolioLink = safeUrl(application.portfolioLink);
  const pictures = application.portfolio.filter((file) => file.isImage);
  const documents = application.portfolio.filter((file) => !file.isImage);

  return (
    <div className="space-y-4">
      <section className="rounded-[14px] bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button className={light} onClick={onBack} disabled={busy}>{tx("← All applications")}</button>
          {application.brandPhoto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={application.brandPhoto} alt="" className="size-10 shrink-0 rounded-full bg-muted object-cover" />
          )}
          <div className="min-w-0 flex-1 basis-56">
            <p className="truncate text-sm font-semibold text-heading">{name}</p>
            <p className="text-xs text-muted-foreground">
              {[application.requestId && tx("Request {id}", { id: application.requestId }), sellerType(application), application.submittedAt ? tx("submitted {date}", { date: cellText(application.submittedAt) }) : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {canEdit && step === "idle" && (
            <div className="flex items-center gap-2">
              <button className={dark} disabled={busy} onClick={() => { setProblem(""); setStep("approve"); }}>{tx("Approve")}</button>
              <button className={light} disabled={busy} onClick={() => { setProblem(""); setStep("reject"); }}>{tx("Reject")}</button>
            </div>
          )}
        </div>

        {!canEdit && <p className="mt-3 text-xs text-muted-foreground">{tx("You can view this application, but your role cannot approve or reject designers.")}</p>}

        {canEdit && step === "approve" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3">
            <span className="min-w-0 flex-1 basis-56 text-xs">
              {tx("Approve {name} as a designer? They get the next designer ID and an approval email.", { name })}
            </span>
            <button className={dark} disabled={busy} onClick={approve}>{busy ? tx("Approving…") : tx("Approve")}</button>
            <button className={light} disabled={busy} onClick={() => setStep("idle")}>{tx("Cancel")}</button>
          </div>
        )}

        {canEdit && step === "reject" && <RejectForm name={name} busy={busy} onReject={reject} onCancel={() => setStep("idle")} />}

        {problem && <p className="mt-3 text-xs text-destructive" role="alert">{problem}</p>}
      </section>

      <section className="rounded-[14px] bg-card p-4">
        <p className="text-sm font-semibold text-heading">{tx("Application details")}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label={tx("Email")} value={application.email || application.accountEmail} />
          <Detail label={tx("Phone")} value={application.phone} ltr />
          <Detail label={tx("Location")} value={application.location} />
          <Detail label={tx("Alternative email")} value={application.alternativeEmail} />
          <Detail label={tx("Alternative phone")} value={application.alternativePhone} ltr />
          <Detail label={tx("Applying as")} value={sellerType(application)} />
          <Detail label={tx("Experience")} value={tx("{count} years", { count: application.experienceYears })} />
          <Detail label={tx("Preferred styles")} value={application.styles.join(", ")} />
          <Detail label={tx("Production capacity")} value={application.productionCapabilities && tx("{count} dresses per month", { count: application.productionCapabilities })} />
          <Detail label={tx("Takes custom orders")} value={application.customOrders ? tx("Yes") : tx("No")} />
          <Detail label={tx("Open to events and collaborations")} value={application.eventCollaborations ? tx("Yes") : tx("No")} />
          <div>
            <dt className="text-xs text-muted-foreground">{tx("Portfolio link")}</dt>
            <dd className="mt-0.5 break-words text-[13px]">
              {portfolioLink ? (
                <a href={portfolioLink} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{portfolioLink}</a>
              ) : (
                application.portfolioLink || <span className="text-subtle">{tx("Not given")}</span>
              )}
            </dd>
          </div>
          <Detail label={tx("About")} value={application.bio} wide />
          <Detail label={tx("References and testimonials")} value={application.testimonials} wide />
        </dl>
      </section>

      <section className="rounded-[14px] bg-card p-4">
        <p className="text-sm font-semibold text-heading">{tx("Portfolio and work samples")}</p>
        {application.portfolio.length === 0 && <p className="mt-3 text-xs text-subtle">{tx("No portfolio files were uploaded.")}</p>}
        {pictures.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3">
            {pictures.map((file, index) => <FileTile key={`${file.url}-${index}`} file={file} onView={setViewing} />)}
          </div>
        )}
        {documents.length > 0 && (
          <ul className="mt-3 space-y-1">
            {documents.map((file, index) => <li key={`${file.url}-${index}`}><FileLink file={file} /></li>)}
          </ul>
        )}
      </section>

      <section className="rounded-[14px] bg-card p-4">
        <p className="text-sm font-semibold text-heading">{tx("Identity verification")}</p>
        <div className="mt-3 flex flex-wrap gap-6">
          <Upload label={application.licensedStore ? tx("Store licence") : tx("ID document")} file={application.idDocument} onView={setViewing} />
          <Upload label={tx("Selfie")} file={application.selfie} onView={setViewing} />
        </div>
      </section>

      {viewing && <ImageViewer file={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function RejectForm({
  name,
  busy,
  onReject,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onReject: (reason: string, message: string) => void;
  onCancel: () => void;
}) {
  const { rows, loading } = useCollection("settings", 5, { type: "Company" });
  const reasons = useMemo(() => readRejectReasons(rows[0]?.data), [rows]);
  const [picked, setPicked] = useState("");
  const [message, setMessage] = useState("");
  const reason = rejectionReason(picked, reasons);
  const mustType = rejectionNeedsMessage(reason);

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-muted p-3">
      <p className="text-xs font-medium">{tx("Reject the application from {name}?", { name })}</p>
      {loading && <p className="text-xs text-subtle">{tx("Loading the reasons…")}</p>}
      {!loading && reasons.length > 0 && (
        <div className="block text-xs text-muted-foreground">
          <span id="reject-reason-label">{tx("Reason")}</span>
          <Select value={picked || undefined} onValueChange={setPicked}>
            <SelectTrigger className="mt-1 bg-card text-foreground" aria-labelledby="reject-reason-label">
              <SelectValue placeholder={tx("Choose a reason…")} />
            </SelectTrigger>
            <SelectContent position="popper">
              {reasons.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {!loading && (
        <label className="block text-xs text-muted-foreground">
          {mustType ? tx("Reason in your own words") : tx("More detail (optional)")}
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={3}
            placeholder={mustType ? tx("Type the reason for rejecting this application") : tx("Anything to add to the reason")}
            className="mt-1 text-foreground"
          />
        </label>
      )}
      <div className="flex items-center gap-2">
        <button className={dark} disabled={busy || loading || !canSubmitRejection(reason, message)} onClick={() => onReject(reason, message)}>
          {busy ? tx("Rejecting…") : tx("Reject application")}
        </button>
        <button className={light} disabled={busy} onClick={onCancel}>{tx("Cancel")}</button>
      </div>
    </div>
  );
}

export function Detail({ label, value, ltr, wide }: { label: string; value: string; ltr?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-[13px]" dir={ltr ? "ltr" : undefined}>
        {value || <span className="text-subtle">{tx("Not given")}</span>}
      </dd>
    </div>
  );
}

function Upload({ label, file, onView }: { label: string; file: UploadedFile | null; onView: (file: UploadedFile) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      {!file && <p className="text-xs text-subtle">{tx("Not uploaded")}</p>}
      {file && (file.isImage ? <FileTile file={file} onView={onView} /> : <FileLink file={file} />)}
    </div>
  );
}

/** A picture thumbnail that opens larger in the page. Falls back to a link if it will not load as a picture. */
export function FileTile({ file, onView }: { file: UploadedFile; onView: (file: UploadedFile) => void }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <FileLink file={file} />;
  return (
    <button onClick={() => onView(file)} title={tx("View {name}", { name: file.name })} className="block overflow-hidden rounded-lg border border-border hover:opacity-90">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={file.url} alt={file.name} loading="lazy" onError={() => setBroken(true)} className="size-36 bg-muted object-cover" />
    </button>
  );
}

function FileLink({ file }: { file: UploadedFile }) {
  return (
    <a href={file.url} target="_blank" rel="noopener noreferrer" className="break-all text-[13px] underline">
      {tx("Open {name}", { name: file.name || tx("file") })}
    </a>
  );
}

export function ImageViewer({ file, onClose }: { file: UploadedFile; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={file.name} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-4" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={file.url} alt={file.name} className="max-h-[82vh] max-w-full rounded-lg object-contain" onClick={(event) => event.stopPropagation()} />
      <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
        <a href={file.url} target="_blank" rel="noopener noreferrer" className={light}>{tx("Open in a new tab")}</a>
        <button className={light} onClick={onClose} autoFocus>{tx("Close")}</button>
      </div>
    </div>
  );
}
