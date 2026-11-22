"use client";

import Link from "next/link";
import { PackagePlus, Truck } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Two routes of the old admin have no screen of their own here, because the
 * work they did now happens somewhere else. Each says where.
 */

/** Stock records are created with the product, so there is no separate "add inventory" form. */
export function AddInventoryNoticePage() {
  return (
    <EmptyState
      icon={PackagePlus}
      title="Stock records are created with the product"
      description="Every ready-made product gets its stock record when it is added, so there is nothing to add here. To bring more stock in, raise a restock request."
      action={
        <span className="flex flex-wrap justify-center gap-2">
          <Link href="/inventory-pm" className={cn(buttonVariants({ variant: "outline" }))}>Stock list</Link>
          <Link href="/restock-request" className={cn(buttonVariants())}>Restock requests</Link>
        </span>
      }
    />
  );
}

/** Warehouse pickups are booked from a restock that is ready, not from a label form. */
export function ShippingLabelNoticePage() {
  return (
    <EmptyState
      icon={Truck}
      title="Pickups are booked from the restock itself"
      description="When a designer marks an accepted restock ready, they create the pickup request there: the warehouse sends a driver and issues the one-time code. No separate shipping label is made here."
      action={
        <span className="flex flex-wrap justify-center gap-2">
          <Link href="/restock-pickup" className={cn(buttonVariants())}>Ready to pick up</Link>
          <Link href="/inventory-timeline" className={cn(buttonVariants({ variant: "outline" }))}>Pickup tracking</Link>
        </span>
      }
    />
  );
}
