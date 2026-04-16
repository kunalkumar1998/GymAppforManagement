// frontend/src/hooks/useGym.ts
import { useState, useEffect, useCallback } from "react";
import { api, MemberStatus, Payment } from "../lib/supabase";

// ── useMembers ────────────────────────────────────────────────────────────────
export function useMembers() {
  const [members, setMembers] = useState<MemberStatus[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { members } = await api.members.list();
      setMembers(members);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addMember = async (payload: Parameters<typeof api.members.create>[0]) => {
    const result = await api.members.create(payload);
    await load();
    return result;
  };

  const removeMember = async (id: string) => {
    await api.members.remove(id);
    setMembers(prev => prev.filter(m => m.id !== id));
  };

  // Stats derived from members list
  const stats = {
    total:    members.length,
    active:   members.filter(m => m.fee_status === "active").length,
    dueSoon:  members.filter(m => m.fee_status === "due_soon").length,
    overdue:  members.filter(m => m.fee_status === "overdue").length,
    neverPaid: members.filter(m => m.fee_status === "never_paid").length,
    collectedThisMonth: members
      .filter(m => {
        if (!m.last_paid_date) return false;
        const d = new Date(m.last_paid_date);
        const now = new Date();
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, m) => sum + m.plan_fee / 100, 0),
  };

  return { members, loading, error, reload: load, addMember, removeMember, stats };
}

// ── usePayments ───────────────────────────────────────────────────────────────
export function usePayments(memberId?: string) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = memberId
        ? await api.payments.byMember(memberId)
        : await api.payments.list();
      setPayments(result.payments);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => { load(); }, [load]);

  const recordPayment = async (payload: Parameters<typeof api.payments.create>[0]) => {
    const result = await api.payments.create(payload);
    await load();
    return result;
  };

  return { payments, loading, error, reload: load, recordPayment };
}

// ── useNotifications ──────────────────────────────────────────────────────────
export function useNotifications() {
  const [notifications, setNotifications] = useState<unknown[]>([]);
  const [unreadCount, setUnreadCount]     = useState(0);

  const load = useCallback(async () => {
    const { data } = await api.notifications.list();
    if (data) {
      setNotifications(data);
      // Mark as "seen" after first load — count those from last 24h
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      setUnreadCount(data.filter((n: { created_at: string }) => n.created_at > cutoff).length);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { notifications, unreadCount, reload: load };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function daysLabel(days: number): string {
  if (days < 0)   return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `${days}d left`;
}

export function fmtINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

export function statusColor(status: string): string {
  return { active: "#22c55e", due_soon: "#f59e0b", overdue: "#ef4444", never_paid: "#6b7280" }[status] || "#6b7280";
}

export function planColor(plan: string): string {
  return { Basic: "#3b82f6", Standard: "#e8ff00", Premium: "#f59e0b" }[plan] || "#888";
}
