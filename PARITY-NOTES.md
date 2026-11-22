# Known gaps

- Nothing in this panel has been tried against live data: it is covered by unit tests, type-check, lint and a production build only.
- Database rules do not enforce roles. "A designer sees only their own records" is applied by the screens, not by the database.
- Store Valley (warehouse and delivery) requests are built and unit-tested but have not been sent from this panel; the vendor acceptance run has not happened.
- A failed delivery job cannot be cancelled from the browser (rules deny writes to `store_valley_delivery_jobs`), so releasing stock is refused while a failed warehouse job can still be retried by the server.
- There is no rule for what a designer is paid from a sale, so designer balances are not computed; creator balances follow the customer app's wallet formula.
- A completed restock does not raise `inventory.stock`; the screens say so.
- Push notifications cannot open a chosen page on tap until the cloud function sends `initialPageName`.
- Delivery partner sign-in is not set up from here; the old plain-text `password` field is never read into a screen or written.
- Search on the lists covers the loaded rows only (Algolia keys are placeholders).
- Pictures are uploaded to Firebase Storage under the uploader's own folder and added to `images`; the old PHP upload endpoint is not used.
