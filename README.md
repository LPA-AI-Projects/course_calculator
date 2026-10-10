# Learners Point – Course Fee Calculator

Node 20+ / Express 5. Fees are calculated on the server; customers only ever receive the final fee. Rates, formulas, levels, modes and courses are managed in the Admin area (default code **8866**).

## Deploy on Railway (about 5 minutes)
1. Push this folder to a GitHub repo.
2. Railway → **New Project → Deploy from GitHub repo**. `railway.json` already sets the builder, start command (`npm start`) and health check (`/health`).
3. **Add a Volume** to the service and mount it at `/data`. Without it, admin edits are lost on every redeploy.
4. Service → **Variables**:
   - `DATA_DIR=/data`
   - `ADMIN_CODE=<your code>` (optional; defaults to `8866`, change it for production)
5. Service → **Settings → Networking → Generate Domain**. Open the URL.
6. Check `https://<your-domain>/health`. It returns `{"ok":true,"persistent":true}`. If `persistent` is `false`, the volume or `DATA_DIR` is not set up.

First start loads the 1,753 courses from `data/seed.json` into `DATA_DIR/config.json`; from then on the file in the volume is the live data. Admin → Backup & reset can download it or restore the defaults.

## Run locally
    npm install
    npm start        # http://localhost:3000
    npm test         # engine (incl. Excel comparison) + end-to-end server tests

## How the fee is built
1. **Trainer payout** = rate × hours × session-length factor (2 h/day 1.5×, 4 h/day 1.2×, 8 h/day 1×).
2. Base fee = payout × fee multiplier (2.8).
3. **Add-ons** on the base fee: level (Beginner 1×, Intermediate 1.2×, Advanced 1.4×) and mode multiplier.
4. Rounded, then VAT (5%) added.

Enter **days** and hours = days × hours per day. Enter **total hours** and days are ignored.
Modes: Online and Classroom. Classroom shows the note "no weekend batches" (editable under Levels & modes).

## Admin
- **Rates**: every course with its online and offline trainer rate, searchable. Edit a rate to give that course its own price; the arrow returns it to its category card.
- **Default rate cards**: the rate card for each category.
- **Formulas**: editable steps with a live tester. Operators `+ - * / ^ ( )`, comparisons, `ROUND MROUND CEIL FLOOR MIN MAX ABS IF`. Required steps: `trainerPayout`, `courseFee`, `vat`, `total`.
- **Courses**: add, edit, delete, **Bulk upload** (Excel .xlsx/.xls or CSV). Category **None** means the course is priced by hand with its own online and offline rate.
- **Backup & reset**: download/import all settings, export courses to CSV.

### Bulk upload format
| Course | Category | Online rate | Offline rate |
|---|---|---|---|
| Excel for Finance Teams | Data & Analytics | | |
| Custom Leadership Workshop | None | 260 | 320 |

Category must match an existing category name (or be blank/None). Rates are required only when the category is None. Rows with problems are listed and skipped; nothing is saved until you press **Save changes**.

## Security notes
- Admin sessions use a random token (12 h); 5 wrong codes lock the IP for 10 minutes.
- Public endpoints never expose rates, payout or add-on breakdowns.
- Set a strong `ADMIN_CODE` on Railway; `8866` is only the default.

## Files
`server.js` API + static · `lib/core.js` formula engine & pricing (shared with the browser for the admin tester) · `lib/store.js` JSON persistence · `public/` UI (`vendor/xlsx.full.min.js` is SheetJS, Apache-2.0) · `data/seed.json` original Excel data.
