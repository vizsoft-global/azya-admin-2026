# Known gaps

- Nothing in this panel has been tried against live data: it is covered by unit tests, type-check, lint and a production build only.
- Database rules do not enforce roles. "A designer sees only their own records" is applied by the screens, not by the database.
- Store Valley (warehouse and delivery) requests are built and unit-tested but have not been sent from this panel; the vendor acceptance run has not happened.
- The Store Valley check page (`/store-valley-check`, super admin only; steps in `docs/store-valley-staging-tests.md`) was first used signed in on 25 Nov 2026: the connection check ran and test 1 (`AZT-1125A-INT`) was accepted by Store Valley. Tests 2 to 5, the cancel button, the tools and the "Count old codes" / "Move old codes" buttons have not been used for real; their requests, records and pass/fail rules are unit-tested.
- Delivery and pickup codes: the panel no longer saves a code on orders, returns, restock requests or its own Store Valley records (it writes `has_code`), and reads codes through the staff-only `storeValleyCode` function, falling back to the code an old record still holds. Release order: back office first (private code store and `storeValleyCode`), then this panel, then moving the old codes out of the records, then the database rules. Released in another order, a screen can show "Code sent" without the code until the next step is out.
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
