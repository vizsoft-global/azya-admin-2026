"use client";

import { useId, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Field, type FieldProps } from "./fields";

export type ImageUploader = (file: File, folder: string) => Promise<string>;

/** Default uploader: Firebase Storage. Loaded on first use so the field itself carries no Firebase code. */
const uploadToStorage: ImageUploader = async (file, folder) => {
  const { uploadFile } = await import("@/lib/upload");
  return uploadFile(file, folder);
};

/**
 * Picks or drops one image, uploads it to Firebase Storage under `folder/` and
 * hands back the download URL. The value is always an absolute URL, because the
 * customer app renders these fields directly.
 */
export function ImageField({
  value,
  onChange,
  folder,
  accept = "image/*",
  maxSizeMb = 5,
  upload = uploadToStorage,
  ...field
}: FieldProps & {
  /** The image URL; `""` when there is none. */
  value: string;
  onChange: (url: string) => void;
  /** Storage folder, e.g. "banners" or "category". */
  folder: string;
  accept?: string;
  maxSizeMb?: number;
  /** Replace the upload, e.g. with a mock in the design preview. */
  upload?: ImageUploader;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const disabled = field.disabled || busy;

  async function handle(file: File | undefined) {
    if (!file || disabled) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file.");
      return;
    }
    if (file.size > maxSizeMb * 1024 * 1024) {
      toast.error(`That image is larger than ${maxSizeMb} MB. Choose a smaller one.`);
      return;
    }
    setBusy(true);
    const preview = URL.createObjectURL(file);
    setLocalPreview(preview);
    try {
      onChange(await upload(file, folder));
    } catch (err) {
      toast.error(`The image was not uploaded: ${err instanceof Error ? err.message : "the upload failed"}.`);
    } finally {
      URL.revokeObjectURL(preview);
      setLocalPreview(null);
      setBusy(false);
    }
  }

  const shown = localPreview || value;

  return (
    <Field {...field} htmlFor={id}>
      <div className="space-y-1.5">
        <div
          id={id}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || undefined}
          aria-label={shown ? "Replace image" : "Choose an image"}
          onClick={() => !disabled && picker.current?.click()}
          onKeyDown={(e) => {
            if (!disabled && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              picker.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handle(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "relative flex h-28 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed bg-muted transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
            dragging ? "border-primary" : "border-border",
            field.error && "border-destructive",
            field.disabled && "cursor-not-allowed opacity-50",
          )}
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="size-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-subtle">
              <ImagePlus className="size-5" />
              <span className="text-[11px]">Drop an image or click to browse</span>
            </div>
          )}
          {busy ? (
            <div className="absolute inset-0 flex items-center justify-center bg-card/70">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}
        </div>
        {value && !disabled ? (
          <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground" onClick={() => onChange("")}>
            <X className="size-3" /> Remove
          </Button>
        ) : null}
        <input
          ref={picker}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void handle(file);
          }}
        />
      </div>
    </Field>
  );
}
