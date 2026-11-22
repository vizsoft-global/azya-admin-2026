"use client";

import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type FormShellProps = {
  open: boolean;
  /** Called with `false` for Cancel, the close button, Escape and an outside click. */
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** The fields. Wrapped in a <form>, so Enter in an input submits. */
  children: ReactNode;
  /** Validate and save. The shell does not close itself: call `onOpenChange(false)` when the save succeeds. */
  onSubmit: () => void | Promise<void>;
  /** Disables both buttons and shows a spinner in the submit button. */
  submitting?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  /** Disables the submit button, e.g. while nothing has changed. */
  submitDisabled?: boolean;
  /** Extra footer content at the start side, e.g. a Delete button. */
  footerStart?: ReactNode;
  className?: string;
};

function submitHandler(onSubmit: () => void | Promise<void>) {
  return (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void onSubmit();
  };
}

function Buttons({ onOpenChange, submitting, submitLabel = "Save", cancelLabel = "Cancel", submitDisabled, footerStart }: FormShellProps) {
  return (
    <>
      {footerStart ? <div className="me-auto flex items-center gap-2">{footerStart}</div> : null}
      <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
        {cancelLabel}
      </Button>
      <Button type="submit" disabled={submitting || submitDisabled}>
        {submitting ? <Spinner size="sm" className="text-current" /> : null}
        {submitLabel}
      </Button>
    </>
  );
}

/** Short form in a centred dialog: a handful of fields, one decision. */
export function FormModal(props: FormShellProps & { size?: "sm" | "md" | "lg" }) {
  const { open, onOpenChange, title, description, children, onSubmit, submitting, size = "md", className } = props;
  const width = size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg";
  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className={cn(width, className)}>
        <form onSubmit={submitHandler(onSubmit)} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
          </DialogHeader>
          <div className="grid max-h-[65vh] gap-4 overflow-y-auto px-0.5 py-0.5">{children}</div>
          <DialogFooter>
            <Buttons {...props} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Longer form in a side sheet: a whole record, scrolls on its own, keeps the list visible behind it. */
export function FormSheet(props: FormShellProps & { wide?: boolean }) {
  const { open, onOpenChange, title, description, children, onSubmit, submitting, wide, className } = props;
  return (
    <Sheet open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <SheetContent className={cn("w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg", wide && "data-[side=right]:sm:max-w-2xl", className)}>
        <form onSubmit={submitHandler(onSubmit)} className="flex min-h-0 flex-1 flex-col" noValidate>
          <SheetHeader className="border-b border-border pe-12">
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : <SheetDescription className="sr-only">{title}</SheetDescription>}
          </SheetHeader>
          <div className="grid min-h-0 flex-1 auto-rows-min gap-4 overflow-y-auto p-4">{children}</div>
          <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/50 p-4">
            <Buttons {...props} />
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
