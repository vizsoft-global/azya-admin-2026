"use client";

import { useMemo, useState } from "react";
import { BellRing, Download, ImageIcon, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Field, TextField, TextareaField } from "@/components/shared/fields";
import { FilterSelect } from "@/components/shared/filter-select";
import { MediaPicker } from "@/components/shared/media-picker";
import { StatusBadge } from "@/components/shared/status-badge";
import { UserCell } from "@/components/shared/user-cell";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useQueryRows, type Row } from "@/lib/firestore-ui";
import { sendPushToUsers } from "@/lib/functions";
import { useUnsavedChanges } from "@/lib/unsaved";
import { useRoleScope } from "@/lib/use-role-scope";
import { Section, errorText, txOptions } from "./parts";
import {
  PUSH_BATCH_SIZE,
  PUSH_BODY_MAX,
  PUSH_TITLE_MAX,
  RECIPIENT_ROLES,
  chunk,
  failureKey,
  failureText,
  filterRecipients,
  mergeOutcomes,
  outcomeText,
  pushPayload,
  readPushResult,
  recipientFromUser,
  stoppedSend,
  stoppedSendText,
  validatePush,
  type PushErrors,
  type PushOutcome,
  type Recipient,
} from "./push-rules";
import { tx, txKey } from "@/lib/i18n/tx";

const ALL = "__all__";
/** Stored value of `users.user_role` → the group's name, plural for the filter and singular for the table. */
const ROLE_PLURAL: Record<string, string> = { Customer: txKey("Customers"), Designer: txKey("Designers"), Creator: txKey("Creators") };
const ROLE_SINGULAR: Record<string, string> = { Customer: txKey("Customer"), Designer: txKey("Designer"), Creator: txKey("Creator") };
const ROLE_OPTIONS = [{ value: ALL, label: txKey("Everyone") }, ...RECIPIENT_ROLES.map((role) => ({ value: role as string, label: ROLE_PLURAL[role] }))];

/** Keeps only what the picker shows, so whole customer records are not held in memory for a mailing list. */
function slim(row: Row): Row {
  const { user_role, display_name, user_name, email, status, designer_main_info, creator_main_info } = row.data;
  return { id: row.id, data: { user_role, display_name, user_name, email, status, designer_main_info, creator_main_info } };
}

type Report = { outcome: PushOutcome; people: Map<string, Recipient>; title: string };

/** Push notification to chosen people: pick recipients, write the message, send, and see who was not reached. */
export function SendNotificationPage() {
  const scope = useRoleScope();
  // A designer account sees only its own records, and the people list belongs to no designer.
  if (scope.isDesigner) return <EmptyState icon={BellRing} title={tx("Notifications are sent by the Azyaa team")} description={tx("Designer accounts cannot message customers from here.")} />;
  return <SendNotification />;
}

function SendNotification() {
  const confirm = useConfirm();
  const [role, setRole] = useState(ALL);
  const { rows, loading, error, hasMore, loadMore } = useQueryRows("users", { where: role === ALL ? [] : [["user_role", "==", role]], limit: 500 }, slim);
  const [term, setTerm] = useState("");
  // Chosen people stay chosen across filters, so their details are kept with the id.
  const [chosen, setChosen] = useState<Map<string, Recipient>>(new Map());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [picking, setPicking] = useState(false);
  const [errors, setErrors] = useState<PushErrors>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  /** Shown until the next send: what happened when a send stopped part-way. */
  const [stopped, setStopped] = useState("");
  const sending = progress !== null;
  useUnsavedChanges(Boolean(title.trim() || body.trim()) && !sending);

  const people = useMemo(() => rows.map((row) => recipientFromUser(row.id, row.data)), [rows]);
  const shown = useMemo(() => filterRecipients(people, "", term), [people, term]);
  const selectedIds = useMemo(() => new Set(chosen.keys()), [chosen]);

  function setSelection(ids: Set<string>) {
    setChosen((current) => {
      const next = new Map<string, Recipient>();
      for (const id of ids) {
        const person = current.get(id) ?? people.find((item) => item.id === id);
        if (person) next.set(id, person);
      }
      return next;
    });
    setErrors((current) => ({ ...current, recipients: undefined }));
  }

  const selectShown = () => setSelection(new Set([...selectedIds, ...shown.map((person) => person.id)]));

  async function send() {
    const found = validatePush({ title, body, imageUrl }, chosen.size);
    setErrors(found);
    if (Object.keys(found).length) return;
    const total = chosen.size;
    const ok = await confirm({
      title: total === 1 ? tx("Send this notification to 1 person?") : tx("Send this notification to {count} people?", { count: total.toLocaleString("en-US") }),
      description: tx("“{title}” appears on their phones straight away. A notification cannot be recalled once sent.", { title: title.trim() }),
      confirmLabel: tx("Send now"),
    });
    if (!ok) return;

    const recipients = new Map(chosen);
    const batches = chunk([...recipients.keys()], PUSH_BATCH_SIZE);
    const outcomes: PushOutcome[] = [];
    setProgress({ done: 0, total });
    setReport(null);
    setStopped("");
    try {
      for (const ids of batches) {
        const result = await sendPushToUsers(pushPayload({ userIds: ids, title, body, imageUrl }));
        outcomes.push(readPushResult(result));
        setProgress((current) => (current ? { ...current, done: current.done + ids.length } : current));
      }
      const outcome = mergeOutcomes(outcomes);
      setReport({ outcome, people: recipients, title: title.trim() });
      if (outcome.sent.length) toast.success(outcomeText(outcome));
      else toast.error(outcomeText(outcome));
      setTitle("");
      setBody("");
      setImageUrl("");
      setChosen(new Map());
    } catch (err) {
      // Calls that completed are final: those people are taken out of the selection so a retry cannot send to them twice.
      const stop = stoppedSend(batches, outcomes);
      const outcome = mergeOutcomes(outcomes);
      if (outcome.sent.length || outcome.failed.length) setReport({ outcome, people: recipients, title: title.trim() });
      const keep = new Set(stop.remaining);
      setChosen(new Map([...recipients].filter(([id]) => keep.has(id))));
      const notice = stoppedSendText(stop, errorText(err));
      setStopped(notice);
      toast.error(notice, { duration: 15000 });
    } finally {
      setProgress(null);
    }
  }

  const columns: Column<Recipient>[] = [
    { key: "name", header: tx("Name"), cell: (person) => <UserCell name={person.name} email={person.email} fallbackId={person.id} />, sortable: true, sortValue: (person) => person.name || person.email },
    { key: "email", header: tx("Email"), cell: (person) => <span className="block max-w-56 truncate" dir="ltr" lang="en" title={person.email}>{person.email || "—"}</span>, sortable: true, sortValue: (person) => person.email },
    { key: "role", header: tx("Group"), cell: (person) => tx(ROLE_SINGULAR[person.role] ?? (person.role || "—")), sortable: true, sortValue: (person) => person.role },
    { key: "status", header: tx("Status"), cell: (person) => <StatusBadge value={person.status} />, sortable: true, sortValue: (person) => person.status },
  ];

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-2 lg:order-1">
        <DataTable
          rows={shown}
          columns={columns}
          loading={loading}
          error={error ? tx("The people could not be loaded: {error}", { error }) : null}
          emptyMessage={tx("Nobody in this group yet.")}
          search={term}
          onSearch={setTerm}
          searchPlaceholder={tx("Search by name or email")}
          toolbar={
            <>
              <FilterSelect value={role} onChange={setRole} options={txOptions(ROLE_OPTIONS)} ariaLabel={tx("Filter by group")} />
              <Button variant="outline" size="sm" disabled={!shown.length || sending} onClick={selectShown}>
                {tx("Select all {count}", { count: `${shown.length.toLocaleString("en-US")}${hasMore ? "+" : ""}` })}
              </Button>
              {chosen.size ? (
                <Button variant="ghost" size="sm" disabled={sending} onClick={() => setSelection(new Set())}>
                  <X /> {tx("Clear selection")}
                </Button>
              ) : null}
            </>
          }
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelection}
          pageSize={25}
          hasMore={hasMore}
          onLoadMore={loadMore}
          noun={tx("person")}
          nounPlural={tx("people")}
        />
        {hasMore ? <p className="px-1 text-[12px] text-subtle">{tx("Only the first {count} people are loaded. Use “Load more” before “Select all” to include the rest.", { count: people.length.toLocaleString("en-US") })}</p> : null}
      </div>

      <div className="space-y-4 lg:order-2">
        <Section title={tx("Message")} description={chosen.size === 1 ? tx("1 person selected.") : tx("{count} people selected.", { count: chosen.size.toLocaleString("en-US") })}>
          <div className="grid gap-4">
            {stopped ? <p role="alert" className="rounded-lg bg-tint-danger px-3 py-2 text-[12px] text-destructive">{stopped}</p> : null}
            {errors.recipients ? <p role="alert" className="text-[12px] text-destructive">{errors.recipients}</p> : null}
            <TextField label={tx("Title")} required value={title} onChange={(value) => { setTitle(value); setErrors((current) => ({ ...current, title: undefined })); }} maxLength={PUSH_TITLE_MAX} dir="auto" disabled={sending} error={errors.title} hint={tx("{count}/{max}. The first line people see.", { count: title.trim().length, max: PUSH_TITLE_MAX })} />
            <TextareaField label={tx("Message")} required value={body} onChange={(value) => { setBody(value); setErrors((current) => ({ ...current, body: undefined })); }} maxLength={PUSH_BODY_MAX} rows={4} dir="auto" disabled={sending} error={errors.body} hint={`${body.trim().length}/${PUSH_BODY_MAX}`} />
            <Field label={tx("Picture")} hint={tx("Optional. Shown inside the notification on phones that support it.")}>
              <div className="flex items-center gap-3">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt="" className="size-14 rounded-md bg-muted object-cover" />
                ) : (
                  <span className="grid size-14 place-items-center rounded-md bg-muted text-subtle"><ImageIcon className="size-5" aria-hidden /></span>
                )}
                <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => setPicking(true)}>
                  {imageUrl ? tx("Change") : tx("Choose picture")}
                </Button>
                {imageUrl ? (
                  <Button type="button" variant="ghost" size="sm" disabled={sending} onClick={() => setImageUrl("")}>
                    {tx("Remove")}
                  </Button>
                ) : null}
              </div>
            </Field>
            <TextField label={tx("Page to open on tap")} value={tx("Home")} onChange={() => undefined} disabled hint={tx("Fixed for now: the app does not yet read the page sent with a notification, so a tap always opens the home page.")} />
            <Button onClick={() => void send()} disabled={sending} className="w-full" size="lg">
              {sending ? <Spinner size="sm" className="text-current" /> : <Send className="rtl:-scale-x-100" />}
              {sending && progress ? tx("Sending… {done} of {total}", { done: progress.done.toLocaleString("en-US"), total: progress.total.toLocaleString("en-US") }) : tx("Send notification")}
            </Button>
          </div>
        </Section>
        {report ? <ReportCard report={report} onClose={() => setReport(null)} /> : null}
      </div>

      <MediaPicker open={picking} onOpenChange={setPicking} title={tx("Choose the notification picture")} onPick={(items) => items[0] && setImageUrl(items[0].url)} />
    </div>
  );
}

function ReportCard({ report, onClose }: { report: Report; onClose: () => void }) {
  const { outcome, people } = report;
  const failed = outcome.failed.map((item) => ({ ...item, person: people.get(item.userId) }));

  function download() {
    downloadCsv(
      "notification-not-reached",
      // The download stays in English, like every export.
      toCsv(["Name", "Email", "Reason"], failed.map((item) => [item.person?.name ?? item.userId, item.person?.email ?? "", failureKey(item.reason)])),
    );
  }

  return (
    <Section
      title={tx("Last send")}
      description={`“${report.title}”: ${outcomeText(outcome)}`}
      actions={
        <Button variant="ghost" size="icon-sm" aria-label={tx("Hide the last send")} onClick={onClose}>
          <X />
        </Button>
      }
    >
      {!failed.length ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><BellRing className="size-4" aria-hidden /> {tx("Everyone selected was reached.")}</p>
      ) : (
        <>
          <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {failed.slice(0, 100).map((item) => (
              <li key={item.userId} className="px-3 py-2">
                <p className="truncate text-[13px] font-medium text-foreground">{item.person?.name || item.person?.email || item.userId}</p>
                <p className="text-[12px] text-muted-foreground">{failureText(item.reason)}</p>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] text-subtle">{failed.length > 100 ? tx("Showing 100 of {count}.", { count: failed.length.toLocaleString("en-US") }) : tx("These people did not get the notification.")}</p>
            <Button variant="outline" size="sm" onClick={download}>
              <Download /> {tx("Download list")}
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}
