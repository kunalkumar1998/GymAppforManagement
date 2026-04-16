// frontend/src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── typed API helpers ────────────────────────────────────────────────────────

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
const headers = () => ({
  "Content-Type": "application/json",
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
});

async function call<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${FUNCTIONS_URL}${path}`, {
    ...options,
    headers: { ...headers(), ...(options?.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "API error");
  return data as T;
}

// ── Members ───────────────────────────────────────────────────────────────────
export const api = {
  members: {
    list: () =>
      call<{ members: MemberStatus[] }>("/members"),

    get: (id: string) =>
      call<{ member: MemberStatus; payments: Payment[] }>(`/members?id=${id}`),

    create: (body: CreateMemberPayload) =>
      call<{ member: Member }>("/members", {
        method: "POST",
        body: JSON.stringify(body),
      }),

    update: (id: string, body: Partial<CreateMemberPayload>) =>
      call<{ member: Member }>(`/members?id=${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),

    remove: (id: string) =>
      call<{ success: boolean }>(`/members?id=${id}`, { method: "DELETE" }),
  },

  payments: {
    list: () =>
      call<{ payments: Payment[] }>("/payments"),

    byMember: (memberId: string) =>
      call<{ payments: Payment[] }>(`/payments?member_id=${memberId}`),

    create: (body: CreatePaymentPayload) =>
      call<{ payment: Payment; next_due_date: string }>("/payments", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },

  notifications: {
    list: () =>
      supabase
        .from("notifications")
        .select("*, members(name, phone)")
        .order("created_at", { ascending: false })
        .limit(50),
  },

  sms: {
    sendManual: (phone: string, message: string, member_id?: string) =>
      call<{ success: boolean }>("/send-sms", {
        method: "POST",
        body: JSON.stringify({ phone, message, member_id, type: "sms_manual" }),
      }),

    triggerDueScan: () =>
      call<{ message: string; results: unknown }>("/notify-due", { method: "POST" }),
  },

  plans: {
    list: () => supabase.from("plans").select("*").order("fee"),
  },
};

// ── Types ─────────────────────────────────────────────────────────────────────
export interface MemberStatus {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  is_active: boolean;
  join_date: string;
  last_paid_date: string | null;
  plan_name: string;
  plan_fee: number;            // in paise
  due_date: string | null;
  days_until_due: number;
  fee_status: "active" | "due_soon" | "overdue" | "never_paid";
}

export interface Member {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  plan_id: string;
  join_date: string;
  last_paid_date: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  member_id: string;
  amount: number;              // in paise
  paid_date: string;
  due_date: string;
  payment_mode: string;
  notes: string | null;
  created_at: string;
  members?: { id: string; name: string; phone: string };
}

export interface CreateMemberPayload {
  name: string;
  phone: string;
  email?: string;
  plan_name: string;
  join_date?: string;
  notes?: string;
}

export interface CreatePaymentPayload {
  member_id: string;
  amount: number;
  paid_date?: string;
  payment_mode?: string;
  notes?: string;
}
