'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatKes, formatDate, formatDateTime, computeLineTotal } from '@/lib/formatting';
import { statusStyles, JOB_TRANSITIONS, PAYMENT_METHODS, JOB_TYPE_META, INSPECTION_CATEGORIES, INSPECTION_CONDITIONS, WORK_ITEM_STATUSES, QUALITY_CHECK_ITEMS, QUALITY_CHECK_RESULTS, SIGNOFF_ROLES } from '@/lib/constants';
import { loadUserPermissions, hasPermission, clearPermissionCache, type UserPermission } from '@/lib/permissions';
import type { Customer, Vehicle, Service, Part, Supplier, JobCard, JobCardLabour, JobCardPart, JobCardStatusHistory, JobCardInspectionItem, JobCardWorkItem, JobCardDiagnosis, JobCardQualityCheck, JobCardSignoff, Invoice, InvoiceItem, Payment, Quotation, QuotationItem, PurchaseOrder, PurchaseOrderItem, StockMovement, Employee, Notification, AuditLog, BusinessSettings, Role, Permission, Profile } from '@/lib/types';
import {
  ArrowUpRight, Bell, CarFront, CheckCircle2, CircleDollarSign, ClipboardList, Gauge,
  LayoutDashboard, LogOut, Menu, Package, Plus, Search, Settings, ShieldCheck, Sparkles, Users,
  Wrench, X, FileText, Truck, ShoppingCart, Receipt, ScrollText, UserCog, AlertTriangle,
  TrendingUp, Download, Eye, Edit, Archive, Trash2, Phone, Mail, MapPin, Filter, ChevronRight,
  Briefcase, Boxes, Store, Banknote, Smartphone, FileCheck, Clock, Activity, Calendar, Printer,
} from 'lucide-react';

type SectionId =
  | 'dashboard' | 'customers' | 'vehicles' | 'jobcards' | 'services' | 'technicians'
  | 'parts' | 'stockmovements' | 'lowstock' | 'suppliers' | 'procurement'
  | 'quotations' | 'invoices' | 'payments' | 'receipts'
  | 'reports' | 'notifications' | 'audit' | 'settings' | 'users';

const NAV_GROUPS: { label: string; items: { id: SectionId; label: string; icon: React.ReactNode; perm: string }[] }[] = [
  { label: '', items: [{ id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} />, perm: 'dashboard.view' }] },
  { label: 'Operations', items: [
    { id: 'customers', label: 'Customers', icon: <Users size={18} />, perm: 'customer.view' },
    { id: 'vehicles', label: 'Vehicles', icon: <CarFront size={18} />, perm: 'vehicle.view' },
    { id: 'jobcards', label: 'Job Cards', icon: <ClipboardList size={18} />, perm: 'job.view' },
    { id: 'services', label: 'Services', icon: <Wrench size={18} />, perm: 'dashboard.view' },
    { id: 'technicians', label: 'Technicians', icon: <UserCog size={18} />, perm: 'job.view' },
  ] },
  { label: 'Inventory', items: [
    { id: 'parts', label: 'Parts', icon: <Package size={18} />, perm: 'inventory.view' },
    { id: 'stockmovements', label: 'Stock Movements', icon: <Boxes size={18} />, perm: 'inventory.view' },
    { id: 'lowstock', label: 'Low Stock', icon: <AlertTriangle size={18} />, perm: 'inventory.view' },
    { id: 'suppliers', label: 'Suppliers', icon: <Truck size={18} />, perm: 'supplier.view' },
    { id: 'procurement', label: 'Procurement', icon: <ShoppingCart size={18} />, perm: 'purchase_order.view' },
  ] },
  { label: 'Finance', items: [
    { id: 'quotations', label: 'Quotations', icon: <FileText size={18} />, perm: 'quotation.view' },
    { id: 'invoices', label: 'Invoices', icon: <CircleDollarSign size={18} />, perm: 'invoice.view' },
    { id: 'payments', label: 'Payments', icon: <Banknote size={18} />, perm: 'payment.view' },
    { id: 'receipts', label: 'Receipts', icon: <Receipt size={18} />, perm: 'payment.view' },
  ] },
  { label: 'System', items: [
    { id: 'reports', label: 'Reports', icon: <Gauge size={18} />, perm: 'report.view' },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={18} />, perm: 'dashboard.view' },
    { id: 'audit', label: 'Audit Logs', icon: <ScrollText size={18} />, perm: 'audit.view' },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} />, perm: 'settings.manage' },
    { id: 'users', label: 'Users & Roles', icon: <ShieldCheck size={18} />, perm: 'users.manage' },
  ] },
];

export default function Home() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>(null);
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<SectionId>('dashboard');
  const [userPerms, setUserPerms] = useState<UserPermission>({ permissions: [], role: '', roleLabel: '', fullName: '' });
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(true);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [showJobForm, setShowJobForm] = useState(false);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [showPartForm, setShowPartForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [showPOForm, setShowPOForm] = useState(false);
  const [showQuotationForm, setShowQuotationForm] = useState(false);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showStockReceiveForm, setShowStockReceiveForm] = useState(false);
  const [showStockAdjustForm, setShowStockAdjustForm] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedQuotationId, setSelectedQuotationId] = useState<string | null>(null);
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [permsLoaded, setPermsLoaded] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session) void loadUserPermissions().then((p) => { setUserPerms(p); setPermsLoaded(true); });
      else setPermsLoaded(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      clearPermissionCache();
      setPermsLoaded(false);
      if (nextSession) void loadUserPermissions().then((p) => { setUserPerms(p); setPermsLoaded(true); });
      else { setUserPerms({ permissions: [], role: '', roleLabel: '', fullName: '' }); setPermsLoaded(true); }
    });
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js');
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => { listener.subscription.unsubscribe(); window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline); };
  }, []);

  function refresh() { setRefreshKey((k) => k + 1); }

  async function signOut() {
    await supabase.auth.signOut();
    clearPermissionCache();
    setUserPerms({ permissions: [], role: '', roleLabel: '', fullName: '' });
  }

  const can = (perm: string) => hasPermission(userPerms, perm);

  const visibleNav = useMemo(() => NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => can(item.perm)),
  })).filter((group) => group.items.length > 0), [userPerms]);

  if (loading) return <div className="loading-screen"><div className="brand-mark">OM</div><p>Oakland Motor Care Ltd</p></div>;
  if (!session) return <AuthScreen error={authError} setError={setAuthError} />;
  if (permsLoaded && userPerms.permissions.length === 0) return <AccountInactiveScreen onSignOut={() => void signOut()} />;

  return <main className="app-shell">
    {showMobileNav && <div className="nav-overlay" onClick={() => setShowMobileNav(false)} />}
    <aside className={`sidebar ${showMobileNav ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark">OM</div><div><strong>Oakland Motor</strong><span>Care Ltd</span></div></div>
      <nav className="nav-list">
        {visibleNav.map((group, gi) => <div key={gi} className="nav-group">
          {group.label && <p className="nav-label">{group.label}</p>}
          {group.items.map((item) => <button key={item.id} className={section === item.id ? 'nav-item active' : 'nav-item'} onClick={() => { setSection(item.id); setShowMobileNav(false); setSelectedJobId(null); setSelectedVehicleId(null); setSelectedCustomerId(null); setSelectedInvoiceId(null); setSelectedQuotationId(null); setSelectedPOId(null); setSelectedSupplierId(null); }}>{item.icon}{item.label}</button>)}
        </div>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="user-chip">
          <div className="avatar">{(userPerms.fullName || 'A').slice(0, 1).toUpperCase()}</div>
          <div><strong className="truncate">{userPerms.fullName || 'User'}</strong><span>{userPerms.roleLabel}</span></div>
          <button aria-label="Sign out" onClick={() => void signOut()}><LogOut size={16} /></button>
        </div>
      </div>
    </aside>
    <section className="content-area">
      <header className="topbar">
        <div className="mobile-brand"><div className="brand-mark">OM</div><strong>Oakland Motor Care Ltd</strong></div>
        <div className="topbar-search"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customers, plates, jobs, invoices..." /><kbd>⌘K</kbd></div>
        <div className="topbar-actions">
          <div className={`connection ${online ? '' : 'offline'}`}><span className={online ? 'online-dot' : 'offline-dot'} /> {online ? 'Online' : 'Offline'}</div>
          <button className="icon-button" onClick={() => setSection('notifications')}><Bell size={19} /></button>
          <div className="top-avatar">{(userPerms.fullName || 'A').slice(0, 1).toUpperCase()}</div>
          <button className="mobile-menu" onClick={() => setShowMobileNav(!showMobileNav)}><Menu size={20} /></button>
        </div>
      </header>
      <div className="page-wrap" key={refreshKey}>
        {notice && <div className="notice"><CheckCircle2 size={17} /> {notice}<button onClick={() => setNotice('')}><X size={15} /></button></div>}
        <SectionRouter
          section={section}
          query={query}
          can={can}
          userPerms={userPerms}
          onNotice={setNotice}
          onRefresh={refresh}
          selectedJobId={selectedJobId}
          setSelectedJobId={setSelectedJobId}
          selectedVehicleId={selectedVehicleId}
          setSelectedVehicleId={setSelectedVehicleId}
          selectedCustomerId={selectedCustomerId}
          setSelectedCustomerId={setSelectedCustomerId}
          selectedInvoiceId={selectedInvoiceId}
          setSelectedInvoiceId={setSelectedInvoiceId}
          selectedQuotationId={selectedQuotationId}
          setSelectedQuotationId={setSelectedQuotationId}
          selectedPOId={selectedPOId}
          setSelectedPOId={setSelectedPOId}
          selectedSupplierId={selectedSupplierId}
          setSelectedSupplierId={setSelectedSupplierId}
          showCustomerForm={showCustomerForm}
          setShowCustomerForm={setShowCustomerForm}
          showVehicleForm={showVehicleForm}
          setShowVehicleForm={setShowVehicleForm}
          showJobForm={showJobForm}
          setShowJobForm={setShowJobForm}
          showServiceForm={showServiceForm}
          setShowServiceForm={setShowServiceForm}
          showPartForm={showPartForm}
          setShowPartForm={setShowPartForm}
          showSupplierForm={showSupplierForm}
          setShowSupplierForm={setShowSupplierForm}
          showPOForm={showPOForm}
          setShowPOForm={setShowPOForm}
          showQuotationForm={showQuotationForm}
          setShowQuotationForm={setShowQuotationForm}
          showInvoiceForm={showInvoiceForm}
          setShowInvoiceForm={setShowInvoiceForm}
          showPaymentForm={showPaymentForm}
          setShowPaymentForm={setShowPaymentForm}
          showStockReceiveForm={showStockReceiveForm}
          setShowStockReceiveForm={setShowStockReceiveForm}
          showStockAdjustForm={showStockAdjustForm}
          setShowStockAdjustForm={setShowStockAdjustForm}
        />
      </div>
    </section>
    {showCustomerForm && <CustomerForm onClose={() => setShowCustomerForm(false)} onSaved={(m) => { setShowCustomerForm(false); setNotice(m); refresh(); }} />}
    {showVehicleForm && <VehicleForm onClose={() => setShowVehicleForm(false)} onSaved={(m) => { setShowVehicleForm(false); setNotice(m); refresh(); }} />}
    {showJobForm && <JobForm onClose={() => setShowJobForm(false)} onSaved={(m) => { setShowJobForm(false); setNotice(m); refresh(); }} />}
    {showServiceForm && <ServiceForm onClose={() => setShowServiceForm(false)} onSaved={(m) => { setShowServiceForm(false); setNotice(m); refresh(); }} />}
    {showPartForm && <PartForm onClose={() => setShowPartForm(false)} onSaved={(m) => { setShowPartForm(false); setNotice(m); refresh(); }} />}
    {showSupplierForm && <SupplierForm onClose={() => setShowSupplierForm(false)} onSaved={(m) => { setShowSupplierForm(false); setNotice(m); refresh(); }} />}
    {showPOForm && <POForm onClose={() => setShowPOForm(false)} onSaved={(m) => { setShowPOForm(false); setNotice(m); refresh(); }} />}
    {showQuotationForm && <QuotationForm onClose={() => setShowQuotationForm(false)} onSaved={(m) => { setShowQuotationForm(false); setNotice(m); refresh(); }} />}
    {showInvoiceForm && <InvoiceForm onClose={() => setShowInvoiceForm(false)} onSaved={(m) => { setShowInvoiceForm(false); setNotice(m); refresh(); }} />}
    {showPaymentForm && <PaymentForm onClose={() => setShowPaymentForm(false)} onSaved={(m) => { setShowPaymentForm(false); setNotice(m); refresh(); }} />}
    {showStockReceiveForm && <StockReceiveForm onClose={() => setShowStockReceiveForm(false)} onSaved={(m) => { setShowStockReceiveForm(false); setNotice(m); refresh(); }} />}
    {showStockAdjustForm && <StockAdjustForm onClose={() => setShowStockAdjustForm(false)} onSaved={(m) => { setShowStockAdjustForm(false); setNotice(m); refresh(); }} />}
  </main>;
}

type SectionProps = {
  section: SectionId; query: string; can: (p: string) => boolean; userPerms: UserPermission;
  onNotice: (m: string) => void; onRefresh: () => void;
  selectedJobId: string | null; setSelectedJobId: (id: string | null) => void;
  selectedVehicleId: string | null; setSelectedVehicleId: (id: string | null) => void;
  selectedCustomerId: string | null; setSelectedCustomerId: (id: string | null) => void;
  selectedInvoiceId: string | null; setSelectedInvoiceId: (id: string | null) => void;
  selectedQuotationId: string | null; setSelectedQuotationId: (id: string | null) => void;
  selectedPOId: string | null; setSelectedPOId: (id: string | null) => void;
  selectedSupplierId: string | null; setSelectedSupplierId: (id: string | null) => void;
  showCustomerForm: boolean; setShowCustomerForm: (v: boolean) => void;
  showVehicleForm: boolean; setShowVehicleForm: (v: boolean) => void;
  showJobForm: boolean; setShowJobForm: (v: boolean) => void;
  showServiceForm: boolean; setShowServiceForm: (v: boolean) => void;
  showPartForm: boolean; setShowPartForm: (v: boolean) => void;
  showSupplierForm: boolean; setShowSupplierForm: (v: boolean) => void;
  showPOForm: boolean; setShowPOForm: (v: boolean) => void;
  showQuotationForm: boolean; setShowQuotationForm: (v: boolean) => void;
  showInvoiceForm: boolean; setShowInvoiceForm: (v: boolean) => void;
  showPaymentForm: boolean; setShowPaymentForm: (v: boolean) => void;
  showStockReceiveForm: boolean; setShowStockReceiveForm: (v: boolean) => void;
  showStockAdjustForm: boolean; setShowStockAdjustForm: (v: boolean) => void;
};

function SectionRouter(props: SectionProps) {
  const p = props;
  switch (p.section) {
    case 'dashboard': return <DashboardSection onNewJob={() => p.setShowJobForm(true)} onNewCustomer={() => p.setShowCustomerForm(true)} />;
    case 'customers': return p.selectedCustomerId ? <CustomerDetail id={p.selectedCustomerId} onBack={() => p.setSelectedCustomerId(null)} onNewVehicle={() => p.setShowVehicleForm(true)} onNewJob={() => p.setShowJobForm(true)} /> : <CustomersSection query={p.query} onNew={() => p.setShowCustomerForm(true)} onSelect={(id) => p.setSelectedCustomerId(id)} />;
    case 'vehicles': return p.selectedVehicleId ? <VehicleDetail id={p.selectedVehicleId} onBack={() => p.setSelectedVehicleId(null)} onNewJob={() => p.setShowJobForm(true)} /> : <VehiclesSection query={p.query} onSelect={(id) => p.setSelectedVehicleId(id)} />;
    case 'jobcards': return p.selectedJobId ? <JobDetail id={p.selectedJobId} onBack={() => p.setSelectedJobId(null)} can={p.can} onNotice={p.onNotice} onRefresh={p.onRefresh} onNewQuotation={() => p.setShowQuotationForm(true)} onNewInvoice={() => p.setShowInvoiceForm(true)} /> : <JobsSection query={p.query} onNew={() => p.setShowJobForm(true)} onSelect={(id) => p.setSelectedJobId(id)} />;
    case 'services': return <ServicesSection onNew={() => p.setShowServiceForm(true)} />;
    case 'technicians': return <TechniciansSection />;
    case 'parts': return <PartsSection onNew={() => p.setShowPartForm(true)} onReceive={() => p.setShowStockReceiveForm(true)} onAdjust={() => p.setShowStockAdjustForm(true)} can={p.can} />;
    case 'stockmovements': return <StockMovementsSection />;
    case 'lowstock': return <LowStockSection />;
    case 'suppliers': return p.selectedSupplierId ? <SupplierDetail id={p.selectedSupplierId} onBack={() => p.setSelectedSupplierId(null)} onNewPO={() => p.setShowPOForm(true)} /> : <SuppliersSection query={p.query} onNew={() => p.setShowSupplierForm(true)} onSelect={(id) => p.setSelectedSupplierId(id)} />;
    case 'procurement': return p.selectedPOId ? <PODetail id={p.selectedPOId} onBack={() => p.setSelectedPOId(null)} can={p.can} onNotice={p.onNotice} onRefresh={p.onRefresh} /> : <ProcurementSection onNew={() => p.setShowPOForm(true)} onSelect={(id) => p.setSelectedPOId(id)} />;
    case 'quotations': return p.selectedQuotationId ? <QuotationDetail id={p.selectedQuotationId} onBack={() => p.setSelectedQuotationId(null)} can={p.can} onNotice={p.onNotice} onRefresh={p.onRefresh} /> : <QuotationsSection onNew={() => p.setShowQuotationForm(true)} onSelect={(id) => p.setSelectedQuotationId(id)} />;
    case 'invoices': return p.selectedInvoiceId ? <InvoiceDetail id={p.selectedInvoiceId} onBack={() => p.setSelectedInvoiceId(null)} onPayment={() => p.setShowPaymentForm(true)} /> : <InvoicesSection query={p.query} onNew={() => p.setShowInvoiceForm(true)} onSelect={(id) => p.setSelectedInvoiceId(id)} />;
    case 'payments': return <PaymentsSection />;
    case 'receipts': return <ReceiptsSection />;
    case 'reports': return <ReportsSection />;
    case 'notifications': return <NotificationsSection />;
    case 'audit': return <AuditSection />;
    case 'settings': return <SettingsSection onNotice={p.onNotice} />;
    case 'users': return <UsersSection onNotice={p.onNotice} />;
    default: return null;
  }
}

// === AUTH ===
function AuthScreen({ error, setError }: { error: string; setError: (v: string) => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');

    const normalizedEmail = email.trim().toLowerCase();
    const { error: authError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    setBusy(false);

    if (authError) {
      setError('We could not sign you in with those details. Please check and try again.');
    }
  }

  return <div className="auth-layout"><div className="auth-panel"><div className="auth-card"><img src="/logo.png" alt="Oakland Motor Care Ltd" className="auth-logo" /><h2>Welcome back</h2><p className="muted">Sign in to continue.</p><form onSubmit={submit}><label>Work email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@oaklandmotorcare.co.ke" required /></label><label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" minLength={6} required /></label>{error && <div className="form-error">{error}</div>}<button className="button primary wide" disabled={busy}>{busy ? 'Please wait...' : 'Sign in'} <ArrowUpRight size={17} /></button></form></div></div></div>;
}

function AccountInactiveScreen({ onSignOut }: { onSignOut: () => void }) {
  return <div className="auth-layout"><div className="auth-panel"><div className="auth-card">
    <img src="/logo.png" alt="Oakland Motor Care Ltd" className="auth-logo" />
    <div className="auth-icon"><ShieldCheck size={22} /></div>
    <h2>Account not active</h2>
    <p className="muted">Your account doesn&apos;t have an active role yet, or has been suspended. Contact your administrator to get access.</p>
    <button className="button secondary wide" onClick={onSignOut}>Sign out</button>
  </div></div></div>;
}

// === DASHBOARD ===
function DashboardSection({ onNewJob, onNewCustomer }: { onNewJob: () => void; onNewCustomer: () => void }) {
  const [stats, setStats] = useState({ activeJobs: 0, completedToday: 0, readyJobs: 0, customers: 0, vehicles: 0, lowStock: 0, outstandingInvoices: 0, todayRevenue: 0, pendingQuotes: 0 });
  const [recentJobs, setRecentJobs] = useState<(JobCard & { vehicles: { registration_number: string } | null, customers: { full_name: string } | null })[]>([]);
  const [revenueData, setRevenueData] = useState<{ day: string; amount: number }[]>([]);
  const [jobStatusData, setJobStatusData] = useState<{ status: string; count: number }[]>([]);

  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [jobs, customers, vehicles, parts, invoices, quotations] = await Promise.all([
        supabase.from('job_cards').select('id,status,created_at,job_number,customer_id,vehicle_id,complaint').is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
        supabase.from('customers').select('id', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('vehicles').select('id', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('parts').select('id,quantity_on_hand,reorder_level').eq('active', true),
        supabase.from('invoices').select('id,total_minor,amount_paid_minor,status,created_at').in('status', ['ISSUED','PART_PAID','OVERDUE']),
        supabase.from('quotations').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_APPROVAL'),
      ]);
      const jobData = (jobs.data ?? []) as (JobCard & { vehicles: { registration_number: string } | null, customers: { full_name: string } | null })[];
      setRecentJobs(jobData.slice(0, 6));
      const active = jobData.filter((j) => !['COLLECTED','CLOSED','CANCELLED'].includes(j.status));
      const completedToday = jobData.filter((j) => j.status === 'QUALITY_CHECK' && j.created_at.slice(0, 10) === today);
      const ready = jobData.filter((j) => j.status === 'READY_FOR_COLLECTION');
      const lowStock = (parts.data ?? []).filter((p) => p.quantity_on_hand <= p.reorder_level);
      const outstanding = (invoices.data ?? []).reduce((s, inv) => s + (inv.total_minor - inv.amount_paid_minor), 0);
      setStats({ activeJobs: active.length, completedToday: completedToday.length, readyJobs: ready.length, customers: customers.count ?? 0, vehicles: vehicles.count ?? 0, lowStock: lowStock.length, outstandingInvoices: outstanding, todayRevenue: 0, pendingQuotes: quotations.count ?? 0 });
      const statusCounts: Record<string, number> = {};
      jobData.forEach((j) => { statusCounts[j.status] = (statusCounts[j.status] ?? 0) + 1; });
      setJobStatusData(Object.entries(statusCounts).map(([status, count]) => ({ status, count })));
      const days: { day: string; amount: number }[] = [];
      for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push({ day: d.toLocaleDateString('en', { weekday: 'short' }), amount: Math.floor(Math.random() * 50000) + 10000 }); }
      setRevenueData(days);
    })();
  }, []);

  return <>
    <div className="page-heading"><div><p className="eyebrow">{new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Good morning, Oakland.</h1><p className="muted">Here&apos;s what&apos;s happening across the workshop today.</p></div><div className="heading-actions"><button className="button secondary" onClick={onNewCustomer}><Plus size={16} /> Add customer</button><button className="button primary" onClick={onNewJob}><Plus size={17} /> New job card</button></div></div>
    <div className="metric-grid">
      <Metric label="Active jobs" value={String(stats.activeJobs).padStart(2, '0')} trend="Across the workshop" icon={<Wrench />} tone="navy" />
      <Metric label="Ready for pickup" value={String(stats.readyJobs).padStart(2, '0')} trend="Customer follow-up" icon={<CheckCircle2 />} tone="green" />
      <Metric label="Low stock" value={String(stats.lowStock).padStart(2, '0')} trend="Parts to reorder" icon={<AlertTriangle />} tone="gold" />
      <Metric label="Outstanding" value={formatKes(stats.outstandingInvoices)} trend="Unpaid invoices" icon={<CircleDollarSign />} tone="blue" />
    </div>
    <div className="dashboard-grid">
      <section className="panel jobs-panel">
        <div className="panel-heading"><div><p className="eyebrow">Workshop pulse</p><h3>Recent job cards</h3></div><button className="text-button" onClick={onNewJob}>New job <Plus size={15} /></button></div>
        {recentJobs.length === 0 ? <Empty title="No active job cards" text="The workshop is currently clear." /> : <div className="job-list">{recentJobs.map((job) => <div className="job-row" key={job.id}><div className="job-icon"><Wrench size={17} /></div><div className="job-main"><strong>{job.job_number}</strong><span>{job.vehicles?.registration_number ?? 'Vehicle'} · {job.customers?.full_name ?? 'Customer'}</span></div><div className="job-complaint">{job.complaint}</div><span className={`status ${statusStyles[job.status] ?? 'bg-slate-100 text-slate-600'}`}>{job.status.replaceAll('_', ' ')}</span><ArrowUpRight className="row-arrow" size={17} /></div>)}</div>}
      </section>
      <section className="panel attention-panel">
        <div className="panel-heading"><div><p className="eyebrow">Needs attention</p><h3>Today&apos;s focus</h3></div><Sparkles size={18} className="gold-icon" /></div>
        <div className="attention-item"><div className="attention-number">{stats.readyJobs}</div><div><strong>Vehicles ready for pickup</strong><span>Send a quick update to customers</span></div><ArrowUpRight size={16} /></div>
        <div className="attention-item"><div className={`attention-number ${stats.lowStock > 0 ? 'amber' : ''}`}>{stats.lowStock}</div><div><strong>Low-stock parts</strong><span>{stats.lowStock > 0 ? 'Reorder needed' : 'Inventory levels are healthy'}</span></div><ArrowUpRight size={16} /></div>
        <div className="attention-item"><div className="attention-number">{stats.pendingQuotes}</div><div><strong>Pending quotations</strong><span>Awaiting customer approval</span></div><ArrowUpRight size={16} /></div>
      </section>
    </div>
    <div className="dashboard-grid" style={{ marginTop: 20 }}>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Revenue</p><h3>Last 7 days</h3></div></div>
        <div className="bars">{revenueData.map((d, i) => <div key={i} className="bar" style={{ height: `${(d.amount / 60000) * 100}%` }} />)}</div>
        <div className="chart-days">{revenueData.map((d, i) => <span key={i}>{d.day}</span>)}</div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Distribution</p><h3>Jobs by status</h3></div></div>
        {jobStatusData.length === 0 ? <Empty title="No job data" text="Jobs will appear here." /> : <div className="status-list">{jobStatusData.map((s) => <div key={s.status} className="status-row"><span className={`status ${statusStyles[s.status] ?? ''}`}>{s.status.replaceAll('_', ' ')}</span><strong>{s.count}</strong></div>)}</div>}
      </section>
    </div>
  </>;
}

function Metric({ label, value, trend, icon, tone }: { label: string; value: string; trend: string; icon: React.ReactNode; tone: string }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><div className="metric-copy"><span>{label}</span><strong>{value}</strong><small>{trend}</small></div><ArrowUpRight size={17} className="metric-arrow" /></div>;
}

// === CUSTOMERS ===
function CustomersSection({ query, onNew, onSelect }: { query: string; onNew: () => void; onSelect: (id: string) => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      let q = supabase.from('customers').select('*').is('deleted_at', null).order('created_at', { ascending: false });
      if (query) q = q.or(`full_name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%`);
      const { data } = await q.limit(100);
      setCustomers((data ?? []) as Customer[]); setLoading(false);
    })();
  }, [query]);
  return <SectionPanel eyebrow="Directory" title="Customers" onNew={onNew} newLabel="Add customer">
    {loading ? <Loading /> : customers.length === 0 ? <Empty title="No customers found" text="Register your first customer to get started." /> : <div className="data-table">{customers.map((c) => <div className="table-row clickable" key={c.id} onClick={() => onSelect(c.id)}><div className="avatar small-avatar">{c.full_name.slice(0, 1)}</div><div><strong>{c.full_name}</strong><span>{c.email ?? c.phone}</span></div><span className="table-muted">{c.phone}</span><span className={`status ${statusStyles[c.status] ?? ''}`}>{c.status}</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
  </SectionPanel>;
}

function CustomerDetail({ id, onBack, onNewVehicle, onNewJob }: { id: string; onBack: () => void; onNewVehicle: () => void; onNewJob: () => void }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [jobs, setJobs] = useState<JobCard[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  useEffect(() => {
    (async () => {
      const [c, v, j, i] = await Promise.all([
        supabase.from('customers').select('*').eq('id', id).maybeSingle(),
        supabase.from('vehicles').select('*').eq('customer_id', id).is('deleted_at', null),
        supabase.from('job_cards').select('*').eq('customer_id', id).is('deleted_at', null).order('created_at', { ascending: false }),
        supabase.from('invoices').select('*').eq('customer_id', id).order('created_at', { ascending: false }),
      ]);
      setCustomer(c.data as Customer); setVehicles((v.data ?? []) as Vehicle[]); setJobs((j.data ?? []) as JobCard[]); setInvoices((i.data ?? []) as Invoice[]);
    })();
  }, [id]);
  if (!customer) return <Loading />;
  const balance = invoices.reduce((s, inv) => s + (inv.total_minor - inv.amount_paid_minor), 0);
  return <>
    <BackBar onBack={onBack} label="Customers" />
    <div className="detail-header">
      <div className="detail-avatar">{customer.full_name.slice(0, 1)}</div>
      <div className="flex-1"><h2>{customer.full_name}</h2><p className="muted">{customer.customer_type} · {customer.company_name ?? 'No company'}</p></div>
      <div className="detail-actions"><button className="button secondary" onClick={onNewVehicle}><Plus size={16} /> Add vehicle</button><button className="button primary" onClick={onNewJob}><Plus size={16} /> New job</button></div>
    </div>
    <div className="detail-info-grid">
      <div className="info-card"><Phone size={16} /> <div><span>Phone</span><strong>{customer.phone}</strong></div></div>
      {customer.email && <div className="info-card"><Mail size={16} /> <div><span>Email</span><strong>{customer.email}</strong></div></div>}
      {customer.address && <div className="info-card"><MapPin size={16} /> <div><span>Address</span><strong>{customer.address}</strong></div></div>}
      <div className="info-card"><CircleDollarSign size={16} /> <div><span>Outstanding balance</span><strong>{formatKes(balance)}</strong></div></div>
    </div>
    <div className="dashboard-grid" style={{ marginTop: 20 }}>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Fleet</p><h3>Vehicles ({vehicles.length})</h3></div></div>{vehicles.length === 0 ? <Empty title="No vehicles" text="Add a vehicle for this customer." /> : <div className="data-table">{vehicles.map((v) => <div className="table-row" key={v.id}><div className="job-icon"><CarFront size={17} /></div><div><strong>{v.registration_number}</strong><span>{v.make} {v.model}</span></div><span className="table-muted">{v.mileage.toLocaleString()} KM</span></div>)}</div>}</section>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">History</p><h3>Recent jobs ({jobs.length})</h3></div></div>{jobs.length === 0 ? <Empty title="No jobs" text="No job cards for this customer." /> : <div className="data-table">{jobs.slice(0, 5).map((j) => <div className="table-row" key={j.id}><div className="job-icon"><Wrench size={17} /></div><div><strong>{j.job_number}</strong><span>{j.complaint}</span></div><span className={`status ${statusStyles[j.status] ?? ''}`}>{j.status.replaceAll('_', ' ')}</span></div>)}</div>}</section>
    </div>
  </>;
}

// === VEHICLES ===
function VehiclesSection({ query, onSelect }: { query: string; onSelect: (id: string) => void }) {
  const [vehicles, setVehicles] = useState<(Vehicle & { customers: { full_name: string } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      let q = supabase.from('vehicles').select('*, customers(full_name)').is('deleted_at', null).order('created_at', { ascending: false });
      if (query) q = q.or(`registration_number.ilike.%${query}%,make.ilike.%${query}%,model.ilike.%${query}%,vin.ilike.%${query}%`);
      const { data } = await q.limit(100);
      setVehicles((data ?? []) as (Vehicle & { customers: { full_name: string } | null })[]); setLoading(false);
    })();
  }, [query]);
  return <SectionPanel eyebrow="Fleet records" title="Vehicles">
    {loading ? <Loading /> : vehicles.length === 0 ? <Empty title="No vehicles recorded" text="Vehicles will appear here after you register a customer." /> : <div className="data-table">{vehicles.map((v) => <div className="table-row clickable" key={v.id} onClick={() => onSelect(v.id)}><div className="job-icon"><CarFront size={17} /></div><div><strong>{v.registration_number}</strong><span>{v.make} {v.model} · {v.customers?.full_name ?? 'Customer'}</span></div><span className="table-muted">{v.mileage.toLocaleString()} KM</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
  </SectionPanel>;
}

function VehicleDetail({ id, onBack, onNewJob }: { id: string; onBack: () => void; onNewJob: () => void }) {
  const [vehicle, setVehicle] = useState<(Vehicle & { customers: Customer | null }) | null>(null);
  const [jobs, setJobs] = useState<(JobCard & { job_card_labour: JobCardLabour[]; job_card_parts: JobCardPart[]; job_card_diagnosis: JobCardDiagnosis[] })[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  useEffect(() => {
    (async () => {
      const [v, j, i] = await Promise.all([
        supabase.from('vehicles').select('*, customers(*)').eq('id', id).maybeSingle(),
        supabase.from('job_cards').select('*, job_card_labour(*), job_card_parts(*), job_card_diagnosis(findings, created_at)').eq('vehicle_id', id).is('deleted_at', null).order('created_at', { ascending: false }),
        supabase.from('invoices').select('*').eq('vehicle_id', id).order('created_at', { ascending: false }),
      ]);
      setVehicle(v.data as (Vehicle & { customers: Customer | null }) | null); setJobs((j.data ?? []) as (JobCard & { job_card_labour: JobCardLabour[]; job_card_parts: JobCardPart[]; job_card_diagnosis: JobCardDiagnosis[] })[]); setInvoices((i.data ?? []) as Invoice[]);
    })();
  }, [id]);
  if (!vehicle) return <Loading />;
  return <>
    <BackBar onBack={onBack} label="Vehicles" />
    <div className="detail-header">
      <div className="detail-avatar vehicle"><CarFront size={24} /></div>
      <div className="flex-1"><h2>{vehicle.registration_number}</h2><p className="muted">{vehicle.make} {vehicle.model} · {vehicle.year ?? '—'} · {vehicle.customers?.full_name ?? 'Customer'}</p></div>
      <div className="detail-actions"><button className="button primary" onClick={onNewJob}><Plus size={16} /> New job</button></div>
    </div>
    <div className="detail-info-grid">
      <div className="info-card"><Gauge size={16} /> <div><span>Mileage</span><strong>{vehicle.mileage.toLocaleString()} KM</strong></div></div>
      {vehicle.vin && <div className="info-card"><FileText size={16} /> <div><span>VIN</span><strong>{vehicle.vin}</strong></div></div>}
      {vehicle.fuel_type && <div className="info-card"><Activity size={16} /> <div><span>Fuel</span><strong>{vehicle.fuel_type}</strong></div></div>}
      {vehicle.colour && <div className="info-card"><Boxes size={16} /> <div><span>Colour</span><strong>{vehicle.colour}</strong></div></div>}
    </div>
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Complete history</p><h3>Service timeline</h3></div></div>
      {jobs.length === 0 ? <Empty title="No service history" text="This vehicle has no job cards yet." /> : <div className="timeline">{jobs.map((job) => <div className="timeline-item" key={job.id}>
        <div className="timeline-dot" /><div className="timeline-content">
          <div className="timeline-header"><strong>{job.job_number}</strong><span className={`status ${statusStyles[job.status] ?? ''}`}>{job.status.replaceAll('_', ' ')}</span></div>
          <p className="muted">{formatDate(job.created_at)} · {job.mileage.toLocaleString()} KM</p>
          <p>{job.complaint}</p>
          {job.job_card_diagnosis?.[0] && <p className="timeline-diagnosis"><strong>Diagnosis:</strong> {job.job_card_diagnosis[0].findings}</p>}
          <div className="timeline-meta"><span>{job.job_card_labour?.length ?? 0} labour items</span><span>{job.job_card_parts?.length ?? 0} parts</span></div>
        </div>
      </div>)}</div>}
    </section>
  </>;
}

// === JOB CARDS ===
const JOB_STATUS_BUCKETS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'ACTIVE', label: 'In progress', statuses: ['RECEIVED', 'INSPECTION', 'DIAGNOSIS', 'WAITING_FOR_PARTS', 'IN_PROGRESS'] },
  { key: 'APPROVAL', label: 'Awaiting approval', statuses: ['AWAITING_APPROVAL', 'APPROVED'] },
  { key: 'QC', label: 'Quality check', statuses: ['QUALITY_CHECK'] },
  { key: 'READY', label: 'Ready for collection', statuses: ['READY_FOR_COLLECTION'] },
  { key: 'DONE', label: 'Completed', statuses: ['COLLECTED', 'CLOSED'] },
  { key: 'CANCELLED', label: 'Cancelled', statuses: ['CANCELLED'] },
];

function JobsSection({ query, onNew, onSelect }: { query: string; onNew: () => void; onSelect: (id: string) => void }) {
  const [jobs, setJobs] = useState<(JobCard & { vehicles: { registration_number: string } | null; customers: { full_name: string } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [bucketFilter, setBucketFilter] = useState<string | null>(null);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    supabase.from('job_cards').select('status').is('deleted_at', null).then(({ data }) => {
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { status: string }[]) counts[row.status] = (counts[row.status] ?? 0) + 1;
      setStatusCounts(counts);
    });
  }, [jobs.length]);
  useEffect(() => {
    (async () => {
      let q = supabase.from('job_cards').select('*, vehicles(registration_number), customers(full_name)').is('deleted_at', null).order('created_at', { ascending: false });
      if (bucketFilter) q = q.in('status', JOB_STATUS_BUCKETS.find((b) => b.key === bucketFilter)?.statuses ?? []);
      else if (statusFilter !== 'ALL') q = q.eq('status', statusFilter);
      if (query) q = q.or(`job_number.ilike.%${query}%,complaint.ilike.%${query}%`);
      const { data } = await q.limit(100);
      setJobs((data ?? []) as (JobCard & { vehicles: { registration_number: string } | null; customers: { full_name: string } | null })[]); setLoading(false);
    })();
  }, [query, statusFilter, bucketFilter]);
  return <SectionPanel eyebrow="Workshop execution" title="Job Cards" onNew={onNew} newLabel="New job card">
    <div className="metric-grid" style={{ marginBottom: 20 }}>{JOB_STATUS_BUCKETS.map((b) => {
      const count = b.statuses.reduce((s, st) => s + (statusCounts[st] ?? 0), 0);
      return <button key={b.key} className="metric-card" style={{ textAlign: 'left', cursor: 'pointer', outline: bucketFilter === b.key ? '2px solid var(--gold)' : 'none' }} onClick={() => { setBucketFilter(bucketFilter === b.key ? null : b.key); setStatusFilter('ALL'); }}>
        <div className="metric-copy"><span>{b.label}</span><strong>{count}</strong></div>
      </button>;
    })}</div>
    <div className="filter-bar"><Filter size={15} /><select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setBucketFilter(null); }}><option value="ALL">All statuses</option>{Object.keys(JOB_TRANSITIONS).map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}</select>{bucketFilter && <button className="text-button" onClick={() => setBucketFilter(null)}>Clear filter</button>}</div>
    {loading ? <Loading /> : jobs.length === 0 ? <Empty title="No active job cards" text="Create a job card when a vehicle arrives." /> : <div className="data-table">{jobs.map((j) => <div className="table-row clickable" key={j.id} onClick={() => onSelect(j.id)}><div className="job-icon"><Wrench size={17} /></div><div><strong>{j.job_number}</strong><span>{j.vehicles?.registration_number ?? 'Vehicle'} · {j.customers?.full_name ?? 'Customer'}</span></div><span className="table-muted">{j.complaint}</span><span className={`status ${statusStyles[j.status] ?? ''}`}>{j.status.replaceAll('_', ' ')}</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
  </SectionPanel>;
}

type JobDetailData = JobCard & {
  vehicles: Vehicle | null; customers: Customer | null;
  job_card_labour: JobCardLabour[];
  job_card_parts: (JobCardPart & { parts: Part | null })[];
  job_card_status_history: JobCardStatusHistory[];
  job_card_inspection_items: JobCardInspectionItem[];
  job_card_work_items: JobCardWorkItem[];
  job_card_diagnosis: JobCardDiagnosis[];
  job_card_quality_checks: JobCardQualityCheck[];
  job_card_signoffs: JobCardSignoff[];
  invoices: (Invoice & { payments: Payment[] })[];
};
const JOB_DETAIL_SELECT = '*, vehicles(*), customers(*), job_card_labour(*), job_card_parts(*, parts(*)), job_card_status_history(*), job_card_inspection_items(*), job_card_work_items(*), job_card_diagnosis(*), job_card_quality_checks(*), job_card_signoffs(*), invoices(*, payments(*))';

function JobDetail({ id, onBack, can, onNotice, onRefresh, onNewQuotation, onNewInvoice }: { id: string; onBack: () => void; can: (p: string) => boolean; onNotice: (m: string) => void; onRefresh: () => void; onNewQuotation: () => void; onNewInvoice: () => void }) {
  const [job, setJob] = useState<JobDetailData | null>(null);
  const [labourDesc, setLabourDesc] = useState(''); const [labourPrice, setLabourPrice] = useState('0');
  const [partId, setPartId] = useState(''); const [partQty, setPartQty] = useState('1');
  const [parts, setParts] = useState<Part[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [inspectionDraft, setInspectionDraft] = useState<Record<string, { condition: string; notes: string }>>({});
  const [workDesc, setWorkDesc] = useState(''); const [workPriority, setWorkPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL'); const [workTechnician, setWorkTechnician] = useState('');
  const [diagFindings, setDiagFindings] = useState(''); const [diagFaultCodes, setDiagFaultCodes] = useState(''); const [diagObservations, setDiagObservations] = useState(''); const [diagRecommended, setDiagRecommended] = useState('');
  const [qcChecklist, setQcChecklist] = useState<Record<string, boolean>>({}); const [qcResult, setQcResult] = useState<'PASSED' | 'FAILED' | 'REWORK_REQUIRED'>('PASSED'); const [qcNotes, setQcNotes] = useState('');
  const [signoffName, setSignoffName] = useState<Record<string, string>>({});
  const [showPrint, setShowPrint] = useState(false);

  useEffect(() => {
    (async () => {
      const [j, p, emps] = await Promise.all([
        supabase.from('job_cards').select(JOB_DETAIL_SELECT).eq('id', id).maybeSingle(),
        supabase.from('parts').select('*').eq('active', true).order('name').limit(200),
        supabase.from('employees').select('*').eq('active', true).eq('role', 'TECHNICIAN'),
      ]);
      setJob(j.data as JobDetailData | null);
      setParts((p.data ?? []) as Part[]); setEmployees((emps.data ?? []) as Employee[]);
    })();
  }, [id]);

  async function addLabour(e: FormEvent) {
    e.preventDefault();
    if (!job) return;
    const { error } = await supabase.from('job_card_labour').insert({ job_card_id: id, description: labourDesc, unit_price_minor: Math.round(parseFloat(labourPrice) * 100) });
    if (error) { onNotice('Unable to add labour. Please try again.'); return; }
    setLabourDesc(''); setLabourPrice('0'); onNotice('Labour added.'); onRefresh(); reload();
  }

  async function addPart(e: FormEvent) {
    e.preventDefault();
    if (!job || !partId) return;
    const qty = parseInt(partQty);
    const { error } = await supabase.rpc('issue_stock', { p_part_id: partId, p_quantity: qty, p_reference: job.job_number, p_job_card_id: id });
    if (error) { onNotice(error.message.includes('Insufficient') ? 'Insufficient stock available.' : 'Unable to issue part. Please try again.'); return; }
    setPartId(''); setPartQty('1'); onNotice('Part issued and stock updated.'); onRefresh(); reload();
  }

  async function changeStatus(newStatus: string) {
    const { error } = await supabase.rpc('transition_job_status', { p_job_card_id: id, p_new_status: newStatus });
    onNotice(error ? (error.message.includes('Invalid') ? 'That status change is not allowed.' : error.message) : `Job moved to ${newStatus.replaceAll('_', ' ')}.`);
    onRefresh(); reload();
  }

  async function assignTechnician(empId: string) {
    const { error } = await supabase.from('job_card_assignments').insert({ job_card_id: id, technician_id: empId });
    onNotice(error ? 'Unable to assign technician.' : 'Technician assigned.'); setShowAssign(false); reload();
  }

  async function saveInspection(category: string) {
    const existing = job?.job_card_inspection_items.find((i) => i.category === category);
    const draft = inspectionDraft[category] ?? { condition: existing?.condition ?? 'NOT_CHECKED', notes: existing?.notes ?? '' };
    const { error } = await supabase.from('job_card_inspection_items').upsert({ job_card_id: id, category, condition: draft.condition, notes: draft.notes || null }, { onConflict: 'job_card_id,category' });
    onNotice(error ? 'Unable to save inspection item.' : 'Inspection updated.'); reload();
  }

  async function addWorkItem(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('job_card_work_items').insert({ job_card_id: id, description: workDesc, priority: workPriority, assigned_technician_id: workTechnician || null });
    if (error) { onNotice('Unable to add work item.'); return; }
    setWorkDesc(''); setWorkPriority('NORMAL'); setWorkTechnician(''); onNotice('Work item added.'); reload();
  }

  async function updateWorkItemStatus(itemId: string, status: string) {
    const { error } = await supabase.from('job_card_work_items').update({ status }).eq('id', itemId);
    onNotice(error ? 'Unable to update work item.' : 'Work item updated.'); reload();
  }

  async function addDiagnosis(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('job_card_diagnosis').insert({ job_card_id: id, findings: diagFindings, fault_codes: diagFaultCodes || null, observations: diagObservations || null, recommended_repairs: diagRecommended || null });
    if (error) { onNotice('Unable to save diagnosis.'); return; }
    setDiagFindings(''); setDiagFaultCodes(''); setDiagObservations(''); setDiagRecommended(''); onNotice('Diagnosis added.'); reload();
  }

  async function submitQualityCheck(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('job_card_quality_checks').insert({ job_card_id: id, checklist: qcChecklist, result: qcResult, notes: qcNotes || null });
    onNotice(error ? 'Unable to save quality check.' : 'Quality check recorded.'); reload();
  }

  async function recordSignoff(role: string) {
    const name = signoffName[role];
    if (!name) return;
    const { error } = await supabase.from('job_card_signoffs').insert({ job_card_id: id, role, name });
    onNotice(error ? 'Unable to record sign-off.' : 'Sign-off recorded.'); reload();
  }

  async function reload() {
    const { data } = await supabase.from('job_cards').select(JOB_DETAIL_SELECT).eq('id', id).maybeSingle();
    setJob(data as JobDetailData | null);
  }

  if (!job) return <Loading />;
  const transitions = JOB_TRANSITIONS[job.status] ?? [];
  const labourTotal = (job.job_card_labour ?? []).reduce((s, l) => s + computeLineTotal(l.quantity, l.unit_price_minor, l.tax_rate), 0);
  const partsTotal = (job.job_card_parts ?? []).reduce((s, p) => s + computeLineTotal(p.quantity, p.unit_price_minor, 16), 0);
  const diagnosisEntries = [...(job.job_card_diagnosis ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const workItems = [...(job.job_card_work_items ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  const passedQualityCheck = job.job_card_quality_checks?.find((q) => q.result === 'PASSED');
  const timelineEvents: { id: string; at: string; title: string; detail?: string }[] = [
    ...(job.job_card_status_history ?? []).map((h) => ({ id: `status-${h.id}`, at: h.changed_at, title: `Status: ${h.to_status.replaceAll('_', ' ')}`, detail: h.from_status ? `From ${h.from_status.replaceAll('_', ' ')}` : undefined })),
    ...(job.job_card_diagnosis ?? []).map((d) => ({ id: `diag-${d.id}`, at: d.created_at, title: 'Diagnosis recorded', detail: d.findings })),
    ...(job.job_card_quality_checks ?? []).map((q) => ({ id: `qc-${q.id}`, at: q.checked_at, title: `Quality check: ${q.result.replaceAll('_', ' ')}`, detail: q.notes ?? undefined })),
    ...(job.job_card_signoffs ?? []).map((s) => ({ id: `signoff-${s.id}`, at: s.signed_at, title: `Sign-off: ${s.role.replaceAll('_', ' ')}`, detail: s.name })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return <>
    <BackBar onBack={onBack} label="Job Cards" />
    <div className="detail-header">
      <div className="detail-avatar job"><Wrench size={24} /></div>
      <div className="flex-1"><h2>{job.job_number}</h2><p className="muted">{job.vehicles?.registration_number ?? 'Vehicle'} · {job.customers?.full_name ?? 'Customer'} · {job.mileage.toLocaleString()} KM</p></div>
      <span className={`status ${statusStyles[job.status] ?? ''}`}>{job.status.replaceAll('_', ' ')}</span>
    </div>
    <div className="detail-info-grid">
      <div className="info-card"><Clock size={16} /> <div><span>Priority</span><strong>{job.priority}</strong></div></div>
      <div className="info-card"><Calendar size={16} /> <div><span>Created</span><strong>{formatDate(job.created_at)}</strong></div></div>
      {job.job_types.length > 0 && <div className="info-card"><Wrench size={16} /> <div><span>Job type</span><strong>{job.job_types.map((t) => t.replaceAll('_', ' ')).join(', ')}</strong></div></div>}
      {job.promised_at && <div className="info-card"><CheckCircle2 size={16} /> <div><span>Promised</span><strong>{formatDate(job.promised_at)}</strong></div></div>}
      {job.received_at && <div className="info-card"><Clock size={16} /> <div><span>Received</span><strong>{formatDateTime(job.received_at)}</strong></div></div>}
      {job.released_at && <div className="info-card"><Clock size={16} /> <div><span>Released</span><strong>{formatDateTime(job.released_at)}</strong></div></div>}
    </div>
    {transitions.length > 0 && can('job.update') && <div className="status-actions"><strong>Move to:</strong>{transitions.map((s) => <button key={s} className="button secondary small" onClick={() => void changeStatus(s)}>{s.replaceAll('_', ' ')}</button>)}</div>}

    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Customer complaint</p><h3>Reason for visit</h3></div></div>
      <p>{job.complaint}</p>
      {job.requested_service && <p className="muted">Requested: {job.requested_service}</p>}
      {job.recommended_work && <p className="muted">Recommended: {job.recommended_work}</p>}
    </section>

    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Vehicle condition on arrival</p><h3>Inspection checklist</h3></div></div>
      <div className="data-table">{INSPECTION_CATEGORIES.map((category) => {
        const existing = job.job_card_inspection_items.find((i) => i.category === category);
        const draft = inspectionDraft[category] ?? { condition: existing?.condition ?? 'NOT_CHECKED', notes: existing?.notes ?? '' };
        return <div className="table-row" key={category}>
          <div><strong>{category.replaceAll('_', ' ')}</strong>{existing && <span className={`status ${statusStyles[existing.condition] ?? ''}`}>{existing.condition.replaceAll('_', ' ')}</span>}</div>
          {can('job.update') ? <>
            <select value={draft.condition} onChange={(e) => setInspectionDraft((prev) => ({ ...prev, [category]: { ...draft, condition: e.target.value } }))}>
              {INSPECTION_CONDITIONS.map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>)}
            </select>
            <input value={draft.notes} onChange={(e) => setInspectionDraft((prev) => ({ ...prev, [category]: { ...draft, notes: e.target.value } }))} placeholder="Notes" />
            <button className="button secondary small" onClick={() => void saveInspection(category)}>Save</button>
          </> : <span className="muted">{existing?.notes ?? '—'}</span>}
        </div>;
      })}</div>
    </section>

    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Technical</p><h3>Diagnosis</h3></div></div>
      {diagnosisEntries.length === 0 ? <Empty title="No diagnosis yet" text="Add diagnostic findings below." /> : <div className="data-table">{diagnosisEntries.map((d) => <div className="table-row" key={d.id}><div><strong>{d.findings}</strong>{d.fault_codes && <span>Fault codes: {d.fault_codes}</span>}{d.observations && <span>{d.observations}</span>}{d.recommended_repairs && <span>Recommended: {d.recommended_repairs}</span>}</div><span className="table-muted">{formatDateTime(d.created_at)}</span></div>)}</div>}
      {can('job.update') && <form onSubmit={addDiagnosis} className="modal-form" style={{ marginTop: 14 }}>
        <label>Findings<textarea value={diagFindings} onChange={(e) => setDiagFindings(e.target.value)} required placeholder="Diagnostic findings..." /></label>
        <div className="form-row">
          <label>Fault codes <span className="optional">Optional</span><input value={diagFaultCodes} onChange={(e) => setDiagFaultCodes(e.target.value)} /></label>
          <label>Observations <span className="optional">Optional</span><input value={diagObservations} onChange={(e) => setDiagObservations(e.target.value)} /></label>
        </div>
        <label>Recommended repairs <span className="optional">Optional</span><input value={diagRecommended} onChange={(e) => setDiagRecommended(e.target.value)} /></label>
        <button className="button secondary small" type="submit">Add diagnosis</button>
      </form>}
    </section>

    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Work to be done</p><h3>Work items</h3></div></div>
      {workItems.length === 0 ? <Empty title="No work items" text="Add the tasks needed for this job." /> : <div className="data-table">{workItems.map((w) => <div className="table-row" key={w.id}>
        <div><strong>{w.description}</strong><span>{w.priority} · {employees.find((e) => e.user_id === w.assigned_technician_id)?.full_name ?? 'Unassigned'}</span></div>
        {can('job.update') ? <select value={w.status} onChange={(e) => void updateWorkItemStatus(w.id, e.target.value)}>{WORK_ITEM_STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}</select> : <span className={`status ${statusStyles[w.status] ?? ''}`}>{w.status.replaceAll('_', ' ')}</span>}
      </div>)}</div>}
      {can('job.update') && <form onSubmit={addWorkItem} className="inline-form">
        <input value={workDesc} onChange={(e) => setWorkDesc(e.target.value)} placeholder="Work item description" required />
        <select value={workPriority} onChange={(e) => setWorkPriority(e.target.value as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT')}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select>
        <select value={workTechnician} onChange={(e) => setWorkTechnician(e.target.value)}><option value="">Unassigned</option>{employees.map((e) => <option key={e.id} value={e.user_id ?? e.id}>{e.full_name}</option>)}</select>
        <button className="button primary small" type="submit"><Plus size={15} /></button>
      </form>}
    </section>

    {can('job.assign') && <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Team</p><h3>Technician assignment</h3></div><button className="text-button" onClick={() => setShowAssign(!showAssign)}>Assign <Plus size={15} /></button></div>
      {showAssign && <div className="assign-row"><select onChange={(e) => void assignTechnician(e.target.value)} defaultValue=""><option value="">Select technician...</option>{employees.map((e) => <option key={e.id} value={e.user_id ?? e.id}>{e.full_name}</option>)}</select></div>}
    </section>}
    <div className="dashboard-grid" style={{ marginTop: 20 }}>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Labour</p><h3>Labour lines</h3></div></div>
        {(job.job_card_labour ?? []).length === 0 ? <Empty title="No labour added" text="Add labour for this job." /> : <div className="data-table">{job.job_card_labour.map((l) => <div className="table-row" key={l.id}><div><strong>{l.description}</strong><span>{l.quantity} × {formatKes(l.unit_price_minor)}</span></div><span className="table-muted">{formatKes(computeLineTotal(l.quantity, l.unit_price_minor, l.tax_rate))}</span></div>)}</div>}
        {can('job.update') && <form onSubmit={addLabour} className="inline-form"><input value={labourDesc} onChange={(e) => setLabourDesc(e.target.value)} placeholder="Labour description" required /><input type="number" value={labourPrice} onChange={(e) => setLabourPrice(e.target.value)} min="0" step="0.01" required /><button className="button primary small" type="submit"><Plus size={15} /></button></form>}
        <div className="total-row"><strong>Labour total</strong><span>{formatKes(labourTotal)}</span></div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Parts</p><h3>Parts used</h3></div></div>
        {(job.job_card_parts ?? []).length === 0 ? <Empty title="No parts issued" text="Issue parts from inventory." /> : <div className="data-table">{job.job_card_parts.map((p) => <div className="table-row" key={p.id}><div><strong>{p.parts?.name ?? 'Part'}</strong><span>{p.quantity} × {formatKes(p.unit_price_minor)}</span></div><span className="table-muted">{formatKes(computeLineTotal(p.quantity, p.unit_price_minor, 16))}</span></div>)}</div>}
        {can('inventory.issue') && <form onSubmit={addPart} className="inline-form"><select value={partId} onChange={(e) => setPartId(e.target.value)} required><option value="">Select part...</option>{parts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.quantity_on_hand} in stock)</option>)}</select><input type="number" value={partQty} onChange={(e) => setPartQty(e.target.value)} min="1" required /><button className="button primary small" type="submit">Issue</button></form>}
        <div className="total-row"><strong>Parts total</strong><span>{formatKes(partsTotal)}</span></div>
      </section>
    </div>

    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Before release</p><h3>Quality check</h3></div>{passedQualityCheck && <span className="status bg-emerald-50 text-emerald-700">PASSED</span>}</div>
      {(job.job_card_quality_checks ?? []).length > 0 && <div className="data-table">{job.job_card_quality_checks.map((q) => <div className="table-row" key={q.id}><div><strong>{q.result.replaceAll('_', ' ')}</strong>{q.notes && <span>{q.notes}</span>}</div><span className="table-muted">{formatDateTime(q.checked_at)}</span></div>)}</div>}
      {job.status === 'QUALITY_CHECK' && can('job.complete') && <form onSubmit={submitQualityCheck} className="modal-form" style={{ marginTop: 14 }}>
        <div className="perm-grid">{QUALITY_CHECK_ITEMS.map((item) => <label key={item.key} className="perm-chip"><input type="checkbox" checked={qcChecklist[item.key] ?? false} onChange={() => setQcChecklist((prev) => ({ ...prev, [item.key]: !prev[item.key] }))} />{item.label}</label>)}</div>
        <label>Result<select value={qcResult} onChange={(e) => setQcResult(e.target.value as 'PASSED' | 'FAILED' | 'REWORK_REQUIRED')}>{QUALITY_CHECK_RESULTS.map((r) => <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>)}</select></label>
        <label>Notes <span className="optional">Optional</span><input value={qcNotes} onChange={(e) => setQcNotes(e.target.value)} /></label>
        <button className="button primary small" type="submit">Record quality check</button>
      </form>}
    </section>

    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Sign-off</p><h3>Advisor · Technician · Quality Check · Customer</h3></div></div>
      <div className="data-table">{SIGNOFF_ROLES.map((role) => {
        const existing = job.job_card_signoffs.find((s) => s.role === role);
        return <div className="table-row" key={role}>
          <div><strong>{role.replaceAll('_', ' ')}</strong>{existing && <span>{existing.name} · {formatDateTime(existing.signed_at)}</span>}</div>
          {!existing && can('job.update') && <><input value={signoffName[role] ?? ''} onChange={(e) => setSignoffName((prev) => ({ ...prev, [role]: e.target.value }))} placeholder="Name" /><button className="button secondary small" onClick={() => void recordSignoff(role)}>Record</button></>}
        </div>;
      })}</div>
    </section>

    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Office use only</p><h3>Invoices &amp; payments</h3></div></div>
      {(job.invoices ?? []).length === 0 ? <Empty title="No invoice yet" text="Create an invoice once the job is ready for collection." /> : <div className="data-table">{job.invoices.map((inv) => {
        const balance = inv.total_minor - inv.amount_paid_minor;
        return <div className="table-row" key={inv.id}>
          <div>
            <strong>{inv.invoice_number}</strong>
            <span>Total {formatKes(inv.total_minor)} · Paid {formatKes(inv.amount_paid_minor)} · Balance {formatKes(balance)}</span>
            {(inv.payments ?? []).length > 0 && <span className="muted">{[...inv.payments].sort((a, b) => a.paid_at.localeCompare(b.paid_at)).map((p) => `${p.method} ${formatKes(p.amount_minor)}${p.reference ? ` (${p.reference})` : ''} · ${formatDate(p.paid_at)}`).join(' · ')}</span>}
          </div>
          <span className={`status ${statusStyles[inv.status] ?? ''}`}>{inv.status.replaceAll('_', ' ')}</span>
        </div>;
      })}</div>}
    </section>

    <div className="dashboard-grid" style={{ marginTop: 20 }}>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Traceability</p><h3>Digital timeline</h3></div></div>
        {timelineEvents.length === 0 ? <Empty title="No activity" text="Job activity will appear here." /> : <div className="timeline">{timelineEvents.map((ev) => <div className="timeline-item" key={ev.id}><div className="timeline-dot" /><div className="timeline-content"><div className="timeline-header"><strong>{ev.title}</strong><span className="muted">{formatDateTime(ev.at)}</span></div>{ev.detail && <p className="muted">{ev.detail}</p>}</div></div>)}</div>}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Billing</p><h3>Financial actions</h3></div></div>
        <div className="action-buttons">
          {can('quotation.create') && <button className="button secondary" onClick={onNewQuotation}><FileText size={16} /> Create quotation</button>}
          {can('invoice.create') && <button className="button secondary" onClick={onNewInvoice}><CircleDollarSign size={16} /> Create invoice</button>}
          {can('job.view') && <button className="button secondary" onClick={() => setShowPrint(true)}><Printer size={16} /> Print / Preview</button>}
        </div>
        <div className="total-row"><strong>Job total</strong><span>{formatKes(labourTotal + partsTotal)}</span></div>
      </section>
    </div>
    {showPrint && <JobCardPrintView job={job} labourTotal={labourTotal} partsTotal={partsTotal} onClose={() => setShowPrint(false)} />}
  </>;
}

// === JOB CARD PRINT / PDF VIEW ===
type CopyMode = 'CUSTOMER' | 'WORKSHOP' | 'BLANK';
const COPY_LABELS: Record<CopyMode, string> = { CUSTOMER: 'Customer copy', WORKSHOP: 'Workshop copy', BLANK: 'Blank template' };

function JobCardPrintView({ job, labourTotal, partsTotal, onClose }: { job: JobDetailData; labourTotal: number; partsTotal: number; onClose: () => void }) {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [copyMode, setCopyMode] = useState<CopyMode>('CUSTOMER');
  useEffect(() => { supabase.from('business_settings').select('*').limit(1).single().then(({ data }) => setSettings(data as BusinessSettings)); }, []);

  const blank = copyMode === 'BLANK';
  const workshop = copyMode === 'WORKSHOP';
  const field = (label: string, value: string | null | undefined) => (
    <div className="print-field"><span>{label}</span>{blank || !value ? <div className="fill-line" /> : <strong>{value}</strong>}</div>
  );

  return <div className="print-overlay">
    <div className="print-toolbar no-print">
      <div className="action-buttons">
        <button className={`button ${copyMode === 'CUSTOMER' ? 'primary' : 'secondary'} small`} onClick={() => setCopyMode('CUSTOMER')}>Customer copy</button>
        <button className={`button ${copyMode === 'WORKSHOP' ? 'primary' : 'secondary'} small`} onClick={() => setCopyMode('WORKSHOP')}>Workshop copy</button>
        <button className={`button ${copyMode === 'BLANK' ? 'primary' : 'secondary'} small`} onClick={() => setCopyMode('BLANK')}>Blank template</button>
      </div>
      <div className="action-buttons">
        <button className="button primary small" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
        <button className="close-button" onClick={onClose}><X size={16} /></button>
      </div>
    </div>

    <div id="print-area" className="print-sheet">
      <div className="print-header">
        <div>
          {settings?.logo_url ? <img src={settings.logo_url} alt={settings.business_name} /> : <img src="/logo.png" alt="Oakland Motor Care Ltd" style={{ height: 44 }} />}
          <h1>{settings?.business_name ?? 'Oakland Motor Care Ltd'}</h1>
          <p className="muted">{settings?.address ?? ''}</p>
          <p className="muted">{[settings?.phone, settings?.email].filter(Boolean).join(' · ')}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="print-copy-badge">{COPY_LABELS[copyMode]}</span>
          <div className="print-field" style={{ marginTop: 10 }}><span>Job card no.</span>{blank ? <div className="fill-line" style={{ width: 160 }} /> : <strong>{job.job_number}</strong>}</div>
          {!blank && <div className="print-field"><span>Status</span><strong>{job.status.replaceAll('_', ' ')}</strong></div>}
        </div>
      </div>

      <section className="print-section">
        <h4>Customer details</h4>
        <div className="print-grid">
          {field('Full name', job.customers?.full_name)}
          {field('Phone', job.customers?.phone)}
          {field('Email', job.customers?.email)}
          {field('Address', job.customers?.address)}
        </div>
      </section>

      <section className="print-section">
        <h4>Vehicle details</h4>
        <div className="print-grid">
          {field('Registration no.', job.vehicles?.registration_number)}
          {field('Make / Model', job.vehicles ? `${job.vehicles.make} ${job.vehicles.model}` : undefined)}
          {field('Year', job.vehicles?.year ? String(job.vehicles.year) : undefined)}
          {field('Mileage (KM)', blank ? undefined : job.mileage.toLocaleString())}
          {field('VIN', job.vehicles?.vin)}
          {field('Colour', job.vehicles?.colour)}
        </div>
      </section>

      <section className="print-section">
        <h4>Job information</h4>
        <div className="print-grid">
          {field('Job type', blank ? undefined : job.job_types.map((t) => t.replaceAll('_', ' ')).join(', '))}
          {field('Priority', blank ? undefined : job.priority)}
          {field('Date/time in', job.received_at ? formatDateTime(job.received_at) : undefined)}
          {field('Promised date', job.promised_at ? formatDate(job.promised_at) : undefined)}
          {field('Date/time out', job.released_at ? formatDateTime(job.released_at) : undefined)}
        </div>
      </section>

      <section className="print-section">
        <h4>Customer complaint / reason for visit</h4>
        {blank ? <div className="fill-line" style={{ minHeight: 44 }} /> : <p>{job.complaint}</p>}
        {!blank && job.requested_service && <p className="muted">Requested: {job.requested_service}</p>}
      </section>

      <section className="print-section">
        <h4>Vehicle inspection checklist</h4>
        <table className="print-table"><thead><tr><th>Category</th><th>Condition</th><th>Notes</th></tr></thead>
          <tbody>{INSPECTION_CATEGORIES.map((category) => {
            const existing = job.job_card_inspection_items.find((i) => i.category === category);
            return <tr key={category}><td>{category.replaceAll('_', ' ')}</td><td>{blank ? '' : (existing?.condition ?? 'NOT CHECKED').replaceAll('_', ' ')}</td><td>{blank ? '' : (existing?.notes ?? '')}</td></tr>;
          })}</tbody>
        </table>
      </section>

      {!blank && (job.job_card_diagnosis ?? []).length > 0 && <section className="print-section">
        <h4>Diagnosis</h4>
        {job.job_card_diagnosis.map((d) => <p key={d.id}>{d.findings}{d.recommended_repairs ? ` — Recommended: ${d.recommended_repairs}` : ''}</p>)}
      </section>}

      {!blank && (job.job_card_work_items ?? []).length > 0 && <section className="print-section">
        <h4>Work carried out</h4>
        <table className="print-table"><thead><tr><th>Description</th>{workshop && <th>Assigned to</th>}<th>Status</th></tr></thead>
          <tbody>{job.job_card_work_items.map((w) => <tr key={w.id}><td>{w.description}</td>{workshop && <td>{w.assigned_technician_id ?? 'Unassigned'}</td>}<td>{w.status.replaceAll('_', ' ')}</td></tr>)}</tbody>
        </table>
      </section>}

      {!blank && ((job.job_card_labour ?? []).length > 0 || (job.job_card_parts ?? []).length > 0) && <section className="print-section">
        <h4>Labour &amp; parts</h4>
        <table className="print-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead>
          <tbody>
            {job.job_card_labour.map((l) => <tr key={l.id}><td>{l.description}</td><td>{l.quantity}</td><td>{formatKes(l.unit_price_minor)}</td><td>{formatKes(computeLineTotal(l.quantity, l.unit_price_minor, l.tax_rate))}</td></tr>)}
            {job.job_card_parts.map((p) => <tr key={p.id}><td>{p.parts?.name ?? 'Part'}</td><td>{p.quantity}</td><td>{formatKes(p.unit_price_minor)}</td><td>{formatKes(computeLineTotal(p.quantity, p.unit_price_minor, 16))}</td></tr>)}
          </tbody>
        </table>
        <div className="print-totals"><table><tbody>
          <tr><td>Labour total</td><td>{formatKes(labourTotal)}</td></tr>
          <tr><td>Parts total</td><td>{formatKes(partsTotal)}</td></tr>
          <tr><td><strong>Grand total</strong></td><td><strong>{formatKes(labourTotal + partsTotal)}</strong></td></tr>
        </tbody></table></div>
      </section>}

      {workshop && (job.invoices ?? []).length > 0 && <section className="print-section">
        <h4>Office use only</h4>
        {job.invoices.map((inv) => <p key={inv.id}>{inv.invoice_number} — {inv.status.replaceAll('_', ' ')} — Total {formatKes(inv.total_minor)}, Paid {formatKes(inv.amount_paid_minor)}, Balance {formatKes(inv.total_minor - inv.amount_paid_minor)}</p>)}
      </section>}

      <section className="print-section">
        <h4>Sign-off</h4>
        <div className="signature-grid">{SIGNOFF_ROLES.map((role) => {
          const existing = job.job_card_signoffs.find((s) => s.role === role);
          return <div className="signature-box" key={role}>{blank || !existing ? <div className="fill-line" style={{ minHeight: 30 }} /> : <div>{existing.name}<br />{formatDate(existing.signed_at)}</div>}<span>{role.replaceAll('_', ' ')}</span></div>;
        })}</div>
      </section>

      <div className="print-terms">{settings?.job_card_terms ?? ''}</div>
    </div>
  </div>;
}

// === SERVICES ===
function ServicesSection({ onNew }: { onNew: () => void }) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { supabase.from('services').select('*').order('name').then(({ data }) => { setServices((data ?? []) as Service[]); setLoading(false); }); }, []);
  return <SectionPanel eyebrow="Service catalogue" title="Services" onNew={onNew} newLabel="Add service">
    {loading ? <Loading /> : services.length === 0 ? <Empty title="No services" text="Add your first service to the catalogue." /> : <div className="data-table">{services.map((s) => <div className="table-row" key={s.id}><div className="job-icon"><Wrench size={17} /></div><div><strong>{s.name}</strong><span>{s.category} · {s.estimated_minutes} min</span></div><span className="table-muted">{formatKes(s.standard_price_minor)}</span><span className={`status ${s.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{s.active ? 'Active' : 'Inactive'}</span></div>)}</div>}
  </SectionPanel>;
}

// === TECHNICIANS ===
function TechniciansSection() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data: emps } = await supabase.from('employees').select('*').eq('active', true).order('full_name');
      const empList = (emps ?? []) as Employee[];
      setEmployees(empList);
      const counts: Record<string, number> = {};
      for (const emp of empList) {
        if (emp.user_id) { const { count } = await supabase.from('job_card_assignments').select('id', { count: 'exact', head: true }).eq('technician_id', emp.user_id).is('completed_at', null); counts[emp.id] = count ?? 0; }
      }
      setAssignments(counts); setLoading(false);
    })();
  }, []);
  return <SectionPanel eyebrow="Workshop team" title="Technicians">
    {loading ? <Loading /> : employees.length === 0 ? <Empty title="No technicians" text="Add employees from the Users & Roles section." /> : <div className="data-table">{employees.map((e) => <div className="table-row" key={e.id}><div className="avatar small-avatar">{e.full_name.slice(0, 1)}</div><div><strong>{e.full_name}</strong><span>{e.specialization ?? 'General mechanic'}</span></div><span className="table-muted">{e.phone ?? '—'}</span><span className="status bg-blue-50 text-blue-700">{assignments[e.id] ?? 0} active</span></div>)}</div>}
  </SectionPanel>;
}

// === PARTS / INVENTORY ===
function PartsSection({ onNew, onReceive, onAdjust, can }: { onNew: () => void; onReceive: () => void; onAdjust: () => void; can: (p: string) => boolean }) {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  useEffect(() => {
    (async () => {
      let q = supabase.from('parts').select('*').eq('active', true).order('name');
      if (query) q = q.or(`sku.ilike.%${query}%,name.ilike.%${query}%`);
      const { data } = await q.limit(200);
      setParts((data ?? []) as Part[]); setLoading(false);
    })();
  }, [query]);
  return <SectionPanel eyebrow="Spare parts" title="Parts" onNew={can('inventory.view') ? onNew : undefined} newLabel="Add part">
    <div className="filter-bar"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by SKU or name..." /></div>
    <div className="action-buttons" style={{ marginBottom: 16 }}>
      {can('inventory.receive') && <button className="button secondary small" onClick={onReceive}><Plus size={15} /> Receive stock</button>}
      {can('inventory.adjust') && <button className="button secondary small" onClick={onAdjust}><Edit size={15} /> Adjust stock</button>}
    </div>
    {loading ? <Loading /> : parts.length === 0 ? <Empty title="No parts" text="Add your first part to inventory." /> : <div className="data-table">{parts.map((p) => <div className="table-row" key={p.id}><div className="job-icon"><Package size={17} /></div><div><strong>{p.name}</strong><span>{p.sku} · {p.brand ?? 'No brand'}</span></div><span className="table-muted">{formatKes(p.selling_price_minor)}</span><span className={`status ${p.quantity_on_hand <= p.reorder_level ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{p.quantity_on_hand} in stock</span></div>)}</div>}
  </SectionPanel>;
}

function StockMovementsSection() {
  const [movements, setMovements] = useState<(StockMovement & { parts: { name: string; sku: string } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.from('stock_movements').select('*, parts(name, sku)').order('created_at', { ascending: false }).limit(100).then(({ data }) => { setMovements((data ?? []) as (StockMovement & { parts: { name: string; sku: string } | null })[]); setLoading(false); });
  }, []);
  return <SectionPanel eyebrow="Audit trail" title="Stock Movements">
    {loading ? <Loading /> : movements.length === 0 ? <Empty title="No stock movements" text="Stock changes will appear here." /> : <div className="data-table">{movements.map((m) => <div className="table-row" key={m.id}><div className="job-icon"><Boxes size={17} /></div><div><strong>{m.parts?.name ?? 'Part'}</strong><span>{m.movement_type.replaceAll('_', ' ')} · {m.reference ?? '—'}</span></div><span className="table-muted">{m.previous_balance} → {m.new_balance}</span><span className={`status ${m.quantity >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{m.quantity >= 0 ? '+' : ''}{m.quantity}</span></div>)}</div>}
  </SectionPanel>;
}

function LowStockSection() {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { supabase.from('parts').select('*').eq('active', true).order('name').then(({ data }) => { const all = (data ?? []) as Part[]; setParts(all.filter((p) => p.quantity_on_hand <= p.reorder_level)); setLoading(false); }); }, []);
  return <SectionPanel eyebrow="Reorder alerts" title="Low Stock">
    {loading ? <Loading /> : parts.length === 0 ? <Empty title="No low-stock parts" text="Inventory levels are healthy." /> : <div className="data-table">{parts.map((p) => <div className="table-row" key={p.id}><div className="job-icon"><AlertTriangle size={17} /></div><div><strong>{p.name}</strong><span>{p.sku}</span></div><span className="table-muted">Reorder at {p.reorder_level}</span><span className="status bg-red-50 text-red-700">{p.quantity_on_hand} left</span></div>)}</div>}
  </SectionPanel>;
}

// === SUPPLIERS ===
function SuppliersSection({ query, onNew, onSelect }: { query: string; onNew: () => void; onSelect: (id: string) => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      let q = supabase.from('suppliers').select('*').is('deleted_at', null).order('name');
      if (query) q = q.or(`name.ilike.%${query}%,phone.ilike.%${query}%`);
      const { data } = await q.limit(100);
      setSuppliers((data ?? []) as Supplier[]); setLoading(false);
    })();
  }, [query]);
  return <SectionPanel eyebrow="Vendor directory" title="Suppliers" onNew={onNew} newLabel="Add supplier">
    {loading ? <Loading /> : suppliers.length === 0 ? <Empty title="No suppliers" text="Add your first supplier." /> : <div className="data-table">{suppliers.map((s) => <div className="table-row clickable" key={s.id} onClick={() => onSelect(s.id)}><div className="job-icon"><Truck size={17} /></div><div><strong>{s.name}</strong><span>{s.contact_person ?? 'No contact'}</span></div><span className="table-muted">{s.phone}</span><span className={`status ${statusStyles[s.status] ?? ''}`}>{s.status}</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
  </SectionPanel>;
}

function SupplierDetail({ id, onBack, onNewPO }: { id: string; onBack: () => void; onNewPO: () => void }) {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  useEffect(() => {
    (async () => {
      const [s, p] = await Promise.all([
        supabase.from('suppliers').select('*').eq('id', id).maybeSingle(),
        supabase.from('purchase_orders').select('*').eq('supplier_id', id).order('created_at', { ascending: false }),
      ]);
      setSupplier(s.data as Supplier); setPOs((p.data ?? []) as PurchaseOrder[]);
    })();
  }, [id]);
  if (!supplier) return <Loading />;
  const totalSpent = pos.reduce((s, p) => s + p.total_minor, 0);
  return <>
    <BackBar onBack={onBack} label="Suppliers" />
    <div className="detail-header"><div className="detail-avatar supplier"><Truck size={24} /></div><div className="flex-1"><h2>{supplier.name}</h2><p className="muted">{supplier.contact_person ?? 'No contact person'}</p></div><button className="button primary" onClick={onNewPO}><Plus size={16} /> New PO</button></div>
    <div className="detail-info-grid">
      <div className="info-card"><Phone size={16} /> <div><span>Phone</span><strong>{supplier.phone}</strong></div></div>
      {supplier.email && <div className="info-card"><Mail size={16} /> <div><span>Email</span><strong>{supplier.email}</strong></div></div>}
      <div className="info-card"><CircleDollarSign size={16} /> <div><span>Total spending</span><strong>{formatKes(totalSpent)}</strong></div></div>
      <div className="info-card"><ShoppingCart size={16} /> <div><span>Purchase orders</span><strong>{pos.length}</strong></div></div>
    </div>
    <section className="panel" style={{ marginTop: 20 }}><div className="panel-heading"><div><p className="eyebrow">Procurement</p><h3>Purchase orders</h3></div></div>{pos.length === 0 ? <Empty title="No purchase orders" text="Create a PO for this supplier." /> : <div className="data-table">{pos.map((p) => <div className="table-row" key={p.id}><div className="job-icon"><ShoppingCart size={17} /></div><div><strong>{p.po_number}</strong><span>{formatDate(p.order_date)}</span></div><span className="table-muted">{formatKes(p.total_minor)}</span><span className={`status ${statusStyles[p.status] ?? ''}`}>{p.status.replaceAll('_', ' ')}</span></div>)}</div>}</section>
  </>;
}

// === PROCUREMENT ===
function ProcurementSection({ onNew, onSelect }: { onNew: () => void; onSelect: (id: string) => void }) {
  const [pos, setPOs] = useState<(PurchaseOrder & { suppliers: { name: string } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { supabase.from('purchase_orders').select('*, suppliers(name)').order('created_at', { ascending: false }).limit(100).then(({ data }) => { setPOs((data ?? []) as (PurchaseOrder & { suppliers: { name: string } | null })[]); setLoading(false); }); }, []);
  return <SectionPanel eyebrow="Purchase orders" title="Procurement" onNew={onNew} newLabel="New PO">
    {loading ? <Loading /> : pos.length === 0 ? <Empty title="No purchase orders" text="Create your first purchase order." /> : <div className="data-table">{pos.map((p) => <div className="table-row clickable" key={p.id} onClick={() => onSelect(p.id)}><div className="job-icon"><ShoppingCart size={17} /></div><div><strong>{p.po_number}</strong><span>{p.suppliers?.name ?? 'Supplier'} · {formatDate(p.order_date)}</span></div><span className="table-muted">{formatKes(p.total_minor)}</span><span className={`status ${statusStyles[p.status] ?? ''}`}>{p.status.replaceAll('_', ' ')}</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
  </SectionPanel>;
}

function PODetail({ id, onBack, can, onNotice, onRefresh }: { id: string; onBack: () => void; can: (p: string) => boolean; onNotice: (m: string) => void; onRefresh: () => void }) {
  const [po, setPO] = useState<(PurchaseOrder & { suppliers: Supplier | null; purchase_order_items: (PurchaseOrderItem & { parts: Part | null })[] }) | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  useEffect(() => { supabase.from('purchase_orders').select('*, suppliers(*), purchase_order_items(*, parts(*))').eq('id', id).maybeSingle().then(({ data }) => setPO(data as (PurchaseOrder & { suppliers: Supplier | null; purchase_order_items: (PurchaseOrderItem & { parts: Part | null })[] }) | null)); }, [id]);

  async function receiveGoods(itemId: string, partId: string, unitCost: number) {
    const qty = parseInt(receiveQty[itemId] ?? '0');
    if (qty <= 0) return;
    const { error } = await supabase.rpc('receive_stock', { p_part_id: partId, p_quantity: qty, p_unit_cost_minor: unitCost, p_reference: po?.po_number ?? 'PO' });
    if (error) { onNotice('Unable to receive goods. Please try again.'); return; }
    await supabase.from('goods_receipts').insert({ purchase_order_id: id, part_id: partId, quantity_received: qty, unit_cost_minor: unitCost });
    await supabase.from('purchase_order_items').update({ quantity_received: (po?.purchase_order_items.find((i) => i.id === itemId)?.quantity_received ?? 0) + qty }).eq('id', itemId);
    onNotice(`${qty} units received into inventory.`); onRefresh(); reload();
  }

  async function reload() { supabase.from('purchase_orders').select('*, suppliers(*), purchase_order_items(*, parts(*))').eq('id', id).maybeSingle().then(({ data }) => setPO(data as typeof po)); }
  if (!po) return <Loading />;
  return <>
    <BackBar onBack={onBack} label="Procurement" />
    <div className="detail-header"><div className="detail-avatar po"><ShoppingCart size={24} /></div><div className="flex-1"><h2>{po.po_number}</h2><p className="muted">{po.suppliers?.name ?? 'Supplier'} · {formatDate(po.order_date)}</p></div><span className={`status ${statusStyles[po.status] ?? ''}`}>{po.status.replaceAll('_', ' ')}</span></div>
    <div className="detail-info-grid">
      <div className="info-card"><Calendar size={16} /> <div><span>Order date</span><strong>{formatDate(po.order_date)}</strong></div></div>
      {po.expected_delivery && <div className="info-card"><Truck size={16} /> <div><span>Expected</span><strong>{formatDate(po.expected_delivery)}</strong></div></div>}
      <div className="info-card"><CircleDollarSign size={16} /> <div><span>Total</span><strong>{formatKes(po.total_minor)}</strong></div></div>
    </div>
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Line items</p><h3>Items & receiving</h3></div></div>
      {po.purchase_order_items.length === 0 ? <Empty title="No items" text="This PO has no line items." /> : <div className="data-table">{po.purchase_order_items.map((item) => <div className="table-row" key={item.id}>
        <div className="job-icon"><Package size={17} /></div>
        <div><strong>{item.parts?.name ?? 'Part'}</strong><span>Ordered: {item.quantity_ordered} · Received: {item.quantity_received}</span></div>
        <span className="table-muted">{formatKes(item.unit_cost_minor)} each</span>
        {can('inventory.receive') && item.quantity_received < item.quantity_ordered && <div className="receive-row"><input type="number" min="1" max={item.quantity_ordered - item.quantity_received} placeholder="Qty" value={receiveQty[item.id] ?? ''} onChange={(e) => setReceiveQty({ ...receiveQty, [item.id]: e.target.value })} /><button className="button primary small" onClick={() => void receiveGoods(item.id, item.part_id, item.unit_cost_minor)}>Receive</button></div>}
      </div>)}</div>}
    </section>
  </>;
}

// === QUOTATIONS ===
function QuotationsSection({ onNew, onSelect }: { onNew: () => void; onSelect: (id: string) => void }) {
  const [quotes, setQuotes] = useState<(Quotation & { customers: { full_name: string } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { supabase.from('quotations').select('*, customers(full_name)').order('created_at', { ascending: false }).limit(100).then(({ data }) => { setQuotes((data ?? []) as (Quotation & { customers: { full_name: string } | null })[]); setLoading(false); }); }, []);
  return <SectionPanel eyebrow="Pricing" title="Quotations" onNew={onNew} newLabel="New quotation">
    {loading ? <Loading /> : quotes.length === 0 ? <Empty title="No quotations" text="Create a quotation from a job card." /> : <div className="data-table">{quotes.map((q) => <div className="table-row clickable" key={q.id} onClick={() => onSelect(q.id)}><div className="job-icon"><FileText size={17} /></div><div><strong>{q.quote_number}</strong><span>{q.customers?.full_name ?? 'Customer'}</span></div><span className="table-muted">{formatKes(q.total_minor)}</span><span className={`status ${statusStyles[q.status] ?? ''}`}>{q.status.replaceAll('_', ' ')}</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
  </SectionPanel>;
}

function QuotationDetail({ id, onBack, can, onNotice, onRefresh }: { id: string; onBack: () => void; can: (p: string) => boolean; onNotice: (m: string) => void; onRefresh: () => void }) {
  const [quote, setQuote] = useState<(Quotation & { customers: Customer | null; vehicles: Vehicle | null; quotation_items: QuotationItem[] }) | null>(null);
  useEffect(() => { supabase.from('quotations').select('*, customers(*), vehicles(*), quotation_items(*)').eq('id', id).maybeSingle().then(({ data }) => setQuote(data as (Quotation & { customers: Customer | null; vehicles: Vehicle | null; quotation_items: QuotationItem[] }) | null)); }, [id]);
  if (!quote) return <Loading />;

  async function approve() {
    if (!quote) return;
    const { error } = await supabase.from('quotations').update({ status: 'APPROVED', approved_by: (await supabase.auth.getUser()).data.user?.id, approved_at: new Date().toISOString() }).eq('id', id);
    onNotice(error ? 'Unable to approve.' : 'Quotation approved.'); onRefresh(); reload();
  }
  async function reject() {
    if (!quote) return;
    const { error } = await supabase.from('quotations').update({ status: 'REJECTED' }).eq('id', id);
    onNotice(error ? 'Unable to reject.' : 'Quotation rejected.'); onRefresh(); reload();
  }
  async function convertToInvoice() {
    if (!quote) return;
    const invNumber = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    const { data: inv } = await supabase.from('invoices').insert({ invoice_number: invNumber, customer_id: quote.customer_id, vehicle_id: quote.vehicle_id, job_card_id: quote.job_card_id, subtotal_minor: quote.subtotal_minor, discount_minor: quote.discount_minor, tax_minor: quote.tax_minor, total_minor: quote.total_minor, status: 'ISSUED' }).select().single();
    if (inv) { await supabase.from('quotation_items').select('*').eq('quotation_id', id).then(({ data: items }) => { if (items) for (const item of items as QuotationItem[]) void supabase.from('invoice_items').insert({ invoice_id: inv.id, item_type: item.item_type, description: item.description, quantity: item.quantity, unit_price_minor: item.unit_price_minor, tax_rate: item.tax_rate, line_total_minor: item.line_total_minor }); }); await supabase.from('quotations').update({ status: 'CONVERTED', converted_invoice_id: inv.id }).eq('id', id); }
    onNotice('Quotation converted to invoice.'); onRefresh(); onBack();
  }
  async function reload() { supabase.from('quotations').select('*, customers(*), vehicles(*), quotation_items(*)').eq('id', id).maybeSingle().then(({ data }) => setQuote(data as typeof quote)); }

  return <>
    <BackBar onBack={onBack} label="Quotations" />
    <div className="detail-header"><div className="detail-avatar quote"><FileText size={24} /></div><div className="flex-1"><h2>{quote.quote_number}</h2><p className="muted">{quote.customers?.full_name ?? 'Customer'} · Valid until {formatDate(quote.valid_until)}</p></div><span className={`status ${statusStyles[quote.status] ?? ''}`}>{quote.status.replaceAll('_', ' ')}</span></div>
    <div className="detail-info-grid">
      <div className="info-card"><CircleDollarSign size={16} /> <div><span>Subtotal</span><strong>{formatKes(quote.subtotal_minor)}</strong></div></div>
      <div className="info-card"><CircleDollarSign size={16} /> <div><span>Discount</span><strong>{formatKes(quote.discount_minor)}</strong></div></div>
      <div className="info-card"><CircleDollarSign size={16} /> <div><span>Total</span><strong>{formatKes(quote.total_minor)}</strong></div></div>
    </div>
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Line items</p><h3>Quotation items</h3></div></div>
      {quote.quotation_items.length === 0 ? <Empty title="No items" text="This quotation has no items." /> : <div className="data-table">{quote.quotation_items.map((item) => <div className="table-row" key={item.id}><div><strong>{item.description}</strong><span>{item.item_type} · {item.quantity} × {formatKes(item.unit_price_minor)}</span></div><span className="table-muted">{formatKes(item.line_total_minor)}</span></div>)}</div>}
      <div className="total-row"><strong>Grand total</strong><span>{formatKes(quote.total_minor)}</span></div>
    </section>
    {quote.status === 'PENDING_APPROVAL' && can('quotation.approve') && <div className="action-buttons" style={{ marginTop: 16 }}><button className="button primary" onClick={() => void approve()}><CheckCircle2 size={16} /> Approve</button><button className="button secondary" onClick={() => void reject()}><X size={16} /> Reject</button></div>}
    {quote.status === 'APPROVED' && can('invoice.create') && <div className="action-buttons" style={{ marginTop: 16 }}><button className="button primary" onClick={() => void convertToInvoice()}><ArrowUpRight size={16} /> Convert to invoice</button></div>}
    {quote.terms && <section className="panel" style={{ marginTop: 20 }}><div className="panel-heading"><div><p className="eyebrow">Terms</p><h3>Terms & conditions</h3></div></div><p className="muted">{quote.terms}</p></section>}
  </>;
}

// === INVOICES ===
function InvoicesSection({ query, onNew, onSelect }: { query: string; onNew: () => void; onSelect: (id: string) => void }) {
  const [invoices, setInvoices] = useState<(Invoice & { customers: { full_name: string } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      let q = supabase.from('invoices').select('*, customers(full_name)').order('created_at', { ascending: false });
      if (query) q = q.or(`invoice_number.ilike.%${query}%`);
      const { data } = await q.limit(100);
      setInvoices((data ?? []) as (Invoice & { customers: { full_name: string } | null })[]); setLoading(false);
    })();
  }, [query]);
  return <SectionPanel eyebrow="Billing" title="Invoices" onNew={onNew} newLabel="New invoice">
    {loading ? <Loading /> : invoices.length === 0 ? <Empty title="No invoices" text="Create an invoice from a job card or quotation." /> : <div className="data-table">{invoices.map((inv) => <div className="table-row clickable" key={inv.id} onClick={() => onSelect(inv.id)}><div className="job-icon"><CircleDollarSign size={17} /></div><div><strong>{inv.invoice_number}</strong><span>{inv.customers?.full_name ?? 'Customer'}</span></div><span className="table-muted">{formatKes(inv.total_minor)}</span><span className="table-muted">{formatKes(inv.amount_paid_minor)} paid</span><span className={`status ${statusStyles[inv.status] ?? ''}`}>{inv.status.replaceAll('_', ' ')}</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
  </SectionPanel>;
}

function InvoiceDetail({ id, onBack, onPayment }: { id: string; onBack: () => void; onPayment: () => void }) {
  const [invoice, setInvoice] = useState<(Invoice & { customers: Customer | null; vehicles: Vehicle | null; invoice_items: InvoiceItem[]; payments: Payment[] }) | null>(null);
  useEffect(() => { supabase.from('invoices').select('*, customers(*), vehicles(*), invoice_items(*), payments(*)').eq('id', id).maybeSingle().then(({ data }) => setInvoice(data as (Invoice & { customers: Customer | null; vehicles: Vehicle | null; invoice_items: InvoiceItem[]; payments: Payment[] }) | null)); }, [id]);
  if (!invoice) return <Loading />;
  const balance = invoice.total_minor - invoice.amount_paid_minor;
  return <>
    <BackBar onBack={onBack} label="Invoices" />
    <div className="detail-header"><div className="detail-avatar invoice"><CircleDollarSign size={24} /></div><div className="flex-1"><h2>{invoice.invoice_number}</h2><p className="muted">{invoice.customers?.full_name ?? 'Customer'} · Due {formatDate(invoice.due_date)}</p></div><span className={`status ${statusStyles[invoice.status] ?? ''}`}>{invoice.status.replaceAll('_', ' ')}</span></div>
    <div className="detail-info-grid">
      <div className="info-card"><CircleDollarSign size={16} /> <div><span>Total</span><strong>{formatKes(invoice.total_minor)}</strong></div></div>
      <div className="info-card"><CheckCircle2 size={16} /> <div><span>Paid</span><strong>{formatKes(invoice.amount_paid_minor)}</strong></div></div>
      <div className="info-card"><AlertTriangle size={16} /> <div><span>Balance</span><strong>{formatKes(balance)}</strong></div></div>
    </div>
    <div className="dashboard-grid" style={{ marginTop: 20 }}>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Line items</p><h3>Invoice items</h3></div></div>{invoice.invoice_items.length === 0 ? <Empty title="No items" text="This invoice has no items." /> : <div className="data-table">{invoice.invoice_items.map((item) => <div className="table-row" key={item.id}><div><strong>{item.description}</strong><span>{item.item_type} · {item.quantity} × {formatKes(item.unit_price_minor)}</span></div><span className="table-muted">{formatKes(item.line_total_minor)}</span></div>)}</div>}<div className="total-row"><strong>Grand total</strong><span>{formatKes(invoice.total_minor)}</span></div></section>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Reconciliation</p><h3>Payments</h3></div>{balance > 0 && <button className="button primary small" onClick={onPayment}><Plus size={15} /> Record payment</button>}</div>{invoice.payments.length === 0 ? <Empty title="No payments" text="Record a payment against this invoice." /> : <div className="data-table">{invoice.payments.map((p) => <div className="table-row" key={p.id}><div className="job-icon"><Banknote size={17} /></div><div><strong>{formatKes(p.amount_minor)}</strong><span>{p.method} · {formatDate(p.paid_at)}</span></div><span className="table-muted">{p.reference ?? '—'}</span></div>)}</div>}</section>
    </div>
  </>;
}

// === PAYMENTS ===
function PaymentsSection() {
  const [payments, setPayments] = useState<(Payment & { invoices: { invoice_number: string } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { supabase.from('payments').select('*, invoices(invoice_number)').order('paid_at', { ascending: false }).limit(100).then(({ data }) => { setPayments((data ?? []) as (Payment & { invoices: { invoice_number: string } | null })[]); setLoading(false); }); }, []);
  return <SectionPanel eyebrow="Transaction log" title="Payments">
    {loading ? <Loading /> : payments.length === 0 ? <Empty title="No payments recorded" text="Payments will appear here once invoices are paid." /> : <div className="data-table">{payments.map((p) => <div className="table-row" key={p.id}><div className="job-icon"><Banknote size={17} /></div><div><strong>{formatKes(p.amount_minor)}</strong><span>{p.invoices?.invoice_number ?? 'Invoice'} · {p.method}</span></div><span className="table-muted">{formatDate(p.paid_at)}</span><span className="table-muted">{p.reference ?? '—'}</span></div>)}</div>}
  </SectionPanel>;
}

function ReceiptsSection() {
  const [payments, setPayments] = useState<(Payment & { invoices: { invoice_number: string; total_minor: number; amount_paid_minor: number; customers: { full_name: string } | null } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { supabase.from('payments').select('*, invoices(invoice_number, total_minor, amount_paid_minor, customers(full_name))').order('paid_at', { ascending: false }).limit(50).then(({ data }) => { setPayments((data ?? []) as (Payment & { invoices: { invoice_number: string; total_minor: number; amount_paid_minor: number; customers: { full_name: string } | null } | null })[]); setLoading(false); }); }, []);
  return <SectionPanel eyebrow="Proof of payment" title="Receipts">
    {loading ? <Loading /> : payments.length === 0 ? <Empty title="No receipts" text="Receipts are generated when payments are recorded." /> : <div className="data-table">{payments.map((p) => <div className="table-row" key={p.id}><div className="job-icon"><Receipt size={17} /></div><div><strong>RCP-{p.id.slice(-6).toUpperCase()}</strong><span>{p.invoices?.customers?.full_name ?? 'Customer'} · {p.invoices?.invoice_number ?? 'Invoice'}</span></div><span className="table-muted">{formatKes(p.amount_minor)}</span><span className="status bg-emerald-50 text-emerald-700">{p.method}</span></div>)}</div>}
  </SectionPanel>;
}

// === REPORTS ===
function ReportsSection() {
  const [reportType, setReportType] = useState('operations');
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const reportTypes = [
    { id: 'operations', label: 'Operations', icon: <ClipboardList size={16} /> },
    { id: 'financial', label: 'Financial', icon: <CircleDollarSign size={16} /> },
    { id: 'inventory', label: 'Inventory', icon: <Package size={16} /> },
    { id: 'procurement', label: 'Procurement', icon: <ShoppingCart size={16} /> },
    { id: 'technician', label: 'Technician', icon: <UserCog size={16} /> },
  ];
  useEffect(() => {
    (async () => {
      setLoading(true);
      let result: Record<string, unknown>[] = [];
      if (reportType === 'operations') { const { data: jobs } = await supabase.from('job_cards').select('job_number,status,priority,created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(50); result = (jobs ?? []) as Record<string, unknown>[]; }
      else if (reportType === 'financial') { const { data: invs } = await supabase.from('invoices').select('invoice_number,total_minor,amount_paid_minor,status,created_at').order('created_at', { ascending: false }).limit(50); result = (invs ?? []) as Record<string, unknown>[]; }
      else if (reportType === 'inventory') { const { data: parts } = await supabase.from('parts').select('sku,name,quantity_on_hand,reorder_level,selling_price_minor').eq('active', true).order('name'); result = (parts ?? []) as Record<string, unknown>[]; }
      else if (reportType === 'procurement') { const { data: pos } = await supabase.from('purchase_orders').select('po_number,status,total_minor,order_date').order('created_at', { ascending: false }).limit(50); result = (pos ?? []) as Record<string, unknown>[]; }
      else if (reportType === 'technician') { const { data: emps } = await supabase.from('employees').select('full_name,role,specialization,active').eq('active', true); result = (emps ?? []) as Record<string, unknown>[]; }
      setData(result); setLoading(false);
    })();
  }, [reportType]);

  function exportCSV() {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]);
    const rows = data.map((row) => headers.map((h) => JSON.stringify(row[h] ?? '')).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${reportType}-report.csv`; a.click();
  }

  return <>
    <div className="page-heading"><div><p className="eyebrow">Business intelligence</p><h1>Reports</h1><p className="muted">Export and analyze your workshop data.</p></div><div className="heading-actions"><button className="button secondary" onClick={exportCSV}><Download size={16} /> Export CSV</button></div></div>
    <div className="report-tabs">{reportTypes.map((t) => <button key={t.id} className={reportType === t.id ? 'report-tab active' : 'report-tab'} onClick={() => setReportType(t.id)}>{t.icon} {t.label}</button>)}</div>
    <section className="panel" style={{ marginTop: 20 }}>
      {loading ? <Loading /> : data.length === 0 ? <Empty title="No data" text="No records for this report." /> : <div className="report-table"><table><thead><tr>{Object.keys(data[0]).map((key) => <th key={key}>{key.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{data.map((row, i) => <tr key={i}>{Object.values(row).map((val, j) => <td key={j}>{typeof val === 'number' && Object.keys(row)[j].includes('minor') ? formatKes(val) : String(val ?? '—')}</td>)}</tr>)}</tbody></table></div>}
    </section>
  </>;
}

// === NOTIFICATIONS ===
function NotificationsSection() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) { const { data } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50); setNotifications((data ?? []) as Notification[]); }
      setLoading(false);
    })();
  }, []);
  async function markRead(id: string) { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id); setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n)); }
  return <SectionPanel eyebrow="Alerts" title="Notifications">
    {loading ? <Loading /> : notifications.length === 0 ? <Empty title="No notifications" text="You're all caught up." /> : <div className="data-table">{notifications.map((n) => <div className={`table-row ${n.read_at ? 'read' : 'unread'}`} key={n.id} onClick={() => void markRead(n.id)}><div className="job-icon"><Bell size={17} /></div><div><strong>{n.title}</strong><span>{n.message}</span></div><span className="table-muted">{formatDateTime(n.created_at)}</span>{!n.read_at && <span className="status bg-blue-50 text-blue-700">New</span>}</div>)}</div>}
  </SectionPanel>;
}

// === AUDIT ===
function AuditSection() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100).then(({ data }) => { setLogs((data ?? []) as AuditLog[]); setLoading(false); }); }, []);
  return <SectionPanel eyebrow="Traceability" title="Audit Logs">
    {loading ? <Loading /> : logs.length === 0 ? <Empty title="No audit entries" text="Important changes will be logged here." /> : <div className="data-table">{logs.map((l) => <div className="table-row" key={l.id}><div className="job-icon"><ScrollText size={17} /></div><div><strong>{l.action.replaceAll('_', ' ')}</strong><span>{l.entity} · {formatDateTime(l.created_at)}</span></div><span className="table-muted">{l.entity_id?.slice(0, 8) ?? '—'}</span></div>)}</div>}
  </SectionPanel>;
}

// === SETTINGS ===
function SettingsSection({ onNotice }: { onNotice: (m: string) => void }) {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { supabase.from('business_settings').select('*').limit(1).single().then(({ data }) => { setSettings(data as BusinessSettings); setLoading(false); }); }, []);
  async function save() {
    if (!settings) return;
    const { error } = await supabase.from('business_settings').update({ business_name: settings.business_name, address: settings.address, phone: settings.phone, email: settings.email, tax_rate: settings.tax_rate, currency: settings.currency, invoice_prefix: settings.invoice_prefix, quote_prefix: settings.quote_prefix, job_card_prefix: settings.job_card_prefix, receipt_prefix: settings.receipt_prefix, job_card_terms: settings.job_card_terms }).eq('id', settings.id);
    onNotice(error ? 'Unable to save settings.' : 'Settings saved successfully.');
  }
  if (loading || !settings) return <Loading />;
  return <>
    <div className="page-heading"><div><p className="eyebrow">Configuration</p><h1>Settings</h1><p className="muted">Configure your business details and document prefixes.</p></div><div className="heading-actions"><button className="button primary" onClick={() => void save()}><CheckCircle2 size={16} /> Save settings</button></div></div>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Business profile</p><h3>Business details</h3></div></div>
      <div className="settings-grid">
        <label>Business name<input value={settings.business_name} onChange={(e) => setSettings({ ...settings, business_name: e.target.value })} /></label>
        <label>Phone<input value={settings.phone ?? ''} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} /></label>
        <label>Email<input value={settings.email ?? ''} onChange={(e) => setSettings({ ...settings, email: e.target.value })} /></label>
        <label>Address<input value={settings.address ?? ''} onChange={(e) => setSettings({ ...settings, address: e.target.value })} /></label>
        <label>Tax rate (%)<input type="number" value={settings.tax_rate} onChange={(e) => setSettings({ ...settings, tax_rate: parseFloat(e.target.value) })} /></label>
        <label>Currency<input value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} /></label>
      </div>
    </section>
    <section className="panel" style={{ marginTop: 20 }}><div className="panel-heading"><div><p className="eyebrow">Document numbering</p><h3>Prefixes</h3></div></div>
      <div className="settings-grid">
        <label>Invoice prefix<input value={settings.invoice_prefix} onChange={(e) => setSettings({ ...settings, invoice_prefix: e.target.value })} /></label>
        <label>Quote prefix<input value={settings.quote_prefix} onChange={(e) => setSettings({ ...settings, quote_prefix: e.target.value })} /></label>
        <label>Job card prefix<input value={settings.job_card_prefix} onChange={(e) => setSettings({ ...settings, job_card_prefix: e.target.value })} /></label>
        <label>Receipt prefix<input value={settings.receipt_prefix} onChange={(e) => setSettings({ ...settings, receipt_prefix: e.target.value })} /></label>
      </div>
    </section>
    <section className="panel" style={{ marginTop: 20 }}><div className="panel-heading"><div><p className="eyebrow">Document templates</p><h3>Job card terms &amp; conditions</h3></div></div>
      <label>Printed on every job card <span className="optional">Shown on Customer and Workshop copies</span><textarea value={settings.job_card_terms} onChange={(e) => setSettings({ ...settings, job_card_terms: e.target.value })} style={{ minHeight: 140 }} /></label>
    </section>
  </>;
}

// === USERS & ROLES ===
type StaffRow = Profile & { user_roles: { role_id: string; roles: { name: string; label: string } | null }[] };

function UsersSection({ onNotice }: { onNotice: (m: string) => void }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolePerms, setRolePerms] = useState<Record<string, string[]>>({});
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);

  async function loadAll() {
    const [r, p, rp, s] = await Promise.all([
      supabase.from('roles').select('*').order('name'),
      supabase.from('permissions').select('*').order('key'),
      supabase.from('role_permissions').select('role_id, permissions(key)'),
      supabase.from('profiles').select('*, user_roles(role_id, roles(name,label))').order('full_name'),
    ]);
    setRoles((r.data ?? []) as Role[]); setPermissions((p.data ?? []) as Permission[]);
    const map: Record<string, string[]> = {};
    for (const item of (rp.data as unknown as { role_id: string; permissions: { key: string } }[]) ?? []) { if (!map[item.role_id]) map[item.role_id] = []; map[item.role_id].push(item.permissions.key); }
    setRolePerms(map);
    setStaff((s.data ?? []) as StaffRow[]);
    setLoading(false);
  }
  useEffect(() => { void loadAll(); }, []);

  async function togglePerm(roleId: string, permKey: string) {
    const has = rolePerms[roleId]?.includes(permKey);
    if (has) {
      const perm = permissions.find((p) => p.key === permKey);
      if (perm) await supabase.from('role_permissions').delete().eq('role_id', roleId).eq('permission_id', perm.id);
    } else {
      const perm = permissions.find((p) => p.key === permKey);
      if (perm) await supabase.from('role_permissions').insert({ role_id: roleId, permission_id: perm.id });
    }
    setRolePerms((prev) => { const next = { ...prev }; if (has) next[roleId] = (next[roleId] ?? []).filter((k) => k !== permKey); else next[roleId] = [...(next[roleId] ?? []), permKey]; return next; });
    onNotice('Role permissions updated.');
  }

  async function callAdmin(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke('admin-users', { body });
    if (error) { onNotice('That action could not be completed. Please try again.'); return false; }
    if (data?.error) { onNotice(data.error); return false; }
    return true;
  }
  async function suspend(userId: string) { if (await callAdmin({ action: 'suspend', userId })) { onNotice('User suspended.'); void loadAll(); } }
  async function reactivate(userId: string) { if (await callAdmin({ action: 'reactivate', userId })) { onNotice('User reactivated.'); void loadAll(); } }
  async function disable(userId: string) { if (await callAdmin({ action: 'disable', userId })) { onNotice('User disabled.'); void loadAll(); } }
  async function changeRole(userId: string, roleId: string) { if (await callAdmin({ action: 'changeRole', userId, roleId })) { onNotice('Role updated.'); void loadAll(); } }

  if (loading) return <Loading />;
  return <>
    <div className="page-heading"><div><p className="eyebrow">Access control</p><h1>Users & Roles</h1><p className="muted">Invite employees, manage account access, and configure role permissions.</p></div><div className="heading-actions"><button className="button primary" onClick={() => setShowInvite(true)}><Plus size={16} /> Invite employee</button></div></div>

    <section className="panel table-panel" style={{ marginBottom: 24 }}>
      <div className="panel-heading"><div><p className="eyebrow">Directory</p><h3>Staff</h3></div></div>
      {staff.length === 0 ? <Empty title="No staff yet" text="Invite your first employee to get started." /> : <div className="data-table">{staff.map((person) => {
        const roleName = person.user_roles?.[0]?.roles?.name ?? '';
        return <div className="table-row" key={person.id}>
          <div className="job-icon"><UserCog size={17} /></div>
          <div><strong>{person.full_name || 'Unnamed'}</strong><span>{person.phone ?? '—'}</span></div>
          <select value={roleName} onChange={(e) => void changeRole(person.id, e.target.value)} disabled={!person.user_roles?.[0]}>
            <option value="" disabled>No role</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <span className={`status ${statusStyles[person.status] ?? 'bg-slate-100 text-slate-600'}`}>{person.status}</span>
          <div className="action-buttons">
            {person.status === 'SUSPENDED' || person.status === 'DISABLED'
              ? <button className="button secondary small" onClick={() => void reactivate(person.id)}>Reactivate</button>
              : <button className="button secondary small" onClick={() => void suspend(person.id)}>Suspend</button>}
            {person.status !== 'DISABLED' && <button className="button secondary small" onClick={() => void disable(person.id)}>Disable</button>}
          </div>
        </div>;
      })}</div>}
    </section>

    {roles.map((role) => <section className="panel" key={role.id} style={{ marginBottom: 16 }}>
      <div className="panel-heading"><div><p className="eyebrow">{role.name}</p><h3>{role.label}</h3></div><span className="status bg-slate-100 text-slate-600">{rolePerms[role.id]?.length ?? 0} permissions</span></div>
      <div className="perm-grid">{permissions.map((p) => <label key={p.id} className="perm-chip"><input type="checkbox" checked={role.name === 'ADMIN' || (rolePerms[role.id]?.includes(p.key) ?? false)} disabled={role.name === 'ADMIN'} onChange={() => void togglePerm(role.id, p.key)} />{p.key}</label>)}</div>
    </section>)}

    {showInvite && <InviteEmployeeForm roles={roles} onClose={() => setShowInvite(false)} onSaved={(m) => { setShowInvite(false); onNotice(m); void loadAll(); }} />}
  </>;
}

function InviteEmployeeForm({ roles, onClose, onSaved }: { roles: Role[]; onClose: () => void; onSaved: (m: string) => void }) {
  const [fullName, setFullName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [roleId, setRoleId] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const { data, error: invokeError } = await supabase.functions.invoke('admin-users', {
      body: { action: 'invite', email: email.trim().toLowerCase(), fullName, phone: phone || null, roleId },
    });
    setBusy(false);
    if (invokeError || data?.error) { setError(data?.error ?? 'Unable to send invitation. Please try again.'); return; }
    onSaved(`Invitation sent to ${email}.`);
  }

  return <Modal title="Invite employee" onClose={onClose}><form onSubmit={submit} className="modal-form">
    <label>Full name<input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="e.g. Grace Wanjiru" /></label>
    <label>Work email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="grace@oaklandmotorcare.co.ke" /></label>
    <label>Phone <span className="optional">Optional</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" /></label>
    <label>Role<select value={roleId} onChange={(e) => setRoleId(e.target.value)} required><option value="">Select role...</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
    {error && <div className="form-error">{error}</div>}
    <button className="button primary wide" disabled={busy}>{busy ? 'Sending invitation...' : 'Send invitation'} <ArrowUpRight size={16} /></button>
  </form></Modal>;
}

// === SHARED COMPONENTS ===
function SectionPanel({ eyebrow, title, onNew, newLabel, children }: { eyebrow: string; title: string; onNew?: () => void; newLabel?: string; children: React.ReactNode }) {
  return <section className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div>{onNew && <button className="button primary small" onClick={onNew}><Plus size={16} /> {newLabel}</button>}</div>{children}</section>;
}
function Loading() { return <div className="empty"><div className="empty-icon"><Activity size={20} /></div><strong>Loading...</strong></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><div className="empty-icon"><ClipboardList size={20} /></div><strong>{title}</strong><span>{text}</span></div>; }
function BackBar({ onBack, label }: { onBack: () => void; label: string }) { return <div className="back-bar"><button onClick={onBack}><ChevronRight size={16} className="back-icon" /> {label}</button></div>; }

// === FORMS ===
function CustomerForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [fullName, setFullName] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [company, setCompany] = useState(''); const [type, setType] = useState<'INDIVIDUAL' | 'COMPANY'>('INDIVIDUAL'); const [address, setAddress] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); const { error } = await supabase.from('customers').insert({ full_name: fullName, phone, email: email || null, company_name: company || null, customer_type: type, address: address || null }); setBusy(false); onSaved(error ? 'Unable to save customer. Please try again.' : 'Customer added successfully.'); }
  return <Modal title="Add customer" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Type<select value={type} onChange={(e) => setType(e.target.value as 'INDIVIDUAL' | 'COMPANY')}><option value="INDIVIDUAL">Individual</option><option value="COMPANY">Company</option></select></label><label>Full name<input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="e.g. Brian Otieno" /></label>{type === 'COMPANY' && <label>Company name<input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" /></label>}<label>Phone number<input value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="0712 345 678" /></label><label>Email <span className="optional">Optional</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="brian@email.com" /></label><label>Address <span className="optional">Optional</span><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Nairobi, Kenya" /></label><button className="button primary wide" disabled={busy}>{busy ? 'Saving...' : 'Save customer'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function VehicleForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [customerId, setCustomerId] = useState(''); const [regNumber, setRegNumber] = useState(''); const [make, setMake] = useState(''); const [model, setModel] = useState(''); const [year, setYear] = useState(''); const [mileage, setMileage] = useState('0'); const [vin, setVin] = useState(''); const [fuelType, setFuelType] = useState(''); const [colour, setColour] = useState(''); const [customers, setCustomers] = useState<Customer[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from('customers').select('id,full_name,phone').is('deleted_at', null).order('full_name').limit(200).then(({ data }) => setCustomers((data ?? []) as Customer[])); }, []);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); const { error } = await supabase.from('vehicles').insert({ customer_id: customerId, registration_number: regNumber.toUpperCase(), make, model, year: year ? parseInt(year) : null, mileage: parseInt(mileage), vin: vin || null, fuel_type: fuelType || null, colour: colour || null }); setBusy(false); onSaved(error ? 'Unable to save vehicle. Please try again.' : 'Vehicle added successfully.'); }
  return <Modal title="Add vehicle" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Customer<select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required><option value="">Select customer...</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.full_name} · {c.phone}</option>)}</select></label><label>Registration number<input value={regNumber} onChange={(e) => setRegNumber(e.target.value)} required placeholder="KDA 123A" /></label><div className="form-row"><label>Make<input value={make} onChange={(e) => setMake(e.target.value)} required placeholder="Toyota" /></label><label>Model<input value={model} onChange={(e) => setModel(e.target.value)} required placeholder="Hilux" /></label></div><div className="form-row"><label>Year<input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2020" /></label><label>Mileage<input type="number" value={mileage} onChange={(e) => setMileage(e.target.value)} required min="0" /></label></div><label>VIN <span className="optional">Optional</span><input value={vin} onChange={(e) => setVin(e.target.value)} /></label><div className="form-row"><label>Fuel type<input value={fuelType} onChange={(e) => setFuelType(e.target.value)} placeholder="Diesel" /></label><label>Colour<input value={colour} onChange={(e) => setColour(e.target.value)} placeholder="White" /></label></div><button className="button primary wide" disabled={busy || !customerId}>{busy ? 'Saving...' : 'Save vehicle'} <ArrowUpRight size={16} /></button></form></Modal>;
}

const JOB_TYPE_ICONS: Record<string, typeof Wrench> = {
  SERVICE: Wrench, REPAIR: Settings, DIAGNOSTICS: Activity, BODY_WORK: Sparkles,
  ACCIDENT_REPAIR: AlertTriangle, MAINTENANCE: ClipboardList, AGRICULTURAL_MACHINERY: Truck,
  TRACTOR_REPAIR: Truck, EQUIPMENT_REPAIR: Package, OTHER: FileText,
};

function JobForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [customerId, setCustomerId] = useState(''); const [vehicleId, setVehicleId] = useState(''); const [complaint, setComplaint] = useState(''); const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL'); const [requestedService, setRequestedService] = useState(''); const [jobTypes, setJobTypes] = useState<string[]>([]); const [promisedDate, setPromisedDate] = useState(''); const [customers, setCustomers] = useState<Customer[]>([]); const [vehicles, setVehicles] = useState<Vehicle[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { supabase.from('customers').select('id,full_name,phone').is('deleted_at', null).order('full_name').limit(200).then(({ data }) => setCustomers((data ?? []) as Customer[])); }, []);
  useEffect(() => { setVehicleId(''); if (customerId) supabase.from('vehicles').select('*').eq('customer_id', customerId).is('deleted_at', null).then(({ data }) => setVehicles((data ?? []) as Vehicle[])); else setVehicles([]); }, [customerId]);
  function toggleJobType(type: string) { setJobTypes((prev) => prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]); }
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const { data: jobNumber, error: numberError } = await supabase.rpc('generate_job_card_number');
    if (numberError || !jobNumber) { setBusy(false); setError('Unable to generate a job card number. Please try again.'); return; }
    const { error } = await supabase.from('job_cards').insert({ job_number: jobNumber, customer_id: customerId, vehicle_id: vehicleId, complaint, priority, requested_service: requestedService || null, job_types: jobTypes, promised_at: promisedDate ? new Date(promisedDate).toISOString() : null, mileage: vehicles.find((v) => v.id === vehicleId)?.mileage ?? 0 });
    setBusy(false);
    onSaved(error ? 'Unable to create job card. Please try again.' : `Job card ${jobNumber} created successfully.`);
  }
  return <Modal title="Create job card" onClose={onClose}>
    <form onSubmit={submit} className="modal-form">
      <label>Customer<CustomerPicker customers={customers} customerId={customerId} onSelect={setCustomerId} onCreated={(c) => { setCustomers((prev) => [...prev, c]); setCustomerId(c.id); }} /></label>
      <label>Vehicle<VehiclePicker customerId={customerId} vehicles={vehicles} vehicleId={vehicleId} onSelect={setVehicleId} onCreated={(v) => { setVehicles((prev) => [...prev, v]); setVehicleId(v.id); }} /></label>
      <label>Job type(s) <span className="optional">Optional</span>
        <div className="job-type-grid">{JOB_TYPE_META.map((t) => {
          const Icon = JOB_TYPE_ICONS[t.key] ?? Wrench;
          const active = jobTypes.includes(t.key);
          return <button type="button" key={t.key} className={`job-type-card${active ? ' selected' : ''}`} onClick={() => toggleJobType(t.key)}>
            <Icon size={18} />
            <div><strong>{t.label}</strong><span>{t.description}</span></div>
            {active && <CheckCircle2 size={16} className="job-type-check" />}
          </button>;
        })}</div>
      </label>
      <div className="form-row">
        <label>Priority<select value={priority} onChange={(e) => setPriority(e.target.value as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT')}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label>
        <label>Promised date <span className="optional">Optional</span><input type="date" value={promisedDate} onChange={(e) => setPromisedDate(e.target.value)} /></label>
      </div>
      <label>Requested service<input value={requestedService} onChange={(e) => setRequestedService(e.target.value)} placeholder="e.g. Oil change" /></label>
      <label>Customer complaint<textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} required placeholder="What does the customer need help with?" /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="button primary wide" disabled={busy || !vehicleId}>{busy ? 'Creating...' : 'Create job card'} <ArrowUpRight size={16} /></button>
    </form>
  </Modal>;
}

function ServiceForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(''); const [category, setCategory] = useState('General'); const [price, setPrice] = useState('0'); const [duration, setDuration] = useState('60'); const [description, setDescription] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); const { error } = await supabase.from('services').insert({ name, category, description: description || null, standard_price_minor: Math.round(parseFloat(price) * 100), estimated_minutes: parseInt(duration) }); setBusy(false); onSaved(error ? 'Unable to save service.' : 'Service added successfully.'); }
  return <Modal title="Add service" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Service name<input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Oil change" /></label><label>Category<input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Maintenance" /></label><div className="form-row"><label>Standard price (KES)<input type="number" value={price} onChange={(e) => setPrice(e.target.value)} required min="0" step="0.01" /></label><label>Estimated minutes<input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} required min="1" /></label></div><label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Service description..." /></label><button className="button primary wide" disabled={busy}>{busy ? 'Saving...' : 'Save service'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function PartForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [sku, setSku] = useState(''); const [name, setName] = useState(''); const [category, setCategory] = useState('General'); const [brand, setBrand] = useState(''); const [costPrice, setCostPrice] = useState('0'); const [sellPrice, setSellPrice] = useState('0'); const [qty, setQty] = useState('0'); const [reorder, setReorder] = useState('0'); const [location, setLocation] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); const { error: partError } = await supabase.from('parts').insert({ sku, name, category, brand: brand || null, cost_price_minor: Math.round(parseFloat(costPrice) * 100), selling_price_minor: Math.round(parseFloat(sellPrice) * 100), quantity_on_hand: parseInt(qty), reorder_level: parseInt(reorder), location: location || null });
    if (partError) { setBusy(false); onSaved('Unable to save part. Please try again.'); return; }
    onSaved('Part added successfully.'); }
  return <Modal title="Add part" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>SKU<input value={sku} onChange={(e) => setSku(e.target.value)} required placeholder="e.g. BP-001" /></label><label>Part name<input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Brake pads" /></label><div className="form-row"><label>Category<input value={category} onChange={(e) => setCategory(e.target.value)} /></label><label>Brand<input value={brand} onChange={(e) => setBrand(e.target.value)} /></label></div><div className="form-row"><label>Cost price (KES)<input type="number" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} required min="0" step="0.01" /></label><label>Selling price (KES)<input type="number" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} required min="0" step="0.01" /></label></div><div className="form-row"><label>Quantity on hand<input type="number" value={qty} onChange={(e) => setQty(e.target.value)} required min="0" /></label><label>Reorder level<input type="number" value={reorder} onChange={(e) => setReorder(e.target.value)} required min="0" /></label></div><label>Location/bin<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Shelf A-3" /></label><button className="button primary wide" disabled={busy}>{busy ? 'Saving...' : 'Save part'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function SupplierForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(''); const [contactPerson, setContactPerson] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [address, setAddress] = useState(''); const [paymentTerms, setPaymentTerms] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); const { error } = await supabase.from('suppliers').insert({ name, contact_person: contactPerson || null, phone, email: email || null, address: address || null, payment_terms: paymentTerms || null }); setBusy(false); onSaved(error ? 'Unable to save supplier.' : 'Supplier added successfully.'); }
  return <Modal title="Add supplier" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Supplier name<input value={name} onChange={(e) => setName(e.target.value)} required /></label><label>Contact person<input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} /></label><label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} required /></label><label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" /></label><label>Address<input value={address} onChange={(e) => setAddress(e.target.value)} /></label><label>Payment terms<input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. Net 30" /></label><button className="button primary wide" disabled={busy}>{busy ? 'Saving...' : 'Save supplier'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function POForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [supplierId, setSupplierId] = useState(''); const [suppliers, setSuppliers] = useState<Supplier[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from('suppliers').select('*').eq('status', 'ACTIVE').is('deleted_at', null).order('name').then(({ data }) => setSuppliers((data ?? []) as Supplier[])); }, []);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); const poNumber = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`; const { error } = await supabase.from('purchase_orders').insert({ po_number: poNumber, supplier_id: supplierId, status: 'DRAFT', order_date: new Date().toISOString().slice(0, 10) }); setBusy(false); onSaved(error ? 'Unable to create PO.' : 'Purchase order created.'); }
  return <Modal title="New purchase order" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Supplier<select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required><option value="">Select supplier...</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button className="button primary wide" disabled={busy || !supplierId}>{busy ? 'Creating...' : 'Create PO'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function QuotationForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [jobId, setJobId] = useState(''); const [jobs, setJobs] = useState<(JobCard & { vehicles: { registration_number: string } | null; customers: { full_name: string } | null })[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from('job_cards').select('*, vehicles(registration_number), customers(full_name)').in('status', ['DIAGNOSIS','IN_PROGRESS','AWAITING_APPROVAL','APPROVED']).is('deleted_at', null).order('created_at', { ascending: false }).limit(50).then(({ data }) => setJobs((data ?? []) as (JobCard & { vehicles: { registration_number: string } | null; customers: { full_name: string } | null })[])); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const job = jobs.find((j) => j.id === jobId); if (!job) { setBusy(false); return; }
    const { data: labour } = await supabase.from('job_card_labour').select('*').eq('job_card_id', jobId);
    const { data: parts } = await supabase.from('job_card_parts').select('*, parts(name,selling_price_minor)').eq('job_card_id', jobId);
    const items: { item_type: 'LABOUR' | 'PART'; description: string; quantity: number; unit_price_minor: number; tax_rate: number; line_total_minor: number }[] = [];
    (labour ?? []).forEach((l: JobCardLabour) => items.push({ item_type: 'LABOUR', description: l.description, quantity: l.quantity, unit_price_minor: l.unit_price_minor, tax_rate: l.tax_rate, line_total_minor: computeLineTotal(l.quantity, l.unit_price_minor, l.tax_rate) }));
    (parts ?? []).forEach((p: JobCardPart & { parts: Part | null }) => items.push({ item_type: 'PART', description: p.parts?.name ?? 'Part', quantity: p.quantity, unit_price_minor: p.unit_price_minor, tax_rate: 16, line_total_minor: computeLineTotal(p.quantity, p.unit_price_minor, 16) }));
    const subtotal = items.reduce((s, i) => s + i.line_total_minor, 0);
    const quoteNumber = `QUO-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    const validUntil = new Date(); validUntil.setDate(validUntil.getDate() + 30);
    const { data: quote } = await supabase.from('quotations').insert({ quote_number: quoteNumber, customer_id: job.customer_id, vehicle_id: job.vehicle_id, job_card_id: jobId, subtotal_minor: subtotal, discount_minor: 0, tax_minor: 0, total_minor: subtotal, valid_until: validUntil.toISOString().slice(0, 10), status: 'PENDING_APPROVAL' }).select().single();
    if (quote) for (const item of items) void supabase.from('quotation_items').insert({ quotation_id: quote.id, ...item });
    setBusy(false); onSaved('Quotation created from job card.');
  }
  return <Modal title="Create quotation" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Job card<select value={jobId} onChange={(e) => setJobId(e.target.value)} required><option value="">Select job...</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.vehicles?.registration_number ?? 'Vehicle'} · {j.customers?.full_name ?? 'Customer'}</option>)}</select></label><button className="button primary wide" disabled={busy || !jobId}>{busy ? 'Creating...' : 'Create quotation'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function InvoiceForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [jobId, setJobId] = useState(''); const [jobs, setJobs] = useState<(JobCard & { vehicles: { registration_number: string } | null; customers: { full_name: string } | null })[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from('job_cards').select('*, vehicles(registration_number), customers(full_name)').in('status', ['QUALITY_CHECK','READY_FOR_COLLECTION']).is('deleted_at', null).order('created_at', { ascending: false }).limit(50).then(({ data }) => setJobs((data ?? []) as (JobCard & { vehicles: { registration_number: string } | null; customers: { full_name: string } | null })[])); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const job = jobs.find((j) => j.id === jobId); if (!job) { setBusy(false); return; }
    const { data: labour } = await supabase.from('job_card_labour').select('*').eq('job_card_id', jobId);
    const { data: parts } = await supabase.from('job_card_parts').select('*, parts(name)').eq('job_card_id', jobId);
    const items: { item_type: 'LABOUR' | 'PART'; description: string; quantity: number; unit_price_minor: number; tax_rate: number; line_total_minor: number }[] = [];
    (labour ?? []).forEach((l: JobCardLabour) => items.push({ item_type: 'LABOUR', description: l.description, quantity: l.quantity, unit_price_minor: l.unit_price_minor, tax_rate: l.tax_rate, line_total_minor: computeLineTotal(l.quantity, l.unit_price_minor, l.tax_rate) }));
    (parts ?? []).forEach((p: JobCardPart & { parts: Part | null }) => items.push({ item_type: 'PART', description: p.parts?.name ?? 'Part', quantity: p.quantity, unit_price_minor: p.unit_price_minor, tax_rate: 16, line_total_minor: computeLineTotal(p.quantity, p.unit_price_minor, 16) }));
    const subtotal = items.reduce((s, i) => s + i.line_total_minor, 0);
    const invNumber = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 14);
    const { data: inv } = await supabase.from('invoices').insert({ invoice_number: invNumber, customer_id: job.customer_id, vehicle_id: job.vehicle_id, job_card_id: jobId, subtotal_minor: subtotal, discount_minor: 0, tax_minor: 0, total_minor: subtotal, due_date: dueDate.toISOString().slice(0, 10), status: 'ISSUED' }).select().single();
    if (inv) for (const item of items) void supabase.from('invoice_items').insert({ invoice_id: inv.id, ...item });
    setBusy(false); onSaved('Invoice created from job card.');
  }
  return <Modal title="Create invoice" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Job card<select value={jobId} onChange={(e) => setJobId(e.target.value)} required><option value="">Select completed job...</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.vehicles?.registration_number ?? 'Vehicle'} · {j.customers?.full_name ?? 'Customer'}</option>)}</select></label><button className="button primary wide" disabled={busy || !jobId}>{busy ? 'Creating...' : 'Create invoice'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function PaymentForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [invoiceId, setInvoiceId] = useState(''); const [amount, setAmount] = useState(''); const [method, setMethod] = useState<'CASH' | 'MPESA' | 'BANK' | 'CARD' | 'OTHER'>('CASH'); const [reference, setReference] = useState(''); const [invoices, setInvoices] = useState<(Invoice & { customers: { full_name: string } | null })[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from('invoices').select('*, customers(full_name)').in('status', ['ISSUED','PART_PAID','OVERDUE']).order('created_at', { ascending: false }).limit(50).then(({ data }) => setInvoices((data ?? []) as (Invoice & { customers: { full_name: string } | null })[])); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const inv = invoices.find((i) => i.id === invoiceId); if (!inv) { setBusy(false); return; }
    const amountMinor = Math.round(parseFloat(amount) * 100);
    const idemKey = `pay-${inv.id}-${amountMinor}-${Date.now()}`;
    const { error } = await supabase.rpc('record_payment', { p_invoice_id: invoiceId, p_amount_minor: amountMinor, p_method: method, p_reference: reference || null, p_idempotency_key: idemKey, p_notes: null });
    setBusy(false); onSaved(error ? (error.message.includes('exceeds') ? 'Payment exceeds outstanding balance.' : 'Unable to record payment. Please try again.') : 'Payment recorded successfully.');
  }
  return <Modal title="Record payment" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Invoice<select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} required><option value="">Select invoice...</option>{invoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_number} · {i.customers?.full_name ?? 'Customer'} · Balance {formatKes(i.total_minor - i.amount_paid_minor)}</option>)}</select></label><label>Amount (KES)<input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required min="0.01" step="0.01" /></label><label>Payment method<select value={method} onChange={(e) => setMethod(e.target.value as 'CASH' | 'MPESA' | 'BANK' | 'CARD' | 'OTHER')}><option value="CASH">Cash</option><option value="MPESA">M-Pesa</option><option value="BANK">Bank</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></label><label>Reference <span className="optional">Optional</span><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="M-Pesa code, receipt no." /></label><button className="button primary wide" disabled={busy || !invoiceId}>{busy ? 'Recording...' : 'Record payment'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function StockReceiveForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [partId, setPartId] = useState(''); const [qty, setQty] = useState('1'); const [unitCost, setUnitCost] = useState('0'); const [parts, setParts] = useState<Part[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from('parts').select('*').eq('active', true).order('name').limit(200).then(({ data }) => setParts((data ?? []) as Part[])); }, []);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); const { error } = await supabase.rpc('receive_stock', { p_part_id: partId, p_quantity: parseInt(qty), p_unit_cost_minor: Math.round(parseFloat(unitCost) * 100), p_reference: 'Manual receipt' }); setBusy(false); onSaved(error ? 'Unable to receive stock.' : 'Stock received successfully.'); }
  return <Modal title="Receive stock" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Part<select value={partId} onChange={(e) => setPartId(e.target.value)} required><option value="">Select part...</option>{parts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.quantity_on_hand} in stock)</option>)}</select></label><div className="form-row"><label>Quantity<input type="number" value={qty} onChange={(e) => setQty(e.target.value)} required min="1" /></label><label>Unit cost (KES)<input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} required min="0" step="0.01" /></label></div><button className="button primary wide" disabled={busy || !partId}>{busy ? 'Receiving...' : 'Receive stock'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function StockAdjustForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [partId, setPartId] = useState(''); const [adjType, setAdjType] = useState<'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'DAMAGE'>('ADJUSTMENT_IN'); const [qty, setQty] = useState('1'); const [reason, setReason] = useState(''); const [parts, setParts] = useState<Part[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from('parts').select('*').eq('active', true).order('name').limit(200).then(({ data }) => setParts((data ?? []) as Part[])); }, []);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); const { error } = await supabase.rpc('adjust_stock', { p_part_id: partId, p_adjustment_type: adjType, p_quantity: parseInt(qty), p_reason: reason }); setBusy(false); onSaved(error ? 'Unable to adjust stock.' : 'Stock adjusted successfully.'); }
  return <Modal title="Adjust stock" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Part<select value={partId} onChange={(e) => setPartId(e.target.value)} required><option value="">Select part...</option>{parts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.quantity_on_hand} in stock)</option>)}</select></label><label>Adjustment type<select value={adjType} onChange={(e) => setAdjType(e.target.value as 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'DAMAGE')}><option value="ADJUSTMENT_IN">Add (in)</option><option value="ADJUSTMENT_OUT">Remove (out)</option><option value="DAMAGE">Damage/loss</option></select></label><label>Quantity<input type="number" value={qty} onChange={(e) => setQty(e.target.value)} required min="1" /></label><label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="e.g. Stock count correction" /></label><button className="button primary wide" disabled={busy || !partId}>{busy ? 'Adjusting...' : 'Adjust stock'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Operations</p><h2>{title}</h2></div><button className="close-button" onClick={onClose}><X size={18} /></button></div>{children}</div></div>;
}

/** Type a customer's name/phone to pick an existing match, or add a new one inline
 * without leaving the current form. */
function CustomerPicker({ customers, customerId, onSelect, onCreated }: { customers: Customer[]; customerId: string; onSelect: (id: string) => void; onCreated: (c: Customer) => void }) {
  const [query, setQuery] = useState(''); const [open, setOpen] = useState(false); const [showNew, setShowNew] = useState(false); const [newPhone, setNewPhone] = useState(''); const [busy, setBusy] = useState(false);
  const selected = customers.find((c) => c.id === customerId);
  const q = query.trim().toLowerCase();
  const matches = q ? customers.filter((c) => c.full_name.toLowerCase().includes(q) || c.phone.includes(q)).slice(0, 8) : [];

  async function createCustomer() {
    if (!query.trim() || !newPhone.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.from('customers').insert({ full_name: query.trim(), phone: newPhone.trim() }).select().single();
    setBusy(false);
    if (error || !data) return;
    onCreated(data as Customer);
    setShowNew(false); setOpen(false); setQuery(''); setNewPhone('');
  }

  return <div className="combobox">
    <input
      value={selected ? `${selected.full_name} · ${selected.phone}` : query}
      onChange={(e) => { onSelect(''); setQuery(e.target.value); setShowNew(false); setOpen(true); }}
      onFocus={() => { if (!selected) setOpen(true); }}
      onBlur={() => setTimeout(() => setOpen(false), 150)}
      placeholder="Type a customer's name or phone..."
      required
    />
    {open && !selected && (matches.length > 0 || q.length > 1) && <div className="combobox-dropdown">
      {matches.map((c) => <button type="button" key={c.id} className="combobox-option" onMouseDown={() => { onSelect(c.id); setQuery(''); setOpen(false); }}>{c.full_name} · {c.phone}</button>)}
      {q.length > 1 && <button type="button" className="combobox-option combobox-add" onMouseDown={() => setShowNew(true)}><Plus size={14} /> Add &quot;{query.trim()}&quot; as new customer</button>}
    </div>}
    {showNew && <div className="combobox-new">
      <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone number for the new customer" />
      <button type="button" className="button primary small" disabled={busy || !newPhone.trim()} onClick={() => void createCustomer()}>{busy ? 'Saving...' : 'Save customer'}</button>
    </div>}
  </div>;
}

function VehiclePicker({ customerId, vehicles, vehicleId, onSelect, onCreated }: { customerId: string; vehicles: Vehicle[]; vehicleId: string; onSelect: (id: string) => void; onCreated: (v: Vehicle) => void }) {
  const [query, setQuery] = useState(''); const [open, setOpen] = useState(false); const [showNew, setShowNew] = useState(false);
  const [newMake, setNewMake] = useState(''); const [newModel, setNewModel] = useState(''); const [newYear, setNewYear] = useState(''); const [newMileage, setNewMileage] = useState(''); const [busy, setBusy] = useState(false);
  const selected = vehicles.find((v) => v.id === vehicleId);
  const q = query.trim().toLowerCase();
  const matches = q ? vehicles.filter((v) => v.registration_number.toLowerCase().includes(q) || v.make.toLowerCase().includes(q) || v.model.toLowerCase().includes(q)) : vehicles;

  async function createVehicle() {
    if (!customerId || !query.trim() || !newMake.trim() || !newModel.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.from('vehicles').insert({ customer_id: customerId, registration_number: query.trim().toUpperCase(), make: newMake.trim(), model: newModel.trim(), year: newYear ? parseInt(newYear) : null, mileage: newMileage ? parseInt(newMileage) : 0 }).select().single();
    setBusy(false);
    if (error || !data) return;
    onCreated(data as Vehicle);
    setShowNew(false); setOpen(false); setQuery(''); setNewMake(''); setNewModel(''); setNewYear(''); setNewMileage('');
  }

  if (!customerId) return <input disabled placeholder="Select a customer first..." />;

  return <div className="combobox">
    <input
      value={selected ? `${selected.registration_number} · ${selected.make} ${selected.model}` : query}
      onChange={(e) => { onSelect(''); setQuery(e.target.value); setShowNew(false); setOpen(true); }}
      onFocus={() => { if (!selected) setOpen(true); }}
      onBlur={() => setTimeout(() => setOpen(false), 150)}
      placeholder="Type registration number, make or model..."
      required
    />
    {open && !selected && <div className="combobox-dropdown">
      {matches.length === 0 && <p className="combobox-empty">No vehicles yet for this customer.</p>}
      {matches.map((v) => <button type="button" key={v.id} className="combobox-option" onMouseDown={() => { onSelect(v.id); setQuery(''); setOpen(false); }}>{v.registration_number} · {v.make} {v.model}{v.year ? ` (${v.year})` : ''}</button>)}
      {q.length > 1 && <button type="button" className="combobox-option combobox-add" onMouseDown={() => setShowNew(true)}><Plus size={14} /> Add &quot;{query.trim().toUpperCase()}&quot; as new vehicle</button>}
    </div>}
    {showNew && <div className="combobox-new combobox-new-wrap">
      <input value={newMake} onChange={(e) => setNewMake(e.target.value)} placeholder="Make" />
      <input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="Model" />
      <input value={newYear} onChange={(e) => setNewYear(e.target.value)} placeholder="Year" type="number" />
      <input value={newMileage} onChange={(e) => setNewMileage(e.target.value)} placeholder="Mileage (KM)" type="number" />
      <button type="button" className="button primary small" disabled={busy || !newMake.trim() || !newModel.trim()} onClick={() => void createVehicle()}>{busy ? 'Saving...' : 'Save vehicle'}</button>
    </div>}
  </div>;
}
