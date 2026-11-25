# Known gaps

- Nothing in this panel has been tried against live data: it is covered by unit tests, type-check, lint and a production build only.
- Database rules do not enforce roles. "A designer sees only their own records" is applied by the screens, not by the database.
- Store Valley (warehouse and delivery) requests are built and unit-tested but have not been sent from this panel; the vendor acceptance run has not happened.
- The Store Valley check page (`/store-valley-check`, super admin only; steps in `docs/store-valley-staging-tests.md`) has not been opened signed in. Its requests, records and pass/fail rules are unit-tested; the five staging tests themselves have not been run. Until the `storeValleyDiagnostics` function is released the page cannot tell which Store Valley system is connected or show received updates, and it warns instead of locking.
- A failed delivery job cannot be cancelled from the browser (rules deny writes to `store_valley_delivery_jobs`), so releasing stock is refused while a failed warehouse job can still be retried by the server.
- There is no rule for what a designer is paid from a sale, so designer balances are not computed; creator balances follow the customer app's wallet formula.
- The customer app sells from `inventory.stock`. A restock the warehouse has stored is added to it with "Add to stock" (once per request); a super admin can also adjust it with a reason. Restocks completed before 22 Nov 2026 ask whether they were already counted.
- Approving a Return to Designer and the enquiry return shipment send a delivery request to Store Valley; neither has been sent from this panel yet.
- A pickup from a designer for a customer order cannot be cancelled from the panel.
- Push notifications cannot open a chosen page on tap until the cloud function sends `initialPageName`.
- A creator's commission is the product's `affiliate_commission_rate`; nothing is set when a creator is approved, and the app has no customer discount for creator links.
- The panel is translated with `tx()` (`src/lib/i18n`), about 3,300 Arabic texts; database values, IDs and CSV exports stay as stored. The Arabic was written without a native review.
- Delivery partner sign-in is not set up from here; the old plain-text `password` field is never read into a screen or written.
- Search on the lists covers the loaded rows only (Algolia keys are placeholders).
- Pictures are uploaded to Firebase Storage under the uploader's own folder and added to `images`; the old PHP upload endpoint is not used.
