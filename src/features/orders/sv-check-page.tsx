"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, CircleHelp, Clock, Copy, ShieldAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { SelectField, TextField } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { useDocRow, useQueryRows } from "@/lib/firestore-ui";
import { formatDate, toNumber } from "@/lib/format";
import { tx } from "@/lib/i18n/tx";
import type { StatusTone } from "@/lib/status";
import { codeOf } from "@/lib/store-valley/codes";
import { inventoryDocId, storeValleyInventoryCollection } from "@/lib/store-valley/inventory";
import { useCodeLookup } from "@/lib/use-codes";
import { useRoleScope } from "@/lib/use-role-scope";
import { cn } from "@/lib/utils";
import { statusLabel, text, type Dict } from "./model";
import { Fact, Section } from "./parts";
import {
  CHECK_LABEL,
  ENVIRONMENT_LABEL,
  FALLBACK_WEBHOOK_URL,
  TESTS,
  WRONG_LOCATION_KEY,
  canCancelDelivery,
  checksFor,
  defaultTestData,
  evidenceOf,
  mergeTestData,
  nextRunLabel,
  overall,
  publicFields,
  reachedEnd,
  readRecord,
  recordFor,
  referenceOf,
  removableOf,
  runsOf,
  selftestChecks,
  startBlock,
  testDataProblem,
  testDef,
  wrongLocationReference,
  type Check,
  type CheckState,
  type Environment,
  type ReturnType,
  type SelftestResult,
  type SvEvent,
  type TestAddress,
  type TestData,
  type TestDef,
  type TestRecord,
} from "./sv-check";
import { askNow, cancelTestDelivery, latestDeliveries, loadEvents, lookUp, readStockNow, refreshStockCopy, removeTestRecords, runConnectionChecks, runWrongLocation, sendSignedTestUpdate, startTest, type ConnectionResult, type LookupHit } from "./sv-check-data";

const SAVED_DATA = "azyaa.sv-check.test-data";
const message = (error: unknown) => (error instanceof Error ? error.message : tx("unknown error"));
const when = (date: Date | null) => (date ? formatDate(date, true) : "");

const ENVIRONMENT_TONE: Record<Environment, StatusTone> = { staging: "info", production: "danger", unknown: "warning" };
const CHECK_TONE: Record<CheckState, StatusTone> = { pass: "success", waiting: "warning", fail: "danger", unknown: "neutral" };
const CHECK_ICON = { pass: CheckCircle2, waiting: Clock, fail: XCircle, unknown: CircleHelp };
const CHECK_COLOUR: Record<CheckState, string> = { pass: "text-emerald-600", waiting: "text-amber-600", fail: "text-destructive", unknown: "text-muted-foreground" };

function copy(value: string) {
  navigator.clipboard.writeText(value).then(
    () => toast.success(tx("Copied.")),
    () => toast.error(tx("Copying is blocked in this browser. Select the text and copy it by hand.")),
  );
}

function Ltr({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" lang="en" className="break-all">
      {children}
    </bdi>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button variant="outline" size="sm" className="bg-card" onClick={() => copy(value)} aria-label={label}>
      <Copy /> {tx("Copy")}
    </Button>
  );
}

function CheckList({ checks }: { checks: Check[] }) {
  if (!checks.length) return null;
  return (
    <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
      {checks.map((check) => {
        const Icon = CHECK_ICON[check.state];
        return (
          <li key={check.label} className="flex items-start gap-2 text-[13px]">
            <Icon className={cn("mt-0.5 size-4 shrink-0", CHECK_COLOUR[check.state])} aria-hidden />
            <span className="min-w-0">
              <span className="text-foreground">{check.label}</span>
              <span className="text-muted-foreground"> · {tx(CHECK_LABEL[check.state])}</span>
              {check.detail ? <span className="block text-[12px] break-words text-muted-foreground">{check.detail}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Notice({ tone, children }: { tone: "danger" | "warning" | "info"; children: ReactNode }) {
  const style = tone === "danger" ? "bg-tint-danger text-destructive" : tone === "warning" ? "bg-tint-warning text-foreground" : "bg-tint-info text-foreground";
  return <p className={cn("rounded-lg px-3 py-2 text-[12px]", style)}>{children}</p>;
}

/** `store-valley-check`: proves the link to Store Valley works and runs the five staging tests Store Valley asked for. */
export function SvCheckPage() {
  const scope = useRoleScope();
  if (!scope.isSuperAdmin) {
    return <EmptyState icon={ShieldAlert} title={tx("Only a super admin can open the Store Valley check")} description={tx("This page creates real requests at the delivery company. Ask a super admin when a delivery needs checking.")} />;
  }
  return <CheckView email={scope.email} who={scope.email || scope.uid} />;
}

function CheckView({ email, who }: { email: string; who: string }) {
  const defaults = useMemo(() => defaultTestData(email), [email]);
  const [data, setData] = useState<TestData>(defaults);
  const [connection, setConnection] = useState<ConnectionResult | null>(null);
  const [stock, setStock] = useState<{ quantity: number | null; at: Date } | null>(null);
  const [events, setEvents] = useState<Record<string, SvEvent[]>>({});
  const [picked, setPicked] = useState<string | null>(null);

  // The test data is a per-browser convenience: the page works the same when storage is empty or blocked.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SAVED_DATA);
      if (saved) setData(mergeTestData(JSON.parse(saved), defaults));
    } catch {
      /* nothing saved, or storage is blocked */
    }
  }, [defaults]);
  const changeData = useCallback((next: TestData) => {
    setData(next);
    try {
      window.localStorage.setItem(SAVED_DATA, JSON.stringify({ ...next, notifyEmail: "" }));
    } catch {
      /* storage is blocked: the change lasts until the page is closed */
    }
  }, []);

  // Which system is connected decides whether test requests may be created at all, so it is
  // checked when the page opens; Start stays off until the answer is in.
  useEffect(() => {
    let live = true;
    void runConnectionChecks(defaults).then((result) => live && setConnection((current) => current ?? result));
    return () => {
      live = false;
    };
  }, [defaults]);

  const stored = useQueryRows("logistics_response", { where: [["selftest", "==", true]], limit: 300 });
  const records = useMemo(() => stored.rows.map((row) => readRecord({ id: row.id, data: row.data as Dict })), [stored.rows]);
  const runs = useMemo(() => runsOf(records), [records]);
  const firstRun = useMemo(() => nextRunLabel(new Date(), []), []);
  const run = picked ?? runs[0] ?? firstRun;
  const runOptions = [...new Set([run, ...runs])].map((value) => ({ value, label: value }));

  const environment: Environment = connection?.installed ? connection.diagnostics.environment : "unknown";
  const installed = connection?.installed === true;

  const refreshStock = useCallback(async () => {
    const quantity = await readStockNow(data);
    setStock({ quantity, at: new Date() });
    return quantity;
  }, [data]);

  const refreshEvents = useCallback(
    async (record: TestRecord) => {
      if (!installed) return;
      try {
        const list = await loadEvents(record);
        setEvents((current) => ({ ...current, [record.docId]: list }));
      } catch {
        /* the timeline is extra evidence; the checks work without it */
      }
    },
    [installed],
  );

  const ownIds = useMemo(() => records.filter((record) => record.run === run).flatMap((record) => [record.trackingId, record.deliveryOrderId]).filter(Boolean), [records, run]);
  const delivery = recordFor(records, run, "t2_delivery");
  const dataProblem = testDataProblem(data);

  return (
    <div className="space-y-3">
      <PageHeader description={tx("Check that the link to Store Valley works, and run the five staging tests Store Valley asked for. Every test request is real on the system shown below.")} />
      <ConnectionSection data={data} connection={connection} onResult={setConnection} />
      <StockSection data={data} stock={stock} onRead={refreshStock} />

      <Section
        title={tx("The five staging tests")}
        description={tx("Run them in order, one at a time: each compares the warehouse stock with what it was when that test started.")}
        actions={
          <>
            <SelectField className="w-32" value={run} onChange={setPicked} options={runOptions} />
            <Button variant="outline" size="sm" className="bg-card" onClick={() => setPicked(nextRunLabel(new Date(), [...runs, run]))}>
              {tx("Start a new run")}
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">{tx("Run")}</span>
          <span className="font-medium text-foreground">
            <Ltr>{run}</Ltr>
          </span>
          <StatusBadge label={tx(ENVIRONMENT_LABEL[environment])} tone={ENVIRONMENT_TONE[environment]} />
          {stored.error ? <span className="text-destructive">{tx("The test records could not be read: {reason}", { reason: stored.error })}</span> : null}
        </div>
        {!connection ? <p className="mt-2 text-[12px] text-muted-foreground">{tx("Checking which Store Valley system is connected…")}</p> : environment === "unknown" ? <p className="mt-2 text-[12px] text-muted-foreground">{tx("Which Store Valley system is connected could not be determined. Every Start asks you to confirm.")}</p> : null}
        <TestDataBlock data={data} defaults={defaults} onChange={changeData} problem={dataProblem} />
      </Section>

      {TESTS.map((def) => (
        <TestCard
          key={`${run}-${def.key}`}
          def={def}
          run={run}
          data={data}
          who={who}
          environment={environment}
          checking={!connection}
          record={recordFor(records, run, def.key)}
          wrongLocation={def.key === "t5_return" ? recordFor(records, run, WRONG_LOCATION_KEY) : undefined}
          delivery={def.key === "t5_return" ? delivery : undefined}
          deliveryEvents={delivery ? events[delivery.docId] : undefined}
          events={events}
          ownIds={ownIds}
          stockNow={stock?.quantity ?? null}
          dataProblem={dataProblem}
          onStock={refreshStock}
          onEvents={refreshEvents}
        />
      ))}

      <ToolsSection records={records} runs={runs} run={run} />
    </div>
  );
}

/* ---------- 1. connection ---------- */

function ConnectionSection({ data, connection, onResult }: { data: TestData; connection: ConnectionResult | null; onResult: (result: ConnectionResult) => void }) {
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [selftest, setSelftest] = useState<SelftestResult | null>(null);

  async function run() {
    setBusy(true);
    try {
      onResult(await runConnectionChecks(data));
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setSending(true);
    try {
      setSelftest(await sendSignedTestUpdate());
    } catch (error) {
      toast.error(tx("The test update was not sent: {reason}", { reason: message(error) }));
    } finally {
      setSending(false);
    }
  }

  const diagnostics = connection?.installed ? connection.diagnostics : null;
  const address = diagnostics?.webhookUrl || FALLBACK_WEBHOOK_URL;
  const reach = connection ? (connection.installed ? connection.diagnostics.reachable : connection.reachable) : null;
  const environment: Environment = diagnostics?.environment ?? "unknown";

  return (
    <Section
      title={tx("Connection")}
      description={tx("Is the key set, does Store Valley answer, and do its updates reach Azyaa?")}
      actions={
        <Button size="sm" disabled={busy} onClick={() => void run()}>
          {busy ? tx("Checking…") : tx("Run checks")}
        </Button>
      }
    >
      {!connection ? (
        <p className="text-[13px] text-muted-foreground">{tx("Checking…")}</p>
      ) : (
        <div className="grid gap-x-8 md:grid-cols-2">
          <div>
            <Fact label={tx("Connected to")}>
              <StatusBadge label={tx(ENVIRONMENT_LABEL[environment])} tone={ENVIRONMENT_TONE[environment]} />
            </Fact>
            {diagnostics?.baseHost ? (
              <Fact label={tx("Store Valley address")} ltr>
                {diagnostics.baseHost}
              </Fact>
            ) : null}
            <Fact label={tx("Store Valley answers")}>
              {reach ? (
                <StatusBadge label={reach.ok ? tx("Yes ({status}, {ms} ms)", { status: reach.status, ms: reach.ms }) : tx("No ({status})", { status: reach.status })} tone={reach.ok ? "success" : "danger"} />
              ) : (
                <StatusBadge label={tx("Not reached")} tone="danger" />
              )}
            </Fact>
            {diagnostics ? (
              <>
                <Fact label={tx("Store Valley key")}>
                  <StatusBadge label={diagnostics.apiKeySet ? tx("Set") : tx("Missing")} tone={diagnostics.apiKeySet ? "success" : "danger"} />
                </Fact>
                <Fact label={tx("Secret for signing updates")}>
                  <StatusBadge label={diagnostics.webhookSecretSet ? tx("Set") : tx("Missing")} tone={diagnostics.webhookSecretSet ? "success" : "danger"} />
                </Fact>
              </>
            ) : null}
          </div>
          <div>
            {diagnostics ? (
              <>
                <Fact label={tx("Last update from Store Valley")}>{diagnostics.lastWebhook ? `${statusLabel(diagnostics.lastWebhook.status) || diagnostics.lastWebhook.eventType} · ${when(diagnostics.lastWebhook.receivedAt) || "—"}` : tx("None received yet")}</Fact>
                <Fact label={tx("Last test update")}>{diagnostics.lastSelftest ? when(diagnostics.lastSelftest.receivedAt) || "—" : tx("None sent yet")}</Fact>
                <Fact label={tx("Delivery requests waiting")}>{tx("{queued} queued, {processing} running, {failed} failed", { queued: diagnostics.jobs.queued, processing: diagnostics.jobs.processing, failed: diagnostics.jobs.failed })}</Fact>
                <Fact label={tx("Delivery requests sent")}>{tx("{requested} sent, {cancelled} cancelled", { requested: diagnostics.jobs.requested, cancelled: diagnostics.jobs.cancelled })}</Fact>
              </>
            ) : null}
          </div>
        </div>
      )}

      {connection && !connection.installed ? (
        <div className="mt-3 space-y-2">
          <Notice tone="warning">
            {connection.reason} — {tx("Without it this page cannot tell which Store Valley system is connected, and cannot prove that updates arrive. The key and the answer from Store Valley above were checked another way.")}
          </Notice>
          {connection.error ? <Notice tone="danger">{connection.error}</Notice> : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[13px]">
        <span className="text-muted-foreground">{tx("Address Store Valley sends updates to")}</span>
        <span className="min-w-0 flex-1 basis-60 text-foreground">
          <Ltr>{address}</Ltr>
        </span>
        <CopyButton value={address} label={tx("Copy the update address")} />
        <Button variant="outline" size="sm" className="bg-card" disabled={sending || !diagnostics} onClick={() => void send()}>
          {sending ? tx("Sending…") : tx("Send a signed test update")}
        </Button>
      </div>
      {!diagnostics && connection ? <p className="mt-1 text-[12px] text-muted-foreground">{tx("The signed test update needs the check program.")}</p> : null}
      {selftest ? <CheckList checks={selftestChecks(selftest)} /> : null}
      {diagnostics?.recentWebhooks.length ? (
        <details className="mt-3 text-[12px]">
          <summary className="cursor-pointer text-muted-foreground">{tx("Latest updates received ({count})", { count: diagnostics.recentWebhooks.length })}</summary>
          <EventList events={diagnostics.recentWebhooks} />
        </details>
      ) : null}
    </Section>
  );
}

function EventList({ events }: { events: SvEvent[] }) {
  return (
    <ul className="mt-2 space-y-1 text-[12px] text-muted-foreground">
      {events.map((event) => (
        <li key={event.eventId} className="flex flex-wrap gap-x-2">
          <span className="tabular-nums">{when(event.receivedAt) || "—"}</span>
          <span className="text-foreground">{statusLabel(event.status) || event.eventType}</span>
          {event.resourceId ? <Ltr>{event.resourceId}</Ltr> : null}
          {event.selftest ? <span>{tx("(test update)")}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/* ---------- 2. stock ---------- */

function StockSection({ data, stock, onRead }: { data: TestData; stock: { quantity: number | null; at: Date } | null; onRead: () => Promise<number | null> }) {
  const [reading, setReading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const cacheId = data.productId.trim() && data.warehouseId.trim() ? inventoryDocId(data.productId.trim(), data.warehouseId.trim()) : null;
  const cache = useDocRow(storeValleyInventoryCollection, cacheId);
  const cached = cache.row ? toNumber(cache.row.data.stored_quantity) : null;

  async function read() {
    setReading(true);
    try {
      await onRead();
    } catch (error) {
      toast.error(message(error));
    } finally {
      setReading(false);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      const result = await refreshStockCopy(data);
      toast.success(tx("Stock copy refreshed: {count} lines.", { count: toNumber(result.upserted) ?? 0 }));
    } catch (error) {
      toast.error(tx("The stock copy was not refreshed: {reason}", { reason: message(error) }));
    } finally {
      setSyncing(false);
    }
  }

  const differs = stock != null && stock.quantity != null && cached != null && stock.quantity !== cached;
  return (
    <Section
      title={tx("Stock of the test product")}
      description={tx("What Store Valley holds now, beside the copy the panel keeps.")}
      actions={
        <>
          <Button variant="outline" size="sm" className="bg-card" disabled={syncing} onClick={() => void sync()}>
            {syncing ? tx("Refreshing…") : tx("Refresh stock copy")}
          </Button>
          <Button size="sm" disabled={reading} onClick={() => void read()}>
            {reading ? tx("Reading…") : tx("Read stock now")}
          </Button>
        </>
      }
    >
      <div className="grid gap-x-8 md:grid-cols-2">
        <div>
          <Fact label={tx("Product")} ltr>
            {data.productId || "—"} · {data.sku || "—"}
          </Fact>
          <Fact label={tx("Warehouse")} ltr>
            {data.warehouseId || "—"}
          </Fact>
        </div>
        <div>
          <Fact label={tx("Store Valley says")}>{stock == null ? tx("Not read yet") : stock.quantity == null ? tx("Store Valley has no stock line for this product") : tx("{count} units · read {when}", { count: stock.quantity, when: when(stock.at) })}</Fact>
          <Fact label={tx("The panel's copy")}>{cache.loading ? "…" : cached == null ? tx("No copy yet") : tx("{count} units · updated {when}", { count: cached, when: formatDate(cache.row?.data.updated_at, true) || "—" })}</Fact>
        </div>
      </div>
      {differs ? <Notice tone="warning">{tx("The copy differs from Store Valley. It catches up when an update arrives, or press “Refresh stock copy”.")}</Notice> : null}
    </Section>
  );
}

/* ---------- 3. the tests ---------- */

function AddressFields({ title, value, onChange }: { title: string; value: TestAddress; onChange: (next: TestAddress) => void }) {
  const set = (key: keyof TestAddress) => (next: string) => onChange({ ...value, [key]: next });
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="mb-1 text-[12px] font-medium text-foreground">{title}</legend>
      <TextField label={tx("Contact name")} value={value.name} onChange={set("name")} />
      <TextField label={tx("Phone")} value={value.phone} onChange={set("phone")} dir="ltr" />
      <TextField label={tx("Street")} value={value.street} onChange={set("street")} />
      <TextField label={tx("City")} value={value.city} onChange={set("city")} />
      <TextField label={tx("Latitude")} value={value.latitude} onChange={set("latitude")} dir="ltr" />
      <TextField label={tx("Longitude")} value={value.longitude} onChange={set("longitude")} dir="ltr" />
    </fieldset>
  );
}

function TestDataBlock({ data, defaults, onChange, problem }: { data: TestData; defaults: TestData; onChange: (next: TestData) => void; problem: string | null }) {
  const set = (key: "designerId" | "productId" | "sku" | "warehouseId" | "packaging" | "notifyEmail") => (next: string) => onChange({ ...data, [key]: next });
  return (
    <details className="mt-3 rounded-lg border border-border p-3" open={Boolean(problem)}>
      <summary className="cursor-pointer text-[13px] font-medium text-foreground">{tx("Test data")}</summary>
      <p className="mt-1 text-[12px] text-muted-foreground">{tx("The defaults are Store Valley's own test designer, product and sample addresses. Codes are emailed only to the address below, so no customer or designer is contacted.")}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <TextField label={tx("Store Valley designer ID")} value={data.designerId} onChange={set("designerId")} dir="ltr" />
        <TextField label={tx("Product ID")} value={data.productId} onChange={set("productId")} dir="ltr" />
        <TextField label={tx("SKU")} value={data.sku} onChange={set("sku")} dir="ltr" />
        <TextField label={tx("Warehouse ID")} value={data.warehouseId} onChange={set("warehouseId")} dir="ltr" />
        <TextField label={tx("Packaging code")} value={data.packaging} onChange={set("packaging")} dir="ltr" />
        <TextField label={tx("Send codes to")} type="email" value={data.notifyEmail} onChange={set("notifyEmail")} dir="ltr" />
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <AddressFields title={tx("Designer pickup address")} value={data.pickup} onChange={(pickup) => onChange({ ...data, pickup })} />
        <AddressFields title={tx("Customer address")} value={data.customer} onChange={(customer) => onChange({ ...data, customer })} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" className="bg-card" onClick={() => onChange(defaults)}>
          {tx("Back to the defaults")}
        </Button>
        {problem ? <span className="text-[12px] text-destructive">{problem}</span> : null}
      </div>
    </details>
  );
}

type CardProps = {
  def: TestDef;
  run: string;
  data: TestData;
  who: string;
  environment: Environment;
  /** True until the first connection check has answered. */
  checking: boolean;
  record?: TestRecord;
  wrongLocation?: TestRecord;
  /** Test 5 only: the record of test 2, whose unit is returned. */
  delivery?: TestRecord;
  deliveryEvents?: SvEvent[];
  events: Record<string, SvEvent[]>;
  ownIds: string[];
  stockNow: number | null;
  dataProblem: string | null;
  onStock: () => Promise<number | null>;
  onEvents: (record: TestRecord) => Promise<void>;
};

function TestCard({ def, run, data, who, environment, checking, record, wrongLocation, delivery, deliveryEvents, events, ownIds, stockNow, dataProblem, onStock, onEvents }: CardProps) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState("");
  const [returnType, setReturnType] = useState<ReturnType>("return");
  const isReturn = def.key === "t5_return";
  const own = record ? events[record.docId] : undefined;
  // The code is kept by the back office and fetched here; a record made before that change still holds it.
  const codeIds = record ? [record.trackingId, record.deliveryOrderId] : [];
  const lookup = useCodeLookup(codeIds, Boolean(record) && !record?.code);
  // What Store Valley's answer carried when this card created the request, until the fetched one arrives.
  const [madeCode, setMadeCode] = useState("");
  const code = record ? codeOf(record.code, codeIds, lookup.codes) || madeCode : "";
  const evidence = evidenceOf(record, own);
  const checks = checksFor(def.key, { record, events: own, stockNow, wrongLocation, ownDeliveryIds: ownIds });
  const verdict = overall(checks);

  const deliveryDef = testDef("t2_delivery");
  const delivered = Boolean(delivery && deliveryDef && reachedEnd(deliveryDef, evidenceOf(delivery, deliveryEvents)));
  const blocked = checking ? tx("Checking which Store Valley system is connected…") : startBlock(environment);
  const needs = isReturn && !delivered ? tx("Test 2 must be delivered first: this test returns that unit.") : null;
  const cannotStart = blocked ?? dataProblem ?? needs;

  async function guarded(name: string, work: () => Promise<void>) {
    setBusy(name);
    try {
      await work();
    } catch (error) {
      toast.error(message(error), { duration: 20000 });
    } finally {
      setBusy("");
    }
  }

  const system = tx(ENVIRONMENT_LABEL[environment]);
  const unknownWarning = environment === "unknown" ? ` ${tx("Which Store Valley system is connected is not known. On the real system this sends a real driver. Run the connection checks first if you are not sure.")}` : "";

  async function start() {
    const cancellable = def.key === "t2_delivery";
    const sure = await confirm({
      title: tx("Start test {number}: {title}?", { number: def.number, title: tx(def.title) }),
      description:
        (cancellable
          ? tx("A real request is created on {system} under {reference}. It can be cancelled here until the driver collects it.", { system, reference: referenceOf(run, def.key) })
          : tx("A real request is created on {system} under {reference}. Only Store Valley can cancel it.", { system, reference: referenceOf(run, def.key) })) + unknownWarning,
      confirmLabel: tx("Create the request"),
      cancelLabel: tx("Cancel"),
    });
    if (!sure) return;
    await guarded("start", async () => {
      const source = isReturn && delivery ? { sourceOrderId: delivery.trackingId, originalSource: delivery.originalSource, returnType } : undefined;
      const done = await startTest({ key: def.key, run, data, startedBy: who, source });
      setMadeCode(done.code.trim());
      toast.success(done.reused ? tx("Store Valley already had {reference}; it is now recorded here.", { reference: referenceOf(run, def.key) }) : tx("Request created. Store Valley ID {id}.", { id: done.trackingId }));
      await onStock().catch(() => null);
    });
  }

  async function wrongStep() {
    if (!delivery) return;
    const sure = await confirm({
      title: tx("Send a return to the wrong location?"),
      description: tx("Store Valley is asked to return the unit of test 2 to a location it did not come from, under {reference}. It should refuse. If it accepts, a real return exists and only Store Valley can cancel it.", { reference: wrongLocationReference(run) }) + unknownWarning,
      confirmLabel: tx("Send it"),
      cancelLabel: tx("Cancel"),
    });
    if (!sure) return;
    await guarded("wrong", async () => {
      const answer = await runWrongLocation({ run, data, sourceOrderId: delivery.trackingId, startedBy: who });
      if (answer.status >= 400 && answer.status < 500) toast.success(tx("Store Valley refused it, as it should ({status}).", { status: answer.status }));
      else toast.warning(tx("Store Valley answered {status}. See the result on the card.", { status: answer.status }));
    });
  }

  async function ask() {
    if (!record) return;
    await guarded("ask", async () => {
      const result = await askNow(record);
      await Promise.all([onStock().catch(() => null), onEvents(record)]);
      toast.success(tx("Store Valley says: {status}", { status: statusLabel(result.status) || "—" }));
    });
  }

  async function cancel() {
    if (!record) return;
    const sure = await confirm({
      title: tx("Cancel this test delivery at Store Valley?"),
      description: tx("Store Valley is told to cancel {reference}. This works only until the driver has collected the unit.", { reference: record.reference }),
      confirmLabel: tx("Cancel the delivery"),
      cancelLabel: tx("Keep it"),
      destructive: true,
    });
    if (!sure) return;
    await guarded("cancel", async () => {
      await cancelTestDelivery(record);
      toast.success(tx("The test delivery was cancelled."));
    });
  }

  const wrongDone = wrongLocation?.resultStatus != null;
  return (
    <Section
      title={`${def.number}. ${tx(def.title)}`}
      description={tx(def.summary)}
      actions={record || (isReturn && wrongDone) ? <StatusBadge label={tx(CHECK_LABEL[verdict])} tone={CHECK_TONE[verdict]} /> : <StatusBadge label={tx("Not started")} tone="neutral" />}
    >
      {isReturn ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-medium text-foreground">{tx("Step A")}</span>
          <span className="min-w-0 flex-1 basis-60 text-muted-foreground">{tx("Ask for a return to the wrong location. Store Valley must refuse it.")}</span>
          <Button variant="outline" size="sm" className="bg-card" disabled={Boolean(busy) || Boolean(cannotStart) || wrongDone} onClick={() => void wrongStep()}>
            {busy === "wrong" ? tx("Sending…") : wrongDone ? tx("Step A done") : tx("Run step A")}
          </Button>
        </div>
      ) : null}

      {!record ? (
        <div className="flex flex-wrap items-end gap-3">
          {isReturn ? (
            <SelectField
              className="w-44"
              label={tx("Step B: kind of return")}
              value={returnType}
              onChange={(next) => setReturnType(next === "exchange" ? "exchange" : "return")}
              options={[
                { value: "return", label: tx("Return") },
                { value: "exchange", label: tx("Exchange") },
              ]}
            />
          ) : null}
          <Button disabled={Boolean(busy) || Boolean(cannotStart)} onClick={() => void start()}>
            {busy === "start" ? tx("Creating…") : isReturn ? tx("Start step B") : tx("Start test {number}", { number: def.number })}
          </Button>
          <span className="text-[12px] text-muted-foreground">
            {tx("Reference")}: <Ltr>{referenceOf(run, def.key)}</Ltr>
          </span>
        </div>
      ) : (
        <>
          <div className="grid gap-x-8 md:grid-cols-2">
            <div>
              <Fact label={tx("Reference")} ltr>
                {record.reference}
              </Fact>
              <Fact label={tx("Store Valley ID")} ltr>
                {record.trackingId || "—"}
              </Fact>
              <Fact label={tx("Started")}>{when(record.startedAt) || "—"}</Fact>
              <Fact label={tx("Stock at the start")}>{record.baseline == null ? "—" : String(record.baseline)}</Fact>
            </div>
            <div>
              <Fact label={tx("Store Valley says")}>{record.polledStatus ? `${statusLabel(record.polledStatus)}${record.deliveryStatus ? ` · ${tx("delivery: {status}", { status: statusLabel(record.deliveryStatus) })}` : ""} · ${when(record.polledAt)}` : tx("Not asked yet")}</Fact>
              <Fact label={tx("Update received")}>{record.status ? `${statusLabel(record.status)} · ${when(record.updatedAt) || "—"}` : tx("None yet")}</Fact>
              <Fact label={tx("Code check")}>{evidence.otpVerified ? tx("Verified") : evidence.otpFailedAttempts ? tx("{count} wrong attempts so far", { count: evidence.otpFailedAttempts }) : tx("Not reported yet")}</Fact>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[13px]">
            <span className="text-muted-foreground">{tx("Code")}</span>
            {code ? (
              <>
                <span className="text-base font-semibold tracking-widest text-foreground tabular-nums">
                  <Ltr>{code}</Ltr>
                </span>
                <CopyButton value={code} label={tx("Copy the code")} />
                <span className="min-w-0 flex-1 basis-60 text-[12px] text-muted-foreground">{tx(def.codeFor)}</span>
              </>
            ) : (
              <span className="text-[12px] text-muted-foreground">
                {lookup.loading
                  ? tx("Loading the code…")
                  : record.hasCode
                    ? tx("A code was sent for this request, but it could not be loaded here. Check the email it was sent to.")
                    : tx("No code is held here: the request already existed at Store Valley, or the code was not returned.")}
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={Boolean(busy)} onClick={() => void ask()}>
              {busy === "ask" ? tx("Asking…") : tx("Ask Store Valley now")}
            </Button>
            {def.key === "t2_delivery" && canCancelDelivery(evidence) ? (
              <Button variant="outline" size="sm" className="bg-card" disabled={Boolean(busy)} onClick={() => void cancel()}>
                {busy === "cancel" ? tx("Cancelling…") : tx("Cancel the delivery")}
              </Button>
            ) : null}
            <span className="text-[12px] text-muted-foreground">{tx("“Update received” starts as Store Valley's first answer and changes only when Store Valley sends an update.")}</span>
          </div>

          {own?.length ? (
            <details className="mt-2 text-[12px]">
              <summary className="cursor-pointer text-muted-foreground">{tx("Updates received for this test ({count})", { count: own.length })}</summary>
              <EventList events={own} />
            </details>
          ) : null}
        </>
      )}

      {!record && cannotStart ? <p className="mt-2 text-[12px] text-destructive">{cannotStart}</p> : null}
      <CheckList checks={checks} />
    </Section>
  );
}

/* ---------- 4. tools ---------- */

function ToolsSection({ records, runs, run }: { records: TestRecord[]; runs: string[]; run: string }) {
  const confirm = useConfirm();
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState("");
  const [hits, setHits] = useState<LookupHit[] | null>(null);
  const [latest, setLatest] = useState<Dict[] | null>(null);
  const [chosen, setChosen] = useState("");
  const removeRun = chosen || (runs.includes(run) ? run : (runs[0] ?? ""));

  async function guarded(name: string, work: () => Promise<void>) {
    setBusy(name);
    try {
      await work();
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    const list = removableOf(records, removeRun);
    if (!list.length) return;
    const sure = await confirm({
      title: tx("Remove the test records of run {run}?", { run: removeRun }),
      description: tx("{count} records are deleted from the panel, with their codes. Nothing is cancelled at Store Valley: requests it still holds stay open there.", { count: list.length }),
      confirmLabel: tx("Remove records"),
      cancelLabel: tx("Cancel"),
      destructive: true,
    });
    if (!sure) return;
    await guarded("remove", async () => {
      const removed = await removeTestRecords(list);
      setChosen("");
      toast.success(tx("{count} test records removed.", { count: removed }));
    });
  }

  return (
    <Section title={tx("Tools")} description={tx("Look a request up at Store Valley, list its latest deliveries, and clear the panel's test records.")}>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!term.trim()) return;
          void guarded("lookup", async () => setHits(await lookUp(term)));
        }}
      >
        <TextField className="min-w-0 flex-1 basis-60" label={tx("Reference or Store Valley ID")} value={term} onChange={setTerm} dir="ltr" />
        <Button type="submit" variant="outline" className="bg-card" disabled={Boolean(busy) || !term.trim()}>
          {busy === "lookup" ? tx("Looking…") : tx("Look up")}
        </Button>
        <Button type="button" variant="outline" className="bg-card" disabled={Boolean(busy)} onClick={() => void guarded("latest", async () => setLatest(await latestDeliveries()))}>
          {busy === "latest" ? tx("Reading…") : tx("Latest 10 deliveries")}
        </Button>
      </form>

      {hits ? (
        hits.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted-foreground">{tx("Store Valley has nothing under that reference or ID.")}</p>
        ) : (
          hits.map((hit) => (
            <div key={hit.route} className="mt-3 rounded-lg border border-border p-3">
              <p className="text-[13px] font-medium text-foreground">{tx(hit.label)}</p>
              {publicFields(hit.answer.body).map((field) => (
                <Fact key={field.name} label={field.name} ltr>
                  {field.value}
                </Fact>
              ))}
            </div>
          ))
        )
      ) : null}

      {latest ? (
        latest.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted-foreground">{tx("Store Valley lists no deliveries.")}</p>
        ) : (
          <ul className="mt-3 space-y-1 text-[12px]">
            {latest.map((row, index) => (
              <li key={text(row.order_id) || text(row.id) || index} className="flex flex-wrap gap-x-3 border-t border-border pt-1 first:border-t-0">
                <Ltr>{text(row.order_id) || text(row.id) || "—"}</Ltr>
                <span className="text-muted-foreground">
                  <Ltr>{text(row.client_order_id) || "—"}</Ltr>
                </span>
                <span className="text-foreground">{statusLabel(row.status) || "—"}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <SelectField className="w-40" label={tx("Run to clear")} value={removeRun} onChange={setChosen} options={runs.map((value) => ({ value, label: value }))} placeholder={tx("No runs yet")} disabled={!runs.length} />
        <Button variant="outline" className="bg-card" disabled={Boolean(busy) || !removeRun} onClick={() => void remove()}>
          {busy === "remove" ? tx("Removing…") : tx("Remove test records")}
        </Button>
        <span className="min-w-0 flex-1 basis-60 text-[12px] text-muted-foreground">{tx("This only deletes the panel's own test records. It does not cancel anything at Store Valley.")}</span>
      </div>
    </Section>
  );
}
