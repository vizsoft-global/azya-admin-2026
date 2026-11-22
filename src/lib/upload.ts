import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebase } from "./firebase";

/** Keeps letters, digits, dot, dash and underscore; everything else becomes a dash. */
export function safeFileName(name: string) {
  const cleaned = name.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "file";
}

/** Uploads a file to Firebase Storage under `folder/` and returns its download URL. */
export async function uploadFile(file: File, folder: string) {
  const path = `${folder.replace(/^\/+|\/+$/g, "")}/${Date.now()}-${safeFileName(file.name)}`;
  const target = ref(getFirebase().storage, path);
  await uploadBytes(target, file, { contentType: file.type || undefined });
  return getDownloadURL(target);
}
