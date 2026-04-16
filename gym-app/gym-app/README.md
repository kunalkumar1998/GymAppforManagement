# 🏋️ IronPulse Gym Management System
**Stack:** React + Vite · Supabase (DB + Edge Functions) · Vercel · MSG91 SMS**Cost:** ~₹0/month until 500+ members

---

## 📁 Project Structure

```
gym-app/
├── frontend/                    # React app → deploy to Vercel
│   ├── src/
│   │   ├── App.tsx              # Main UI (Dashboard, Members, Payments, Notifications)
│   │   ├── App.css              # Styling
│   │   ├── main.tsx             # Entry point
│   │   ├── lib/supabase.ts      # Supabase client + typed API helpers
│   │   └── hooks/useGym.ts      # React hooks (useMembers, usePayments, useNotifications)
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── .env.example             # → copy to .env.local
│
└── supabase/
    ├── config.toml              # Supabase project config
    ├── .env.example             # Edge Function secrets template
    ├── migrations/
    │   └── 001_init.sql         # Full DB schema (run this first!)
    └── functions/
        ├── members/index.ts     # CRUD for gym members
        ├── payments/index.ts    # Record payments + trigger SMS
        ├── send-sms/index.ts    # SMS gateway (MSG91 / Twilio)
        └── notify-due/index.ts  # Daily cron: scan & SMS overdue members
```

---

## 🚀 Step-by-Step Deployment

### STEP 1 — Supabase Setup (10 min)

1. Go to [supabase.com](https://supabase.com) → Create new project
   - Name: `ironpulse-gym`
   - DB Password: save this!
   - Region: **South Asia (Mumbai)** — closest to India

2. Open **SQL Editor** → paste entire contents of `supabase/migrations/001_init.sql` → Run

3. Go to **Settings → API** → Copy:
   - `Project URL` → paste in `frontend/.env.local` as `VITE_SUPABASE_URL`
   - `anon public` key → paste as `VITE_SUPABASE_ANON_KEY`

---

### STEP 2 — Install Supabase CLI & Deploy Edge Functions (15 min)

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project (get project-ref from Supabase Dashboard URL)
supabase link --project-ref YOUR_PROJECT_REF

# Set SMS secrets (MSG91 recommended for India)
supabase secrets set SMS_PROVIDER=msg91
supabase secrets set MSG91_AUTH_KEY=your_key_from_msg91_dashboard
supabase secrets set MSG91_SENDER_ID=IRPULS

# Deploy all 4 Edge Functions
supabase functions deploy members
supabase functions deploy payments
supabase functions deploy send-sms
supabase functions deploy notify-due
```

**Verify:** Supabase Dashboard → Edge Functions → you should see all 4 functions listed.

---

### STEP 3 — MSG91 SMS Setup (10 min)

1. Sign up at [msg91.com](https://msg91.com)
2. Add ₹100 credits (enough for ~600 SMS)
3. Dashboard → API → copy **Auth Key**
4. Register a **Sender ID** (e.g. `IRPULS`) — takes ~24hrs for DLT approval in India
5. Set the secrets (done in Step 2 above)

> **DLT Registration:** India requires all SMS senders to register on TRAI's DLT portal. MSG91 guides you through this. Required for transactional SMS delivery.

---

### STEP 4 — Frontend on Vercel (5 min)

```bash
# In the frontend/ directory
cd frontend
npm install
npm run build          # test build locally first

# Deploy to Vercel
npm install -g vercel
vercel                 # follow prompts, select frontend/ as root
```

**OR** use Vercel Dashboard:
1. [vercel.com](https://vercel.com) → Import Git Repository
2. Root directory: `frontend`
3. Add Environment Variables:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
4. Deploy!

---

### STEP 5 — Daily Cron Job (5 min)

**Option A — cron-job.org (Free, recommended):**
1. Go to [cron-job.org](https://cron-job.org) → Sign up free
2. Create new cron job:
   - URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/notify-due`
   - Schedule: Daily at **09:00 IST** (03:30 UTC)
   - Add header: `Authorization: Bearer YOUR_ANON_KEY`
3. Save → Done!

**Option B — Supabase pg_cron:**
```sql
-- Run in Supabase SQL Editor
select cron.schedule(
  'notify-due-daily',
  '30 3 * * *',
  $$
    select net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/notify-due',
      headers := jsonb_build_object(
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
        'Content-Type', 'application/json'
      )
    );
  $$
);
```

---

## 💰 Cost Breakdown

| Service | Free Tier | Paid |
|---|---|---|
| **Supabase** | 500MB DB, 2 Edge Functions invocations/day... plenty for gyms | $25/mo if you need more |
| **Vercel** | Unlimited hobby deploys | $20/mo for teams |
| **MSG91** | Pay-per-SMS (~₹0.15/SMS) | ₹100 = ~600 SMS |
| **cron-job.org** | Free | Free |
| **Total/month** | **~₹0** for setup | ~₹50-200/mo at scale |

---

## 🔧 Local Development

```bash
# Terminal 1 — Supabase local
supabase start
supabase functions serve   # serves all functions on localhost:54321

# Terminal 2 — Frontend
cd frontend
cp .env.example .env.local
# Edit .env.local with local Supabase URL (printed by supabase start)
npm install
npm run dev
# → http://localhost:5173
```

---

## 📊 Database Schema Overview

```
plans          → Basic / Standard / Premium (fee in paise)
members        → name, phone, plan_id, last_paid_date
payments       → member_id, amount, paid_date, due_date (auto = paid+30d)
notifications  → log of all SMS sent + system events

VIEW: member_fee_status
  → joins members + plans
  → calculates days_until_due = last_paid + 30 - today
  → fee_status: active | due_soon | overdue | never_paid
```

---

## 🔔 SMS Flow

```
Member added          → Welcome SMS (queued via send-sms function)
Payment marked        → Receipt SMS with next due date (via payments function)
Daily at 9 AM         → notify-due scans member_fee_status view
  → overdue members   → "Your fee is X days overdue..."
  → due_soon members  → "Your fee is due in Y days..."
Manual SMS button     → Gym owner can send individual SMS anytime
Bulk SMS button       → Sends to all due/overdue members at once
```

---

## 🛡️ Security Notes

- Edge Functions use `SUPABASE_SERVICE_ROLE_KEY` — never expose this to the frontend
- Frontend only uses the `anon` key (safe to expose — RLS protects data)
- Enable Row Level Security policies in `001_init.sql` when adding user auth
- Use `verify_jwt = true` in `config.toml` functions config after adding Supabase Auth

---

## 📱 Future Enhancements

- [ ] WhatsApp notifications via Twilio WhatsApp API (higher open rate in India)
- [ ] Supabase Auth login for gym owner
- [ ] Member self-service portal (pay online via Razorpay)
- [ ] Attendance tracking with QR code check-in
- [ ] Monthly revenue reports PDF export
- [ ] Multi-gym / multi-branch support
