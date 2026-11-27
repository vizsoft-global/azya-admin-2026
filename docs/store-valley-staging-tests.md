# Running the five staging tests with Store Valley

Store Valley asked for five tests on its test system (staging) before the link is accepted. This page says how to run them from the admin panel, what to send Store Valley, and what a pass looks like.

For how the link itself works, see [store-valley-delivery.md](store-valley-delivery.md).

## Where

Admin panel > **Order > Shipping > Store Valley check** (address ends in `/store-valley-check`). Only a super admin can open it.

## Who does what

| Who | Does |
|---|---|
| Azyaa super admin | Presses the buttons on the page, sends Store Valley the reference and the code for each test, reads the result |
| Store Valley | Approves each request on their side, plays the driver (collects, delivers, enters the code, takes the photo and signature), does the warehouse check and placement |

Nothing on this page contacts a customer or a designer. The codes are emailed only to the address in "Send codes to" (your own, by default), and each code is also shown on the test's card.

## Before you start

1. Look at the Connection box. The page checks the connection by itself when it opens; **Run checks** repeats it.
   - "Connected to" must say **Store Valley's test system**. If it says the real system, the Start buttons are switched off: stop and tell the developers.
   - If it says "Check program not installed", the page still works, but it cannot tell which system is connected and cannot show the updates Store Valley sends. Ask the developers to release the check program first.
2. Press **Send a signed test update**. Both lines must pass: a signed update is accepted, an unsigned one is refused. This proves Store Valley's updates can reach Azyaa.
3. Press **Read stock now**. Note the number: every test compares against the stock at the moment it started.
4. Open **Test data** and check the designer, product, SKU and warehouse are the ones agreed with Store Valley. The defaults are Store Valley's own test values:

   | Field | Default |
   |---|---|
   | Designer ID | `DSN-KWT-0001` |
   | Product ID | `PRD-RM-1001` |
   | SKU | `AZY-DSN0001-DRESS-RED-M` |
   | Warehouse | `WH-KWT-MAIN` |
   | Packaging code | `AZY-PKG-STD-01` |

5. Press **Start a new run**. A run has a short label such as `1125A` (date and a letter). Every request of the run carries it, for example `AZT-1125A-INT`, so both sides can find the same request.

## The same four steps for every test

1. Press **Start**. Read the confirmation: a real request is created on Store Valley's system.
2. Send Store Valley the **Reference** and the **Store Valley ID** from the card, and the **Code** when the test needs the driver to enter it.
3. Store Valley carries out its part.
4. Press **Ask Store Valley now** until the list at the bottom of the card is all green. It also re-reads the stock.

Run the tests **in order, one at a time**. Do not start the next until the one before is finished, because each one measures the stock change.

"Store Valley says" is what Store Valley answers when asked just now. "Update received" is what Store Valley pushed to Azyaa by itself. Both should end on the same status; if only the first one moves, the updates are not arriving.

## The five tests

| # | Test | What Store Valley does | Pass looks like | Stock after |
|---|---|---|---|---|
| 1 | **Warehouse intake** (`…-INT`) | Collects 12 units from the designer. The driver first enters a **wrong** code, then the right one. Warehouse checks and places the units. | Wrong code refused, right code accepted, status "Stored" | start **+ 12** |
| 2 | **Warehouse delivery** (`…-DLV`) | Packs with the packaging code, delivers 1 unit, takes signature and photo, enters the code. | Packaging sent, status "Delivered", code verified, photo and signature recorded | start **− 1** |
| 3 | **Designer delivery** (`…-DSG`) | Collects 1 ready-made unit from the designer and delivers it. | Status "Delivered", delivery proof recorded | **unchanged** |
| 4 | **Custom-made delivery** (`…-CUS`) | Collects 1 custom-made unit from the designer and delivers it. | Status "Delivered", proof recorded, still marked custom-made | **unchanged** |
| 5 | **Warehouse return / exchange** (`…-RET`) | Step A: nothing, the request must be refused. Step B: collects the unit of test 2 from the customer, checks it, places it back in the warehouse. | Step A refused; status "Return completed"; no new delivery appeared | start **+ 1** |

If Store Valley starts from 0 units, the stock reads 12, 11, 11, 11, 12 after tests 1 to 5. If it starts from another number, only the change matters.

### Notes per test

- **Test 1.** Ask Store Valley to try a wrong code on purpose before the right one. If the page says "Store Valley reported no wrong attempt", ask them to confirm it in writing; the page cannot see it otherwise.
- **Test 2.** This is the only test you can cancel yourself (**Cancel the delivery**), and only before the driver has collected the unit.
- **Test 4.** "Still marked custom-made" passes when Store Valley's answer says so. If it shows "Not confirmed", their answer does not carry the kind of order: ask them to confirm it on their side.
- **Test 5.** Needs test 2 delivered first, because it returns that same unit.
  - **Step A** asks for a return to a wrong location. Store Valley must refuse it. If it accepts, tell Store Valley straight away: a real return now exists under `…-RETX`.
  - **Step B**: choose Return or Exchange, then start. For an exchange, no replacement delivery may be created by itself. The page compares Store Valley's list of deliveries before and after.

## Reading the result

| Mark | Meaning |
|---|---|
| Passed | Shown by Store Valley's answer or update |
| Waiting | Not happened yet |
| Not confirmed | The flow finished but Store Valley did not report this point. Ask them to confirm. |
| Failed | Store Valley's answer contradicts what was expected. The line under it says what. |

A card is "Passed" only when every line is.

## What to send Store Valley afterwards

For each test: the reference, the Store Valley ID, the final status and the stock before and after. A screenshot of each card carries all of it.

## Afterwards

- **Tools > Look up** finds any reference or Store Valley ID on Store Valley's side.
- **Tools > Remove test records** deletes the panel's own records of a run. It does **not** cancel anything at Store Valley. Requests of tests 1, 3, 4 and 5 can only be cancelled by Store Valley.
- To repeat a test, press **Start a new run**: a request cannot be created twice under the same reference.
