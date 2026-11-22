"use client";

import {
  Timestamp,
  collection,
  doc,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { getFirebase } from "@/lib/firebase";
import { formatMoney } from "@/lib/format";
import { idMapRef, takeIds } from "@/lib/id-map";
import type { RoleScope } from "@/lib/role-scope";
import {
  COMPLETED_ORDER_STATUS,
  PAID_PAYMENT_STATUS,
  recordedPaid,
  round3,
  summariseCreator,
  summariseDesigner,
  toOrderFacts,
  toPartner,
  toPayoutFacts,
  toReturnFacts,
  type OrderFacts,
  type Partner,
  type PayoutFacts,
} from "./finance";
import { designerRecordLimit, nextPayoutStatus, payoutRecord, promotionsAfterPayout, salesHistoryPayoutUpdate, type PayoutAction } from "./payouts";

/* ---------- Who may see what ---------- */

/**
 * The money screens are for people with the `sales` permission (and the super
 * admin). A designer may open the sales and payout lists, limited to their own
 * records. This is a screen-level limit; database rules do not enforce it.
 */
export function useFinanceAccess() {
  const { allowed, scope } = useAuth();
  const staff = scope.isSuperAdmin || allowed("sales");
  return { scope, staff, designerOnly: !staff && scope.isDesigner };
}

/* ---------- One-shot loads with a short-lived cache ---------- */

type Loaded<T> = { value: T; at: number };
const cache = new Map<string, Loaded<unknown>>();
const MAX_AGE_MS = 60_000;

/**
 * Loads once and keeps the result for a minute, so moving between the finance
 * screens does not read the same orders again. `refresh` reads again now.
 */
function useLoaded<T>(key: string, load: () => Promise<T>) {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [tick, setTick] = useState(0);
  const forced = useRef(0);
  const [state, setState] = useState<{ key: string; value: T | null; at: number; loading: boolean; error: string }>(() => {
    const hit = key ? (cache.get(key) as Loaded<T> | undefined) : undefined;
    return { key, value: hit?.value ?? null, at: hit?.at ?? 0, loading: Boolean(key) && !hit, error: "" };
  });

  useEffect(() => {
    if (!key) {
      setState({ key, value: null, at: 0, loading: false, error: "" });
      return;
    }
    const hit = cache.get(key) as Loaded<T> | undefined;
    const force = forced.current !== tick;
    forced.current = tick;
    if (hit && !force && Date.now() - hit.at < MAX_AGE_MS) {
      setState({ key, value: hit.value, at: hit.at, loading: false, error: "" });
      return;
    }
    let live = true;
    setState({ key, value: hit?.value ?? null, at: hit?.at ?? 0, loading: true, error: "" });
    loadRef.current().then(
      (value) => {
        const at = Date.now();
        cache.set(key, { value, at });
        if (live) setState({ key, value, at, loading: false, error: "" });
      },
      (err: unknown) => {
        if (live) setState((cur) => ({ ...cur, key, loading: false, error: err instanceof Error ? err.message : "The data could not be loaded." }));
      },
    );
    return () => {
      live = false;
    };
  }, [key, tick]);

  const refresh = useCallback(() => setTick((cur) => cur + 1), []);
  // A result that belongs to another key (the key just changed) is not shown.
  const current = state.key === key ? state : { key, value: null, at: 0, loading: Boolean(key), error: "" };
  return { value: current.value, loadedAt: current.at ? new Date(current.at) : null, loading: current.loading, error: current.error, refresh };
}

/** Drops every cached load, so the next screen reads fresh data (after a payment is recorded). */
export function clearFinanceCache() {
  cache.clear();
}

/* ---------- Orders ---------- */

/**
 * Which orders to read. Every query is bounded by `cap`; when more exist the
 * result says so (`capped`) and the screens show it instead of truncating silently.
 * - `window`: newest first, optionally only from a date on (one field, no extra index).
 * - `completed`: every order with `order_status == "completed"`.
 * - `paid`: every order with `payment_status == "CAPTURED"`.
 */
export type OrdersQuery = { kind: "window"; fromMs: number | null; toMs: number | null; cap: number } | { kind: "completed"; cap: number } | { kind: "paid"; cap: number };

export type OrdersResult = { orders: OrderFacts[]; capped: boolean; cap: number };

export async function fetchOrders(spec: OrdersQuery): Promise<OrdersResult> {
  const { db } = getFirebase();
  const parts: QueryConstraint[] = [];
  if (spec.kind === "completed") parts.push(where("order_status", "==", COMPLETED_ORDER_STATUS));
  else if (spec.kind === "paid") parts.push(where("payment_status", "==", PAID_PAYMENT_STATUS));
  else {
    if (spec.fromMs != null) parts.push(where("created_at", ">=", Timestamp.fromMillis(spec.fromMs)));
    if (spec.toMs != null) parts.push(where("created_at", "<=", Timestamp.fromMillis(spec.toMs)));
    parts.push(orderBy("created_at", "desc"));
  }
  // One more than the cap, to know whether anything was left out.
  const snap = await getDocs(query(collection(db, "orders"), ...parts, limit(spec.cap + 1)));
  const orders = snap.docs.slice(0, spec.cap).map((item) => toOrderFacts(item.id, item.data()));
  return { orders, capped: snap.docs.length > spec.cap, cap: spec.cap };
}

export function useOrders(spec: OrdersQuery | null) {
  const key = spec ? `orders|${JSON.stringify(spec)}` : "";
  const loaded = useLoaded(key, () => fetchOrders(spec as OrdersQuery));
  return { orders: loaded.value?.orders ?? [], capped: loaded.value?.capped ?? false, cap: spec?.cap ?? 0, loading: loaded.loading, error: loaded.error, loadedAt: loaded.loadedAt, refresh: loaded.refresh };
}

/** Most orders the balance screens read. Past it, recording a payment is refused rather than risk a wrong balance. */
export const BALANCE_ORDER_CAP = 5000;

/* ---------- Creators and designers ---------- */

export const PARTNER_CAP = 2000;

async function fetchPartners(): Promise<{ partners: Partner[]; capped: boolean }> {
  const { db } = getFirebase();
  const snap = await getDocs(query(collection(db, "users"), where("user_role", "in", ["Creator", "Designer"]), limit(PARTNER_CAP + 1)));
  const partners: Partner[] = [];
  for (const item of snap.docs.slice(0, PARTNER_CAP)) {
    const partner = toPartner(item.id, item.data());
    if (partner) partners.push(partner);
  }
  return { partners, capped: snap.docs.length > PARTNER_CAP };
}

/** Creators and designers (name, ID, bank details, promotions). `enabled: false` reads nothing. */
export function usePartners(enabled = true) {
  const loaded = useLoaded(enabled ? "partners" : "", fetchPartners);
  return { partners: loaded.value?.partners ?? [], capped: loaded.value?.capped ?? false, loading: loaded.loading, error: loaded.error, refresh: loaded.refresh };
}

/* ---------- Return requests ---------- */

export const RETURNS_CAP = 1000;

/** Return requests made in a period, newest first. */
export function useReturns(fromMs: number, toMs: number) {
  const loaded = useLoaded(`returns|${fromMs}|${toMs}`, async () => {
    const source = query(
      collection(getFirebase().db, "return_requests"),
      where("created_at", ">=", Timestamp.fromMillis(fromMs)),
      where("created_at", "<=", Timestamp.fromMillis(toMs)),
      orderBy("created_at", "desc"),
      limit(RETURNS_CAP + 1),
    );
    const snap = await getDocs(source);
    return { returns: snap.docs.slice(0, RETURNS_CAP).map((item) => toReturnFacts(item.id, item.data())), capped: snap.docs.length > RETURNS_CAP };
  });
  return { returns: loaded.value?.returns ?? [], capped: loaded.value?.capped ?? false, loading: loaded.loading, error: loaded.error };
}

/* ---------- Counts ---------- */

/** Server-side count of a collection, optionally of the people following a designer. */
export function useCount(kind: "users" | "followers" | null, userDocId = "") {
  const key = kind === "followers" ? (userDocId ? `count|followers|${userDocId}` : "") : kind ? `count|${kind}` : "";
  const loaded = useLoaded(key, async () => {
    const { db } = getFirebase();
    const users = collection(db, "users");
    const source = kind === "followers" ? query(users, where("user_designer_following", "array-contains", doc(db, "users", userDocId))) : users;
    return (await getCountFromServer(source)).data().count;
  });
  return { count: loaded.value, loading: loaded.loading, error: loaded.error };
}

/* ---------- Payout records ---------- */

export const PAYOUT_PAGE = 300;

/**
 * Live payout records, newest first. A designer's list is filtered on the
 * server to their own records.
 */
export function usePayouts(options: { enabled?: boolean; onlyUserDocId?: string } = {}) {
  const enabled = options.enabled !== false;
  const only = options.onlyUserDocId ?? "";
  const [pages, setPages] = useState(1);
  const [state, setState] = useState<{ payouts: PayoutFacts[]; loading: boolean; error: string; more: boolean }>({ payouts: [], loading: enabled, error: "", more: false });

  useEffect(() => {
    if (!enabled) {
      setState({ payouts: [], loading: false, error: "", more: false });
      return;
    }
    const { db } = getFirebase();
    const max = PAYOUT_PAGE * pages;
    // Filter or order, not both, so no composite index is needed; the designer's own list is sorted here.
    const source = only
      ? query(collection(db, "transactions"), where("user_ref", "==", doc(db, "users", only)), limit(max + 1))
      : query(collection(db, "transactions"), orderBy("created_at", "desc"), limit(max + 1));
    setState((cur) => ({ ...cur, loading: true }));
    return onSnapshot(
      source,
      (snap) => {
        const payouts = snap.docs.slice(0, max).map((item) => toPayoutFacts(item.id, item.data()));
        payouts.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
        setState({ payouts, loading: false, error: "", more: snap.docs.length > max });
      },
      (err) => setState((cur) => ({ ...cur, loading: false, error: err.message })),
    );
  }, [enabled, only, pages]);

  return { ...state, pageSize: PAYOUT_PAGE * pages, loadMore: () => setPages((cur) => cur + 1) };
}

/** Most payout records the balance screens read at once. */
export const PAYOUT_CAP = 5000;

/** Every payout record (up to the cap), read once: for totals per person on the balance screens. */
export function useAllPayouts(enabled = true) {
  const loaded = useLoaded(enabled ? "payouts|all" : "", async () => {
    const snap = await getDocs(query(collection(getFirebase().db, "transactions"), limit(PAYOUT_CAP + 1)));
    return { payouts: snap.docs.slice(0, PAYOUT_CAP).map((item) => toPayoutFacts(item.id, item.data())), capped: snap.docs.length > PAYOUT_CAP };
  });
  return { payouts: loaded.value?.payouts ?? [], capped: loaded.value?.capped ?? false, loading: loaded.loading, error: loaded.error, refresh: loaded.refresh };
}

/* ---------- Writes ---------- */

export type RecordPayoutInput = {
  partnerDocId: string;
  amount: number;
  method: string;
  reference: string;
  paidAt: Date;
  note: string;
  recorder: RoleScope;
};

export type RecordPayoutResult = { id: string; transactionId: number; balanceAfter: number | null; name: string };

/**
 * Records a payment that was made outside the system. One transaction writes:
 * - a `transactions` record (and moves the `transaction_id` counter on);
 * - for a creator, `creator_main_info.creator_promotions` on their user
 *   record, so the balance in their app drops by the amount;
 * - `last_payout_date` / `last_payout_amount` at the top level of their
 *   `sales_history` record, when they have one.
 * The balance is worked out again from fresh orders and the fresh user record
 * inside the transaction; an amount above it is refused and nothing is written.
 */
export async function recordPayout(input: RecordPayoutInput): Promise<RecordPayoutResult> {
  const { db } = getFirebase();
  if (!input.recorder.userDocId) throw new Error("Your own user record was not found, so the payment cannot be attributed. Nothing was recorded.");
  const amount = round3(input.amount);
  const userRef = doc(db, "users", input.partnerDocId);
  const counterRef = await idMapRef();

  const completed = await fetchOrders({ kind: "completed", cap: BALANCE_ORDER_CAP });
  if (completed.capped) {
    throw new Error(`There are more than ${BALANCE_ORDER_CAP} completed orders, so the balance cannot be checked in the browser. Nothing was recorded.`);
  }
  const [salesSnap, paidSnap] = await Promise.all([
    getDocs(query(collection(db, "sales_history"), where("user_ref", "==", userRef), limit(1))),
    getDocs(query(collection(db, "transactions"), where("user_ref", "==", userRef))),
  ]);
  const salesRef = salesSnap.docs[0]?.ref ?? null;
  const earlier = paidSnap.docs.map((item) => toPayoutFacts(item.id, item.data()));
  const recordRef = doc(collection(db, "transactions"));
  const recorderRef = doc(db, "users", input.recorder.userDocId);

  return runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) throw new Error("This person's record no longer exists. Nothing was recorded.");
    const data = userSnap.data();
    const partner = toPartner(userSnap.id, data);
    if (!partner) throw new Error("This person is not a creator or a designer. Nothing was recorded.");

    let nextPromotions: Record<string, unknown>[] | null = null;
    let previousBalance: number | undefined;
    let currentBalance: number | undefined;

    if (partner.role === "creator") {
      const summary = summariseCreator(completed.orders, partner.docId, partner.promotions);
      if (amount > summary.payable) {
        throw new Error(`The payable balance is now ${formatMoney(summary.payable)}, less than the amount. Nothing was recorded.`);
      }
      const rawPromotions = (data.creator_main_info as Record<string, unknown> | undefined)?.creator_promotions;
      nextPromotions = promotionsAfterPayout(rawPromotions, summary.byPromotion, amount).promotions;
      previousBalance = summary.appBalance;
      currentBalance = round3(summary.appBalance - amount);
    } else {
      const sales = summariseDesigner(completed.orders, { docId: partner.docId, uid: partner.uid });
      const ceiling = designerRecordLimit(sales.completedSales, recordedPaid(earlier, partner.docId));
      if (amount > ceiling) {
        throw new Error(`The amount is more than this designer's delivered sales not yet recorded as paid (${formatMoney(ceiling)}). Nothing was recorded.`);
      }
    }

    const ids = await takeIds(tx, counterRef, ["transaction_id"] as const);
    const now = serverTimestamp();
    tx.set(
      recordRef,
      payoutRecord({
        now,
        transactionId: ids.transaction_id,
        role: partner.role,
        userRef,
        name: partner.name,
        email: partner.email,
        bank: partner.bank,
        amount,
        previousBalance,
        currentBalance,
        payment: { method: input.method, reference: input.reference, paidAt: input.paidAt, note: input.note },
        recorder: { userRef: recorderRef, name: input.recorder.displayName || input.recorder.email, role: input.recorder.userRole },
      }),
    );
    if (nextPromotions) tx.update(userRef, { "creator_main_info.creator_promotions": nextPromotions });
    if (salesRef) tx.update(salesRef, salesHistoryPayoutUpdate({ now, amount, paidAt: input.paidAt }));
    return { id: recordRef.id, transactionId: ids.transaction_id, balanceAfter: currentBalance ?? null, name: partner.name };
  }).then((result) => {
    clearFinanceCache();
    return result;
  });
}

/**
 * Mark as paid / Skip on a payout record that is yet to be paid. Changes that
 * record's `status` and nothing else: no balance, no wallet, no other record.
 */
export async function setPayoutStatus(recordId: string, action: PayoutAction): Promise<string> {
  const { db } = getFirebase();
  const ref = doc(db, "transactions", recordId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("This payout record no longer exists. Nothing was changed.");
    const next = nextPayoutStatus(String(snap.data().status ?? ""), action);
    if (!next) throw new Error("Only a record that is yet to be paid can be changed. Nothing was changed.");
    tx.update(ref, { status: next, updated_at: serverTimestamp() });
    return next;
  });
}
