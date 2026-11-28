# Delivery with Store Valley: how it is set up today

Checked against the code and the live Firebase project on 25 November 2026.

## The short version

Azyaa does not deliver anything itself. A company called **Store Valley** stores the stock in its Kuwait warehouse, sends drivers, and hands parcels to customers. Azyaa tells Store Valley what to move, and Store Valley reports back what happened.

Today this link is built and switched on, but it points at Store Valley's **test system (staging)**, not their real one. That is the agreed stage of the project, not a fault: the two companies are still in joint testing. It has carried 4 test requests in total, the last on 15 September 2026. No real customer order has gone through it yet.

Websitek builds and runs Azyaa as the platform. Store Valley is the separate logistics company. The two teams coordinate in the "Azyaa logistics integration" WhatsApp group.

## Who does what

| Part | What it is | Its job in delivery |
|---|---|---|
| Customer app | The Azyaa phone app | Takes the order and payment. Shows the customer the order status. Never talks to Store Valley. |
| Admin panel | This panel (`azya-admin-2026`) | Staff watch the queue, retry failures, book pickups and returns by hand. |
| Back office | Small programs running on Firebase (project `azyaa-0uiv4k`) | The only part that holds the Store Valley password (API key). It sends every request and receives every update. |
| Store Valley | The delivery and warehouse company | Stores stock, collects from designers, delivers to customers, collects returns. |

The admin panel and the app never hold the Store Valley key. Everything goes through the back office.

## The five things Azyaa asks Store Valley to do

| # | Job | When it happens | Who starts it |
|---|---|---|---|
| 1 | **Warehouse delivery**: take an item from the warehouse to the customer | A paid order contains a ready-made item that is kept in the warehouse | Automatic |
| 2 | **Designer pickup and delivery**: collect an item from the designer and take it to the customer | A paid order contains a custom-made item, or a ready-made item the designer keeps, and the designer marks it "Ready to Pickup" | Automatic |
| 3 | **Restock (warehouse intake)**: collect new stock from a designer and put it in the warehouse | Staff approve a restock request and book the pickup | Staff, in Inventory > Restock |
| 4 | **Return to designer**: send warehouse stock back to its designer | Staff approve a "Return to Designer" request | Staff, in Inventory > Restock |
| 5 | **Customer return**: collect an item back from a customer | Staff accept a return request | Staff, in Order > Returns |

Staff can also do jobs 1 and 2 by hand from an order ("Request shipping") when the automatic route did not run.

Only a warehouse delivery (job 1) can be cancelled from Azyaa's side, and only before the driver has picked it up. Jobs 2 to 5 can only be cancelled by contacting Store Valley.

## What was agreed with Store Valley

Taken from the WhatsApp thread, 28 July to 11 September 2026.

| Topic | What was agreed | Does the code follow it? |
|---|---|---|
| Access | One key for Azyaa as the platform, not one per designer. The designer's id is sent on every request. | Yes |
| Delivery code | Azyaa makes the code and sends it to the customer. Store Valley checks what the driver types and reports pass or fail in its update. Store Valley never sends the code back or logs it. (5 August) | Yes |
| Code at every step | Codes are also used when collecting from a designer and when collecting a customer return, not only at final delivery. (meeting of 7 September) | Yes |
| New designers | Store Valley creates each designer by hand. Azyaa sends them the designer's details and gets back an id like `DSN-KWT-0001`, which staff put on the designer's profile. There is no automatic way. | By hand, as agreed |
| New products | Azyaa sends the product details and a unique SKU. Store Valley adds it to their catalogue by hand. Stock then enters through a restock request. | By hand, as agreed |
| Packaging | Azyaa supplies the branded packaging. Each request carries the code `AZY-PKG-STD-01`. | Yes |
| Proof | Final delivery: photo and signature. Designer pickup: signature, photo optional. Customer return pickup: condition photo and signature. | Photo and signature links are saved from Store Valley's updates |
| Exchange | Store Valley collects the original item. The replacement is a separate, new delivery request, raised only after the return passes checks. | Partly: staff record "Exchanged" on the return, and must raise the replacement delivery by hand |
| Designer takes unsold stock back | On the day of the first call Store Valley said this was "a separate workflow that we need to define". | **Not confirmed.** The panel sends it as a normal warehouse delivery to the designer's address. Ask Store Valley whether that is the agreed way. |
| Update address | Azyaa gave `https://us-central1-azyaa-0uiv4k.cloudfunctions.net/storeValleyWebhook` as its **staging** address. | See "One project for test and real" below |

Not part of this version on Store Valley's side: holding stock for an order, separate counts for reserved/damaged/returned stock, shipping labels, public tracking links, and cancelling anything other than a warehouse delivery. Azyaa holds stock for orders itself, in its own records.

### One project for test and real

Azyaa has one Firebase project, and it is the one real customers use. The same project was given to Store Valley as the staging address. So today the live system is the test receiver. On the day production starts, the key, the Store Valley address and the signing secret must all be switched together, and after that staging tests can no longer be run from the panel unless a second, separate setup is made.

### The five staging tests

Store Valley has asked for five tests before sign-off: warehouse intake, warehouse delivery, designer delivery, custom-made delivery, and warehouse return/exchange. The panel has a page for running them (Order > Shipping > Store Valley check). Steps are in [store-valley-staging-tests.md](store-valley-staging-tests.md).

## What happens to a paid order, step by step

1. The customer pays. The order's payment status becomes `CAPTURED`.
2. The back office **reserves stock** for the warehouse items, so the same unit cannot be sold twice. If there is not enough stock, the order is marked "stock failed" and stops here until staff retry.
3. The back office writes a **delivery job** (a to-do note) for each shipment the order needs: one for the warehouse items together, and one per designer for pickup items.
4. Each job is sent to Store Valley. First it asks "do you already have this one?" so a retry never books twice.
5. Store Valley answers with a **tracking number**. The back office saves it on the order and on a delivery record, and the reserved units are counted as shipped.
6. If Store Valley refuses or cannot be reached, the job is marked failed. A timer wakes up **every 5 minutes** and tries failed jobs again, up to **3 attempts**. After that it waits for staff to press Retry in Order > Shipping.
7. As the driver works, Store Valley sends **status updates** (assigned, out for delivery, delivered). The back office copies each one onto the order, which is what the customer sees in the app.

An order with both warehouse and designer items gets two shipments. It only shows "delivered" when both are finished.

## The delivery code (OTP)

Every delivery and pickup needs a 6-digit code as proof of handover.

- Azyaa's back office makes the code and sends it to the receiving person by email and app notification.
- Store Valley is given the code too. The driver types in what the customer tells them, and Store Valley only lets the delivery finish if it matches.
- For a restock pickup the code goes to the designer, who gives it to the driver.
- Staff can send a restock pickup code again from the request screen.
- **Where the code is kept:** in a private store that only the back office can read. It is not written on the order, the return, the restock request or Store Valley's answer; those only note that a code exists. Staff see a code in the panel, which asks the back office for it. A designer is given only the codes that were sent to them, and the customer's delivery code is shown only to a super admin. (This is the fix for item 2 under "What needs attention". It is written but not yet released; until it is, the codes are still on those records.)

## How Azyaa hears back

Store Valley calls one web address whenever something changes:

`https://us-central1-azyaa-0uiv4k.cloudfunctions.net/storeValleyWebhook`

Each call is signed with a shared secret. Unsigned or wrongly signed calls are rejected (checked on 25 November 2026: an unsigned call gets "401 Invalid signature"). Each update has an id, and a repeated id is ignored.

The updates cover three things: delivery progress, pickup/restock/return progress, and warehouse stock counts.

If an update is missed, staff can press **Refresh from warehouse** on a request, which asks Store Valley directly.

## Stock numbers

Store Valley is the source of truth for what is physically in the warehouse. Azyaa keeps a copy (one row per product) and updates it two ways: Store Valley pushes a change whenever stock moves, and staff can press a button in Inventory to pull the full list.

What Azyaa can sell from the warehouse = what Store Valley says is stored, minus units reserved for paid orders, minus units marked unavailable.

## Current settings

| Setting | Value today | Where it is set |
|---|---|---|
| Store Valley system in use | **Staging (test)** | Firebase function settings, `storevalley.base_url` |
| Address the back office calls | `https://us-central1-store-valley-websitek-staging.cloudfunctions.net/api/v1` | same |
| Store Valley password (API key) | Set (not shown here) | Firebase function settings, `storevalley.api_key` |
| Secret for signing status updates | Set (not shown here) | Firebase function settings, `storevalley.webhook_secret` |
| Warehouse | `WH-KWT-MAIN` | Fixed in the code |
| Pickup location for warehouse deliveries | `WH-KWT-MAIN` | Fixed in the code |
| Packaging type | `AZY-PKG-STD-01` | Fixed in the code |
| Designer used when a product has no Store Valley designer | `DSN-KWT-0001` (Store Valley's test designer) | Fixed in the code |
| Proof required on delivery | Code and photo, always | Fixed in the code |
| Automatic retries | 3 attempts, checked every 5 minutes | Fixed in the code |
| Store Valley integration package | Version 1.1.0-rc.5 (a release candidate) | Copy kept in the `Azyaa-Admin` repository |
| Where the back office runs | Google region `us-central1` | Firebase |

"Fixed in the code" means changing it needs a developer and a new release, in two places: the back office (`Azyaa-Admin/firebase/custom_cloud_functions`) and this panel (`src/lib/store-valley/config.ts`).

## Naming of requests

Store Valley is given Azyaa's own reference for every request, so both sides can find the same shipment:

| Request | Reference Azyaa sends | Example |
|---|---|---|
| Warehouse delivery | order number + `-RM` | `ORDAZYA1269-RM` |
| Designer pickup | `PKP-` + order number + `-CM-` + designer account id | `PKP-ORDAZYA1269-CM-abc123` |
| A second pickup for the same order and designer | same, with `-2`, `-3` | `PKP-ORDAZYA1269-CM-abc123-2` |

## Where Azyaa keeps its records

| Record | What it holds |
|---|---|
| `orders` | The order, its shipping status for warehouse items and for designer items, and the list of shipments with tracking numbers |
| `store_valley_delivery_jobs` | The to-do notes: one per shipment, with status (queued, processing, requested, failed, cancelled), attempts and last error |
| `delivery` | One record per shipment or pickup, with tracking number and status |
| `logistics_response` | Store Valley's answer to each request, and its latest status and proof photo links |
| `store_valley_codes` | The delivery and pickup codes, one per request. Private: only the back office can read it, and staff see codes through the panel. (Not yet released.) |
| `store_valley_inventory` | The copy of warehouse stock, one row per product |
| `store_valley_webhook_events` | The ids of updates already processed, so none is applied twice |

## What is true on the live system today

- Store Valley records in total: **4** (1 warehouse delivery that reached "delivered", 3 restock pickups). First on 9 September 2026, last on 15 September 2026.
- Paid orders in total: 157. Orders that went to Store Valley: 1 (the test above).
- Products Store Valley knows about: **1** (`PRD-RM-1001`, Store Valley's own test product, 21 units). This matches the thread: the 11 September test delivery took it from 22 to 21.
- Designers with a Store Valley designer id: **2 of 13**.
- No status update from Store Valley appears in the logs that are still kept (they go back to at least 4 November 2026). The September tests did reach "stored" and "delivered", so updates were arriving then.
- The 5-minute retry timer is running normally and finding nothing to do.
- Store Valley's own acceptance sheet (shipped with version 1.1.0-rc.5) lists the five end-to-end flows as 0 of 5 passed. A later sheet may exist; this repository does not have one.

## What needs attention

In order of importance. Details are in the audit that came with this document.

1. ~~**Anyone with an Azyaa login can use the Store Valley key.**~~ **Fixed on 25 November 2026.** The back office programs now refuse anyone who is not panel staff.
2. **Delivery codes can be read without logging in.** The codes are saved on Store Valley's answers (`logistics_response`), on the order, on the restock request and on the return, and all four are open to read (and to change) by anyone on the internet. **Fix written, not yet released:** the codes move to a private store, the panel stops saving them, and the access rules are tightened. It goes out in four steps, in this order: back office, panel, moving the old codes, then the rules.
3. **The joint testing is not finished.** The five staging tests have not been signed off, and real products and most designers are not yet registered with Store Valley, so real orders cannot ship through it.
4. ~~**A customer can get a delivery code for a request Store Valley then refuses.**~~ **Fixed on 25 November 2026.** The code is now sent only after Store Valley accepts the request.
5. **Four older delivery programs are still running** on the live project (`createReadyDeliveryRequests`, `createCustomDeliveryRequests`, `syncDeliveryToOrders`, `inventoryUpdatePostDelivery`). Their code is not in any of the three repositories, and the first two wake up on every order change, the same as the Store Valley programs.
6. **The settings store is being retired by Google in March 2027.** The key and secret must be moved to the newer secrets store before then, or releases will stop working.
7. ~~If a customer has no email on the order, the code email is addressed to their phone number and never arrives.~~ **Fixed on 25 November 2026.** No email is written without a real email address; the app notification still goes out.

## Before switching to Store Valley's real system

- [ ] Store Valley gives the production key and production address, and registers the production web address for updates with a new signing secret.
- [ ] Every designer who sells has a Store Valley designer id on their account.
- [ ] Every warehouse product exists at Store Valley with the same product id and SKU, and its stock shows in Inventory after a refresh.
- [x] Item 1 above is fixed (25 November 2026).
- [ ] Item 2 above is released (the fix is written).
- [ ] The five flows are run once each on staging and signed off by both sides. How to run them from the panel: [store-valley-staging-tests.md](store-valley-staging-tests.md).
- [ ] The fallback test designer `DSN-KWT-0001` is removed or replaced.
- [ ] The four older delivery programs are identified and switched off if no longer needed.

## Where the code is

| What | Where |
|---|---|
| Back office programs | `Azyaa-Admin/firebase/custom_cloud_functions/` (files starting `store_valley_` and `warehouse_stock_`) |
| Store Valley's own guide | `Azyaa-Admin/store_valley_websitek_integration_v1.1.0-rc.5/api-guide/` |
| Panel settings and request building | `azya-admin-2026/src/lib/store-valley/`, `src/features/orders/`, `src/features/inventory/` |
| Database access rules | `Azyaa-Admin/firebase/firestore.rules` |
