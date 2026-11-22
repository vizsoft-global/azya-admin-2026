"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useQueryRows, type WhereClause } from "@/lib/firestore-ui";
import { mediaItem, uploadMedia, type MediaItem } from "@/lib/media";
import { useRoleScope } from "@/lib/use-role-scope";
import { tx } from "@/lib/i18n/tx";
import { cn } from "@/lib/utils";

/**
 * Live pictures of the media library, newest first. A designer gets only the
 * pictures they uploaded, as in the Flutter admin.
 */
export function useMediaLibrary(pageSize = 60) {
  const scope = useRoleScope();
  // A filter plus an order would need a new database index, so a designer's list is ordered in the browser.
  const where: WhereClause[] = scope.isDesigner ? [["image_uid", "==", scope.uid]] : [];
  const { rows, ...rest } = useQueryRows("images", scope.isDesigner ? { where, limit: pageSize } : { orderBy: ["created_at", "desc"], limit: pageSize });
  const items = useMemo(() => {
    const list = rows.map((row) => ({ item: mediaItem(row.id, row.data), at: Number((row.data.created_at as { seconds?: number } | undefined)?.seconds ?? 0) }));
    if (scope.isDesigner) list.sort((a, b) => b.at - a.at);
    return list.map((entry) => entry.item).filter((item) => item.url);
  }, [rows, scope.isDesigner]);
  return { items, ...rest };
}

export type MediaPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen pictures when the person confirms. */
  onPick: (items: MediaItem[]) => void;
  /** Allow choosing more than one picture. */
  multiple?: boolean;
  title?: string;
};

/** Dialog to choose pictures from the media library, or upload new ones into it. */
export function MediaPicker({ open, onOpenChange, onPick, multiple = false, title = tx("Choose a picture") }: MediaPickerProps) {
  const { items, loading, error, hasMore, loadMore } = useMediaLibrary();
  const [term, setTerm] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return needle ? items.filter((item) => `${item.name} ${item.imageId}`.toLowerCase().includes(needle)) : items;
  }, [items, term]);

  function toggle(id: string) {
    setChosen((current) => (multiple ? (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]) : current[0] === id ? [] : [id]));
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const added: string[] = [];
      for (const file of Array.from(files)) added.push((await uploadMedia(file)).id);
      setChosen((current) => (multiple ? [...current, ...added] : added.slice(-1)));
      toast.success(added.length === 1 ? tx("Picture uploaded.") : tx("{count} pictures uploaded.", { count: added.length }));
    } catch (err) {
      toast.error(tx("The upload failed: {reason}", { reason: err instanceof Error ? err.message : String(err) }));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function confirm() {
    onPick(chosen.map((id) => items.find((item) => item.id === id)).filter((item): item is MediaItem => Boolean(item)));
    setChosen([]);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{multiple ? tx("Select one or more pictures from the media library.") : tx("Select a picture from the media library.")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={tx("Search by name or ID")} className="min-w-0 flex-1" aria-label={tx("Search pictures")} />
          <input ref={fileInput} type="file" accept="image/*" multiple={multiple} hidden onChange={(e) => upload(e.target.files)} />
          <Button type="button" variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? <Spinner /> : <Upload />} {tx("Upload")}
          </Button>
        </div>
        <div className="max-h-[52vh] min-h-40 overflow-y-auto rounded-lg border border-border bg-muted/40 p-2">
          {error ? (
            <p className="p-4 text-sm text-destructive">{error}</p>
          ) : loading && !items.length ? (
            <div className="flex h-40 items-center justify-center"><Spinner /></div>
          ) : !shown.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{term ? tx("No pictures match your search.") : tx("The media library is empty. Upload a picture to start.")}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {shown.map((item) => {
                const on = chosen.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggle(item.id)}
                    aria-pressed={on}
                    title={item.name || item.imageId}
                    className={cn("group relative aspect-square overflow-hidden rounded-lg border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-primary ring-2 ring-primary" : "border-border hover:border-foreground/30")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt={item.name} loading="lazy" className="size-full object-cover" />
                    {on ? <span className="absolute end-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="size-3" /></span> : null}
                  </button>
                );
              })}
            </div>
          )}
          {hasMore && !term ? (
            <div className="mt-2 flex justify-center"><Button type="button" variant="outline" size="sm" onClick={loadMore}>{tx("Load more")}</Button></div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tx("Cancel")}</Button>
          <Button type="button" disabled={!chosen.length} onClick={confirm}>{multiple && chosen.length > 1 ? tx("Use {count} pictures", { count: chosen.length }) : tx("Use picture")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
