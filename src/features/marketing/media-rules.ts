import { tx } from "@/lib/i18n/tx";
import type { MediaItem } from "@/lib/media";

/** Pictures whose name or short id contains the search term. */
export function searchMedia(items: MediaItem[], term: string): MediaItem[] {
  const needle = term.trim().toLowerCase();
  return needle ? items.filter((item) => `${item.name} ${item.imageId}`.toLowerCase().includes(needle)) : items;
}

/**
 * Who may remove a picture from the library: people with `media_edit`, and a
 * designer only for pictures they uploaded themselves.
 */
export function canDeleteMedia(item: MediaItem, who: { mayEdit: boolean; isDesigner: boolean; uid: string }) {
  if (!who.mayEdit) return false;
  return !who.isDesigner || (who.uid !== "" && item.uploaderUid === who.uid);
}

export function mediaLabel(item: MediaItem) {
  return item.name || item.imageId || tx("Picture");
}
