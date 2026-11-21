/**
 * Share links, built exactly as the app builds them (`AzyLinks` in the app's
 * `lib/backend/links/azy_links.dart`).
 *
 * A link carries everything in its own path, so nothing is created or stored
 * on a server before it is shared:
 *
 *   https://azyaa-link.pages.dev/promo/{creatorUid}/{promotionId}
 *
 * The app opens this path directly, so the host, the path and the rule for
 * what an ID may contain must stay the same as in the app.
 */

export const LINK_HOST = "azyaa-link.pages.dev";

/** IDs are Firestore IDs and user IDs: letters, digits, dash and underscore. */
const LINK_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidLinkId(id: unknown): id is string {
  return typeof id === "string" && LINK_ID.test(id);
}

/**
 * The link that credits a creator for what a visitor buys from their
 * promotion. Null when either ID is missing or malformed, so a link that
 * cannot open is never stored.
 */
export function promoLink(creatorUid: unknown, promotionId: unknown): string | null {
  if (!isValidLinkId(creatorUid) || !isValidLinkId(promotionId)) return null;
  return `https://${LINK_HOST}/promo/${creatorUid}/${promotionId}`;
}
