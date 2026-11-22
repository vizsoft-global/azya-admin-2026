import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebase } from "./firebase";

/** Keeps letters, digits, dot, dash and underscore; everything else becomes a dash. */
export function safeFileName(name: string) {
  const cleaned = name.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "file";
}

/**
 * Where an upload goes. Storage only lets a signed-in person write under their own
 * `users/<uid>/` folder, so every upload lands there, grouped by `folder`.
 */
export function uploadPath(uid: string, folder: string, fileName: string, now: number) {
  const group = folder.replace(/^\/+|\/+$/g, "");
  return `users/${uid}/${group ? `${group}/` : ""}${now}-${safeFileName(fileName)}`;
}

/** Uploads a file to Firebase Storage under the signed-in person's folder and returns its download URL. */
export async function uploadFile(file: File, folder: string) {
  const { auth, storage } = getFirebase();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Sign in again to upload a file.");
  const target = ref(storage, uploadPath(uid, folder, file.name, Date.now()));
  await uploadBytes(target, file, { contentType: file.type || undefined });
  return getDownloadURL(target);
}
