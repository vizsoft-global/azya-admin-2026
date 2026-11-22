"use client";

import { useMemo, useRef, useState } from "react";
import { Copy, ImageIcon, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { useMediaLibrary } from "@/components/shared/media-picker";
import { HeaderSearch, PageHeader } from "@/components/shared/page-header";
import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { removeDoc } from "@/lib/firestore-ui";
import { MEDIA_MAX_MB, uploadMedia, type MediaItem } from "@/lib/media";
import { useRoleScope } from "@/lib/use-role-scope";
import { canDeleteMedia, mediaLabel, searchMedia } from "./media-rules";
import { errorText } from "./parts";

/** The picture library: every picture used by banners, products and notifications. Designers see only their own. */
export function MediaPage() {
  const { allowed } = useAuth();
  const scope = useRoleScope();
  const confirm = useConfirm();
  const { items, loading, error, hasMore, loadMore } = useMediaLibrary(60);
  const [term, setTerm] = useState("");
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [viewing, setViewing] = useState<MediaItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => searchMedia(items, term), [items, term]);
  const mayUpload = allowed("media_add");
  const who = { mayEdit: allowed("media_edit"), isDesigner: scope.isDesigner, uid: scope.uid };

  async function upload(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    let done = 0;
    const failures: string[] = [];
    setUploading({ done, total: list.length });
    for (const file of list) {
      try {
        await uploadMedia(file);
        done += 1;
      } catch (err) {
        failures.push(`${file.name}: ${errorText(err)}`);
      }
      setUploading({ done: done + failures.length, total: list.length });
    }
    setUploading(null);
    if (fileInput.current) fileInput.current.value = "";
    if (done) toast.success(done === 1 ? "Picture added to the library." : `${done} pictures added to the library.`);
    if (failures.length) toast.error(`${failures.length === 1 ? "One picture was" : `${failures.length} pictures were`} not uploaded. ${failures.slice(0, 3).join("; ")}`);
  }

  async function copyLink(item: MediaItem) {
    try {
      await navigator.clipboard.writeText(item.url);
      toast.success("Link copied.");
    } catch {
      toast.error("The link could not be copied. Open the picture and copy its address from the browser.");
    }
  }

  async function remove(item: MediaItem) {
    const name = mediaLabel(item);
    const ok = await confirm({
      title: `Delete “${name}” from the library?`,
      description: "It can no longer be chosen for new banners or products. Places that already use it keep showing it. This cannot be undone.",
      confirmLabel: "Delete picture",
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeDoc("images", item.id);
      toast.success(`“${name}” deleted from the library.`);
      setViewing(null);
    } catch (err) {
      toast.error(`“${name}” was not deleted: ${errorText(err)}.`);
    }
  }

  return (
    <>
      <PageHeader
        center={<HeaderSearch value={term} onChange={setTerm} placeholder="Search by name or ID" ariaLabel="Search pictures" />}
        actions={
          mayUpload ? (
            <>
              <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event) => void upload(event.target.files)} />
              <Button disabled={uploading !== null} onClick={() => fileInput.current?.click()}>
                {uploading ? <Spinner size="sm" className="text-current" /> : <Upload />}
                {uploading ? `Uploading ${uploading.done} of ${uploading.total}` : "Upload pictures"}
              </Button>
            </>
          ) : null
        }
      />
      {error ? (
        <EmptyState icon={ImageIcon} title="The pictures could not be loaded" description={`${error} Reload the page to try again.`} />
      ) : loading && !items.length ? (
        <PageLoading label="Loading pictures…" />
      ) : !shown.length ? (
        <EmptyState
          icon={ImageIcon}
          title={term ? "No pictures match your search" : "The library is empty"}
          description={term ? "Try a different name or ID." : mayUpload ? `Upload pictures to use them in banners, products and notifications. Up to ${MEDIA_MAX_MB} MB each.` : "Pictures uploaded by the team appear here."}
          action={term ? <Button variant="outline" onClick={() => setTerm("")}>Clear search</Button> : undefined}
        />
      ) : (
        <div className="rounded-[14px] bg-card p-3">
          <p className="mb-2 px-1 text-[12px] text-subtle">
            {shown.length.toLocaleString("en-US")}{hasMore && !term ? "+" : ""} {shown.length === 1 ? "picture" : "pictures"}, newest first
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {shown.map((item) => (
              <li key={item.id} className="min-w-0">
                <button type="button" onClick={() => setViewing(item)} className="block aspect-square w-full overflow-hidden rounded-lg border border-border bg-muted outline-none hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Open ${mediaLabel(item)}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt={item.name} loading="lazy" className="size-full object-cover" />
                </button>
                <div className="mt-1 flex items-center gap-1">
                  <p className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground" title={mediaLabel(item)}>{mediaLabel(item)}</p>
                  <Button variant="ghost" size="icon-xs" aria-label={`Copy the link of ${mediaLabel(item)}`} onClick={() => void copyLink(item)}>
                    <Copy />
                  </Button>
                  {canDeleteMedia(item, who) ? (
                    <Button variant="ghost" size="icon-xs" className="text-destructive" aria-label={`Delete ${mediaLabel(item)}`} onClick={() => void remove(item)}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {hasMore && !term ? (
            <div className="mt-3 flex justify-center">
              <Button variant="outline" size="sm" onClick={loadMore}>Load more</Button>
            </div>
          ) : null}
          {hasMore && term ? <p className="mt-3 px-1 text-[12px] text-subtle">Only the pictures loaded so far were searched. Clear the search and load more to look further back.</p> : null}
        </div>
      )}

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="sm:max-w-2xl">
          {viewing ? (
            <>
              <DialogHeader>
                <DialogTitle className="truncate">{mediaLabel(viewing)}</DialogTitle>
                <DialogDescription dir="ltr" lang="en">{viewing.imageId || viewing.id}</DialogDescription>
              </DialogHeader>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={viewing.url} alt={viewing.name} className="max-h-[60vh] w-full rounded-lg bg-muted object-contain" />
              <DialogFooter>
                {canDeleteMedia(viewing, who) ? (
                  <Button variant="destructive" className="sm:me-auto" onClick={() => void remove(viewing)}>
                    <Trash2 /> Delete
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => void copyLink(viewing)}>
                  <Copy /> Copy link
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
