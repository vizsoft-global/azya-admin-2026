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
          <p className="text-sm font-semibold text-heading">Designer applications waiting for review: {applications.length}</p>
          <p className="text-xs text-muted-foreground">Open an application to see the form, portfolio and ID documents, then approve or reject it.</p>
        </div>
        <Input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search name, email, phone or request ID"
          aria-label="Search designer applications"
          className="sm:w-64"
        />
      </div>

      {note && <p className={`mt-3 text-xs ${note.failed ? "text-destructive" : "text-muted-foreground"}`} role="status">{note.text}</p>}
      {error && <p className="mt-3 text-xs text-destructive">Designer applications could not be loaded: {error}</p>}
      {loading && <p className="mt-3 text-xs text-subtle">Loading…</p>}

      {!loading && !error && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className={th}>Request ID</th>
                <th className={th}>Name</th>
                <th className={th}>Email</th>
                <th className={th}>Phone</th>
                <th className={th}>Applying as</th>
                <th className={th}>Submitted</th>
                <th className={th}>Actions</th>
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
                    <button className={dark} onClick={() => { setNote(null); setOpenId(item.id); }}>Review</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && (
            <p className="py-6 text-center text-xs text-subtle">
              {q.trim() ? "No application matches your search." : "No designer applications are waiting for review."}
            </p>
          )}
        </div>
      )}

      {hasMore && (
        <div className="mt-3 flex items-center gap-2">
          <button className={light} onClick={loadMore}>Load more</button>
          <span className="text-xs text-subtle">The count covers the applications loaded so far.</span>
        </div>
      )}
    </section>
  );
}

function sellerType(application: DesignerApplication): string {
  return application.licensedStore ? "Licensed store" : "Individual designer";
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
      if (!counterRef) throw new Error("the record that hands out designer IDs was not found");
      const userRef = doc(db, USERS_COLLECTION, application.id);
      const salesRef = doc(collection(db, SALES_HISTORY_COLLECTION));
      const mailRef = doc(collection(db, MAIL_COLLECTION));

      // One transaction, so two admins approving at once can never hand out the same designer ID.
      const result = await runTransaction(db, async (tx) => {
        const [counterSnap, userSnap] = await Promise.all([tx.get(counterRef), tx.get(userRef)]);
        const data = userSnap.data();
        if (!data) throw new Error("this person's record no longer exists");
        if (!canApprove(readApplication(data).status)) throw new Error("the application has already been approved or rejected");
        const next = readIdCounters(counterSnap.data());
        if (!next) throw new Error("the record that hands out designer IDs has no next designer or sales history number");

        const now = serverTimestamp();
        const designerId = designerIdFor(next.designerId);
        const recipient = approvalRecipient(data);
        tx.set(salesRef, salesHistoryRecord({ data, userRef, saleHistoryId: next.saleHistoryId, now }));
        tx.update(userRef, approveUpdate({ data, designerId, saleHistoryRef: salesRef, saleHistoryId: next.saleHistoryId, now }));
        tx.update(counterRef, idCountersUpdate(increment(1)));
        if (recipient.email) tx.set(mailRef, approvalMail({ ...recipient, now }));
        return { designerId, email: recipient.email };
      });

      onDone(
        result.email
          ? `Approved ${name}. Their designer ID is ${result.designerId} and an approval email to ${result.email} has been queued.`
          : `Approved ${name}. Their designer ID is ${result.designerId}. No approval email was sent because the application has no email address.`,
      );
    } catch (err) {
      setProblem(`${name} was not approved: ${err instanceof Error ? err.message : "something went wrong"}.`);
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
      await runTransaction(db, async (tx) => {
        const data = (await tx.get(userRef)).data();
        if (!data) throw new Error("this person's record no longer exists");
        if (!canReject(readApplication(data).status)) throw new Error("the application has already been approved or rejected");
        tx.update(userRef, rejectUpdate({ reason, message, now: serverTimestamp() }));
      });
      onDone(`Rejected the application from ${name}.`);
    } catch (err) {
      setProblem(`The application was not rejected: ${err instanceof Error ? err.message : "something went wrong"}.`);
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
          <button className={light} onClick={onBack} disabled={busy}>← All applications</button>
          {application.brandPhoto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={application.brandPhoto} alt="" className="size-10 shrink-0 rounded-full bg-muted object-cover" />
          )}
          <div className="min-w-0 flex-1 basis-56">
            <p className="truncate text-sm font-semibold text-heading">{name}</p>
            <p className="text-xs text-muted-foreground">
              {[application.requestId && `Request ${application.requestId}`, sellerType(application), application.submittedAt ? `submitted ${cellText(application.submittedAt)}` : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {canEdit && step === "idle" && (
            <div className="flex items-center gap-2">
              <button className={dark} disabled={busy} onClick={() => { setProblem(""); setStep("approve"); }}>Approve</button>
              <button className={light} disabled={busy} onClick={() => { setProblem(""); setStep("reject"); }}>Reject</button>
            </div>
          )}
        </div>

        {!canEdit && <p className="mt-3 text-xs text-muted-foreground">You can view this application, but your role cannot approve or reject designers.</p>}

        {canEdit && step === "approve" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3">
            <span className="min-w-0 flex-1 basis-56 text-xs">
              Approve {name} as a designer? They get the next designer ID and an approval email.
            </span>
            <button className={dark} disabled={busy} onClick={approve}>{busy ? "Approving…" : "Approve"}</button>
            <button className={light} disabled={busy} onClick={() => setStep("idle")}>Cancel</button>
          </div>
        )}

        {canEdit && step === "reject" && <RejectForm name={name} busy={busy} onReject={reject} onCancel={() => setStep("idle")} />}

        {problem && <p className="mt-3 text-xs text-destructive" role="alert">{problem}</p>}
      </section>

      <section className="rounded-[14px] bg-card p-4">
        <p className="text-sm font-semibold text-heading">Application details</p>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Email" value={application.email || application.accountEmail} />
          <Detail label="Phone" value={application.phone} ltr />
          <Detail label="Location" value={application.location} />
          <Detail label="Alternative email" value={application.alternativeEmail} />
          <Detail label="Alternative phone" value={application.alternativePhone} ltr />
          <Detail label="Applying as" value={sellerType(application)} />
          <Detail label="Experience" value={`${application.experienceYears} years`} />
          <Detail label="Preferred styles" value={application.styles.join(", ")} />
          <Detail label="Production capacity" value={application.productionCapabilities && `${application.productionCapabilities} dresses per month`} />
          <Detail label="Takes custom orders" value={application.customOrders ? "Yes" : "No"} />
          <Detail label="Open to events and collaborations" value={application.eventCollaborations ? "Yes" : "No"} />
          <div>
            <dt className="text-xs text-muted-foreground">Portfolio link</dt>
            <dd className="mt-0.5 break-words text-[13px]">
              {portfolioLink ? (
                <a href={portfolioLink} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{portfolioLink}</a>
              ) : (
                application.portfolioLink || <span className="text-subtle">Not given</span>
              )}
            </dd>
          </div>
          <Detail label="About" value={application.bio} wide />
          <Detail label="References and testimonials" value={application.testimonials} wide />
        </dl>
      </section>

      <section className="rounded-[14px] bg-card p-4">
        <p className="text-sm font-semibold text-heading">Portfolio and work samples</p>
        {application.portfolio.length === 0 && <p className="mt-3 text-xs text-subtle">No portfolio files were uploaded.</p>}
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
        <p className="text-sm font-semibold text-heading">Identity verification</p>
        <div className="mt-3 flex flex-wrap gap-6">
          <Upload label={application.licensedStore ? "Store licence" : "ID document"} file={application.idDocument} onView={setViewing} />
          <Upload label="Selfie" file={application.selfie} onView={setViewing} />
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
      <p className="text-xs font-medium">Reject the application from {name}?</p>
      {loading && <p className="text-xs text-subtle">Loading the reasons…</p>}
      {!loading && reasons.length > 0 && (
        <div className="block text-xs text-muted-foreground">
          <span id="reject-reason-label">Reason</span>
          <Select value={picked || undefined} onValueChange={setPicked}>
            <SelectTrigger className="mt-1 bg-card text-foreground" aria-labelledby="reject-reason-label">
              <SelectValue placeholder="Choose a reason…" />
            </SelectTrigger>
            <SelectContent position="popper">
              {reasons.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {!loading && (
        <label className="block text-xs text-muted-foreground">
          {mustType ? "Reason in your own words" : "More detail (optional)"}
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={3}
            placeholder={mustType ? "Type the reason for rejecting this application" : "Anything to add to the reason"}
            className="mt-1 text-foreground"
          />
        </label>
      )}
      <div className="flex items-center gap-2">
        <button className={dark} disabled={busy || loading || !canSubmitRejection(reason, message)} onClick={() => onReject(reason, message)}>
          {busy ? "Rejecting…" : "Reject application"}
        </button>
        <button className={light} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function Detail({ label, value, ltr, wide }: { label: string; value: string; ltr?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-[13px]" dir={ltr ? "ltr" : undefined}>
        {value || <span className="text-subtle">Not given</span>}
      </dd>
    </div>
  );
}

function Upload({ label, file, onView }: { label: string; file: UploadedFile | null; onView: (file: UploadedFile) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      {!file && <p className="text-xs text-subtle">Not uploaded</p>}
      {file && (file.isImage ? <FileTile file={file} onView={onView} /> : <FileLink file={file} />)}
    </div>
  );
}

/** A picture thumbnail that opens larger in the page. Falls back to a link if it will not load as a picture. */
export function FileTile({ file, onView }: { file: UploadedFile; onView: (file: UploadedFile) => void }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <FileLink file={file} />;
  return (
    <button onClick={() => onView(file)} title={`View ${file.name}`} className="block overflow-hidden rounded-lg border border-border hover:opacity-90">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={file.url} alt={file.name} loading="lazy" onError={() => setBroken(true)} className="size-36 bg-muted object-cover" />
    </button>
  );
}

function FileLink({ file }: { file: UploadedFile }) {
  return (
    <a href={file.url} target="_blank" rel="noopener noreferrer" className="break-all text-[13px] underline">
      Open {file.name || "file"}
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
        <a href={file.url} target="_blank" rel="noopener noreferrer" className={light}>Open in a new tab</a>
        <button className={light} onClick={onClose} autoFocus>Close</button>
      </div>
    </div>
  );
}
