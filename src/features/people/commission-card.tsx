"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "@/components/auth-provider";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { getFirebase } from "@/lib/firebase";
import { formatMoney } from "@/lib/format";
import { tx } from "@/lib/i18n/tx";
import { commissionSummary, productIdsToLookUp, promotedProducts, rateText, rateView, readProductRate, type ProductRate, type PromotedProduct } from "./commission";
import { Section } from "./parts";
import { errorText } from "./util";

/** Reads each promoted product once, for its current commission rate. Nothing is written. */
function useProductRates(ids: string[]) {
  const key = ids.join("|");
  const [state, setState] = useState<{ key: string; rates: Record<string, ProductRate>; error: string }>({ key: "", rates: {}, error: "" });

  useEffect(() => {
    if (!key) return;
    let stale = false;
    const wanted = key.split("|");
    Promise.all(wanted.map(async (id) => [id, readProductRate((await getDoc(doc(getFirebase().db, "products", id))).data())] as const))
      .then((entries) => {
        if (!stale) setState({ key, rates: Object.fromEntries(entries), error: "" });
      })
      .catch((err) => {
        if (!stale) setState({ key, rates: {}, error: errorText(err) });
      });
    return () => {
      stale = true;
    };
  }, [key]);

  const ready = state.key === key;
  return { rates: ready ? state.rates : {}, loading: key !== "" && !ready, error: ready ? state.error : "" };
}

/**
 * Commission for a creator, as the app really works: the rate is the one on
 * each product they promote, so this lists those products with their current
 * rate and links to the product editor where it is set. `applicant` is the
 * review of someone who is not a creator yet and so has no promotions.
 */
export function CommissionCard({ data, applicant = false }: { data: Record<string, unknown>; applicant?: boolean }) {
  const { allowed } = useAuth();
  const canOpenProduct = allowed("product");
  const rows = useMemo(() => promotedProducts(data), [data]);
  const ids = useMemo(() => productIdsToLookUp(rows), [rows]);
  const { rates, loading, error } = useProductRates(ids);
  const summary = commissionSummary(rows, rates);

  const explain = tx(
    "A creator earns the commission rate set on each product they promote. The app copies the product's rate when a customer adds it through the creator's link. There is no separate rate per creator, and customers get no discount for using a creator's link.",
  );

  if (applicant || rows.length === 0) {
    return (
      <Section title={tx("Commission")} description={explain}>
        <p className="text-[12px] text-muted-foreground">
          {applicant
            ? tx("Nothing is set at approval. Once approved, the creator earns from the rate on each product they promote; set those rates in the product editor.")
            : tx("This creator has no promoted products yet, so there are no rates to show.")}
        </p>
      </Section>
    );
  }

  const columns: Column<PromotedProduct>[] = [
    {
      key: "promotion",
      header: tx("Promotion"),
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-1">
          <span className="block max-w-56 truncate text-foreground" title={row.promotionLabel}>{row.promotionLabel || tx("Promotion")}</span>
          {row.promotionStatus ? <StatusBadge value={row.promotionStatus} className="w-fit" /> : null}
        </span>
      ),
      sortable: true,
      sortValue: (row) => row.promotionLabel,
      exportValue: (row) => row.promotionLabel,
    },
    {
      key: "product",
      header: tx("Product"),
      cell: (row) => {
        const name = row.productName || (row.productId ? rates[row.productId]?.name : "") || "";
        return name ? <span className="block max-w-64 truncate" title={name}>{name}</span> : <span className="text-subtle">{tx("Not named")}</span>;
      },
      sortable: true,
      sortValue: (row) => row.productName,
      exportValue: (row) => row.productName,
    },
    {
      key: "rate",
      header: tx("Commission rate"),
      cell: (row) => {
        const view = rateView(row, rates);
        if (view.state === "ok") return <span className="tabular-nums" dir="ltr">{rateText(view.rate as number)}</span>;
        if (view.state === "missing") return <StatusBadge tone="danger" label={tx("No rate: earns nothing")} />;
        if (view.state === "over") return <StatusBadge tone="danger" label={tx("{rate} is above 100%: earns nothing", { rate: rateText(view.rate as number) })} />;
        if (view.state === "gone") return <StatusBadge tone="warning" label={tx("Product no longer exists")} />;
        return <span className="text-subtle">{loading ? tx("Loading…") : tx("Not looked up")}</span>;
      },
      sortable: true,
      sortValue: (row) => rateView(row, rates).rate,
      exportValue: (row) => rateView(row, rates).rate,
    },
    {
      key: "sales",
      header: tx("Sales recorded"),
      className: "text-end whitespace-nowrap tabular-nums",
      cell: (row) => (row.sales === null ? <span className="text-subtle">{tx("Not recorded")}</span> : formatMoney(row.sales)),
      exportValue: (row) => row.sales,
    },
    {
      key: "earned",
      header: tx("Commission recorded"),
      className: "text-end whitespace-nowrap tabular-nums",
      cell: (row) => (row.earnings === null ? <span className="text-subtle">{tx("Not recorded")}</span> : formatMoney(row.earnings)),
      exportValue: (row) => row.earnings,
    },
    {
      key: "open",
      header: "",
      className: "text-end",
      cell: (row) =>
        canOpenProduct && row.productId && rateView(row, rates).state !== "gone" ? (
          <Link href={`/product-edit?id=${encodeURIComponent(row.productId)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {rateView(row, rates).state === "ok" ? tx("Open product") : tx("Set the rate")}
          </Link>
        ) : null,
    },
  ];

  return (
    <Section title={tx("Commission")} description={explain}>
      {summary.earningNothing > 0 ? (
        <p className="mb-3 rounded-lg bg-tint-warning p-3 text-[12px] text-foreground" role="status">
          {summary.earningNothing === 1
            ? tx("1 promoted product has no usable commission rate, so sales of it earn this creator nothing.")
            : tx("{count} promoted products have no usable commission rate, so sales of them earn this creator nothing.", { count: summary.earningNothing })}
        </p>
      ) : null}
      {error ? <p className="mb-3 text-[12px] text-destructive">{tx("The product rates could not be loaded: {error}", { error })}</p> : null}
      <DataTable rows={rows} columns={columns} pageSize={10} emptyMessage={tx("This creator has no promoted products yet.")} noun="product" exportName="creator-commission" />
    </Section>
  );
}
