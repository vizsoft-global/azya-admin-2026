import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirebase } from "./firebase";
import { tx } from "./i18n/tx";
import { uploadFile } from "./upload";

/** One picture of the media library (`images` collection). */
export type MediaItem = {
  /** Document id in `images`. */
  id: string;
  /** Public URL of the picture (`feature_image`). */
  url: string;
  /** Short id shown under the thumbnail (`image_id`). */
  imageId: string;
  name: string;
  /** Uid of the person who uploaded it (`image_uid`); designers see only their own. */
  uploaderUid: string;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function mediaItem(id: string, data: Record<string, unknown>): MediaItem {
  return { id, url: text(data.feature_image), imageId: text(data.image_id), name: text(data.image_name), uploaderUid: text(data.image_uid) };
}

/** A short id for a new picture, e.g. "IMG-lw3k9x2a-4f". */
export function newImageId(now: number, random: number) {
  return `IMG-${now.toString(36)}-${Math.floor(random * 1296).toString(36).padStart(2, "0")}`;
}

/** The `images` record for an uploaded picture, with the same fields the app and the old admin read. */
export function mediaRecord(input: { url: string; fileName: string; uid: string; imageId: string; now: unknown }): Record<string, unknown> {
  return {
    image_id: input.imageId,
    image_name: input.fileName,
    created_at: input.now,
    feature_image: input.url,
    image_alt_text: "",
    image_responsive_list: [],
    image_uid: input.uid,
  };
}

export const MEDIA_MAX_MB = 10;

/** Uploads one picture to the signed-in person's storage folder and adds it to the media library. */
export async function uploadMedia(file: File): Promise<MediaItem> {
  if (!file.type.startsWith("image/")) throw new Error(tx("{name} is not a picture.", { name: file.name }));
  if (file.size > MEDIA_MAX_MB * 1024 * 1024) throw new Error(tx("{name} is larger than {size} MB.", { name: file.name, size: MEDIA_MAX_MB }));
  const { auth, db } = getFirebase();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error(tx("Sign in again to upload a picture."));
  const url = await uploadFile(file, "media");
  const ref = doc(collection(db, "images"));
  const record = mediaRecord({ url, fileName: file.name, uid, imageId: newImageId(Date.now(), Math.random()), now: serverTimestamp() });
  await setDoc(ref, record);
  return mediaItem(ref.id, record);
}
