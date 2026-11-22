"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { tx } from "@/lib/i18n/tx";

export type ConfirmOptions = {
  title: string;
  /** What will happen, and whether it can be undone. */
  description?: ReactNode;
  /** Label of the button that goes ahead. Name the action: "Delete", "Reject", "Turn off". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action. Use for deletes and anything irreversible. */
  destructive?: boolean;
};

export type ConfirmDialogProps = ConfirmOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Runs when the user confirms. While a returned promise is pending the dialog
   * stays open and locked; it closes when the promise resolves. If it rejects,
   * the error is shown as a toast and the dialog stays open.
   */
  onConfirm: () => void | Promise<void>;
  /** Extra content between the description and the buttons (e.g. a reason field). */
  children?: ReactNode;
  /** Disables the confirm button, e.g. until a required reason is typed. */
  confirmDisabled?: boolean;
};

/** Asks before a delete or any write that cannot be undone. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = tx("Confirm"),
  cancelLabel = tx("Cancel"),
  destructive,
  onConfirm,
  children,
  confirmDisabled,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tx("That did not work. Nothing was changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={busy || confirmDisabled} onClick={() => void confirm()}>
            {busy ? <Spinner size="sm" className="text-current" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/** Mounted once in the root layout; backs `useConfirm`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((answer: boolean) => void) | null>(null);

  const settle = useCallback((answer: boolean) => {
    resolver.current?.(answer);
    resolver.current = null;
    setOpen(false);
  }, []);

  const ask = useCallback<Ask>((next) => {
    // A second question while one is open answers the first with "no".
    resolver.current?.(false);
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const value = useMemo(() => ask, [ask]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        {...(options ?? { title: "" })}
        open={open}
        onOpenChange={(next) => !next && settle(false)}
        onConfirm={() => settle(true)}
      />
    </ConfirmContext.Provider>
  );
}

/**
 * Promise form of ConfirmDialog for handlers:
 * `if (!(await confirm({ title: "Delete this coupon?", destructive: true, confirmLabel: "Delete" }))) return;`
 */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("ConfirmProvider missing");
  return ask;
}
