# Known gaps for the later page-by-page pass

- Product add/edit writes the same `products` document fields, but the FlutterFlow step builder (variations, attributes, translations) is the JSON document, not a stepped form.
- Live chat is the support user list plus `notification` records. The streamed chat thread UI is not rebuilt yet.
- Google Maps pickup-address picker is not on the profile page yet. PACI parsing from the Flutter address helper is ported and tested.
- Algolia user search keys are env placeholders. Lists read Firestore directly.
- Lists load the first 250 documents and filter in the browser so we do not add new Firestore indexes.
- `proxy.vizsoft.in` payment calls are wrapped in `src/lib/api.ts`. The admin still does not charge cards itself; payouts write `transactions`.
