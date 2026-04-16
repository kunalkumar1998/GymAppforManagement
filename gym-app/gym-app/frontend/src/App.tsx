// frontend/src/App.tsx
import { useState, useCallback } from "react";
import { useMembers, usePayments, useNotifications, daysLabel, fmtINR, fmtDate, statusColor, planColor } from "./hooks/useGym";
import { api, CreateMemberPayload, MemberStatus } from "./lib/supabase";
import "./App.css";

// ─── MODAL: Add Member ────────────────────────────────────────────────────────
function AddMemberModal({ open, onClose, onSave }: {
  open: boolean;
  onClose: () => void;
  onSave: (p: CreateMemberPayload) => Promise<void>;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ name: "", phone: "", email: "", plan_name: "Standard", join_date: today });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.name.trim() || !form.phone.trim()) { setErr("Name and phone are required."); return; }
    if (!/^\+?[0-9]{10,13}$/.test(form.phone.replace(/\s/g, ""))) { setErr("Enter a valid phone number."); return; }
    setSaving(true); setErr("");
    try {
      await onSave(form);
      setForm({ name: "", phone: "", email: "", plan_name: "Standard", join_date: today });
      onClose();
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  };

  if (!open) return null;
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 className="modal-title">Add New Member</h2>
        <div className="form-grid-2">
          <label className="field"><span>Full Name</span><input value={form.name} onChange={set("name")} placeholder="Rahul Sharma" /></label>
          <label className="field"><span>Phone (+91...)</span><input value={form.phone} onChange={set("phone")} placeholder="+91 9876543210" /></label>
        </div>
        <div className="form-grid-2">
          <label className="field">
            <span>Plan</span>
            <select value={form.plan_name} onChange={set("plan_name")}>
              <option>Basic — ₹799/mo</option>
              <option>Standard — ₹1,299/mo</option>
              <option>Premium — ₹1,999/mo</option>
            </select>
          </label>
          <label className="field"><span>Start Date</span><input type="date" value={form.join_date} onChange={set("join_date")} /></label>
        </div>
        <label className="field"><span>Email (optional)</span><input value={form.email} onChange={set("email")} placeholder="rahul@email.com" /></label>
        {err && <p className="err">{err}</p>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={saving}>
            {saving ? "Adding…" : "✅ Add Member + Send Welcome SMS"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL: Mark Payment ──────────────────────────────────────────────────────
function PaymentModal({ member, open, onClose, onSave }: {
  member: MemberStatus | null;
  open: boolean;
  onClose: () => void;
  onSave: (amount: number, date: string, mode: string) => Promise<void>;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [amount, setAmount] = useState("");
  const [date, setDate]   = useState(today);
  const [mode, setMode]   = useState("Cash");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try { await onSave(Number(amount), date, mode); onClose(); }
    catch (e) { alert((e as Error).message); }
    finally { setSaving(false); }
  };

  // Pre-fill fee when member changes
  if (open && member && amount === "") setAmount(String(member.plan_fee / 100));

  if (!open || !member) return null;
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 className="modal-title">Mark Payment</h2>
        <div className="member-pill">
          <div className="av">{member.name.split(" ").map(w => w[0]).join("").slice(0,2)}</div>
          <div>
            <strong>{member.name}</strong>
            <span className="muted"> · {member.phone}</span>
            <span style={{ color: planColor(member.plan_name), marginLeft: 8, fontSize: 12, fontWeight: 700 }}>
              {member.plan_name}
            </span>
          </div>
        </div>
        <div className="form-grid-2">
          <label className="field"><span>Amount (₹)</span><input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label className="field"><span>Payment Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        </div>
        <label className="field">
          <span>Payment Mode</span>
          <select value={mode} onChange={e => setMode(e.target.value)}>
            {["Cash","UPI","Card","Bank Transfer"].map(m => <option key={m}>{m}</option>)}
          </select>
        </label>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "💳 Confirm + Send Receipt SMS"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]       = useState("dashboard");
  const [search, setSearch]   = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [payMember, setPayMember] = useState<MemberStatus | null>(null);
  const [toast, setToast]     = useState("");

  const { members, loading, stats, addMember, removeMember, reload } = useMembers();
  const { payments, recordPayment } = usePayments();
  const { notifications, unreadCount } = useNotifications();

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  const handleAddMember = async (payload: CreateMemberPayload) => {
    await addMember(payload);
    showToast(`✅ ${payload.name} added! Welcome SMS queued.`);
  };

  const handlePayment = async (amount: number, date: string, mode: string) => {
    if (!payMember) return;
    await recordPayment({ member_id: payMember.id, amount, paid_date: date, payment_mode: mode });
    await reload();
    showToast(`💳 Payment of ₹${amount} for ${payMember.name} confirmed. Receipt SMS sent!`);
  };

  const handleSendSMS = async (m: MemberStatus) => {
    const dl = m.days_until_due;
    const fee = fmtINR(m.plan_fee);
    const msg = dl < 0
      ? `Hi ${m.name.split(" ")[0]}, your Iron Pulse Gym fee of ${fee} is overdue by ${Math.abs(dl)} day(s). Please pay ASAP.`
      : `Hi ${m.name.split(" ")[0]}, your Iron Pulse Gym fee of ${fee} is due in ${dl} day(s). Please pay on time!`;
    try {
      await api.sms.sendManual(m.phone, msg, m.id);
      showToast(`📱 SMS sent to ${m.name} (${m.phone})`);
    } catch (e) { showToast(`❌ SMS failed: ${(e as Error).message}`); }
  };

  const handleSendAll = async () => {
    const due = members.filter(m => ["overdue","due_soon","never_paid"].includes(m.fee_status));
    if (!due.length) { showToast("No dues today!"); return; }
    try {
      await api.sms.triggerDueScan();
      showToast(`📢 Bulk SMS triggered for ${due.length} member(s)!`);
    } catch (e) { showToast(`❌ ${(e as Error).message}`); }
  };

  const filtered = members.filter(m =>
    !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.phone.includes(search)
  );

  const NAV = [
    { id: "dashboard", icon: "⬛", label: "Dashboard" },
    { id: "members",   icon: "👥", label: "Members" },
    { id: "payments",  icon: "💳", label: "Payments" },
    { id: "notifications", icon: "🔔", label: "Notifications", badge: unreadCount },
  ];

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-text">IRONPULSE</div>
          <div className="logo-sub">Gym Management</div>
        </div>
        <nav>
          {NAV.map(n => (
            <button key={n.id} className={`nav-item${page === n.id ? " active" : ""}`} onClick={() => setPage(n.id)}>
              <span className="nav-icon">{n.icon}</span>
              {n.label}
              {n.badge ? <span className="badge-dot">{n.badge}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="gym-name">Iron Pulse Gym</div>
          <div className="gym-info">Mumbai, India</div>
        </div>
      </aside>

      {/* Main */}
      <main className="main">
        <header className="topbar">
          <h1 className="page-title">
            {{ dashboard: "Dashboard", members: "Members", payments: "Payments", notifications: "Notifications" }[page]}
          </h1>
          <div className="topbar-actions">
            <button className="btn ghost sm" onClick={handleSendAll}>📱 Send Due SMS</button>
            <button className="btn primary sm" onClick={() => setAddOpen(true)}>+ Add Member</button>
          </div>
        </header>

        <div className="content">
          {/* ── DASHBOARD ── */}
          {page === "dashboard" && (
            <>
              {loading && <p className="loading">Loading members…</p>}
              <div className="stats-grid">
                <div className="stat accent"><div className="stat-label">Total Members</div><div className="stat-val yellow">{stats.total}</div></div>
                <div className="stat"><div className="stat-label">Paid This Month</div><div className="stat-val green">{stats.active}</div><div className="stat-sub">₹{stats.collectedThisMonth.toLocaleString("en-IN")} collected</div></div>
                <div className="stat"><div className="stat-label">Due Soon (≤5 days)</div><div className="stat-val orange">{stats.dueSoon}</div></div>
                <div className="stat"><div className="stat-label">Overdue</div><div className="stat-val red">{stats.overdue}</div></div>
              </div>
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Member Fee Status</span>
                  <input className="search" placeholder="Search member…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <table>
                  <thead><tr><th>Member</th><th>Plan</th><th>Last Paid</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filtered.map(m => {
                      const pct = Math.max(0, Math.min(100, (30 - m.days_until_due) / 30 * 100));
                      const barCls = m.days_until_due < 0 ? "bar-danger" : m.days_until_due <= 5 ? "bar-warn" : "bar-ok";
                      return (
                        <tr key={m.id}>
                          <td><div className="member-cell"><div className="av">{m.name.split(" ").map(w => w[0]).join("").slice(0,2)}</div><div><div className="member-name">{m.name}</div><div className="member-phone">{m.phone}</div></div></div></td>
                          <td><span style={{ color: planColor(m.plan_name), fontWeight: 700, fontSize: 12 }}>{m.plan_name}</span></td>
                          <td className="muted">{fmtDate(m.last_paid_date)}</td>
                          <td>
                            <div className="days-bar">
                              <span style={{ color: statusColor(m.fee_status), fontSize: 12, fontWeight: 600 }}>{daysLabel(m.days_until_due)}</span>
                              <div className="bar-bg"><div className={`bar-fill ${barCls}`} style={{ width: `${pct}%` }} /></div>
                            </div>
                          </td>
                          <td><span className={`status ${m.fee_status}`}>{m.fee_status.replace("_", " ")}</span></td>
                          <td>
                            <button className="btn ghost sm" onClick={() => setPayMember(m)}>Mark Paid</button>
                            <button className="btn ghost sm" onClick={() => handleSendSMS(m)} title="Send SMS">📱</button>
                          </td>
                        </tr>
                      );
                    })}
                    {!loading && filtered.length === 0 && (
                      <tr><td colSpan={6} className="empty">No members found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── MEMBERS ── */}
          {page === "members" && (
            <div className="card">
              <div className="card-header">
                <span className="card-title">All Members ({members.length})</span>
                <input className="search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <table>
                <thead><tr><th>Member</th><th>Phone</th><th>Plan</th><th>Monthly Fee</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.id}>
                      <td><div className="member-cell"><div className="av">{m.name.split(" ").map(w => w[0]).join("").slice(0,2)}</div><div className="member-name">{m.name}</div></div></td>
                      <td className="muted">{m.phone}</td>
                      <td><span style={{ color: planColor(m.plan_name), fontWeight: 700, fontSize: 12 }}>{m.plan_name}</span></td>
                      <td style={{ fontWeight: 600 }}>{fmtINR(m.plan_fee)}</td>
                      <td className="muted">{fmtDate(m.join_date)}</td>
                      <td><span className={`status ${m.fee_status}`}>{m.fee_status.replace("_", " ")}</span></td>
                      <td>
                        <button className="btn ghost sm" onClick={() => setPayMember(m)}>Mark Paid</button>
                        <button className="btn ghost sm" onClick={() => handleSendSMS(m)}>📱 SMS</button>
                        <button className="btn danger sm" onClick={() => { if (confirm(`Remove ${m.name}?`)) removeMember(m.id).then(() => showToast(`Removed ${m.name}`)); }}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── PAYMENTS ── */}
          {page === "payments" && (
            <div className="card">
              <div className="card-header"><span className="card-title">Payment Records</span></div>
              <table>
                <thead><tr><th>Member</th><th>Amount</th><th>Paid Date</th><th>Next Due</th><th>Mode</th></tr></thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id}>
                      <td><div className="member-cell"><div className="av" style={{ fontSize: 10 }}>{p.members?.name?.split(" ").map(w => w[0]).join("").slice(0,2)}</div><div><div className="member-name">{p.members?.name}</div><div className="member-phone">{p.members?.phone}</div></div></div></td>
                      <td style={{ fontWeight: 600 }}>{fmtINR(p.amount)}</td>
                      <td className="muted">{fmtDate(p.paid_date)}</td>
                      <td>{fmtDate(p.due_date)}</td>
                      <td><span className="mode-pill">{p.payment_mode}</span></td>
                    </tr>
                  ))}
                  {payments.length === 0 && <tr><td colSpan={5} className="empty">No payments recorded yet</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* ── NOTIFICATIONS ── */}
          {page === "notifications" && (
            <div>
              <p className="muted" style={{ marginBottom: 16 }}>Automated SMS & system notifications log</p>
              <div className="notif-list">
                {(notifications as Array<{ id: string; type: string; title: string; detail: string; status: string; created_at: string; phone: string }>).map(n => (
                  <div key={n.id} className={`notif-item ${n.type.includes("overdue") ? "notif-danger" : n.type.includes("receipt") ? "notif-success" : ""}`}>
                    <div className="notif-icon">{n.type.includes("overdue") ? "🚨" : n.type.includes("receipt") ? "💳" : n.type.includes("welcome") ? "🎉" : "📱"}</div>
                    <div className="notif-body">
                      <div className="notif-title">{n.title}</div>
                      <div className="notif-detail">{n.detail}</div>
                    </div>
                    <div className="notif-meta">
                      <span className={`notif-status ${n.status}`}>{n.status}</span>
                      <span className="notif-time">{new Date(n.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>
                ))}
                {notifications.length === 0 && <div className="empty">🔔 No notifications yet. Add members and mark payments to see activity here.</div>}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      <AddMemberModal open={addOpen} onClose={() => setAddOpen(false)} onSave={handleAddMember} />
      <PaymentModal   member={payMember} open={!!payMember} onClose={() => setPayMember(null)} onSave={handlePayment} />

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
