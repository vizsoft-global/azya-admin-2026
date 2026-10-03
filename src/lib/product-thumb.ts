export function productThumbUrl(
  featureImage?: string | null,
  galleryImage?: string[] | null,
) {
  const feature = (featureImage ?? "").trim();
  if (feature) return feature;
  for (const item of galleryImage ?? []) {
    const url = item.trim();
    if (url) return url;
  }
  return "";
}
