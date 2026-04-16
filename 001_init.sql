-- ============================================================
-- IRONPULSE GYM MANAGEMENT - Supabase DB Schema
-- Run this in: Supabase Dashboard > SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ──────────────────────────────────────────────
-- PLANS (seed data)
-- ──────────────────────────────────────────────
create table if not exists plans (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null unique,           -- Basic | Standard | Premium
  fee         integer not null,               -- monthly fee in INR paise (e.g. 79900 = ₹799)
  created_at  timestamptz default now()
);

insert into plans (name, fee) values
  ('Basic',    79900),
  ('Standard', 129900),
  ('Premium',  199900)
on conflict (name) do nothing;

-- ──────────────────────────────────────────────
-- MEMBERS
-- ──────────────────────────────────────────────
create table if not exists members (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  phone           text not null unique,        -- +91XXXXXXXXXX
  email           text,
  plan_id         uuid references plans(id),
  join_date       date not null default current_date,
  last_paid_date  date,                        -- updated on each payment
  is_active       boolean default true,
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Index for fast due-date queries
create index if not exists idx_members_last_paid on members(last_paid_date);
create index if not exists idx_members_active    on members(is_active);

-- ──────────────────────────────────────────────
-- PAYMENTS
-- ──────────────────────────────────────────────
create table if not exists payments (
  id            uuid primary key default uuid_generate_v4(),
  member_id     uuid not null references members(id) on delete cascade,
  amount        integer not null,              -- INR paise
  paid_date     date not null default current_date,
  due_date      date generated always as (paid_date + interval '30 days') stored,
  payment_mode  text default 'Cash',           -- Cash | UPI | Card | Bank Transfer
  notes         text,
  created_at    timestamptz default now()
);

create index if not exists idx_payments_member   on payments(member_id);
create index if not exists idx_payments_due_date on payments(due_date);

-- ──────────────────────────────────────────────
-- NOTIFICATIONS LOG
-- ──────────────────────────────────────────────
create table if not exists notifications (
  id          uuid primary key default uuid_generate_v4(),
  member_id   uuid references members(id) on delete set null,
  type        text not null,                   -- sms_due | sms_receipt | sms_welcome | system
  title       text not null,
  detail      text,
  phone       text,
  status      text default 'sent',             -- sent | failed | queued
  created_at  timestamptz default now()
);

create index if not exists idx_notif_member  on notifications(member_id);
create index if not exists idx_notif_created on notifications(created_at desc);

-- ──────────────────────────────────────────────
-- TRIGGER: auto-update members.updated_at
-- ──────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_members_updated_at on members;
create trigger trg_members_updated_at
  before update on members
  for each row execute function update_updated_at();

-- ──────────────────────────────────────────────
-- TRIGGER: auto-update last_paid_date on new payment
-- ──────────────────────────────────────────────
create or replace function sync_last_paid()
returns trigger language plpgsql as $$
begin
  update members
  set last_paid_date = new.paid_date
  where id = new.member_id
    and (last_paid_date is null or new.paid_date > last_paid_date);
  return new;
end;
$$;

drop trigger if exists trg_sync_last_paid on payments;
create trigger trg_sync_last_paid
  after insert on payments
  for each row execute function sync_last_paid();

-- ──────────────────────────────────────────────
-- VIEW: member fee status (used by dashboard)
-- ──────────────────────────────────────────────
create or replace view member_fee_status as
select
  m.id,
  m.name,
  m.phone,
  m.email,
  m.is_active,
  m.join_date,
  m.last_paid_date,
  p.name  as plan_name,
  p.fee   as plan_fee,
  case
    when m.last_paid_date is null then null
    else m.last_paid_date + interval '30 days'
  end as due_date,
  case
    when m.last_paid_date is null then 9999
    else (m.last_paid_date + interval '30 days' - current_date)::integer
  end as days_until_due,
  case
    when m.last_paid_date is null                                              then 'never_paid'
    when (m.last_paid_date + interval '30 days') < current_date               then 'overdue'
    when (m.last_paid_date + interval '30 days') <= current_date + interval '5 days' then 'due_soon'
    else 'active'
  end as fee_status
from members m
join plans p on p.id = m.plan_id
where m.is_active = true;

-- ──────────────────────────────────────────────
-- ROW LEVEL SECURITY (optional but recommended)
-- ──────────────────────────────────────────────
alter table members       enable row level security;
alter table payments      enable row level security;
alter table notifications enable row level security;
alter table plans         enable row level security;

-- Service role (Edge Functions) bypass RLS automatically.
-- For anon/authenticated access from frontend, use these policies:
-- (Uncomment after setting up Supabase Auth if needed)
-- create policy "allow_all_authenticated" on members for all using (auth.role() = 'authenticated');
