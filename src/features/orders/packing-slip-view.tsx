"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { tx } from "@/lib/i18n/tx";
import { orderLinesInScope } from "@/lib/role-scope";
import { useRoleScope } from "@/lib/use-role-scope";
import { loadOptionNames } from "./data";
import type { Dict } from "./model";
import { packingSlip, type OptionNames, type PackingSlip } from "./packing-slip";

/*
 * Paper is black on white whatever theme the panel is in, so the slip sets its
 * own two colours instead of using theme tokens. On paper everything on the page
 * except the slip is hidden: the sidebar, the header, dialogs and toasts are all
 * other children of <body>. No page size is set, so the same slip prints on A4
 * and on a narrow label roll; the layout is one fluid column. The body rule is
 * written to outrank the scroll lock an open dialog puts on <body>, which would
 * otherwise cut a long slip off after the first page.
 */
const SLIP_CSS = `
.azyaa-slip { color: black; background: white; }
.azyaa-slip-print { display: none; }
@media print {
  @page { margin: 8mm; }
  html:root, html:root body, html:root body[data-scroll-locked] { background: white !important; height: auto !important; min-height: 0 !important; overflow: visible !important; position: static !important; margin: 0 !important; padding: 0 !important; }
  body > *:not(.azyaa-slip-print) { display: none !important; }
  .azyaa-slip-print { display: block !important; }
  .azyaa-slip { padding: 0 !important; max-width: none !important; }
  .azyaa-slip-row, .azyaa-slip-notes { break-inside: avoid; }
}
`;

/** "Packing slip" button for an order. `order` may be the scoped copy; the slip is scoped again either way. */
export function PackingSlipButton({ order }: { order: Dict }) {
  const scope = useRoleScope();
  const { lang } = useAuth();
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<OptionNames | undefined>();
  const slip = useMemo(() => packingSlip(order, scope, names), [order, scope, names]);
  const lineKeys = slip?.lines.map((line) => line.key).join(",") ?? "";

  // Option names are looked up once the slip is opened; until they arrive the stored ids show.
  useEffect(() => {
    if (!open) return;
    let live = true;
    loadOptionNames(orderLinesInScope<Dict>(scope, order), lang)
      .then((loaded) => live && setNames(loaded))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // The lines on the slip decide what to look up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lineKeys, lang]);

  // A designer whose items are all in the warehouse has nothing to pack.
  if (!slip || slip.lineCount === 0) return null;

  return (
    <>
      <Button variant="outline" size="sm" className="bg-card" onClick={() => setOpen(true)}>
        <Printer /> {tx("Packing slip")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tx("Packing slip")}</DialogTitle>
            <DialogDescription>
              {slip.audience === "designer" ? tx("Your items in this order, to pack for the courier. It has no customer details. Prints on A4 or a label roll.") : tx("The items and the delivery address, without prices. Prints on A4 or a label roll.")}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border">
            <SlipSheet slip={slip} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{tx("Close")}</Button>
            <Button onClick={() => window.print()}>
              <Printer /> {tx("Print")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="azyaa-slip-print">
              <style>{SLIP_CSS}</style>
              <SlipSheet slip={slip} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

const ltr = { dir: "ltr", lang: "en" } as const;

function SlipSheet({ slip }: { slip: PackingSlip }) {
  const to = slip.destination;
  return (
    <article className="azyaa-slip mx-auto w-full max-w-[190mm] p-4 text-[12px] leading-snug">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-current pb-2">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold">{tx("Packing slip")}</p>
          <p>
            {tx("Order")} <bdi {...ltr} className="font-semibold">{slip.orderNumber || "—"}</bdi>
          </p>
        </div>
        <div className="text-end">
          <p>{tx("Placed on {date}", { date: formatDate(slip.placed) || "—" })}</p>
          <p>{tx("Items: {items} · Lines: {lines}", { items: slip.itemCount, lines: slip.lineCount })}</p>
        </div>
      </header>

      <section className="mt-3">
        <p className="text-[11px] font-semibold tracking-wide uppercase">{to.heading}</p>
        {to.name ? <p className="text-[14px] font-semibold break-words">{to.name}</p> : null}
        {to.phone ? <p><bdi {...ltr}>{to.phone}</bdi></p> : null}
        {to.address.map((part, index) => (
          <p key={index} className="break-words">{part}</p>
        ))}
        {slip.tracking.length ? (
          <p className="mt-1">
            {tx("Tracking")} <bdi {...ltr} className="font-semibold break-all">{slip.tracking.join(", ")}</bdi>
          </p>
        ) : null}
        {to.note ? <p className={to.missing.length ? "mt-1 border border-current p-1 font-semibold" : "mt-1"}>{to.note}</p> : null}
      </section>

      <ul className="mt-3 border-t border-current">
        {slip.lines.map((line) => (
          <li key={line.key} className="azyaa-slip-row flex items-start gap-2 border-b border-dotted border-current py-2">
            <span aria-hidden className="mt-0.5 inline-block size-4 shrink-0 border border-current" />
            {line.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={line.image} alt="" className="size-10 shrink-0 object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="font-semibold break-words">{line.name}</p>
              <p>
                {tx(line.kind)}
                {line.sku ? (
                  <>
                    {" · SKU "}
                    <bdi {...ltr}>{line.sku}</bdi>
                  </>
                ) : null}
                {slip.audience === "staff" ? ` · ${line.from === "warehouse" ? tx("From the warehouse") : tx("Collected from the designer")}` : ""}
              </p>
              {line.options.length ? <p className="break-words">{line.options.join(" · ")}</p> : null}
              {line.measurements.length ? <p className="break-words">{line.measurements.join(" · ")}</p> : null}
            </div>
            <p className="shrink-0 text-end text-[14px] font-semibold">
              <span aria-hidden>× </span>
              <span className="sr-only">{tx("Quantity")} </span>
              {line.quantity}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-2 font-semibold">
        {tx("Total items to pack: {count}", { count: slip.itemCount })}
      </p>
      {slip.packedElsewhere ? (
        <p className="mt-1">
          {tx("Your items already in the warehouse and packed there: {count}.", { count: slip.packedElsewhere })}
        </p>
      ) : null}

      <section className="azyaa-slip-notes mt-4">
        <p className="text-[11px] font-semibold tracking-wide uppercase">{tx("Notes")}</p>
        <div className="h-6 border-b border-current" />
        <div className="h-6 border-b border-current" />
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
          <p className="min-w-32 flex-1 border-b border-current pb-4">{tx("Packed by")}</p>
          <p className="min-w-24 flex-1 border-b border-current pb-4">{tx("Date")}</p>
        </div>
      </section>
    </article>
  );
}
