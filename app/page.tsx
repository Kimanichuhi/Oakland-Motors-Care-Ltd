'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { supabase } from '@/lib/supabase';
import { formatKes, formatDate, formatDateTime, computeLineTotal, downloadCSV, formatKg, localDateStr, localDayStart, localDayEnd } from '@/lib/formatting';
import { getTaxRate, clearTaxRateCache } from '@/lib/settings';
import { statusStyles, JOB_TRANSITIONS, PAYMENT_METHODS, SALES_PAYMENT_METHODS, SALES_PAYMENT_STATUSES, CUSTOMER_SALE_TYPES, PART_CATEGORIES, JOB_TYPE_META, MOVEMENT_TYPES } from '@/lib/constants';
import { loadUserPermissions, hasPermission, clearPermissionCache, type UserPermission } from '@/lib/permissions';
import type { Customer, Vehicle, Service, Part, Supplier, JobCard, JobCardLabour, JobCardPart, JobCardStatusHistory, JobCardInspectionItem, JobCardWorkItem, JobCardDiagnosis, JobCardQualityCheck, JobCardSignoff, Invoice, InvoiceItem, Payment, GeneralReceipt, GeneralReceiptItem, Quotation, QuotationItem, PurchaseOrder, PurchaseOrderItem, StockMovement, Sale, SaleItem, Employee, Notification, AuditLog, BusinessSettings, Role, Permission, Profile } from '@/lib/types';
import {
  ArrowUpRight, Bell, CarFront, CheckCircle2, CircleDollarSign, ClipboardList, Gauge,
  LayoutDashboard, LogOut, Menu, Package, Plus, Search, Settings, ShieldCheck, Sparkles, Users,
  Wrench, X, FileText, Truck, ShoppingCart, Receipt, ScrollText, UserCog, AlertTriangle,
  TrendingUp, Download, Eye, EyeOff, Edit, Archive, Trash2, Phone, Mail, MapPin, Filter, ChevronRight,
  Briefcase, Boxes, Store, Banknote, Smartphone, FileCheck, Clock, Activity, Calendar, Printer, Recycle, DoorOpen, Ban, Circle, Scale,
} from 'lucide-react';

import SalesSection from '@/components/sales/SalesSection';
import SaleDetail from '@/components/sales/SaleDetail';
import SaleForm from '@/components/sales/SaleForm';
import ScrapDashboardPage from '@/components/scrap/ScrapDashboardPage';
import ScrapRecordsPage from '@/components/scrap/ScrapRecordsPage';
import ScrapStockPage from '@/components/scrap/ScrapStockPage';
import ScrapReconciliationPage from '@/components/scrap/ScrapReconciliationPage';
import ScrapFinancesPage from '@/components/scrap/ScrapFinancesPage';
import ScrapReportsPage from '@/components/scrap/ScrapReportsPage';
import ScrapTypesPage from '@/components/scrap/ScrapTypesPage';
import DebtsOverviewPage from '@/components/debts/DebtsOverviewPage';
import DebtRegisterPage from '@/components/debts/DebtRegisterPage';
import DebtReportsPage from '@/components/debts/DebtReportsPage';
import VehicleRegisterSection from '@/components/vehicle-register/VehicleRegisterSection';

type SectionId =
  | 'dashboard' | 'customers' | 'vehicles' | 'vehicleregister' | 'jobcards' | 'services' | 'technicians'
  | 'sales' | 'parts' | 'stockmovements' | 'lowstock' | 'suppliers' | 'procurement'
  | 'quotations' | 'invoices' | 'payments' | 'receipts'
  | 'scrapdashboard' | 'scraprecords' | 'scrapstock' | 'scrapreconciliation' | 'scrapfinances' | 'scrapreports' | 'scraptypes'
  | 'debtsoverview' | 'debtregister' | 'debtreports'
  | 'reports' | 'notifications' | 'audit' | 'settings' | 'users';

const NAV_GROUPS: { label: string; items: { id: SectionId; label: string; icon: React.ReactNode; perm: string }[] }[] = [
  { label: '', items: [{ id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} />, perm: 'dashboard.view' }] },
  { label: 'Operations', items: [
    { id: 'customers', label: 'Customers', icon: <Users size={18} />, perm: 'customer.view' },
    { id: 'vehicles', label: 'Vehicles', icon: <CarFront size={18} />, perm: 'vehicle.view' },
    { id: 'vehicleregister', label: 'Vehicle Register', icon: <DoorOpen size={18} />, perm: 'vehicle_register.view' },
    { id: 'jobcards', label: 'Work Orders', icon: <ClipboardList size={18} />, perm: 'job.view' },
    { id: 'services', label: 'Services', icon: <Wrench size={18} />, perm: 'dashboard.view' },
    { id: 'technicians', label: 'Technicians', icon: <UserCog size={18} />, perm: 'job.view' },
  ] },
  { label: 'Inventory', items: [
    { id: 'sales', label: 'Sales', icon: <Store size={18} />, perm: 'sales.view' },
    { id: 'parts', label: 'Parts', icon: <Package size={18} />, perm: 'inventory.view' },
    { id: 'stockmovements', label: 'Stock Movements', icon: <Boxes size={18} />, perm: 'inventory.view' },
    { id: 'lowstock', label: 'Low Stock', icon: <AlertTriangle size={18} />, perm: 'inventory.view' },
    { id: 'suppliers', label: 'Suppliers', icon: <Truck size={18} />, perm: 'supplier.view' },
    { id: 'procurement', label: 'Procurement', icon: <ShoppingCart size={18} />, perm: 'purchase_order.view' },
  ] },
  { label: 'Scrap Yard', items: [
    { id: 'scrapdashboard', label: 'Overview', icon: <LayoutDashboard size={18} />, perm: 'scrap.view' },
    { id: 'scraprecords', label: 'Daily Records', icon: <ClipboardList size={18} />, perm: 'scrap.view' },
    { id: 'scrapstock', label: 'Stock Position', icon: <Boxes size={18} />, perm: 'scrap.view' },
    { id: 'scrapreconciliation', label: 'Reconciliation', icon: <Scale size={18} />, perm: 'scrap.view' },
    { id: 'scrapfinances', label: 'Finances', icon: <CircleDollarSign size={18} />, perm: 'scrap.view' },
    { id: 'scrapreports', label: 'Reports', icon: <Gauge size={18} />, perm: 'scrap.view' },
    { id: 'scraptypes', label: 'Scrap Types & Rates', icon: <Recycle size={18} />, perm: 'scrap.manage' },
  ] },
  { label: 'Debts', items: [
    { id: 'debtsoverview', label: 'Overview', icon: <AlertTriangle size={18} />, perm: 'debt.view' },
    { id: 'debtregister', label: 'Debt Register', icon: <ClipboardList size={18} />, perm: 'debt.view' },
    { id: 'debtreports', label: 'Reports', icon: <Gauge size={18} />, perm: 'debt.view' },
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

// === UNIVERSAL SEARCH — one query bar, every module ===
type SearchResultGroup = { key: SectionId; label: string; icon: React.ReactNode; items: { id: string; title: string; subtitle: string }[] };

async function runUniversalSearch(term: string, can: (p: string) => boolean): Promise<SearchResultGroup[]> {
  const pattern = `%${term}%`;
  const tasks: Promise<SearchResultGroup | null>[] = [];

  if (can('customer.view')) tasks.push((async () => {
    const { data } = await supabase.from('customers').select('id,full_name,phone,email').is('deleted_at', null).or(`full_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`).limit(4);
    const items = ((data ?? []) as { id: string; full_name: string; phone: string | null; email: string | null }[]).map((c) => ({ id: c.id, title: c.full_name, subtitle: c.phone ?? c.email ?? '' }));
    return items.length ? { key: 'customers' as SectionId, label: 'Customers', icon: <Users size={14} />, items } : null;
  })());

  if (can('vehicle.view')) tasks.push((async () => {
    const { data } = await supabase.from('vehicles').select('id,registration_number,make,model').is('deleted_at', null).or(`registration_number.ilike.${pattern},make.ilike.${pattern},model.ilike.${pattern}`).limit(4);
    const items = ((data ?? []) as { id: string; registration_number: string; make: string; model: string }[]).map((v) => ({ id: v.id, title: v.registration_number, subtitle: `${v.make} ${v.model}` }));
    return items.length ? { key: 'vehicles' as SectionId, label: 'Vehicles', icon: <CarFront size={14} />, items } : null;
  })());

  if (can('job.view')) tasks.push((async () => {
    const { data } = await supabase.from('job_cards').select('id,job_number,complaint').is('deleted_at', null).or(`job_number.ilike.${pattern},complaint.ilike.${pattern}`).limit(4);
    const items = ((data ?? []) as { id: string; job_number: string; complaint: string | null }[]).map((j) => ({ id: j.id, title: j.job_number, subtitle: j.complaint ?? '' }));
    return items.length ? { key: 'jobcards' as SectionId, label: 'Work Orders', icon: <Wrench size={14} />, items } : null;
  })());

  if (can('inventory.view')) tasks.push((async () => {
    const { data } = await supabase.from('parts').select('id,name,sku').eq('active', true).or(`name.ilike.${pattern},sku.ilike.${pattern}`).limit(4);
    const items = ((data ?? []) as { id: string; name: string; sku: string }[]).map((p) => ({ id: p.id, title: p.name, subtitle: p.sku }));
    return items.length ? { key: 'parts' as SectionId, label: 'Parts', icon: <Package size={14} />, items } : null;
  })());

  if (can('sales.view')) tasks.push((async () => {
    const { data } = await supabase.from('sales').select('id,sale_number,customer_name').or(`sale_number.ilike.${pattern},customer_name.ilike.${pattern}`).limit(4);
    const items = ((data ?? []) as { id: string; sale_number: string; customer_name: string | null }[]).map((s) => ({ id: s.id, title: s.sale_number, subtitle: s.customer_name ?? '' }));
    return items.length ? { key: 'sales' as SectionId, label: 'Sales', icon: <Store size={14} />, items } : null;
  })());

  if (can('invoice.view')) tasks.push((async () => {
    const { data } = await supabase.from('invoices').select('id,invoice_number').ilike('invoice_number', pattern).limit(4);
    const items = ((data ?? []) as { id: string; invoice_number: string }[]).map((i) => ({ id: i.id, title: i.invoice_number, subtitle: 'Invoice' }));
    return items.length ? { key: 'invoices' as SectionId, label: 'Invoices', icon: <CircleDollarSign size={14} />, items } : null;
  })());

  if (can('supplier.view')) tasks.push((async () => {
    const { data } = await supabase.from('suppliers').select('id,name,phone').is('deleted_at', null).or(`name.ilike.${pattern},phone.ilike.${pattern}`).limit(4);
    const items = ((data ?? []) as { id: string; name: string; phone: string | null }[]).map((s) => ({ id: s.id, title: s.name, subtitle: s.phone ?? '' }));
    return items.length ? { key: 'suppliers' as SectionId, label: 'Suppliers', icon: <Truck size={14} />, items } : null;
  })());

  if (can('quotation.view')) tasks.push((async () => {
    const { data } = await supabase.from('quotations').select('id,quote_number').ilike('quote_number', pattern).limit(4);
    const items = ((data ?? []) as { id: string; quote_number: string }[]).map((q) => ({ id: q.id, title: q.quote_number, subtitle: 'Quotation' }));
    return items.length ? { key: 'quotations' as SectionId, label: 'Quotations', icon: <FileText size={14} />, items } : null;
  })());

  if (can('purchase_order.view')) tasks.push((async () => {
    const { data } = await supabase.from('purchase_orders').select('id,po_number').ilike('po_number', pattern).limit(4);
    const items = ((data ?? []) as { id: string; po_number: string }[]).map((po) => ({ id: po.id, title: po.po_number, subtitle: 'Purchase order' }));
    return items.length ? { key: 'procurement' as SectionId, label: 'Purchase Orders', icon: <ShoppingCart size={14} />, items } : null;
  })());

  return (await Promise.all(tasks)).filter((g): g is SearchResultGroup => g !== null);
}

export default function Home() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>(null);
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<SectionId>('dashboard');
  const [userPerms, setUserPerms] = useState<UserPermission>({ permissions: [], role: '', roleLabel: '', fullName: '' });
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [online, setOnline] = useState(true);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [showJobForm, setShowJobForm] = useState(false);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [showTechnicianForm, setShowTechnicianForm] = useState(false);
  const [showPartForm, setShowPartForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [showPOForm, setShowPOForm] = useState(false);
  const [showQuotationForm, setShowQuotationForm] = useState(false);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [showStockReceiveForm, setShowStockReceiveForm] = useState(false);
  const [showStockAdjustForm, setShowStockAdjustForm] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedQuotationId, setSelectedQuotationId] = useState<string | null>(null);
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [permsLoaded, setPermsLoaded] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session) void loadUserPermissions().then((p) => { setUserPerms(p); setPermsLoaded(true); });
      else setPermsLoaded(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
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

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!session) { setUnreadCount(0); return; }
    (async () => {
      const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', session.user.id).is('read_at', null);
      setUnreadCount(count ?? 0);
    })();
  }, [session, section, refreshKey]);

  async function signOut() {
    await supabase.auth.signOut();
    clearPermissionCache();
    setUserPerms({ permissions: [], role: '', roleLabel: '', fullName: '' });
  }

  const can = useCallback((perm: string) => hasPermission(userPerms, perm), [userPerms]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchGroups, setSearchGroups] = useState<SearchResultGroup[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchInputRef.current?.focus(); setSearchOpen(true); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setSearchGroups([]); setSearchLoading(false); return undefined; }
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      setSearchGroups(await runUniversalSearch(term, can));
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, can]);

  function navigateToSearchResult(sectionId: SectionId, id: string) {
    setSection(sectionId);
    setSelectedJobId(null); setSelectedVehicleId(null); setSelectedCustomerId(null); setSelectedInvoiceId(null);
    setSelectedQuotationId(null); setSelectedPOId(null); setSelectedSupplierId(null); setSelectedSaleId(null); setSelectedPartId(null); setSelectedTechnicianId(null);
    if (sectionId === 'customers') setSelectedCustomerId(id);
    else if (sectionId === 'vehicles') setSelectedVehicleId(id);
    else if (sectionId === 'jobcards') setSelectedJobId(id);
    else if (sectionId === 'parts') setSelectedPartId(id);
    else if (sectionId === 'sales') setSelectedSaleId(id);
    else if (sectionId === 'invoices') setSelectedInvoiceId(id);
    else if (sectionId === 'suppliers') setSelectedSupplierId(id);
    else if (sectionId === 'quotations') setSelectedQuotationId(id);
    else if (sectionId === 'procurement') setSelectedPOId(id);
    setQuery(''); setSearchGroups([]); setSearchOpen(false); setShowMobileNav(false);
  }

  const searchResultCount = searchGroups.reduce((s, g) => s + g.items.length, 0);

  const visibleNav = useMemo(() => NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => can(item.perm)),
  })).filter((group) => group.items.length > 0), [can]);

  if (loading) return <div className="loading-screen"><div className="brand-mark">OM</div><p>Oakland Motor Care Ltd</p></div>;
  if (!session) return <AuthScreen error={authError} setError={setAuthError} />;
  if (recoveryMode) return <ResetPasswordScreen onDone={() => setRecoveryMode(false)} />;
  if (permsLoaded && userPerms.permissions.length === 0) return <AccountInactiveScreen onSignOut={() => void signOut()} />;

  return <main className="app-shell">
    {showMobileNav && <div className="nav-overlay" onClick={() => setShowMobileNav(false)} />}
    <aside className={`sidebar ${showMobileNav ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark">OM</div><div><strong>Oakland Motor</strong><span>Care Ltd</span></div></div>
      <nav className="nav-list">
        {visibleNav.map((group, gi) => <div key={gi} className="nav-group">
          {group.label && <p className="nav-label">{group.label}</p>}
          {group.items.map((item) => <button key={item.id} className={section === item.id ? 'nav-item active' : 'nav-item'} onClick={() => { setSection(item.id); setShowMobileNav(false); setSelectedJobId(null); setSelectedVehicleId(null); setSelectedCustomerId(null); setSelectedInvoiceId(null); setSelectedQuotationId(null); setSelectedPOId(null); setSelectedSupplierId(null); setSelectedSaleId(null); setSelectedPartId(null); setSelectedTechnicianId(null); }}>{item.icon}<span className="flex-1">{item.label}</span>{item.id === 'notifications' && unreadCount > 0 && <span className="badge-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>)}
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
        <div className="topbar-search" style={{ position: 'relative' }}>
          <Search size={18} />
          <input ref={searchInputRef} value={query} onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onBlur={() => setTimeout(() => setSearchOpen(false), 150)} placeholder="Search customers, plates, jobs, invoices..." />
          <kbd>⌘K</kbd>
          {searchOpen && query.trim().length >= 2 && <div className="combobox-dropdown">
            {searchLoading ? <p className="combobox-empty">Searching…</p> : searchResultCount === 0 ? <p className="combobox-empty">No matches for &quot;{query}&quot;.</p> : searchGroups.map((g) => <div key={g.key}>
              <p className="search-group-label">{g.icon} {g.label}</p>
              {g.items.map((item) => <button type="button" key={item.id} className="combobox-option" onMouseDown={() => navigateToSearchResult(g.key, item.id)}>
                <strong>{highlightMatch(item.title, query)}</strong>{item.subtitle && <span style={{ color: '#8997a5' }}> {item.subtitle}</span>}
              </button>)}
            </div>)}
          </div>}
        </div>
        <div className="topbar-actions">
          <div className={`connection ${online ? '' : 'offline'}`}><span className={online ? 'online-dot' : 'offline-dot'} /> {online ? 'Online' : 'Offline'}</div>
          <button className="icon-button" onClick={() => setSection('notifications')}><Bell size={19} />{unreadCount > 0 && <span className="badge-count icon-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>
          <div className="top-avatar">{(userPerms.fullName || 'A').slice(0, 1).toUpperCase()}</div>
          <button className="mobile-menu" onClick={() => setShowMobileNav(!showMobileNav)}><Menu size={20} /></button>
        </div>
      </header>
      <div className="page-wrap" key={refreshKey}>
        {notice && <div className="notice"><CheckCircle2 size={17} /> {notice}<button onClick={() => setNotice('')}><X size={15} /></button></div>}
        <SectionRouter
          section={section}
          setSection={setSection}
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
          selectedSaleId={selectedSaleId}
          setSelectedSaleId={setSelectedSaleId}
          selectedPartId={selectedPartId}
          setSelectedPartId={setSelectedPartId}
          selectedTechnicianId={selectedTechnicianId}
          setSelectedTechnicianId={setSelectedTechnicianId}
          showCustomerForm={showCustomerForm}
          setShowCustomerForm={setShowCustomerForm}
          showVehicleForm={showVehicleForm}
          setShowVehicleForm={setShowVehicleForm}
          showJobForm={showJobForm}
          setShowJobForm={setShowJobForm}
          showServiceForm={showServiceForm}
          setShowServiceForm={setShowServiceForm}
          showTechnicianForm={showTechnicianForm}
          setShowTechnicianForm={setShowTechnicianForm}
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
          showSaleForm={showSaleForm}
          setShowSaleForm={setShowSaleForm}
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
    {showTechnicianForm && <TechnicianForm onClose={() => setShowTechnicianForm(false)} onSaved={(m) => { setShowTechnicianForm(false); setNotice(m); refresh(); }} />}
    {showPartForm && <PartForm onClose={() => setShowPartForm(false)} onSaved={(m) => { setShowPartForm(false); setNotice(m); refresh(); }} />}
    {showSupplierForm && <SupplierForm onClose={() => setShowSupplierForm(false)} onSaved={(m) => { setShowSupplierForm(false); setNotice(m); refresh(); }} />}
    {showPOForm && <POForm onClose={() => setShowPOForm(false)} onSaved={(m) => { setShowPOForm(false); setNotice(m); refresh(); }} />}
    {showQuotationForm && <QuotationForm onClose={() => setShowQuotationForm(false)} onSaved={(m) => { setShowQuotationForm(false); setNotice(m); refresh(); }} />}
    {showInvoiceForm && <InvoiceForm onClose={() => setShowInvoiceForm(false)} onSaved={(m) => { setShowInvoiceForm(false); setNotice(m); refresh(); }} />}
    {showPaymentForm && <PaymentForm onClose={() => setShowPaymentForm(false)} onSaved={(m) => { setShowPaymentForm(false); setNotice(m); refresh(); }} />}
    {showSaleForm && <SaleForm onClose={() => setShowSaleForm(false)} onSaved={(m) => { setShowSaleForm(false); setNotice(m); refresh(); }} can={can} />}
    {showStockReceiveForm && <StockReceiveForm onClose={() => setShowStockReceiveForm(false)} onSaved={(m) => { setShowStockReceiveForm(false); setNotice(m); refresh(); }} />}
    {showStockAdjustForm && <StockAdjustForm onClose={() => setShowStockAdjustForm(false)} onSaved={(m) => { setShowStockAdjustForm(false); setNotice(m); refresh(); }}
      onGoToReceive={() => { setShowStockAdjustForm(false); setShowStockReceiveForm(true); }}
      onGoToSales={() => { setShowStockAdjustForm(false); setSection('sales'); setShowSaleForm(true); }}
      onGoToWorkOrders={() => { setShowStockAdjustForm(false); setSection('jobcards'); }}
    />}
  </main>;
}

type SectionProps = {
  section: SectionId; setSection: (s: SectionId) => void; query: string; can: (p: string) => boolean; userPerms: UserPermission;
  onNotice: (m: string) => void; onRefresh: () => void;
  selectedJobId: string | null; setSelectedJobId: (id: string | null) => void;
  selectedVehicleId: string | null; setSelectedVehicleId: (id: string | null) => void;
  selectedCustomerId: string | null; setSelectedCustomerId: (id: string | null) => void;
  selectedInvoiceId: string | null; setSelectedInvoiceId: (id: string | null) => void;
  selectedQuotationId: string | null; setSelectedQuotationId: (id: string | null) => void;
  selectedPOId: string | null; setSelectedPOId: (id: string | null) => void;
  selectedSupplierId: string | null; setSelectedSupplierId: (id: string | null) => void;
  selectedSaleId: string | null; setSelectedSaleId: (id: string | null) => void;
  selectedPartId: string | null; setSelectedPartId: (id: string | null) => void;
  selectedTechnicianId: string | null; setSelectedTechnicianId: (id: string | null) => void;
  showCustomerForm: boolean; setShowCustomerForm: (v: boolean) => void;
  showVehicleForm: boolean; setShowVehicleForm: (v: boolean) => void;
  showJobForm: boolean; setShowJobForm: (v: boolean) => void;
  showServiceForm: boolean; setShowServiceForm: (v: boolean) => void;
  showTechnicianForm: boolean; setShowTechnicianForm: (v: boolean) => void;
  showPartForm: boolean; setShowPartForm: (v: boolean) => void;
  showSupplierForm: boolean; setShowSupplierForm: (v: boolean) => void;
  showPOForm: boolean; setShowPOForm: (v: boolean) => void;
  showQuotationForm: boolean; setShowQuotationForm: (v: boolean) => void;
  showInvoiceForm: boolean; setShowInvoiceForm: (v: boolean) => void;
  showPaymentForm: boolean; setShowPaymentForm: (v: boolean) => void;
  showSaleForm: boolean; setShowSaleForm: (v: boolean) => void;
  showStockReceiveForm: boolean; setShowStockReceiveForm: (v: boolean) => void;
  showStockAdjustForm: boolean; setShowStockAdjustForm: (v: boolean) => void;
};

function SectionRouter(props: SectionProps) {
  const p = props;
  switch (p.section) {
    case 'dashboard': return <DashboardSection onNewJob={() => p.setShowJobForm(true)} onNewCustomer={() => p.setShowCustomerForm(true)} onNewSale={() => p.setShowSaleForm(true)} onReceiveStock={() => p.setShowStockReceiveForm(true)} onNavigate={p.setSection} onSelectJob={(id) => { p.setSelectedJobId(id); p.setSection('jobcards'); }} onSelectInvoice={(id) => { p.setSelectedInvoiceId(id); p.setSection('invoices'); }} can={p.can} userPerms={p.userPerms} />;
    case 'customers': return p.selectedCustomerId ? <CustomerDetail id={p.selectedCustomerId} onBack={() => p.setSelectedCustomerId(null)} onNewVehicle={() => p.setShowVehicleForm(true)} onNewJob={() => p.setShowJobForm(true)} can={p.can} /> : <CustomersSection query={p.query} onNew={() => p.setShowCustomerForm(true)} onSelect={(id) => p.setSelectedCustomerId(id)} can={p.can} />;
    case 'vehicles': return p.selectedVehicleId ? <VehicleDetail id={p.selectedVehicleId} onBack={() => p.setSelectedVehicleId(null)} onNewJob={() => p.setShowJobForm(true)} can={p.can} /> : <VehiclesSection query={p.query} onSelect={(id) => p.setSelectedVehicleId(id)} />;
    case 'jobcards': return p.selectedJobId ? <JobDetail id={p.selectedJobId} onBack={() => p.setSelectedJobId(null)} can={p.can} onNotice={p.onNotice} /> : <JobsSection query={p.query} onNew={() => p.setShowJobForm(true)} onSelect={(id) => p.setSelectedJobId(id)} onNotice={p.onNotice} can={p.can} />;
    case 'services': return <ServicesSection onNew={() => p.setShowServiceForm(true)} can={p.can} />;
    case 'technicians': return p.selectedTechnicianId ? <TechnicianDetail id={p.selectedTechnicianId} onBack={() => p.setSelectedTechnicianId(null)} /> : <TechniciansSection onNew={() => p.setShowTechnicianForm(true)} onSelect={(id) => p.setSelectedTechnicianId(id)} can={p.can} />;
    case 'sales': return p.selectedSaleId ? <SaleDetail id={p.selectedSaleId} onBack={() => p.setSelectedSaleId(null)} can={p.can} onNotice={p.onNotice} /> : <SalesSection query={p.query} onNew={() => p.setShowSaleForm(true)} onSelect={(id) => p.setSelectedSaleId(id)} can={p.can} />;
    case 'parts': return p.selectedPartId ? <PartDetail id={p.selectedPartId} onBack={() => p.setSelectedPartId(null)} can={p.can} onNotice={p.onNotice}
      onNavigateToSale={(saleId) => { p.setSelectedSaleId(saleId); p.setSection('sales'); }}
      onNavigateToJob={(jobId) => { p.setSelectedJobId(jobId); p.setSection('jobcards'); }}
      onNavigateToPO={(poId) => { p.setSelectedPOId(poId); p.setSection('procurement'); }}
    /> : <PartsSection onNew={() => p.setShowPartForm(true)} onReceive={() => p.setShowStockReceiveForm(true)} onAdjust={() => p.setShowStockAdjustForm(true)} onSelect={(id) => p.setSelectedPartId(id)} can={p.can} />;
    case 'stockmovements': return <StockMovementsSection
      onSelectPart={(id) => { p.setSelectedPartId(id); p.setSection('parts'); }}
      onNavigateToSale={(id) => { p.setSelectedSaleId(id); p.setSection('sales'); }}
      onNavigateToJob={(id) => { p.setSelectedJobId(id); p.setSection('jobcards'); }}
      onNavigateToPO={(id) => { p.setSelectedPOId(id); p.setSection('procurement'); }}
    />;
    case 'lowstock': return <LowStockSection onSelect={(id) => { p.setSelectedPartId(id); p.setSection('parts'); }} onNotice={p.onNotice} can={p.can} onNavigateToPO={(id) => { p.setSelectedPOId(id); p.setSection('procurement'); }} />;
    case 'suppliers': return p.selectedSupplierId ? <SupplierDetail id={p.selectedSupplierId} onBack={() => p.setSelectedSupplierId(null)} onNewPO={() => p.setShowPOForm(true)} can={p.can} /> : <SuppliersSection query={p.query} onNew={() => p.setShowSupplierForm(true)} onSelect={(id) => p.setSelectedSupplierId(id)} can={p.can} />;
    case 'procurement': return p.selectedPOId ? <PODetail id={p.selectedPOId} onBack={() => p.setSelectedPOId(null)} can={p.can} onNotice={p.onNotice} /> : <ProcurementSection onNew={() => p.setShowPOForm(true)} onSelect={(id) => p.setSelectedPOId(id)} can={p.can} />;
    case 'quotations': return p.selectedQuotationId ? <QuotationDetail id={p.selectedQuotationId} onBack={() => p.setSelectedQuotationId(null)} can={p.can} onNotice={p.onNotice} /> : <QuotationsSection onNew={() => p.setShowQuotationForm(true)} onSelect={(id) => p.setSelectedQuotationId(id)} can={p.can} />;
    case 'invoices': return p.selectedInvoiceId ? <InvoiceDetail id={p.selectedInvoiceId} onBack={() => p.setSelectedInvoiceId(null)} onPayment={() => p.setShowPaymentForm(true)} can={p.can} /> : <InvoicesSection query={p.query} onNew={() => p.setShowInvoiceForm(true)} onSelect={(id) => p.setSelectedInvoiceId(id)} can={p.can} />;
    case 'scrapdashboard': return <ScrapDashboardPage can={p.can} onNotice={p.onNotice} onNavigateToStock={() => p.setSection('scrapstock')} />;
    case 'scraprecords': return <ScrapRecordsPage can={p.can} onNotice={p.onNotice} />;
    case 'scrapstock': return <ScrapStockPage can={p.can} onNotice={p.onNotice} />;
    case 'scrapreconciliation': return <ScrapReconciliationPage can={p.can} onNotice={p.onNotice} />;
    case 'scrapfinances': return <ScrapFinancesPage />;
    case 'scrapreports': return <ScrapReportsPage can={p.can} />;
    case 'scraptypes': return <ScrapTypesPage can={p.can} onNotice={p.onNotice} />;
    case 'debtsoverview': return <DebtsOverviewPage onNavigateToRegister={() => p.setSection('debtregister')} onNavigateToReports={() => p.setSection('debtreports')} />;
    case 'debtregister': return <DebtRegisterPage can={p.can} onNotice={p.onNotice} />;
    case 'debtreports': return <DebtReportsPage />;
    case 'vehicleregister': return <VehicleRegisterSection can={p.can} onNotice={p.onNotice} />;
    case 'payments': return <PaymentsSection onNotice={p.onNotice} />;
    case 'receipts': return <ReceiptsSection onNotice={p.onNotice} can={p.can} />;
    case 'reports': return <ReportsSection />;
    case 'notifications': return <NotificationsSection onRefresh={p.onRefresh} can={p.can} onSelectInvoice={(id) => { p.setSelectedInvoiceId(id); p.setSection('invoices'); }} />;
    case 'audit': return <AuditSection />;
    case 'settings': return <SettingsSection onNotice={p.onNotice} />;
    case 'users': return <UsersSection onNotice={p.onNotice} />;
    default: return null;
  }
}

// === AUTH ===
function AuthScreen({ error, setError }: { error: string; setError: (v: string) => void }) {
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

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

  async function submitForgot(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');

    const normalizedEmail = email.trim().toLowerCase();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: window.location.origin,
    });
    setBusy(false);

    if (resetError) {
      setError('We could not send a reset link. Please try again in a moment.');
      return;
    }
    setResetSent(true);
  }

  function backToSignIn() {
    setMode('signin');
    setError('');
    setResetSent(false);
  }

  if (mode === 'forgot') {
    return <div className="auth-layout"><div className="auth-panel"><div className="auth-card">
      <img src="/logo.png" alt="Oakland Motor Care Ltd" className="auth-logo" />
      <h2>Reset your password</h2>
      <p className="muted">Enter your work email and we&apos;ll send you a link to set a new password.</p>
      {resetSent
        ? <>
            <div className="form-success">If an account exists for that email, a reset link is on its way.</div>
            <button className="switch-auth" type="button" onClick={backToSignIn}>Back to sign in</button>
          </>
        : <form onSubmit={submitForgot}>
            <label>Work email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@oaklandmotorcare.co.ke" required /></label>
            {error && <div className="form-error">{error}</div>}
            <button className="button primary wide" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'} <ArrowUpRight size={17} /></button>
            <button className="switch-auth" type="button" onClick={backToSignIn}>Back to sign in</button>
          </form>}
    </div></div></div>;
  }

  return <div className="auth-layout"><div className="auth-panel"><div className="auth-card"><img src="/logo.png" alt="Oakland Motor Care Ltd" className="auth-logo" /><h2>Welcome back</h2><p className="muted">Sign in to continue.</p><form onSubmit={submit}><label>Work email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@oaklandmotorcare.co.ke" required /></label><label>Password<PasswordInput value={password} onChange={setPassword} placeholder="Enter your password" minLength={6} required autoComplete="current-password" /></label>{error && <div className="form-error">{error}</div>}<button className="button primary wide" disabled={busy}>{busy ? 'Please wait...' : 'Sign in'} <ArrowUpRight size={17} /></button><button className="switch-auth" type="button" onClick={() => { setMode('forgot'); setError(''); }}>Forgot password?</button></form><PoweredByFooter /></div></div></div>;
}

function ResetPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (updateError) {
      setError('We could not update your password. Please request a new reset link and try again.');
      return;
    }
    onDone();
  }

  return <div className="auth-layout"><div className="auth-panel"><div className="auth-card">
    <img src="/logo.png" alt="Oakland Motor Care Ltd" className="auth-logo" />
    <h2>Set a new password</h2>
    <p className="muted">Choose a new password for your account.</p>
    <form onSubmit={submit}>
      <label>New password<PasswordInput value={password} onChange={setPassword} placeholder="At least 6 characters" minLength={6} required autoComplete="new-password" /></label>
      <label>Confirm password<PasswordInput value={confirmPassword} onChange={setConfirmPassword} placeholder="Re-enter your new password" minLength={6} required autoComplete="new-password" /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="button primary wide" disabled={busy}>{busy ? 'Updating...' : 'Update password'} <ArrowUpRight size={17} /></button>
    </form>
  </div></div></div>;
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
function greetingForHour(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function roleDisplayName(userPerms: UserPermission) {
  if (!userPerms.role) return 'there';
  return userPerms.role.charAt(0) + userPerms.role.slice(1).toLowerCase();
}

function DashboardSection({ onNewJob, onNewCustomer, onNewSale, onReceiveStock, onNavigate, onSelectJob, onSelectInvoice, can, userPerms }: { onNewJob: () => void; onNewCustomer: () => void; onNewSale: () => void; onReceiveStock: () => void; onNavigate: (section: SectionId) => void; onSelectJob: (id: string) => void; onSelectInvoice: (id: string) => void; can: (p: string) => boolean; userPerms: UserPermission }) {
  const [stats, setStats] = useState({ activeJobs: 0, completedToday: 0, vehiclesPerWeek: 0, customers: 0, vehicles: 0, lowStock: 0, outOfStock: 0, outstandingInvoices: 0, overdueCount: 0, pendingQuotes: 0, todaySales: 0, weekSales: 0, monthSales: 0 });
  const [worstOverdue, setWorstOverdue] = useState<{ id: string; customer: string; balance: number } | null>(null);
  const [recentJobs, setRecentJobs] = useState<(JobCard & { vehicles: { registration_number: string } | null, customers: { full_name: string } | null })[]>([]);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [topItems, setTopItems] = useState<{ name: string; category: string | null; qty: number }[]>([]);
  const [revenueData, setRevenueData] = useState<{ day: string; amount: number }[]>([]);
  const [jobStatusData, setJobStatusData] = useState<{ status: string; count: number }[]>([]);

  useEffect(() => {
    (async () => {
      const today = localDateStr();
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const [jobs, customers, vehicles, parts, invoices, quotations, weekVehicleRows, overdueInvoices] = await Promise.all([
        supabase.from('job_cards').select('id,status,created_at,job_number,customer_id,vehicle_id,complaint').is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
        supabase.from('customers').select('id', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('vehicles').select('id', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('parts').select('id,quantity_on_hand,reorder_level').eq('active', true),
        supabase.from('invoices').select('id,total_minor,amount_paid_minor,status,created_at').in('status', ['ISSUED','PART_PAID','OVERDUE']),
        supabase.from('quotations').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_APPROVAL'),
        supabase.from('job_cards').select('vehicle_id').gte('created_at', weekAgo.toISOString()).is('deleted_at', null),
        supabase.from('invoices').select('id,total_minor,amount_paid_minor,customers(full_name)').eq('status', 'OVERDUE').order('created_at', { ascending: false }).limit(100),
      ]);
      const jobData = (jobs.data ?? []) as (JobCard & { vehicles: { registration_number: string } | null, customers: { full_name: string } | null })[];
      setRecentJobs(jobData.slice(0, 6));
      const active = jobData.filter((j) => !['COMPLETED','CANCELLED'].includes(j.status));
      const completedToday = jobData.filter((j) => j.status === 'COMPLETED' && localDateStr(new Date(j.created_at)) === today);
      const lowStock = (parts.data ?? []).filter((p) => p.quantity_on_hand <= p.reorder_level);
      const outOfStock = (parts.data ?? []).filter((p) => p.quantity_on_hand === 0);
      const outstanding = (invoices.data ?? []).reduce((s, inv) => s + (inv.total_minor - inv.amount_paid_minor), 0);
      const vehiclesPerWeek = new Set(((weekVehicleRows.data ?? []) as { vehicle_id: string }[]).map((r) => r.vehicle_id)).size;
      const overdueRows = ((overdueInvoices.data ?? []) as unknown as { id: string; total_minor: number; amount_paid_minor: number; customers: { full_name: string } | null }[])
        .map((inv) => ({ id: inv.id, customer: inv.customers?.full_name ?? 'Customer', balance: inv.total_minor - inv.amount_paid_minor }))
        .sort((a, b) => b.balance - a.balance);
      setWorstOverdue(overdueRows[0] ?? null);
      const [todaySales, weekSales, monthSales, recentSaleRows, saleItemRows] = await Promise.all([
        supabase.from('sales').select('total_minor').gte('sale_date', localDayStart()).neq('status', 'VOIDED'),
        supabase.from('sales').select('total_minor').gte('sale_date', weekAgo.toISOString()).neq('status', 'VOIDED'),
        supabase.from('sales').select('total_minor').gte('sale_date', monthStart.toISOString()).neq('status', 'VOIDED'),
        supabase.from('sales').select('*').order('sale_date', { ascending: false }).limit(5),
        supabase.from('sale_items').select('part_name,category,quantity,sales!inner(status,sale_date)').gte('sales.sale_date', monthStart.toISOString()).neq('sales.status', 'VOIDED').limit(200),
      ]);
      const itemTotals = new Map<string, { name: string; category: string | null; qty: number }>();
      for (const item of (saleItemRows.data ?? []) as { part_name: string; category: string | null; quantity: number }[]) {
        const entry = itemTotals.get(item.part_name) ?? { name: item.part_name, category: item.category, qty: 0 };
        entry.qty += item.quantity; itemTotals.set(item.part_name, entry);
      }
      setRecentSales((recentSaleRows.data ?? []) as Sale[]);
      setTopItems(Array.from(itemTotals.values()).sort((a, b) => b.qty - a.qty).slice(0, 5));
      setStats({
        activeJobs: active.length, completedToday: completedToday.length, vehiclesPerWeek,
        customers: customers.count ?? 0, vehicles: vehicles.count ?? 0, lowStock: lowStock.length,
        outOfStock: outOfStock.length, outstandingInvoices: outstanding, overdueCount: overdueRows.length,
        pendingQuotes: quotations.count ?? 0,
        todaySales: ((todaySales.data ?? []) as Sale[]).reduce((s, sale) => s + sale.total_minor, 0),
        weekSales: ((weekSales.data ?? []) as Sale[]).reduce((s, sale) => s + sale.total_minor, 0),
        monthSales: ((monthSales.data ?? []) as Sale[]).reduce((s, sale) => s + sale.total_minor, 0),
      });
      const statusCounts: Record<string, number> = {};
      jobData.forEach((j) => { statusCounts[j.status] = (statusCounts[j.status] ?? 0) + 1; });
      setJobStatusData(Object.entries(statusCounts).map(([status, count]) => ({ status, count })));
      const days: { day: string; amount: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const { data } = await supabase.from('sales').select('total_minor').gte('sale_date', localDayStart(d)).lt('sale_date', localDayEnd(d)).neq('status', 'VOIDED');
        days.push({ day: d.toLocaleDateString('en', { weekday: 'short' }), amount: ((data ?? []) as Sale[]).reduce((s, sale) => s + sale.total_minor, 0) });
      }
      setRevenueData(days);
    })();
  }, []);

  const fabItems: { label: string; icon: React.ReactNode; onClick: () => void }[] = [];
  if (can('job.create')) fabItems.push({ label: 'New work order', icon: <Wrench size={16} />, onClick: onNewJob });
  if (can('sales.create')) fabItems.push({ label: 'New sale', icon: <Store size={16} />, onClick: onNewSale });
  if (can('inventory.receive')) fabItems.push({ label: 'Receive stock', icon: <Boxes size={16} />, onClick: onReceiveStock });

  return <>
    <div className="page-heading"><div><p className="eyebrow">{new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>{greetingForHour(new Date().getHours())}, {roleDisplayName(userPerms)}.</h1><p className="muted">Here&apos;s what&apos;s happening across the workshop today.</p></div><div className="heading-actions">{can('customer.create') && <button className="button secondary" onClick={onNewCustomer}><Plus size={16} /> Add customer</button>}{can('job.create') && <button className="button primary" onClick={onNewJob}><Plus size={17} /> New work order</button>}</div></div>
    <div className="metric-grid">
      <Metric label="Active jobs" value={String(stats.activeJobs).padStart(2, '0')} trend="Across the workshop" icon={<Wrench />} tone="navy" onClick={() => onNavigate('jobcards')} />
      <Metric label="Vehicles per week" value={String(stats.vehiclesPerWeek).padStart(2, '0')} trend="Distinct vehicles, last 7 days" icon={<CarFront />} tone="green" onClick={() => onNavigate('vehicles')} />
      <Metric label="Sales for the month" value={formatKes(stats.monthSales)} trend="Since the 1st" icon={<Store />} tone="gold" onClick={() => onNavigate('sales')} />
      <Metric label="Outstanding" value={formatKes(stats.outstandingInvoices)} trend="Unpaid invoices" icon={<CircleDollarSign />} tone="blue" onClick={() => onNavigate('invoices')} />
    </div>
    <div className="dashboard-grid">
      <section className="panel jobs-panel">
        <div className="panel-heading"><div><p className="eyebrow">Workshop pulse</p><h3>Recent work orders</h3></div>{can('job.create') && <button className="text-button" onClick={onNewJob}>New work order <Plus size={15} /></button>}</div>
        {recentJobs.length === 0 ? <Empty title="No active work orders" text="The workshop is currently clear." /> : <div className="job-list">{recentJobs.map((job) => <div className="job-row" key={job.id} onClick={() => onSelectJob(job.id)}><div className="job-icon"><Wrench size={17} /></div><div className="job-main"><strong>{job.job_number}</strong><span>{job.vehicles?.registration_number ?? 'Vehicle'} · {job.customers?.full_name ?? 'Customer'}</span></div><div className="job-complaint">{job.complaint}</div><span className={`status ${statusStyles[job.status] ?? 'bg-slate-100 text-slate-600'}`}>{job.status.replaceAll('_', ' ')}</span><ArrowUpRight className="row-arrow" size={17} /></div>)}</div>}
      </section>
      <section className="panel attention-panel">
        <div className="panel-heading"><div><p className="eyebrow">Needs attention</p><h3>Today&apos;s focus</h3></div><Sparkles size={18} className="gold-icon" /></div>
        <div className="attention-item clickable" onClick={() => onNavigate('lowstock')}><div className={`attention-number ${stats.lowStock > 0 ? 'amber' : ''}`}>{stats.lowStock}</div><div><strong>Low-stock parts</strong><span>{stats.lowStock > 0 ? 'Reorder needed' : 'Inventory levels are healthy'}</span></div><ArrowUpRight size={16} /></div>
        <div className="attention-item clickable" onClick={() => worstOverdue ? onSelectInvoice(worstOverdue.id) : onNavigate('invoices')}><div className={`attention-number ${stats.overdueCount > 0 ? 'red' : ''}`}>{stats.overdueCount}</div><div><strong>Overdue bad debts</strong><span>{worstOverdue ? `Most critical: ${worstOverdue.customer} · ${formatKes(worstOverdue.balance)}` : 'No overdue balances'}</span></div><ArrowUpRight size={16} /></div>
        <div className="attention-item clickable" onClick={() => onNavigate('quotations')}><div className="attention-number">{stats.pendingQuotes}</div><div><strong>Pending quotations</strong><span>Awaiting customer approval</span></div><ArrowUpRight size={16} /></div>
      </section>
    </div>
    <div className="dashboard-grid" style={{ marginTop: 28 }}>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Revenue</p><h3>Last 7 days</h3></div></div>
        <div className="bars">{revenueData.map((d, i) => <div key={i} className="bar" style={{ height: `${Math.min(100, (d.amount / Math.max(...revenueData.map((r) => r.amount), 1)) * 100)}%` }} />)}</div>
        <div className="chart-days">{revenueData.map((d, i) => <span key={i}>{d.day}</span>)}</div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Distribution</p><h3>Jobs by status</h3></div></div>
        {jobStatusData.length === 0 ? <Empty title="No job data" text="Jobs will appear here." /> : <div className="status-list">{jobStatusData.map((s) => <div key={s.status} className="status-row clickable" onClick={() => onNavigate('jobcards')}><span className={`status ${statusStyles[s.status] ?? ''}`}>{s.status.replaceAll('_', ' ')}</span><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><strong>{s.count}</strong><ChevronRight size={15} className="row-arrow" /></div></div>)}</div>}
      </section>
    </div>
    <DashboardFab items={fabItems} />
  </>;
}

function DashboardFab({ items }: { items: { label: string; icon: React.ReactNode; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return <div className="fab-container">
    {open && <div className="fab-menu">{items.map((item) => <button key={item.label} className="fab-menu-item" onClick={() => { setOpen(false); item.onClick(); }}><span className="fab-menu-icon">{item.icon}</span>{item.label}</button>)}</div>}
    <button className={`fab-button${open ? ' open' : ''}`} onClick={() => setOpen((v) => !v)} aria-label="Quick actions" aria-expanded={open}><Plus size={24} /></button>
  </div>;
}

function Metric({ label, value, trend, icon, tone, onClick }: { label: string; value: string; trend: string; icon: React.ReactNode; tone: string; onClick: () => void }) {
  return <button type="button" className="metric-card" style={{ textAlign: 'left' }} onClick={onClick}><div className={`metric-icon ${tone}`}>{icon}</div><div className="metric-copy"><span>{label}</span><strong>{value}</strong><small>{trend}</small></div><ArrowUpRight size={17} className="metric-arrow" /></button>;
}

// === CUSTOMERS ===
function CustomersSection({ query, onNew, onSelect, can }: { query: string; onNew: () => void; onSelect: (id: string) => void; can: (p: string) => boolean }) {
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
  return <SectionPanel eyebrow="Directory" title="Customers" onNew={can('customer.create') ? onNew : undefined} newLabel="Add customer">
    {loading ? <Loading /> : customers.length === 0 ? <Empty title="No customers found" text="Register your first customer to get started." /> : <div className="report-table-wrap"><table className="report-table"><thead><tr>
      <th>Name</th><th>Phone</th><th>Email</th><th>Type</th><th>Status</th><th />
    </tr></thead><tbody>{customers.map((c) => <tr key={c.id} className="clickable" onClick={() => onSelect(c.id)}>
      <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div className="avatar small-avatar">{c.full_name.slice(0, 1)}</div><strong>{c.full_name}</strong></div>{c.company_name && <span className="table-subtext">{c.company_name}</span>}</td>
      <td>{c.phone}</td>
      <td>{c.email ?? '—'}</td>
      <td>{c.customer_type.replaceAll('_', ' ')}</td>
      <td><span className={`status ${statusStyles[c.status] ?? ''}`}>{c.status}</span></td>
      <td><ChevronRight size={17} className="row-arrow" /></td>
    </tr>)}</tbody></table></div>}
  </SectionPanel>;
}

function CustomerDetail({ id, onBack, onNewVehicle, onNewJob, can }: { id: string; onBack: () => void; onNewVehicle: () => void; onNewJob: () => void; can: (p: string) => boolean }) {
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
      <div className="detail-actions">{can('vehicle.create') && <button className="button secondary" onClick={onNewVehicle}><Plus size={16} /> Add vehicle</button>}{can('job.create') && <button className="button primary" onClick={onNewJob}><Plus size={16} /> New work order</button>}</div>
    </div>
    <div className="detail-info-grid">
      <div className="info-card"><Phone size={16} /> <div><span>Phone</span><strong>{customer.phone}</strong></div></div>
      {customer.email && <div className="info-card"><Mail size={16} /> <div><span>Email</span><strong>{customer.email}</strong></div></div>}
      {customer.address && <div className="info-card"><MapPin size={16} /> <div><span>Address</span><strong>{customer.address}</strong></div></div>}
      <div className="info-card"><CircleDollarSign size={16} /> <div><span>Outstanding balance</span><strong>{formatKes(balance)}</strong></div></div>
    </div>
    <div className="dashboard-grid" style={{ marginTop: 20 }}>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Fleet</p><h3>Vehicles ({vehicles.length})</h3></div></div>{vehicles.length === 0 ? <Empty title="No vehicles" text="Add a vehicle for this customer." /> : <div className="data-table">{vehicles.map((v) => <div className="table-row" key={v.id}><div className="job-icon"><CarFront size={17} /></div><div><strong>{v.registration_number}</strong><span>{v.make} {v.model}</span></div><span className="table-muted">{v.mileage.toLocaleString()} KM</span></div>)}</div>}</section>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">History</p><h3>Recent jobs ({jobs.length})</h3></div></div>{jobs.length === 0 ? <Empty title="No jobs" text="No work orders for this customer." /> : <div className="data-table">{jobs.slice(0, 5).map((j) => <div className="table-row" key={j.id}><div className="job-icon"><Wrench size={17} /></div><div><strong>{j.job_number}</strong><span>{j.complaint}</span></div><span className={`status ${statusStyles[j.status] ?? ''}`}>{j.status.replaceAll('_', ' ')}</span></div>)}</div>}</section>
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
    {loading ? <Loading /> : vehicles.length === 0 ? <Empty title="No vehicles recorded" text="Vehicles will appear here after you register a customer." /> : <div className="report-table-wrap"><table className="report-table"><thead><tr>
      <th>Reg. No.</th><th>Make / Model</th><th className="numeric">Year</th><th>Owner</th><th className="numeric">Mileage</th><th />
    </tr></thead><tbody>{vehicles.map((v) => <tr key={v.id} className="clickable" onClick={() => onSelect(v.id)}>
      <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div className="job-icon"><CarFront size={17} /></div><strong>{v.registration_number}</strong></div></td>
      <td>{[v.make, v.model].filter(Boolean).join(' ') || '—'}</td>
      <td className="numeric">{v.year ?? '—'}</td>
      <td>{v.customers?.full_name ?? '—'}</td>
      <td className="numeric">{v.mileage.toLocaleString()} KM</td>
      <td><ChevronRight size={17} className="row-arrow" /></td>
    </tr>)}</tbody></table></div>}
  </SectionPanel>;
}

const TIMELINE_DOT_TONES: Record<string, string> = {
  COMPLETED: 'green', DELIVERED: 'green', IN_PROGRESS: 'blue', AWAITING_APPROVAL: 'gold',
  AWAITING_PARTS: 'gold', CANCELLED: 'red', RECEIVED: 'navy', DIAGNOSING: 'navy',
};

function VehicleDetail({ id, onBack, onNewJob, can }: { id: string; onBack: () => void; onNewJob: () => void; can: (p: string) => boolean }) {
  const [vehicle, setVehicle] = useState<(Vehicle & { customers: Customer | null }) | null>(null);
  const [jobs, setJobs] = useState<(JobCard & { job_card_labour: JobCardLabour[]; job_card_parts: JobCardPart[]; job_card_diagnosis: JobCardDiagnosis[] })[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [taxRate, setTaxRate] = useState(16);
  useEffect(() => { void getTaxRate().then(setTaxRate); }, []);
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
      <div className="flex-1"><h2>{vehicle.registration_number}</h2><p className="muted">{[vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'} · {vehicle.year ?? '—'} · {vehicle.customers?.full_name ?? 'Customer'}</p></div>
      <div className="detail-actions">{can('job.create') && <button className="button primary" onClick={onNewJob}><Plus size={16} /> New work order</button>}</div>
    </div>
    <div className="detail-info-grid">
      <div className="info-card"><Gauge size={16} /> <div><span>Mileage</span><strong>{vehicle.mileage.toLocaleString()} KM</strong></div></div>
      {vehicle.vin && <div className="info-card"><FileText size={16} /> <div><span>VIN</span><strong>{vehicle.vin}</strong></div></div>}
      {vehicle.fuel_type && <div className="info-card"><Activity size={16} /> <div><span>Fuel</span><strong>{vehicle.fuel_type}</strong></div></div>}
      {vehicle.colour && <div className="info-card"><Boxes size={16} /> <div><span>Colour</span><strong>{vehicle.colour}</strong></div></div>}
    </div>
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Complete history</p><h3>Service timeline</h3></div></div>
      {jobs.length === 0 ? <Empty title="No service history" text="This vehicle has no work orders yet." /> : <div className="timeline">{jobs.map((job) => {
        const labourTotal = (job.job_card_labour ?? []).reduce((s, l) => s + computeLineTotal(l.quantity, l.unit_price_minor, l.tax_rate), 0);
        const partsTotal = (job.job_card_parts ?? []).reduce((s, p) => s + computeLineTotal(p.quantity, p.unit_price_minor, taxRate), 0);
        return <div className="timeline-item" key={job.id}>
          <div className={`timeline-dot ${TIMELINE_DOT_TONES[job.status] ?? ''}`} /><div className="timeline-content">
            <div className="timeline-header"><strong>{job.job_number}</strong><span className={`status ${statusStyles[job.status] ?? ''}`}>{job.status.replaceAll('_', ' ')}</span></div>
            <p className="muted">{formatDate(job.created_at)} · {job.mileage.toLocaleString()} KM</p>
            <p>{job.complaint}</p>
            {job.job_card_diagnosis?.[0] && <p className="timeline-diagnosis"><strong>Diagnosis:</strong> {job.job_card_diagnosis[0].findings}</p>}
            <div className="timeline-meta">
              <span><Wrench size={12} /> {job.job_card_labour?.length ?? 0} labour item{(job.job_card_labour?.length ?? 0) === 1 ? '' : 's'}</span>
              <span><Package size={12} /> {job.job_card_parts?.length ?? 0} part{(job.job_card_parts?.length ?? 0) === 1 ? '' : 's'}</span>
              <span><CircleDollarSign size={12} /> {formatKes(labourTotal + partsTotal)}</span>
            </div>
          </div>
        </div>;
      })}</div>}
    </section>
  </>;
}

// === JOB CARDS ===
const JOB_STATUS_BUCKETS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'DRAFT', label: 'Draft', statuses: ['DRAFT'] },
  { key: 'OPEN', label: 'Open', statuses: ['OPEN'] },
  { key: 'IN_PROGRESS', label: 'In progress', statuses: ['IN_PROGRESS'] },
  { key: 'DONE', label: 'Completed', statuses: ['COMPLETED'] },
  { key: 'CANCELLED', label: 'Cancelled', statuses: ['CANCELLED'] },
];

const PRIORITY_STYLES: Record<string, string> = {
  LOW: 'bg-slate-100 text-slate-600', NORMAL: 'bg-sky-50 text-sky-700', HIGH: 'bg-amber-50 text-amber-700', URGENT: 'bg-red-50 text-red-700',
};

type JobExportRow = JobCard & {
  vehicles: { registration_number: string; make: string | null; model: string | null } | null;
  customers: { full_name: string; phone: string } | null;
  job_card_labour: { quantity: number; unit_price_minor: number; tax_rate: number }[];
  job_card_parts: { quantity: number; unit_price_minor: number }[];
  job_card_signoffs: { role: string; name: string }[];
  invoices: { status: string; total_minor: number; amount_paid_minor: number }[];
};

function JobsSection({ query, onNew, onSelect, onNotice, can }: { query: string; onNew: () => void; onSelect: (id: string) => void; onNotice: (m: string) => void; can: (p: string) => boolean }) {
  const [jobs, setJobs] = useState<(JobCard & { vehicles: { registration_number: string } | null; customers: { full_name: string } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [bucketFilter, setBucketFilter] = useState<string | null>(null);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [exporting, setExporting] = useState(false);

  async function exportWorkOrdersCSV() {
    setExporting(true);
    const taxRate = await getTaxRate();
    const { data, error } = await supabase
      .from('job_cards')
      .select('job_number,created_at,status,job_types,other_charges_minor,vehicles(registration_number,make,model),customers(full_name,phone),job_card_labour(quantity,unit_price_minor,tax_rate),job_card_parts(quantity,unit_price_minor),job_card_signoffs(role,name),invoices(status,total_minor,amount_paid_minor)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    setExporting(false);
    if (error) { onNotice('Unable to export work orders. Please try again.'); return; }
    const rows = (data ?? []) as unknown as JobExportRow[];
    if (rows.length === 0) { onNotice('There are no work orders to export.'); return; }

    downloadCSV(`Oakland_Work_Orders_${new Date().toISOString().slice(0, 10)}.csv`, rows.map((j) => {
      const labourTotal = (j.job_card_labour ?? []).reduce((s, l) => s + computeLineTotal(l.quantity, l.unit_price_minor, l.tax_rate), 0);
      const partsTotal = (j.job_card_parts ?? []).reduce((s, p) => s + computeLineTotal(p.quantity, p.unit_price_minor, taxRate), 0);
      const total = labourTotal + partsTotal + (j.other_charges_minor ?? 0);
      const invoice = (j.invoices ?? []).find((inv) => inv.status !== 'VOID');
      const amountPaid = invoice?.amount_paid_minor ?? 0;
      return {
        'Job Number': j.job_number,
        'Date': formatDate(j.created_at),
        'Status': j.status,
        'Reg No': j.vehicles?.registration_number ?? '',
        'Make/Model': [j.vehicles?.make, j.vehicles?.model].filter(Boolean).join(' '),
        'Customer': j.customers?.full_name ?? '',
        'Phone': j.customers?.phone ?? '',
        'Job Type': (j.job_types ?? []).join('; '),
        'Technician': j.job_card_signoffs?.find((s) => s.role === 'TECHNICIAN')?.name ?? '',
        'Labour (KES)': (labourTotal / 100).toFixed(2),
        'Parts (KES)': (partsTotal / 100).toFixed(2),
        'Other (KES)': ((j.other_charges_minor ?? 0) / 100).toFixed(2),
        'Total (KES)': (total / 100).toFixed(2),
        'Amount Paid (KES)': (amountPaid / 100).toFixed(2),
        'Balance Due (KES)': (Math.max(0, total - amountPaid) / 100).toFixed(2),
      };
    }));
  }
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

  return <SectionPanel eyebrow="Workshop execution" title="Work Orders" onNew={can('job.create') ? onNew : undefined} newLabel="New work order">
    <div className="action-buttons" style={{ marginBottom: 16 }}>
      <button className="button secondary small" disabled={exporting} onClick={() => void exportWorkOrdersCSV()}><Download size={15} /> {exporting ? 'Exporting…' : 'Export CSV'}</button>
    </div>
    <div className="metric-grid" style={{ marginBottom: 20 }}>{JOB_STATUS_BUCKETS.map((b) => {
      const count = b.statuses.reduce((s, st) => s + (statusCounts[st] ?? 0), 0);
      return <button key={b.key} className="metric-card" style={{ textAlign: 'left', cursor: 'pointer', outline: bucketFilter === b.key ? '2px solid var(--gold)' : 'none' }} onClick={() => { setBucketFilter(bucketFilter === b.key ? null : b.key); setStatusFilter('ALL'); }}>
        <div className="metric-copy"><span>{b.label}</span><strong>{count}</strong></div>
      </button>;
    })}</div>
    <div className="filter-bar"><Filter size={15} /><select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setBucketFilter(null); }}><option value="ALL">All statuses</option>{Object.keys(JOB_TRANSITIONS).map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}</select>{bucketFilter && <button className="text-button" onClick={() => setBucketFilter(null)}>Clear filter</button>}</div>
    {loading ? <Loading /> : jobs.length === 0 ? <Empty title="No active work orders" text="Create a work order when a vehicle arrives." /> : <div className="report-table-wrap"><table className="report-table"><thead><tr>
      <th>Job Number</th><th>Date</th><th>Vehicle</th><th>Customer</th><th>Complaint</th><th>Priority</th><th>Status</th><th />
    </tr></thead><tbody>{jobs.map((j) => <tr key={j.id} className="clickable" onClick={() => onSelect(j.id)}>
      <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div className="job-icon"><Wrench size={17} /></div><strong>{j.job_number}</strong></div></td>
      <td>{formatDate(j.created_at)}</td>
      <td>{j.vehicles?.registration_number ?? '—'}</td>
      <td>{j.customers?.full_name ?? '—'}</td>
      <td>{j.complaint}</td>
      <td><span className={`status ${PRIORITY_STYLES[j.priority] ?? ''}`}>{j.priority}</span></td>
      <td><span className={`status ${statusStyles[j.status] ?? ''}`}>{j.status.replaceAll('_', ' ')}</span></td>
      <td><ChevronRight size={17} className="row-arrow" /></td>
    </tr>)}</tbody></table></div>}
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

const WORK_ORDER_STEPS = ['DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED'] as const;
const WORK_ORDER_STEP_LABELS: Record<string, string> = { DRAFT: 'Draft', OPEN: 'Open', IN_PROGRESS: 'In progress', COMPLETED: 'Completed' };
const WORK_ORDER_NEXT_STEP_CTA: Record<string, string> = { DRAFT: 'Open job card', OPEN: 'Start work', IN_PROGRESS: 'Mark as completed' };

function JobDetail({ id, onBack, can, onNotice }: { id: string; onBack: () => void; can: (p: string) => boolean; onNotice: (m: string) => void }) {
  const [job, setJob] = useState<JobDetailData | null>(null);
  const [labourDesc, setLabourDesc] = useState(''); const [labourPrice, setLabourPrice] = useState('0');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [jobTypeText, setJobTypeText] = useState('');
  const [jobDone, setJobDone] = useState('');
  const [remarks, setRemarks] = useState('');
  const [otherCharges, setOtherCharges] = useState('0');
  const [technicianName, setTechnicianName] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [taxRate, setTaxRate] = useState(16);
  useEffect(() => { void getTaxRate().then(setTaxRate); }, []);

  useEffect(() => {
    (async () => {
      const [j, emps] = await Promise.all([
        supabase.from('job_cards').select(JOB_DETAIL_SELECT).eq('id', id).maybeSingle(),
        supabase.from('employees').select('*').eq('active', true).eq('role', 'TECHNICIAN'),
      ]);
      const data = j.data as JobDetailData | null;
      setJob(data);
      setEmployees((emps.data ?? []) as Employee[]);
      if (data) {
        setJobTypeText(data.job_types.map((t) => JOB_TYPE_META.find((m) => m.key === t)?.label ?? t).join(', '));
        setJobDone(data.recommended_work ?? '');
        setRemarks(data.requested_service ?? '');
        setOtherCharges((data.other_charges_minor / 100).toString());
      }
    })();
  }, [id]);

  async function reload() {
    const { data } = await supabase.from('job_cards').select(JOB_DETAIL_SELECT).eq('id', id).maybeSingle();
    setJob(data as JobDetailData | null);
  }

  async function addLabour(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('job_card_labour').insert({ job_card_id: id, description: labourDesc, unit_price_minor: Math.round(parseFloat(labourPrice) * 100), tax_rate: taxRate });
    if (error) { onNotice('Unable to add labour. Please try again.'); return; }
    setLabourDesc(''); setLabourPrice('0'); onNotice('Labour added.'); reload();
  }

  async function removePart(partLineId: string) {
    const { error } = await supabase.rpc('remove_job_card_part', { p_id: partLineId });
    onNotice(error ? error.message : 'Part removed from the job card.');
    reload();
  }

  async function changeStatus(newStatus: string) {
    const { error } = await supabase.rpc('transition_job_status', { p_job_card_id: id, p_new_status: newStatus });
    onNotice(error ? (error.message.includes('Invalid') ? 'That status change is not allowed.' : error.message) : `Job moved to ${newStatus.replaceAll('_', ' ')}.`);
    reload();
  }

  async function openTab() {
    const { error } = await supabase.rpc('ensure_job_card_invoice', { p_job_card_id: id });
    onNotice(error ? 'Unable to open the invoice for this job.' : 'Invoice opened for this work order.');
    reload();
  }

  async function recordTechnician() {
    if (!technicianName) return;
    const { error } = await supabase.from('job_card_signoffs').insert({ job_card_id: id, role: 'TECHNICIAN', name: technicianName });
    onNotice(error ? 'Unable to record technician.' : 'Technician recorded.'); reload();
  }

  async function saveDetails() {
    setSavingDetails(true);
    const { error } = await supabase.from('job_cards').update({
      job_types: jobTypeText.trim() ? [jobTypeText.trim()] : [],
      recommended_work: jobDone || null,
      requested_service: remarks || null,
      other_charges_minor: Math.round((parseFloat(otherCharges) || 0) * 100),
    }).eq('id', id);
    setSavingDetails(false);
    onNotice(error ? error.message : 'Work order updated.');
    reload();
  }

  if (!job) return <Loading />;
  const transitions = JOB_TRANSITIONS[job.status] ?? [];
  const labourTotal = (job.job_card_labour ?? []).reduce((s, l) => s + computeLineTotal(l.quantity, l.unit_price_minor, l.tax_rate), 0);
  const partsTotal = (job.job_card_parts ?? []).reduce((s, p) => s + computeLineTotal(p.quantity, p.unit_price_minor, taxRate), 0);
  const otherChargesMinor = Math.round((parseFloat(otherCharges) || 0) * 100);
  const total = labourTotal + partsTotal + otherChargesMinor;
  const technicianSignoff = job.job_card_signoffs.find((s) => s.role === 'TECHNICIAN');
  const invoice = job.invoices?.find((inv) => inv.status !== 'VOID') ?? job.invoices?.[job.invoices.length - 1];
  const payments = invoice ? [...(invoice.payments ?? [])].sort((a, b) => b.paid_at.localeCompare(a.paid_at)) : [];
  const amountPaid = invoice?.amount_paid_minor ?? 0;
  const balance = Math.max(0, total - amountPaid);

  const nextStep = transitions.find((s) => s !== 'CANCELLED');
  const canAdvance = !!nextStep && can(nextStep === 'COMPLETED' ? 'job.complete' : 'job.update');
  const canCancel = transitions.includes('CANCELLED') && can('job.update');
  const currentStepIdx = WORK_ORDER_STEPS.indexOf(job.status as typeof WORK_ORDER_STEPS[number]);

  return <>
    <BackBar onBack={onBack} label="Work Orders" />
    <div className="detail-header">
      <div className="detail-avatar job"><Wrench size={24} /></div>
      <div className="flex-1"><h2>{job.job_number}</h2><p className="muted">{formatDate(job.created_at)}</p></div>
      {job.status === 'CANCELLED' && <span className={`status ${statusStyles[job.status] ?? ''}`}>Cancelled</span>}
      {job.status !== 'CANCELLED' && balance > 0 && <span className="status bg-red-50 text-red-700">Owes {formatKes(balance)}</span>}
    </div>

    {job.status === 'CANCELLED' ? (
      <div className="wod-cancelled-banner"><Ban size={18} /> This work order was cancelled.</div>
    ) : (
      <div className="wod-progress">
        {WORK_ORDER_STEPS.map((s, i) => {
          const state = i < currentStepIdx ? 'done' : i === currentStepIdx ? 'current' : 'upcoming';
          return (
            <div className="wod-step-wrap" key={s}>
              <div className={`wod-step ${state}`}>
                <span className="wod-step-dot">{state === 'done' ? <CheckCircle2 size={18} /> : <Circle size={18} />}</span>
                <span className="wod-step-label">{WORK_ORDER_STEP_LABELS[s]}</span>
              </div>
              {i < WORK_ORDER_STEPS.length - 1 && <span className={`wod-step-line ${i < currentStepIdx ? 'done' : ''}`} />}
            </div>
          );
        })}
      </div>
    )}

    {(canAdvance || canCancel) && <div className="wod-progress-actions">
      {canAdvance && nextStep && <button className="button primary" onClick={() => void changeStatus(nextStep)}>{WORK_ORDER_NEXT_STEP_CTA[job.status]}</button>}
      {canCancel && <button className="button secondary wod-cancel-btn" onClick={() => void changeStatus('CANCELLED')}><Ban size={15} /> Cancel job</button>}
    </div>}

    <div className="detail-info-grid" style={{ marginTop: 24 }}>
      <div className="info-card"><CarFront size={16} /><div><span>Reg. No.</span><strong>{job.vehicles?.registration_number ?? '—'}</strong></div></div>
      <div className="info-card"><Wrench size={16} /><div><span>Make / Model</span><strong>{job.vehicles ? ([job.vehicles.make, job.vehicles.model].filter(Boolean).join(' ') || '—') : '—'}</strong></div></div>
      <div className="info-card"><Users size={16} /><div><span>Customer</span><strong>{job.customers?.full_name ?? '—'}</strong></div></div>
      <div className="info-card"><Phone size={16} /><div><span>Phone</span><strong>{job.customers?.phone ?? '—'}</strong></div></div>
    </div>

    <section className="panel" style={{ marginTop: 28 }}>
      <div className="panel-heading"><div><p className="eyebrow">Job</p><h3>Job type &amp; work done</h3></div></div>
      <div className="modal-form">
        <label>Job type<textarea value={jobTypeText} onChange={(e) => setJobTypeText(e.target.value)} placeholder="e.g. Brake service, oil change" style={{ minHeight: 46 }} disabled={!can('job.update')} /></label>
        <label>Job done<textarea value={jobDone} onChange={(e) => setJobDone(e.target.value)} placeholder="Describe the work carried out..." style={{ minHeight: 60 }} disabled={!can('job.update')} /></label>
        <label>Remarks <span className="optional">Optional</span><textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any additional notes" style={{ minHeight: 46 }} disabled={!can('job.update')} /></label>
      </div>
    </section>

    <section className="panel" style={{ marginTop: 28 }}>
      <div className="panel-heading"><div><p className="eyebrow">Parts</p><h3>Parts used</h3></div></div>
      {(job.job_card_parts ?? []).length === 0 ? <Empty title="No parts issued" text="Search inventory below to add a part." /> : <div className="data-table">{job.job_card_parts.map((p) => <div className="table-row" key={p.id}>
        <div><strong>{p.parts?.name ?? 'Part'}</strong><span>{p.parts?.sku} · {p.quantity} × {formatKes(p.unit_price_minor)}</span></div>
        <span className={`status ${p.issued_at ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{p.issued_at ? 'Issued' : 'Pending'}</span>
        <span className="table-muted">{formatKes(computeLineTotal(p.quantity, p.unit_price_minor, taxRate))}</span>
        {!p.issued_at && can('inventory.issue') && <button className="close-button" style={{ width: 28, height: 28 }} title="Remove" onClick={() => void removePart(p.id)}><X size={14} /></button>}
      </div>)}</div>}
      <JobCardPartAdder jobCardId={id} can={can} onAdded={(m) => { onNotice(m); reload(); }} />
    </section>

    <div className="dashboard-grid" style={{ marginTop: 20 }}>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Team</p><h3>Technician</h3></div></div>
        {technicianSignoff ? <div className="info-card"><Users size={16} /><div><span>Assigned</span><strong>{technicianSignoff.name}</strong></div></div> : can('job.update') && (
          <div className="action-buttons modal-form" style={{ flexWrap: 'nowrap' }}>
            <select value={technicianName} onChange={(e) => setTechnicianName(e.target.value)} style={{ minWidth: 200 }}><option value="">Select technician...</option>{employees.map((e) => <option key={e.id} value={e.full_name}>{e.full_name}</option>)}</select>
            <button className="button secondary" disabled={!technicianName} onClick={() => void recordTechnician()}>Assign</button>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Labour</p><h3>Labour lines</h3></div></div>
        {(job.job_card_labour ?? []).length === 0 ? <Empty title="No labour added" text="Add labour for this job." /> : <div className="data-table">{job.job_card_labour.map((l) => <div className="table-row" key={l.id}><div><strong>{l.description}</strong><span>{l.quantity} × {formatKes(l.unit_price_minor)}</span></div><span className="table-muted">{formatKes(computeLineTotal(l.quantity, l.unit_price_minor, l.tax_rate))}</span></div>)}</div>}
        {can('job.update') && <form onSubmit={addLabour} className="inline-form"><input value={labourDesc} onChange={(e) => setLabourDesc(e.target.value)} placeholder="Labour description" required /><input type="number" value={labourPrice} onChange={(e) => setLabourPrice(e.target.value)} min="0" step="0.01" required /><button className="button primary" type="submit"><Plus size={15} /></button></form>}
      </section>
    </div>

    <section className="panel" style={{ marginTop: 28 }}>
      <div className="panel-heading"><div><p className="eyebrow">Summary</p><h3>Cost &amp; payment</h3></div></div>
      <div className="status-row"><strong>Labour</strong><span>{formatKes(labourTotal)}</span></div>
      <div className="status-row"><strong>Parts</strong><span>{formatKes(partsTotal)}</span></div>
      <div className="status-row"><strong>Other</strong>{can('job.update') ? <input type="number" min={0} step="0.01" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} style={{ width: 110, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12, textAlign: 'right' }} /> : <span>{formatKes(otherChargesMinor)}</span>}</div>
      <div className="status-row"><strong>Total</strong><span style={{ fontWeight: 800 }}>{formatKes(total)}</span></div>
      <div className="status-row"><strong>Amount paid</strong><span>{formatKes(amountPaid)}</span></div>
      <div className="status-row"><strong>Balance due</strong><span style={{ fontWeight: 800, color: balance > 0 ? '#a4493d' : undefined }}>{formatKes(balance)}</span></div>

      {payments.length > 0 && <div style={{ marginTop: 10 }}>
        <p className="eyebrow">Payments recorded</p>
        {payments.map((p) => <p key={p.id} className="muted">{p.method}{p.reference ? ` · ${p.reference}` : ''} · {formatKes(p.amount_minor)} · {formatDate(p.paid_at)}</p>)}
      </div>}
      {balance > 0 && can('payment.create') && <JobPaymentRecorder jobCardId={id} balance={balance} onRecorded={(m) => { onNotice(m); reload(); }} />}

      <div className="action-buttons" style={{ marginTop: 14 }}>
        {can('job.update') && <button className="button primary small" disabled={savingDetails} onClick={() => void saveDetails()}>{savingDetails ? 'Saving…' : 'Save details'}</button>}
        {total > 0 && can('invoice.create') && <button className="button secondary small" onClick={() => void openTab()}>{invoice ? 'Refresh invoice' : 'Open invoice'}</button>}
        {can('job.view') && <button className="button secondary small" onClick={() => setShowPrint(true)}><Printer size={16} /> Print work order</button>}
      </div>
    </section>
    {showPrint && <JobCardPrintView job={job} labourTotal={labourTotal} partsTotal={partsTotal} taxRate={taxRate} onClose={() => setShowPrint(false)} onNotice={onNotice} />}
  </>;
}

function JobPaymentRecorder({ jobCardId, balance, onRecorded }: { jobCardId: string; balance: number; onRecorded: (m: string) => void }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'MPESA' | 'BANK' | 'CARD' | 'OTHER'>('MPESA');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    const amountMinor = Math.round((parseFloat(amount) || 0) * 100);
    if (amountMinor <= 0) { setError('Enter a valid amount.'); return; }
    setBusy(true);
    const { data: invoiceId, error: tabError } = await supabase.rpc('ensure_job_card_invoice', { p_job_card_id: jobCardId });
    if (tabError || !invoiceId) { setBusy(false); setError('Unable to open this job’s account. Please try again.'); return; }
    const idemKey = `pay-${invoiceId}-${amountMinor}-${Date.now()}`;
    const { error: rpcError } = await supabase.rpc('record_payment', { p_invoice_id: invoiceId, p_amount_minor: amountMinor, p_method: method, p_reference: reference || null, p_idempotency_key: idemKey, p_notes: null });
    setBusy(false);
    if (rpcError) { setError(rpcError.message.includes('exceeds') ? 'Payment exceeds outstanding balance.' : rpcError.message); return; }
    onRecorded('Payment recorded.');
    setAmount(''); setReference('');
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="form-row modal-form" style={{ gridTemplateColumns: '130px 1fr 1fr auto' }}>
        <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="MPESA">M-Pesa</option><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="CARD">Card</option><option value="OTHER">Other</option>
        </select>
        <input type="number" min={0.01} step="0.01" max={balance / 100} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (KES) — e.g. a deposit" />
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="M-Pesa code / reference" />
        <button type="button" className="button primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Record'}</button>
      </div>
      {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}

// === SMART PART SEARCH — live inventory search used everywhere a job card adds a part ===
function highlightMatch(text: string, term: string): React.ReactNode {
  if (!term) return text;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return text;
  return <>{text.slice(0, idx)}<mark>{text.slice(idx, idx + term.length)}</mark>{text.slice(idx + term.length)}</>;
}

function PartSmartSearch({ can, onSelect }: { can: (p: string) => boolean; onSelect: (part: Part) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Part[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [showNewPart, setShowNewPart] = useState(false);
  const [newName, setNewName] = useState(''); const [newSku, setNewSku] = useState(''); const [newCategory, setNewCategory] = useState(''); const [newPrice, setNewPrice] = useState(''); const [newBusy, setNewBusy] = useState(false); const [newError, setNewError] = useState('');

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setResults([]); setLoading(false); return undefined; }
    setLoading(true);
    const timer = setTimeout(async () => {
      const pattern = `%${term}%`;
      const { data } = await supabase.from('parts').select('*').eq('active', true)
        .or(`name.ilike.${pattern},sku.ilike.${pattern},category.ilike.${pattern},brand.ilike.${pattern},vehicle_make.ilike.${pattern},vehicle_model.ilike.${pattern},compatible_vehicle.ilike.${pattern}`)
        .order('name').limit(15);
      setResults((data ?? []) as Part[]);
      setHighlight(0);
      setLoading(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function selectPart(p: Part) {
    onSelect(p);
    setQuery(''); setResults([]); setOpen(false); setShowNewPart(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const p = results[highlight]; if (p && p.quantity_on_hand > 0) selectPart(p); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  async function createPart() {
    setNewError('');
    if (!newName.trim() || !newSku.trim()) { setNewError('Part name and part number are required.'); return; }
    setNewBusy(true);
    const priceMinor = Math.round((parseFloat(newPrice) || 0) * 100);
    const { data, error } = await supabase.from('parts').insert({ sku: newSku.trim(), name: newName.trim(), category: newCategory.trim() || 'Other', selling_price_minor: priceMinor, cost_price_minor: 0, quantity_on_hand: 0, reorder_level: 0 }).select().single();
    setNewBusy(false);
    if (error || !data) { setNewError(error?.code === '23505' ? 'A part with that number already exists.' : error?.message ?? 'Unable to add part.'); return; }
    selectPart(data as Part);
  }

  return (
    <div className="combobox">
      <Search size={16} className="combobox-search-icon" />
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setShowNewPart(false); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder="Search by name, part number, brand, category, vehicle make/model..."
      />
      {open && query.trim().length >= 2 && <div className="combobox-dropdown">
        {loading && <p className="combobox-empty">Searching…</p>}
        {!loading && results.length === 0 && !showNewPart && (
          <>
            <p className="combobox-empty">No matching part found.</p>
            {can('inventory.create') && <button type="button" className="combobox-option combobox-add" onMouseDown={() => setShowNewPart(true)}><Plus size={14} /> Add New Part</button>}
          </>
        )}
        {!loading && results.map((p, i) => (
          <button type="button" key={p.id} className="combobox-option" style={i === highlight ? { background: '#f7f9fa' } : undefined} onMouseDown={() => p.quantity_on_hand > 0 && selectPart(p)} onMouseEnter={() => setHighlight(i)} disabled={p.quantity_on_hand <= 0}>
            <strong>{highlightMatch(p.name, query)}</strong> <span style={{ color: '#8997a5' }}>{highlightMatch(p.sku, query)}</span>
            <span style={{ float: 'right', color: p.quantity_on_hand <= 0 ? '#a4493d' : '#8997a5' }}>{p.quantity_on_hand <= 0 ? 'Out of stock' : `${p.quantity_on_hand} in stock`} · {formatKes(p.selling_price_minor)}</span>
          </button>
        ))}
        {showNewPart && (
          <div className="combobox-new combobox-new-wrap" style={{ padding: 10 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Part name" />
            <input value={newSku} onChange={(e) => setNewSku(e.target.value)} placeholder="Part number" />
            <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Category" />
            <input type="number" min={0} step="0.01" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="Selling price (KES)" />
            <button type="button" className="button primary small" disabled={newBusy} onMouseDown={(e) => { e.preventDefault(); void createPart(); }}>{newBusy ? 'Saving…' : 'Save part'}</button>
            {newError && <p className="form-error" style={{ flexBasis: '100%' }}>{newError}</p>}
          </div>
        )}
      </div>}
    </div>
  );
}

function JobCardPartAdder({ jobCardId, can, onAdded }: { jobCardId: string; can: (p: string) => boolean; onAdded: (m: string) => void }) {
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!can('inventory.issue')) return null;

  async function addPart() {
    if (!selectedPart) return;
    const qty = parseInt(quantity) || 0;
    setError('');
    if (qty <= 0) { setError('Quantity must be greater than zero.'); return; }
    if (qty > selectedPart.quantity_on_hand) { setError(`Insufficient stock. Only ${selectedPart.quantity_on_hand} units are available.`); return; }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('add_job_card_part', { p_job_card_id: jobCardId, p_part_id: selectedPart.id, p_quantity: qty });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    onAdded(`${selectedPart.name} added to the job card.`);
    setSelectedPart(null); setQuantity('1');
  }

  return (
    <div style={{ marginTop: 10 }}>
      <PartSmartSearch can={can} onSelect={(p) => { setSelectedPart(p); setError(''); setQuantity('1'); }} />
      {selectedPart && <>
        <div className="detail-info-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', marginTop: 10 }}>
          <div className="info-card"><div><span>Part</span><strong>{selectedPart.name} ({selectedPart.sku})</strong></div></div>
          <div className="info-card"><div><span>Unit price</span><strong>{formatKes(selectedPart.selling_price_minor)}</strong></div></div>
          <div className="info-card"><div><span>Available stock</span><strong>{selectedPart.quantity_on_hand}</strong></div></div>
        </div>
        <div className="action-buttons" style={{ marginTop: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#516271' }}>Quantity</span>
          <input type="number" min={1} max={selectedPart.quantity_on_hand} value={quantity} onChange={(e) => setQuantity(e.target.value)} style={{ width: 90, border: '1px solid #dfe5ea', borderRadius: 7, padding: '10px 11px', fontSize: 13 }} />
          <span style={{ fontSize: 13, color: '#8997a5' }}>Total: {formatKes(Math.round((parseInt(quantity) || 0) * selectedPart.selling_price_minor))}</span>
          <button type="button" className="button primary" disabled={busy} onClick={() => void addPart()}><Plus size={15} /> {busy ? 'Adding…' : 'Add Part'}</button>
          <button type="button" className="button secondary" onClick={() => { setSelectedPart(null); setError(''); }}>Cancel</button>
        </div>
        {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
      </>}
    </div>
  );
}


// === JOB CARD PRINT / PDF VIEW — matches the physical duplicate Work Order pad ===
function JobCardPrintView({ job, labourTotal, partsTotal, taxRate, onClose, onNotice }: { job: JobDetailData; labourTotal: number; partsTotal: number; taxRate: number; onClose: () => void; onNotice: (m: string) => void }) {
  const [blank, setBlank] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function exportImage() {
    const node = document.getElementById('print-area');
    if (!node) return;
    setExporting(true);
    try {
      await document.fonts?.ready;
      const images = Array.from(node.querySelectorAll('img'));
      await Promise.all(images.map((img) => (img.complete ? Promise.resolve() : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; }))));

      // Explicit width/height (rather than letting html-to-image infer them) works around a
      // known issue where combining pixelRatio with an inferred size clips the output to
      // roughly the top half of a tall node.
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        width: node.scrollWidth,
        height: node.scrollHeight,
        backgroundColor: '#ffffff',
        cacheBust: true,
      });
      const link = document.createElement('a');
      link.download = `${job.job_number}-work-order.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      onNotice('Unable to export the work order as an image. Please try again.');
    }
    setExporting(false);
  }

  return <div className="print-overlay">
    <div className="print-toolbar no-print">
      <div className="action-buttons">
        <button className={`button ${!blank ? 'primary' : 'secondary'} small`} onClick={() => setBlank(false)}>Filled work order</button>
        <button className={`button ${blank ? 'primary' : 'secondary'} small`} onClick={() => setBlank(true)}>Blank template</button>
      </div>
      <div className="action-buttons">
        <button className="button primary small" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
        <button className="button secondary small" disabled={exporting} onClick={() => void exportImage()}><Download size={15} /> {exporting ? 'Exporting…' : 'Export as image'}</button>
        <button className="close-button" onClick={onClose}><X size={16} /></button>
      </div>
    </div>

    <div id="print-area" className="print-sheet work-order-sheet">
      <WorkOrderCopy job={job} labourTotal={labourTotal} partsTotal={partsTotal} taxRate={taxRate} blank={blank} />
    </div>
  </div>;
}

function WorkOrderCopy({ job, labourTotal, partsTotal, taxRate, blank }: { job: JobDetailData; labourTotal: number; partsTotal: number; taxRate: number; blank: boolean }) {
  const technicianName = job.job_card_signoffs.find((s) => s.role === 'TECHNICIAN')?.name;
  const jobDone = job.job_card_work_items?.filter((w) => w.status === 'COMPLETED').map((w) => w.description).join('; ') || job.recommended_work || '';
  const payments = !blank ? job.invoices.flatMap((inv) => inv.payments ?? []).sort((a, b) => b.paid_at.localeCompare(a.paid_at)) : [];
  const lastPayment = payments[0];
  const mpesaPayment = payments.find((p) => p.method === 'MPESA');
  const amountPaid = blank ? 0 : job.invoices.reduce((s, inv) => s + inv.amount_paid_minor, 0);
  const totalCharges = labourTotal + partsTotal + job.other_charges_minor;
  const balanceDue = Math.max(0, totalCharges - amountPaid);
  const plainKes = (minor: number) => (minor / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const partRows = blank ? [] : job.job_card_parts;
  const rows = Array.from({ length: Math.max(10, partRows.length) });

  return (
    <div className="work-order-copy">
      <div className="wo-header">
        <div className="wo-brand">
          <img src="/logo.png" alt="Oakland Motor Care Ltd" />
          <h1>WORK ORDER</h1>
        </div>
        <div className="wo-meta-box">
          <div><span>Work Order No.</span><strong>{blank ? '' : job.job_number}</strong></div>
          <div><span>Date</span><strong>{blank || !job.received_at ? '__ / __ / ____' : formatDate(job.received_at)}</strong></div>
        </div>
      </div>

      <div className="wo-row">
        <section className="wo-section" style={{ flex: 2 }}>
          <h5>1. VEHICLE DETAILS</h5>
          <div className="wo-fields">
            <div className="wo-field-row">
              <span>Reg. No.: <strong>{blank ? '' : job.vehicles?.registration_number}</strong></span>
              <span>Model / Make: <strong>{blank || !job.vehicles ? '' : [job.vehicles.make, job.vehicles.model].filter(Boolean).join(' ')}</strong></span>
            </div>
            <div className="wo-field-row">
              <span>Customer Name: <strong>{blank ? '' : job.customers?.full_name}</strong></span>
              <span>Phone No.: <strong>{blank ? '' : job.customers?.phone}</strong></span>
            </div>
          </div>
        </section>
        <section className="wo-section" style={{ flex: 1 }}>
          <h5>2. JOB TYPE</h5>
          <p className="wo-lines">{blank ? '' : job.job_types.map((t) => JOB_TYPE_META.find((m) => m.key === t)?.label ?? t).join(', ')}</p>
        </section>
      </div>

      <section className="wo-section">
        <h5>3. PARTS USED</h5>
        <table className="wo-table">
          <thead><tr><th>No.</th><th>Part / Description</th><th>Part Number</th><th>Qty</th><th>Unit Price (KES)</th><th className="wo-shaded">Total Price (KES)</th></tr></thead>
          <tbody>
            {rows.map((_, i) => {
              const p = partRows[i];
              const total = p ? computeLineTotal(p.quantity, p.unit_price_minor, taxRate) : 0;
              return <tr key={i}>
                <td>{i + 1}</td>
                <td>{p?.parts?.name ?? ''}</td>
                <td>{p?.parts?.sku ?? ''}</td>
                <td>{p ? p.quantity : ''}</td>
                <td>{p ? plainKes(p.unit_price_minor) : ''}</td>
                <td className="wo-shaded">{p ? plainKes(total) : ''}</td>
              </tr>;
            })}
          </tbody>
          <tfoot><tr><td colSpan={5}>TOTAL PARTS (KES)</td><td className="wo-shaded">{blank ? '' : plainKes(partsTotal)}</td></tr></tfoot>
        </table>
      </section>

      <section className="wo-section">
        <h5>4. JOB DONE</h5>
        <p className="wo-lines wo-lines-tall">{jobDone}</p>
      </section>

      <div className="wo-row">
        <section className="wo-section" style={{ flex: 1 }}>
          <h5>5. CHARGES</h5>
          <div className="wo-charges">
            <div><span>Labour (KES)</span><strong>{blank ? '' : plainKes(labourTotal)}</strong></div>
            <div><span>Parts (KES)</span><strong>{blank ? '' : plainKes(partsTotal)}</strong></div>
            <div><span>Other (KES)</span><strong>{blank ? '' : plainKes(job.other_charges_minor)}</strong></div>
            <div className="wo-total"><span>TOTAL (KES)</span><strong>{blank ? '' : plainKes(totalCharges)}</strong></div>
            <div><span>Amount Paid (KES)</span><strong>{blank ? '' : plainKes(amountPaid)}</strong></div>
            <div><span>Balance Due (KES)</span><strong>{blank ? '' : plainKes(balanceDue)}</strong></div>
          </div>
          <p className="wo-signature-line">Customer Signature: ________________________</p>
        </section>
        <section className="wo-section" style={{ flex: 1 }}>
          <h5>6. COMPLETION</h5>
          <p className="wo-signature-line">Technician: {technicianName ?? '________________________'}</p>
          <p className="wo-signature-line">Signature: ________________________</p>
          <div className="wo-checkbox-row">
            <span>Payment:</span>
            <label><input type="checkbox" readOnly checked={lastPayment?.method === 'CASH'} /> Cash</label>
            <label><input type="checkbox" readOnly checked={lastPayment?.method === 'MPESA'} /> M-Pesa</label>
            <label><input type="checkbox" readOnly checked={!!lastPayment && lastPayment.method !== 'CASH' && lastPayment.method !== 'MPESA'} /> Other ____</label>
          </div>
          <p className="wo-signature-line">M-Pesa Code: {blank ? '________________________' : (mpesaPayment?.reference || '________________________')}</p>
        </section>
      </div>
    </div>
  );
}

// === SERVICES ===
function ServicesSection({ onNew, can }: { onNew: () => void; can: (p: string) => boolean }) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { supabase.from('services').select('*').order('name').then(({ data }) => { setServices((data ?? []) as Service[]); setLoading(false); }); }, []);
  return <SectionPanel eyebrow="Service catalogue" title="Services" onNew={can('settings.manage') ? onNew : undefined} newLabel="Add service">
    {loading ? <Loading /> : services.length === 0 ? <Empty title="No services" text="Add your first service to the catalogue." /> : <div className="data-table">{services.map((s) => <div className="table-row" key={s.id}><div className="job-icon"><Wrench size={17} /></div><div><strong>{s.name}</strong><span>{s.category} · {s.estimated_minutes} min</span></div><span className="table-muted">{formatKes(s.standard_price_minor)}</span><span className={`status ${s.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{s.active ? 'Active' : 'Inactive'}</span></div>)}</div>}
  </SectionPanel>;
}

// === TECHNICIANS ===
function TechniciansSection({ onNew, onSelect, can }: { onNew: () => void; onSelect: (id: string) => void; can: (p: string) => boolean }) {
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
        // Technician assignment is recorded as a job_card_signoffs row (name-matched, not a
        // foreign key) via JobDetail's "Assign" action — job_card_assignments is never written to.
        const { count } = await supabase.from('job_card_signoffs').select('job_card_id, job_cards!inner(status)', { count: 'exact', head: true }).eq('role', 'TECHNICIAN').eq('name', emp.full_name).not('job_cards.status', 'in', '(COMPLETED,CANCELLED)');
        counts[emp.id] = count ?? 0;
      }
      setAssignments(counts); setLoading(false);
    })();
  }, []);
  return <SectionPanel eyebrow="Workshop team" title="Technicians" onNew={can('users.manage') ? onNew : undefined} newLabel="Add technician">
    {loading ? <Loading /> : employees.length === 0 ? <Empty title="No technicians" text="Add your first technician to the workshop team." /> : <div className="data-table">{employees.map((e) => <div className="table-row clickable" key={e.id} onClick={() => onSelect(e.id)}><div className="avatar small-avatar">{e.full_name.slice(0, 1)}</div><div><strong>{e.full_name}</strong><span>{e.specialization ?? 'General mechanic'}</span></div><span className="table-muted">{e.phone ?? '—'}</span><span className="status bg-blue-50 text-blue-700">{assignments[e.id] ?? 0} active</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
  </SectionPanel>;
}

type TechnicianJobRow = {
  job_card_id: string; signed_at: string;
  job_cards: { job_number: string; status: string; created_at: string; complaint: string; invoices: { invoice_number: string; total_minor: number; amount_paid_minor: number; status: string }[] } | null;
};

function TechnicianDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [jobs, setJobs] = useState<TechnicianJobRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: emp } = await supabase.from('employees').select('*').eq('id', id).maybeSingle();
      const employeeRow = emp as Employee | null;
      setEmployee(employeeRow);
      if (employeeRow) {
        const { data } = await supabase.from('job_card_signoffs').select('job_card_id, signed_at, job_cards(job_number, status, created_at, complaint, invoices(invoice_number, total_minor, amount_paid_minor, status))').eq('role', 'TECHNICIAN').eq('name', employeeRow.full_name).order('signed_at', { ascending: false });
        setJobs((data ?? []) as unknown as TechnicianJobRow[]);
      }
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <Loading />;
  if (!employee) return <Empty title="Technician not found" text="This technician may have been removed." />;

  const revenueOf = (row: TechnicianJobRow) => (row.job_cards?.invoices ?? []).filter((inv) => inv.status !== 'VOID').reduce((s, inv) => s + inv.total_minor, 0);
  const collectedOf = (row: TechnicianJobRow) => (row.job_cards?.invoices ?? []).filter((inv) => inv.status !== 'VOID').reduce((s, inv) => s + inv.amount_paid_minor, 0);
  const totalRevenue = jobs.reduce((s, row) => s + revenueOf(row), 0);
  const totalCollected = jobs.reduce((s, row) => s + collectedOf(row), 0);
  const completedCount = jobs.filter((row) => row.job_cards?.status === 'COMPLETED').length;

  return <>
    <BackBar onBack={onBack} label="Technicians" />
    <div className="detail-header"><div className="detail-avatar"><UserCog size={24} /></div><div className="flex-1"><h2>{employee.full_name}</h2><p className="muted">{employee.specialization ?? 'General mechanic'} · {employee.phone ?? 'No phone on file'}</p></div></div>
    <div className="detail-info-grid">
      <div className="info-card"><ClipboardList size={16} /> <div><span>Jobs handled</span><strong>{jobs.length}</strong></div></div>
      <div className="info-card"><CheckCircle2 size={16} /> <div><span>Completed</span><strong>{completedCount}</strong></div></div>
      <div className="info-card"><CircleDollarSign size={16} /> <div><span>Revenue generated</span><strong>{formatKes(totalRevenue)}</strong></div></div>
      <div className="info-card"><Banknote size={16} /> <div><span>Collected</span><strong>{formatKes(totalCollected)}</strong></div></div>
    </div>
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">History</p><h3>Work orders</h3></div></div>
      {jobs.length === 0 ? <Empty title="No work orders yet" text="Work orders this technician is assigned to will appear here." /> : <div className="data-table">{jobs.map((row) => <div className="table-row" key={row.job_card_id}>
        <div className="job-icon"><Wrench size={17} /></div>
        <div><strong>{row.job_cards?.job_number ?? '—'}</strong><span>{row.job_cards?.complaint ?? ''}</span></div>
        <span className="table-muted">{row.job_cards ? formatDate(row.job_cards.created_at) : '—'}</span>
        <span className="table-muted">{revenueOf(row) > 0 ? formatKes(revenueOf(row)) : 'Not invoiced'}</span>
        {row.job_cards && <span className={`status ${statusStyles[row.job_cards.status] ?? ''}`}>{row.job_cards.status.replaceAll('_', ' ')}</span>}
      </div>)}</div>}
    </section>
  </>;
}

// === PARTS / INVENTORY ===
const MOVEMENT_LABELS: Record<string, string> = {
  OPENING_BALANCE: 'Opening Balance', PURCHASE: 'Purchase', SALE: 'Sale', SALE_REVERSAL: 'Sale Reversal',
  JOB_CARD_USAGE: 'Workshop Issue', RETURN: 'Return', ADJUSTMENT_IN: 'Adjustment (In)',
  ADJUSTMENT_OUT: 'Adjustment (Out)', DAMAGE: 'Damage / Loss', TRANSFER: 'Transfer',
};

function partCategoryType(category: string) { return category === 'Accessories' ? 'Accessory' : 'Spare'; }

function partStockStatus(p: Part): { label: string; className: string } {
  if (p.quantity_on_hand === 0) return { label: 'Out of stock', className: 'bg-red-50 text-red-700' };
  if (p.quantity_on_hand <= p.reorder_level) return { label: 'Low stock', className: 'bg-amber-50 text-amber-700' };
  return { label: 'In stock', className: 'bg-emerald-50 text-emerald-700' };
}

function PartsSection({ onNew, onReceive, onAdjust, onSelect, can }: { onNew: () => void; onReceive: () => void; onAdjust: () => void; onSelect: (id: string) => void; can: (p: string) => boolean }) {
  const [parts, setParts] = useState<Part[]>([]);
  const [performance, setPerformance] = useState<Record<string, number>>({});
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
  useEffect(() => {
    (async () => {
      const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const { data } = await supabase.from('sale_items').select('part_id,quantity,sales!inner(status,sale_date)').gte('sales.sale_date', thirtyDaysAgo.toISOString()).neq('sales.status', 'VOIDED').limit(2000);
      const map: Record<string, number> = {};
      for (const row of (data ?? []) as unknown as { part_id: string; quantity: number }[]) map[row.part_id] = (map[row.part_id] ?? 0) + row.quantity;
      setPerformance(map);
    })();
  }, []);
  return <SectionPanel eyebrow="Spare parts" title="Parts" onNew={can('inventory.create') ? onNew : undefined} newLabel="Add part">
    <div className="filter-bar"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by SKU or name..." /></div>
    <div className="action-buttons" style={{ marginBottom: 16 }}>
      {can('inventory.receive') && <button className="button secondary small" onClick={onReceive}><Plus size={15} /> Receive stock</button>}
      {can('inventory.adjust') && <button className="button secondary small" onClick={onAdjust}><Edit size={15} /> Adjust stock</button>}
    </div>
    {loading ? <Loading /> : parts.length === 0 ? <Empty title="No parts" text="Add your first part to inventory." /> : <>
      <div className="parts-table-wrap"><table className="report-table parts-table"><thead><tr>
        <th>Part Name</th><th>Part Number</th><th className="numeric">Buying Price</th><th className="numeric">Selling Price</th><th className="numeric">Stock</th><th>Performance</th><th>Status</th><th>Category</th>
      </tr></thead><tbody>{parts.map((p) => {
        const status = partStockStatus(p); const sold = performance[p.id] ?? 0;
        return <tr key={p.id} className="clickable" onClick={() => onSelect(p.id)}>
          <td><strong>{p.name}</strong>{p.brand && <span className="table-subtext">{p.brand}</span>}</td>
          <td>{p.sku}</td>
          <td className="numeric">{formatKes(p.cost_price_minor)}</td>
          <td className="numeric">{formatKes(p.selling_price_minor)}</td>
          <td className="numeric">{p.quantity_on_hand}</td>
          <td>{sold > 0 ? <span className="performance-tag up"><TrendingUp size={13} /> {sold} sold (30d)</span> : <span className="performance-tag flat">No recent sales</span>}</td>
          <td><span className={`status ${status.className}`}>{status.label}</span></td>
          <td><span className="category-tag">{partCategoryType(p.category)}</span><span className="table-subtext">{p.category}</span></td>
        </tr>;
      })}</tbody></table></div>
      <div className="parts-card-grid">{parts.map((p) => {
        const status = partStockStatus(p); const sold = performance[p.id] ?? 0;
        return <button key={p.id} type="button" className="part-card" onClick={() => onSelect(p.id)}>
          <div className="part-card-top"><div className="job-icon"><Package size={17} /></div><span className={`status ${status.className}`}>{status.label}</span></div>
          <strong>{p.name}</strong>
          <span className="part-card-meta">{p.sku} · {partCategoryType(p.category)}</span>
          <div className="part-card-prices"><span>Buy {formatKes(p.cost_price_minor)}</span><span>Sell {formatKes(p.selling_price_minor)}</span></div>
          <div className="part-card-foot"><span>{p.quantity_on_hand} in stock</span>{sold > 0 && <span className="performance-tag up"><TrendingUp size={12} /> {sold} sold</span>}</div>
        </button>;
      })}</div>
    </>}
  </SectionPanel>;
}

function PartDetail({ id, onBack, can, onNotice, onNavigateToSale, onNavigateToJob, onNavigateToPO }: { id: string; onBack: () => void; can: (p: string) => boolean; onNotice: (m: string) => void; onNavigateToSale?: (id: string) => void; onNavigateToJob?: (id: string) => void; onNavigateToPO?: (id: string) => void }) {
  const [part, setPart] = useState<Part | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);

  const load = useCallback(async () => {
    const [{ data: partData }, { data: movementData }] = await Promise.all([
      supabase.from('parts').select('*').eq('id', id).maybeSingle(),
      supabase.from('stock_movements').select('*').eq('part_id', id).order('created_at', { ascending: false }).limit(30),
    ]);
    const movementRows = (movementData ?? []) as StockMovement[];
    setPart(partData as Part | null); setMovements(movementRows); setLoading(false);
    const userIds = Array.from(new Set(movementRows.map((m) => m.user_id).filter(Boolean))) as string[];
    if (userIds.length > 0) {
      const { data: profileRows } = await supabase.from('profiles').select('id,full_name').in('id', userIds);
      const map: Record<string, string> = {};
      for (const row of (profileRows ?? []) as { id: string; full_name: string }[]) map[row.id] = row.full_name;
      setActorNames(map);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <Loading />;
  if (!part) return <><BackBar onBack={onBack} label="Parts" /><Empty title="Part not found" text="This part may have been removed." /></>;
  const stockValue = part.cost_price_minor * part.quantity_on_hand;
  const margin = part.selling_price_minor - part.cost_price_minor;
  const status = partStockStatus(part);
  return <>
    <BackBar onBack={onBack} label="Parts" />
    <div className="detail-header">
      <div className="detail-avatar"><Package size={24} /></div>
      <div className="flex-1"><h2>{part.name}</h2><p className="muted">{part.sku} · {partCategoryType(part.category)} ({part.category}){part.brand ? ` · ${part.brand}` : ''}</p></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <span className={`status ${status.className}`}>{status.label}</span>
        {can('inventory.update') && <button className="button secondary small" onClick={() => setShowEdit(true)}><Edit size={15} /> Edit part</button>}
      </div>
    </div>
    <div className="detail-info-grid">
      <div className="info-card"><CircleDollarSign size={16} /> <div><span>Buying price</span><strong>{formatKes(part.cost_price_minor)}</strong></div></div>
      <div className="info-card"><CircleDollarSign size={16} /> <div><span>Selling price</span><strong>{formatKes(part.selling_price_minor)}</strong></div></div>
      <div className="info-card"><TrendingUp size={16} /> <div><span>Margin per unit</span><strong>{formatKes(margin)}</strong></div></div>
      <div className="info-card"><Boxes size={16} /> <div><span>Stock value (cost)</span><strong>{formatKes(stockValue)}</strong></div></div>
      <div className="info-card"><Package size={16} /> <div><span>Quantity on hand</span><strong>{part.quantity_on_hand}</strong></div></div>
      <div className="info-card"><AlertTriangle size={16} /> <div><span>Reorder level</span><strong>{part.reorder_level}</strong></div></div>
      {part.location && <div className="info-card"><MapPin size={16} /> <div><span>Location</span><strong>{part.location}</strong></div></div>}
      <div className="info-card"><ShieldCheck size={16} /> <div><span>Active</span><strong>{part.active ? 'Yes' : 'No'}</strong></div></div>
    </div>
    <section className="panel table-panel" style={{ marginTop: 20 }}>
      <div className="panel-heading"><div><p className="eyebrow">Audit trail</p><h3>Recent stock movements</h3></div></div>
      {movements.length === 0 ? <Empty title="No stock movements" text="Movements for this part will appear here." /> : <div className="report-table-wrap"><table className="report-table"><thead><tr>
        <th>Date</th><th>Reference</th><th>Movement</th><th className="numeric">Qty</th><th className="numeric">Balance</th>
      </tr></thead><tbody>{movements.map((m) => {
        let navigate: ((id: string) => void) | undefined;
        if (m.reference_id) {
          if (m.movement_type === 'SALE' || m.movement_type === 'SALE_REVERSAL') navigate = onNavigateToSale;
          else if (m.movement_type === 'JOB_CARD_USAGE') navigate = onNavigateToJob;
          else if (m.movement_type === 'PURCHASE') navigate = onNavigateToPO;
        }
        const actor = m.user_id ? actorNames[m.user_id] : undefined;
        return <tr key={m.id}>
          <td>{formatDateTime(m.created_at)}</td>
          <td>{(() => { const go = navigate; const refId = m.reference_id; return go && refId ? <button type="button" className="text-button" style={{ padding: 0 }} onClick={() => go(refId)}>{m.reference ?? '—'}</button> : (m.reference ?? '—'); })()}</td>
          <td><strong>{MOVEMENT_LABELS[m.movement_type] ?? m.movement_type.replaceAll('_', ' ')}</strong>{(m.reason || actor) && <span className="table-subtext">{[actor ? `By ${actor}` : null, m.reason].filter(Boolean).join(' · ')}</span>}</td>
          <td className="numeric"><span className={`status ${m.quantity >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{m.quantity >= 0 ? '+' : ''}{m.quantity}</span></td>
          <td className="numeric">{m.new_balance}</td>
        </tr>;
      })}</tbody></table></div>}
    </section>
    {showEdit && <PartForm part={part} onClose={() => setShowEdit(false)} onSaved={(m) => { setShowEdit(false); onNotice(m); void load(); }} />}
  </>;
}

type StockMovementRow = StockMovement & { parts: { id: string; name: string; sku: string } | null };

function StockMovementsSection({ onSelectPart, onNavigateToSale, onNavigateToJob, onNavigateToPO }: { onSelectPart: (id: string) => void; onNavigateToSale: (id: string) => void; onNavigateToJob: (id: string) => void; onNavigateToPO: (id: string) => void }) {
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(async () => {
      let q = supabase.from('stock_movements').select('*, parts!inner(id,name,sku)').order('created_at', { ascending: false }).limit(300);
      if (typeFilter !== 'ALL') q = q.eq('movement_type', typeFilter);
      if (fromDate) q = q.gte('created_at', `${fromDate}T00:00:00`);
      if (toDate) q = q.lte('created_at', `${toDate}T23:59:59`);
      const term = query.trim();
      if (term) q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%`, { foreignTable: 'parts' });
      const { data } = await q;
      const rows = (data ?? []) as unknown as StockMovementRow[];
      setMovements(rows);
      setLoading(false);
      const userIds = Array.from(new Set(rows.map((m) => m.user_id).filter(Boolean))) as string[];
      if (userIds.length > 0) {
        const { data: profileRows } = await supabase.from('profiles').select('id,full_name').in('id', userIds);
        const map: Record<string, string> = {};
        for (const row of (profileRows ?? []) as { id: string; full_name: string }[]) map[row.id] = row.full_name;
        setActorNames(map);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [typeFilter, fromDate, toDate, query]);

  function exportCSV() {
    downloadCSV(`Oakland_stock_movements_${new Date().toISOString().slice(0, 10)}.csv`, movements.map((m) => ({
      Date: formatDateTime(m.created_at),
      Part: m.parts?.name ?? '',
      'Part Number': m.parts?.sku ?? '',
      Movement: MOVEMENT_LABELS[m.movement_type] ?? m.movement_type,
      Reference: m.reference ?? '',
      Reason: m.reason ?? '',
      By: m.user_id ? actorNames[m.user_id] ?? '' : '',
      Quantity: m.quantity,
      'Previous Balance': m.previous_balance,
      'New Balance': m.new_balance,
    })));
  }

  const hasFilters = query || typeFilter !== 'ALL' || fromDate || toDate;

  return <>
    <div className="page-heading"><div><p className="eyebrow">Audit trail</p><h1>Stock Movements</h1><p className="muted">Every change to inventory, in one place.</p></div><div className="heading-actions"><button className="button secondary" onClick={exportCSV} disabled={movements.length === 0}><Download size={16} /> Export CSV</button></div></div>
    <div className="form-row modal-form" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', alignItems: 'end', marginBottom: 12 }}>
      <label>Search part<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or part number..." /></label>
      <label>Movement type<select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="ALL">All types</option>{MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_LABELS[t] ?? t}</option>)}</select></label>
      <label>From<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
      <label>To<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
    </div>
    {hasFilters && <div className="action-buttons" style={{ marginBottom: 16 }}><button type="button" className="text-button" onClick={() => { setQuery(''); setTypeFilter('ALL'); setFromDate(''); setToDate(''); }}>Clear filters</button></div>}
    <section className="panel table-panel">
      {loading ? <Loading /> : movements.length === 0 ? <Empty title="No stock movements" text="Try widening your filters." /> : <div className="report-table-wrap"><table className="report-table"><thead><tr>
        <th>Date</th><th>Part</th><th>Reference</th><th>Movement</th><th className="numeric">Qty</th><th className="numeric">Balance</th>
      </tr></thead><tbody>{movements.map((m) => {
        let navigate: ((id: string) => void) | undefined;
        if (m.reference_id) {
          if (m.movement_type === 'SALE' || m.movement_type === 'SALE_REVERSAL') navigate = onNavigateToSale;
          else if (m.movement_type === 'JOB_CARD_USAGE') navigate = onNavigateToJob;
          else if (m.movement_type === 'PURCHASE') navigate = onNavigateToPO;
        }
        const actor = m.user_id ? actorNames[m.user_id] : undefined;
        return <tr key={m.id}>
          <td>{formatDateTime(m.created_at)}</td>
          <td>{m.parts ? <button type="button" className="text-button" style={{ padding: 0 }} onClick={() => onSelectPart(m.parts!.id)}>{m.parts.name}</button> : '—'}{m.parts && <span className="table-subtext">{m.parts.sku}</span>}</td>
          <td>{(() => { const go = navigate; const refId = m.reference_id; return go && refId ? <button type="button" className="text-button" style={{ padding: 0 }} onClick={() => go(refId)}>{m.reference ?? '—'}</button> : (m.reference ?? '—'); })()}</td>
          <td><strong>{MOVEMENT_LABELS[m.movement_type] ?? m.movement_type.replaceAll('_', ' ')}</strong>{(m.reason || actor) && <span className="table-subtext">{[actor ? `By ${actor}` : null, m.reason].filter(Boolean).join(' · ')}</span>}</td>
          <td className="numeric"><span className={`status ${m.quantity >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{m.quantity >= 0 ? '+' : ''}{m.quantity}</span></td>
          <td className="numeric">{m.previous_balance} → {m.new_balance}</td>
        </tr>;
      })}</tbody></table></div>}
    </section>
  </>;
}

type LowStockPart = Part & { suppliers: { name: string } | null };

function suggestedOrderQty(p: Part): number {
  return Math.max(p.reorder_level * 2 - p.quantity_on_hand, p.reorder_level, 1);
}

function LowStockSection({ onSelect, onNotice, can, onNavigateToPO }: { onSelect: (id: string) => void; onNotice: (m: string) => void; can: (p: string) => boolean; onNavigateToPO: (id: string) => void }) {
  const [parts, setParts] = useState<LowStockPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [orderQty, setOrderQty] = useState<Record<string, number>>({});
  const [showPrint, setShowPrint] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    supabase.from('parts').select('*, suppliers(name)').eq('active', true).order('name').then(({ data }) => {
      const all = (data ?? []) as unknown as LowStockPart[];
      const low = all.filter((p) => p.quantity_on_hand <= p.reorder_level);
      setParts(low);
      setOrderQty(Object.fromEntries(low.map((p) => [p.id, suggestedOrderQty(p)])));
      setLoading(false);
    });
  }, []);

  const term = query.trim().toLowerCase();
  const filtered = term ? parts.filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.category.toLowerCase().includes(term)) : parts;
  const suggestions = filtered.slice(0, 8);

  function pick(p: Part) { setQuery(p.name); setOpen(false); onSelect(p.id); }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const p = suggestions[highlight]; if (p) pick(p); }
    else if (e.key === 'Escape') setOpen(false);
  }

  const orderGroups = useMemo(() => {
    const bySupplier = new Map<string, LowStockPart[]>();
    for (const p of parts) {
      const key = p.suppliers?.name ?? 'No supplier assigned';
      if (!bySupplier.has(key)) bySupplier.set(key, []);
      bySupplier.get(key)!.push(p);
    }
    return Array.from(bySupplier.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [parts]);
  const grandTotalMinor = parts.reduce((s, p) => s + (orderQty[p.id] ?? 0) * p.cost_price_minor, 0);

  function exportExcel() {
    downloadCSV(`Oakland_suggested_order_${new Date().toISOString().slice(0, 10)}.csv`, parts.map((p) => ({
      'Part Name': p.name, 'Part Number': p.sku, Category: p.category, Supplier: p.suppliers?.name ?? 'No supplier assigned',
      'Current Stock': p.quantity_on_hand, 'Reorder Level': p.reorder_level, 'Suggested Qty': orderQty[p.id] ?? 0,
      'Unit Cost': (p.cost_price_minor / 100).toFixed(2), 'Estimated Total': (((orderQty[p.id] ?? 0) * p.cost_price_minor) / 100).toFixed(2),
    })));
  }

  async function generateOrders() {
    setGenerating(true);
    const bySupplierId = new Map<string, LowStockPart[]>();
    const unassigned: LowStockPart[] = [];
    for (const p of parts) {
      if (!p.supplier_id) { unassigned.push(p); continue; }
      if (!bySupplierId.has(p.supplier_id)) bySupplierId.set(p.supplier_id, []);
      bySupplierId.get(p.supplier_id)!.push(p);
    }
    const created: { id: string; po_number: string }[] = [];
    const failedSuppliers: string[] = [];
    for (const [supplierId, items] of Array.from(bySupplierId.entries())) {
      const { data, error } = await supabase.rpc('create_purchase_order', {
        p_supplier_id: supplierId,
        p_order_date: localDateStr(),
        p_expected_delivery: null,
        p_items: items.map((p) => ({ part_id: p.id, quantity: orderQty[p.id] ?? 1, unit_cost_minor: p.cost_price_minor })),
      });
      if (error || !data) failedSuppliers.push(items[0].suppliers?.name ?? 'Supplier');
      else created.push(data as { id: string; po_number: string });
    }
    setGenerating(false);
    const messages: string[] = [];
    if (created.length > 0) messages.push(`Created ${created.length} purchase order${created.length === 1 ? '' : 's'}: ${created.map((c) => c.po_number).join(', ')}.`);
    if (failedSuppliers.length > 0) messages.push(`Unable to create an order for ${failedSuppliers.join(', ')}.`);
    if (unassigned.length > 0) messages.push(`${unassigned.length} part${unassigned.length === 1 ? '' : 's'} skipped — no supplier assigned.`);
    onNotice(messages.join(' ') || 'No purchase orders were created.');
    if (created.length === 1) onNavigateToPO(created[0].id);
  }

  const orderableCount = parts.filter((p) => p.supplier_id).length;

  return <>
    <div className="page-heading"><div><p className="eyebrow">Reorder alerts</p><h1>Low Stock</h1><p className="muted">Parts at or below their reorder level, with a ready-to-send suggested order.</p></div><div className="heading-actions"><button className="button secondary" onClick={exportExcel} disabled={parts.length === 0}><Download size={16} /> Export Excel</button><button className="button secondary" onClick={() => setShowPrint(true)} disabled={parts.length === 0}><Printer size={16} /> Export PDF</button>{can('purchase_order.create') && <button className="button primary" onClick={() => void generateOrders()} disabled={generating || orderableCount === 0}><ShoppingCart size={16} /> {generating ? 'Generating…' : 'Generate purchase orders'}</button>}</div></div>

    <div className="combobox" style={{ marginBottom: 16 }}>
      <Search size={16} className="combobox-search-icon" />
      <input value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={handleKeyDown} placeholder="Search low-stock parts by name, SKU or category..." />
      {open && term.length > 0 && <div className="combobox-dropdown">
        {suggestions.length === 0 ? <p className="combobox-empty">No matching low-stock parts.</p> : suggestions.map((p, i) => <button type="button" key={p.id} className="combobox-option" style={i === highlight ? { background: '#f7f9fa' } : undefined} onMouseDown={() => pick(p)} onMouseEnter={() => setHighlight(i)}>
          <strong>{highlightMatch(p.name, query)}</strong> <span style={{ color: '#8997a5' }}>{highlightMatch(p.sku, query)}</span>
          <span style={{ float: 'right', color: '#a4493d' }}>{p.quantity_on_hand} left · reorder at {p.reorder_level}</span>
        </button>)}
      </div>}
    </div>

    {loading ? <Loading /> : filtered.length === 0 ? <Empty title={term ? 'No matches' : 'No low-stock parts'} text={term ? 'Try a different search term.' : 'Inventory levels are healthy.'} /> : <>
      <section className="panel table-panel" style={{ marginBottom: 24 }}>
        <div className="panel-heading"><div><p className="eyebrow">Inventory</p><h3>Parts needing attention ({filtered.length})</h3></div></div>
        <div className="report-table-wrap"><table className="report-table"><thead><tr>
          <th>Part Name</th><th>Part Number</th><th>Category</th><th className="numeric">Stock</th><th className="numeric">Reorder Level</th><th className="numeric">Buying Price</th><th className="numeric">Selling Price</th><th>Supplier</th><th>Status</th>
        </tr></thead><tbody>{filtered.map((p) => {
          const status = partStockStatus(p);
          return <tr key={p.id} className="clickable" onClick={() => onSelect(p.id)}>
            <td><strong>{highlightMatch(p.name, query)}</strong>{p.brand && <span className="table-subtext">{p.brand}</span>}</td>
            <td>{highlightMatch(p.sku, query)}</td>
            <td><span className="category-tag">{partCategoryType(p.category)}</span><span className="table-subtext">{p.category}</span></td>
            <td className="numeric">{p.quantity_on_hand}</td>
            <td className="numeric">{p.reorder_level}</td>
            <td className="numeric">{formatKes(p.cost_price_minor)}</td>
            <td className="numeric">{formatKes(p.selling_price_minor)}</td>
            <td>{p.suppliers?.name ?? '—'}</td>
            <td><span className={`status ${status.className}`}>{status.label}</span></td>
          </tr>;
        })}</tbody></table></div>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading"><div><p className="eyebrow">Purchasing</p><h3>Suggested order</h3></div><span className="status bg-slate-100 text-slate-600">Est. total {formatKes(grandTotalMinor)}</span></div>
        {orderGroups.map(([supplierName, items]) => {
          const subtotal = items.reduce((s, p) => s + (orderQty[p.id] ?? 0) * p.cost_price_minor, 0);
          return <div key={supplierName} style={{ marginBottom: 20 }}>
            <div className="status-row"><strong>{supplierName}</strong><span className="muted">{items.length} part{items.length === 1 ? '' : 's'} · Subtotal {formatKes(subtotal)}</span></div>
            <div className="report-table-wrap"><table className="report-table"><thead><tr>
              <th>Part Name</th><th>Part Number</th><th className="numeric">Current Stock</th><th className="numeric">Reorder Level</th><th className="numeric">Suggested Qty</th><th className="numeric">Unit Cost</th><th className="numeric">Est. Total</th>
            </tr></thead><tbody>{items.map((p) => <tr key={p.id}>
              <td><strong>{p.name}</strong></td>
              <td>{p.sku}</td>
              <td className="numeric">{p.quantity_on_hand}</td>
              <td className="numeric">{p.reorder_level}</td>
              <td className="numeric"><input type="number" min={1} value={orderQty[p.id] ?? 1} onChange={(e) => setOrderQty((prev) => ({ ...prev, [p.id]: Math.max(1, parseInt(e.target.value) || 1) }))} style={{ width: 70, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12, textAlign: 'right' }} /></td>
              <td className="numeric">{formatKes(p.cost_price_minor)}</td>
              <td className="numeric">{formatKes((orderQty[p.id] ?? 0) * p.cost_price_minor)}</td>
            </tr>)}</tbody></table></div>
          </div>;
        })}
      </section>
    </>}

    {showPrint && <SuggestedOrderPrintView parts={parts} orderQty={orderQty} orderGroups={orderGroups} grandTotalMinor={grandTotalMinor} onClose={() => setShowPrint(false)} />}
  </>;
}

function SuggestedOrderPrintView({ orderQty, orderGroups, grandTotalMinor, onClose }: { parts: LowStockPart[]; orderQty: Record<string, number>; orderGroups: [string, LowStockPart[]][]; grandTotalMinor: number; onClose: () => void }) {
  const today = formatDate(new Date().toISOString());
  return <div className="print-overlay">
    <div className="print-toolbar no-print">
      <strong>Suggested Order — {today}</strong>
      <div className="action-buttons">
        <button className="button primary small" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
        <button className="close-button" onClick={onClose}><X size={16} /></button>
      </div>
    </div>
    <div id="print-area" className="print-sheet">
      <div className="print-header">
        <div><img src="/logo.png" alt="Oakland Motor Care Ltd" /><h1>Oakland Motor Care Ltd.</h1><p className="muted">Suggested Purchase Order</p><p className="muted">Generated {today}</p></div>
      </div>
      {orderGroups.map(([supplierName, items]) => {
        const subtotal = items.reduce((s, p) => s + (orderQty[p.id] ?? 0) * p.cost_price_minor, 0);
        return <div className="print-section" key={supplierName}>
          <h4>{supplierName}</h4>
          <table className="print-table"><thead><tr><th>Part Name</th><th>Part Number</th><th>Current Stock</th><th>Reorder Level</th><th>Order Qty</th><th>Unit Cost</th><th>Total</th></tr></thead>
            <tbody>{items.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.sku}</td><td>{p.quantity_on_hand}</td><td>{p.reorder_level}</td><td>{orderQty[p.id] ?? 0}</td><td>{formatKes(p.cost_price_minor)}</td><td>{formatKes((orderQty[p.id] ?? 0) * p.cost_price_minor)}</td></tr>)}</tbody>
          </table>
          <div className="print-totals"><table><tbody><tr><td>Subtotal</td><td>{formatKes(subtotal)}</td></tr></tbody></table></div>
        </div>;
      })}
      <div className="print-totals"><table><tbody><tr><td><strong>Grand total</strong></td><td><strong>{formatKes(grandTotalMinor)}</strong></td></tr></tbody></table></div>
    </div>
  </div>;
}

// === SUPPLIERS ===
function SuppliersSection({ query, onNew, onSelect, can }: { query: string; onNew: () => void; onSelect: (id: string) => void; can: (p: string) => boolean }) {
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
  return <SectionPanel eyebrow="Vendor directory" title="Suppliers" onNew={can('supplier.create') ? onNew : undefined} newLabel="Add supplier">
    {loading ? <Loading /> : suppliers.length === 0 ? <Empty title="No suppliers" text="Add your first supplier." /> : <div className="data-table">{suppliers.map((s) => <div className="table-row clickable" key={s.id} onClick={() => onSelect(s.id)}><div className="job-icon"><Truck size={17} /></div><div><strong>{s.name}</strong><span>{s.contact_person ?? 'No contact'}</span></div><span className="table-muted">{s.phone}</span><span className={`status ${statusStyles[s.status] ?? ''}`}>{s.status}</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
  </SectionPanel>;
}

function SupplierDetail({ id, onBack, onNewPO, can }: { id: string; onBack: () => void; onNewPO: () => void; can: (p: string) => boolean }) {
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
    <div className="detail-header"><div className="detail-avatar supplier"><Truck size={24} /></div><div className="flex-1"><h2>{supplier.name}</h2><p className="muted">{supplier.contact_person ?? 'No contact person'}</p></div>{can('purchase_order.create') && <button className="button primary" onClick={onNewPO}><Plus size={16} /> New PO</button>}</div>
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
function ProcurementSection({ onNew, onSelect, can }: { onNew: () => void; onSelect: (id: string) => void; can: (p: string) => boolean }) {
  const [pos, setPOs] = useState<(PurchaseOrder & { suppliers: { name: string } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { supabase.from('purchase_orders').select('*, suppliers(name)').order('created_at', { ascending: false }).limit(100).then(({ data }) => { setPOs((data ?? []) as (PurchaseOrder & { suppliers: { name: string } | null })[]); setLoading(false); }); }, []);
  return <SectionPanel eyebrow="Purchase orders" title="Procurement" onNew={can('purchase_order.create') ? onNew : undefined} newLabel="New PO">
    {loading ? <Loading /> : pos.length === 0 ? <Empty title="No purchase orders" text="Create your first purchase order." /> : <div className="data-table">{pos.map((p) => <div className="table-row clickable" key={p.id} onClick={() => onSelect(p.id)}><div className="job-icon"><ShoppingCart size={17} /></div><div><strong>{p.po_number}</strong><span>{p.suppliers?.name ?? 'Supplier'} · {formatDate(p.order_date)}</span></div><span className="table-muted">{formatKes(p.total_minor)}</span><span className={`status ${statusStyles[p.status] ?? ''}`}>{p.status.replaceAll('_', ' ')}</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
  </SectionPanel>;
}

type PODetailData = PurchaseOrder & { suppliers: Supplier | null; purchase_order_items: (PurchaseOrderItem & { parts: Part | null })[] };

function PODetail({ id, onBack, can, onNotice }: { id: string; onBack: () => void; can: (p: string) => boolean; onNotice: (m: string) => void }) {
  const [po, setPO] = useState<PODetailData | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editQty, setEditQty] = useState<Record<string, string>>({});
  const [editCost, setEditCost] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [availableParts, setAvailableParts] = useState<Part[]>([]);
  const [pickPartId, setPickPartId] = useState(''); const [pickQty, setPickQty] = useState('1'); const [pickCost, setPickCost] = useState('0');
  const [showPrint, setShowPrint] = useState(false);

  async function reload() { const { data } = await supabase.from('purchase_orders').select('*, suppliers(*), purchase_order_items(*, parts(*))').eq('id', id).maybeSingle(); setPO(data as PODetailData | null); }
  useEffect(() => { void reload(); }, [id]);

  const editable = po?.status === 'DRAFT' && can('settings.manage');
  useEffect(() => { if (editable) supabase.from('parts').select('*').eq('active', true).order('name').limit(500).then(({ data }) => setAvailableParts((data ?? []) as Part[])); }, [editable]);

  async function receiveGoods(itemId: string, unitCost: number) {
    const qty = parseInt(receiveQty[itemId] ?? '0');
    if (qty <= 0 || receivingId) return;
    setReceivingId(itemId);
    const { error } = await supabase.rpc('receive_po_item', { p_item_id: itemId, p_quantity: qty, p_unit_cost_minor: unitCost });
    setReceivingId(null);
    if (error) { onNotice(error.message.includes('more than the ordered') ? 'Cannot receive more than the ordered quantity.' : 'Unable to receive goods. Please try again.'); return; }
    setReceiveQty((prev) => ({ ...prev, [itemId]: '' }));
    onNotice(`${qty} units received into inventory.`); void reload();
  }

  async function saveItem(item: PurchaseOrderItem) {
    if (!po) return;
    const qty = Math.max(1, parseInt(editQty[item.id] ?? String(item.quantity_ordered)) || 1);
    const cost = Math.max(0, Math.round((parseFloat(editCost[item.id] ?? String(item.unit_cost_minor / 100)) || 0) * 100));
    if (qty < item.quantity_received) { onNotice(`Cannot set ordered quantity below the ${item.quantity_received} already received.`); return; }
    setSavingId(item.id);
    const lineTotal = qty * cost;
    const { error } = await supabase.from('purchase_order_items').update({ quantity_ordered: qty, unit_cost_minor: cost, line_total_minor: lineTotal }).eq('id', item.id);
    if (!error) {
      const total = po.purchase_order_items.reduce((s, i) => s + (i.id === item.id ? lineTotal : i.line_total_minor), 0);
      await supabase.from('purchase_orders').update({ total_minor: total }).eq('id', po.id);
    }
    setSavingId(null);
    if (error) { onNotice('Unable to update the line item.'); return; }
    onNotice('Line item updated.'); void reload();
  }

  async function removeItem(itemId: string) {
    if (!po) return;
    const { error } = await supabase.from('purchase_order_items').delete().eq('id', itemId);
    if (error) { onNotice('Unable to remove the line item.'); return; }
    const total = po.purchase_order_items.filter((i) => i.id !== itemId).reduce((s, i) => s + i.line_total_minor, 0);
    await supabase.from('purchase_orders').update({ total_minor: total }).eq('id', po.id);
    onNotice('Line item removed.'); void reload();
  }

  async function addPart() {
    if (!po) return;
    const part = availableParts.find((x) => x.id === pickPartId); if (!part) return;
    const qty = Math.max(1, parseInt(pickQty) || 1); const cost = Math.max(0, Math.round((parseFloat(pickCost) || 0) * 100));
    const { error } = await supabase.from('purchase_order_items').insert({ purchase_order_id: po.id, part_id: part.id, quantity_ordered: qty, unit_cost_minor: cost, line_total_minor: qty * cost });
    if (error) { onNotice('Unable to add the part to this order.'); return; }
    const total = po.purchase_order_items.reduce((s, i) => s + i.line_total_minor, 0) + qty * cost;
    await supabase.from('purchase_orders').update({ total_minor: total }).eq('id', po.id);
    setPickPartId(''); setPickQty('1'); setPickCost('0');
    onNotice('Part added to order.'); void reload();
  }

  if (!po) return <Loading />;
  return <>
    <BackBar onBack={onBack} label="Procurement" />
    <div className="detail-header"><div className="detail-avatar po"><ShoppingCart size={24} /></div><div className="flex-1"><h2>{po.po_number}</h2><p className="muted">{po.suppliers?.name ?? 'Supplier'} · {formatDate(po.order_date)}</p></div><span className={`status ${statusStyles[po.status] ?? ''}`}>{po.status.replaceAll('_', ' ')}</span></div>
    <div className="action-buttons" style={{ marginBottom: 16 }}>
      <button className="button secondary small" onClick={() => setShowPrint(true)}><Printer size={15} /> Export PDF</button>
      {editable && <button className={`button ${editMode ? 'primary' : 'secondary'} small`} onClick={() => setEditMode((v) => !v)}><Edit size={15} /> {editMode ? 'Done editing' : 'Edit order'}</button>}
    </div>
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
        {editMode ? <>
          <input type="number" min={item.quantity_received || 1} value={editQty[item.id] ?? item.quantity_ordered} onChange={(e) => setEditQty((prev) => ({ ...prev, [item.id]: e.target.value }))} style={{ width: 70, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12, textAlign: 'right' }} />
          <input type="number" min="0" step="0.01" value={editCost[item.id] ?? (item.unit_cost_minor / 100)} onChange={(e) => setEditCost((prev) => ({ ...prev, [item.id]: e.target.value }))} style={{ width: 90, border: '1px solid #dfe5ea', borderRadius: 6, padding: '6px 8px', fontSize: 12, textAlign: 'right' }} />
          <button className="button secondary small" disabled={savingId === item.id} onClick={() => void saveItem(item)}>Save</button>
          <button className="close-button" style={{ width: 28, height: 28 }} onClick={() => void removeItem(item.id)}><X size={14} /></button>
        </> : <>
          <span className="table-muted">{formatKes(item.unit_cost_minor)} each</span>
          {can('inventory.receive') && item.quantity_received < item.quantity_ordered && <div className="receive-row"><input type="number" min="1" max={item.quantity_ordered - item.quantity_received} placeholder="Qty" value={receiveQty[item.id] ?? ''} onChange={(e) => setReceiveQty({ ...receiveQty, [item.id]: e.target.value })} disabled={receivingId === item.id} /><button className="button primary small" disabled={receivingId === item.id} onClick={() => void receiveGoods(item.id, item.unit_cost_minor)}>{receivingId === item.id ? 'Receiving...' : 'Receive'}</button></div>}
        </>}
      </div>)}</div>}
      {editMode && <div className="form-row" style={{ gridTemplateColumns: '1fr 80px 120px auto', alignItems: 'end', marginTop: 16 }}>
        <label>Part<select value={pickPartId} onChange={(e) => { const part = availableParts.find((x) => x.id === e.target.value); setPickPartId(e.target.value); if (part) setPickCost((part.cost_price_minor / 100).toString()); }}><option value="">Select part...</option>{availableParts.map((part) => <option key={part.id} value={part.id}>{part.name} ({part.sku})</option>)}</select></label>
        <label>Qty<input type="number" min="1" value={pickQty} onChange={(e) => setPickQty(e.target.value)} /></label>
        <label>Unit cost (KES)<input type="number" min="0" step="0.01" value={pickCost} onChange={(e) => setPickCost(e.target.value)} /></label>
        <button type="button" className="button secondary" disabled={!pickPartId} onClick={() => void addPart()}><Plus size={15} /> Add</button>
      </div>}
    </section>
    {showPrint && <POPrintView po={po} onClose={() => setShowPrint(false)} />}
  </>;
}

function POPrintView({ po, onClose }: { po: PODetailData; onClose: () => void }) {
  return <div className="print-overlay">
    <div className="print-toolbar no-print">
      <strong>{po.po_number}</strong>
      <div className="action-buttons">
        <button className="button primary small" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
        <button className="close-button" onClick={onClose}><X size={16} /></button>
      </div>
    </div>
    <div id="print-area" className="print-sheet">
      <div className="print-header">
        <div><img src="/logo.png" alt="Oakland Motor Care Ltd" /><h1>Oakland Motor Care Ltd.</h1><p className="muted">Purchase Order</p></div>
        <div style={{ textAlign: 'right' }}>
          <p className="print-field"><span>PO Number</span><strong>{po.po_number}</strong></p>
          <p className="print-field"><span>Order date</span><strong>{formatDate(po.order_date)}</strong></p>
          {po.expected_delivery && <p className="print-field"><span>Expected delivery</span><strong>{formatDate(po.expected_delivery)}</strong></p>}
        </div>
      </div>
      <div className="print-section">
        <h4>Supplier</h4>
        <p className="print-field"><strong>{po.suppliers?.name ?? '—'}</strong></p>
        {po.suppliers?.contact_person && <p className="print-field"><span>Contact</span><strong>{po.suppliers.contact_person}</strong></p>}
        {po.suppliers?.phone && <p className="print-field"><span>Phone</span><strong>{po.suppliers.phone}</strong></p>}
        {po.suppliers?.email && <p className="print-field"><span>Email</span><strong>{po.suppliers.email}</strong></p>}
      </div>
      <div className="print-section">
        <h4>Items</h4>
        <table className="print-table"><thead><tr><th>Part Name</th><th>Part Number</th><th>Qty</th><th>Unit Cost</th><th>Total</th></tr></thead>
          <tbody>{po.purchase_order_items.map((item) => <tr key={item.id}><td>{item.parts?.name ?? 'Part'}</td><td>{item.parts?.sku ?? '—'}</td><td>{item.quantity_ordered}</td><td>{formatKes(item.unit_cost_minor)}</td><td>{formatKes(item.line_total_minor)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="print-totals"><table><tbody><tr><td><strong>Total</strong></td><td><strong>{formatKes(po.total_minor)}</strong></td></tr></tbody></table></div>
    </div>
  </div>;
}

// === QUOTATIONS ===
function QuotationsSection({ onNew, onSelect, can }: { onNew: () => void; onSelect: (id: string) => void; can: (p: string) => boolean }) {
  const [quotes, setQuotes] = useState<(Quotation & { customers: { full_name: string } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { supabase.from('quotations').select('*, customers(full_name)').order('created_at', { ascending: false }).limit(100).then(({ data }) => { setQuotes((data ?? []) as (Quotation & { customers: { full_name: string } | null })[]); setLoading(false); }); }, []);
  return <SectionPanel eyebrow="Pricing" title="Quotations" onNew={can('quotation.create') ? onNew : undefined} newLabel="New quotation">
    {loading ? <Loading /> : quotes.length === 0 ? <Empty title="No quotations" text="Create a quotation from a work order." /> : <div className="data-table">{quotes.map((q) => <div className="table-row clickable" key={q.id} onClick={() => onSelect(q.id)}><div className="job-icon"><FileText size={17} /></div><div><strong>{q.quote_number}</strong><span>{q.customers?.full_name ?? 'Customer'}</span></div><span className="table-muted">{formatKes(q.total_minor)}</span><span className={`status ${statusStyles[q.status] ?? ''}`}>{q.status.replaceAll('_', ' ')}</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
  </SectionPanel>;
}

function QuotationDetail({ id, onBack, can, onNotice }: { id: string; onBack: () => void; can: (p: string) => boolean; onNotice: (m: string) => void }) {
  const [quote, setQuote] = useState<(Quotation & { customers: Customer | null; vehicles: Vehicle | null; quotation_items: QuotationItem[] }) | null>(null);
  useEffect(() => { supabase.from('quotations').select('*, customers(*), vehicles(*), quotation_items(*)').eq('id', id).maybeSingle().then(({ data }) => setQuote(data as (Quotation & { customers: Customer | null; vehicles: Vehicle | null; quotation_items: QuotationItem[] }) | null)); }, [id]);
  if (!quote) return <Loading />;

  async function approve() {
    if (!quote) return;
    const { error } = await supabase.from('quotations').update({ status: 'APPROVED', approved_by: (await supabase.auth.getUser()).data.user?.id, approved_at: new Date().toISOString() }).eq('id', id);
    onNotice(error ? 'Unable to approve.' : 'Quotation approved.'); reload();
  }
  async function reject() {
    if (!quote) return;
    const { error } = await supabase.from('quotations').update({ status: 'REJECTED' }).eq('id', id);
    onNotice(error ? 'Unable to reject.' : 'Quotation rejected.'); reload();
  }
  async function convertToInvoice() {
    if (!quote) return;
    const { data: invNumber, error: numError } = await supabase.rpc('generate_document_number', { p_doc_type: 'INV', p_prefix: 'INV', p_permission: 'invoice.create' });
    if (numError || !invNumber) { onNotice('Unable to generate an invoice number.'); return; }
    const { data: inv, error: invError } = await supabase.from('invoices').insert({ invoice_number: invNumber, customer_id: quote.customer_id, vehicle_id: quote.vehicle_id, job_card_id: quote.job_card_id, subtotal_minor: quote.subtotal_minor, discount_minor: quote.discount_minor, tax_minor: quote.tax_minor, total_minor: quote.total_minor, status: 'ISSUED' }).select().single();
    if (invError || !inv) { onNotice(quote.job_card_id ? 'This work order already has an invoice.' : 'Unable to create the invoice.'); return; }
    await supabase.from('quotation_items').select('*').eq('quotation_id', id).then(({ data: items }) => { if (items) for (const item of items as QuotationItem[]) void supabase.from('invoice_items').insert({ invoice_id: inv.id, item_type: item.item_type, description: item.description, quantity: item.quantity, unit_price_minor: item.unit_price_minor, tax_rate: item.tax_rate, line_total_minor: item.line_total_minor }); });
    await supabase.from('quotations').update({ status: 'CONVERTED', converted_invoice_id: inv.id }).eq('id', id);
    onNotice('Quotation converted to invoice.'); onBack();
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
function InvoicesSection({ query, onNew, onSelect, can }: { query: string; onNew: () => void; onSelect: (id: string) => void; can: (p: string) => boolean }) {
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
  return <SectionPanel eyebrow="Billing" title="Invoices" onNew={can('invoice.create') ? onNew : undefined} newLabel="New invoice">
    {loading ? <Loading /> : invoices.length === 0 ? <Empty title="No invoices" text="Create an invoice from a work order or quotation." /> : <div className="data-table">{invoices.map((inv) => <div className="table-row clickable" key={inv.id} onClick={() => onSelect(inv.id)}><div className="job-icon"><CircleDollarSign size={17} /></div><div><strong>{inv.invoice_number}</strong><span>{inv.customers?.full_name ?? 'Customer'}</span></div><span className="table-muted">{formatKes(inv.total_minor)}</span><span className="table-muted">{formatKes(inv.amount_paid_minor)} paid</span><span className={`status ${statusStyles[inv.status] ?? ''}`}>{inv.status.replaceAll('_', ' ')}</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
  </SectionPanel>;
}

function InvoiceDetail({ id, onBack, onPayment, can }: { id: string; onBack: () => void; onPayment: () => void; can: (p: string) => boolean }) {
  const [invoice, setInvoice] = useState<(Invoice & { customers: Customer | null; vehicles: Vehicle | null; invoice_items: InvoiceItem[]; payments: Payment[]; job_cards: { job_number: string } | null }) | null>(null);
  useEffect(() => { supabase.from('invoices').select('*, customers(*), vehicles(*), invoice_items(*), payments(*), job_cards(job_number)').eq('id', id).maybeSingle().then(({ data }) => setInvoice(data as (Invoice & { customers: Customer | null; vehicles: Vehicle | null; invoice_items: InvoiceItem[]; payments: Payment[]; job_cards: { job_number: string } | null }) | null)); }, [id]);
  if (!invoice) return <Loading />;
  const balance = invoice.total_minor - invoice.amount_paid_minor;
  return <>
    <BackBar onBack={onBack} label="Invoices" />
    <div className="detail-header"><div className="detail-avatar invoice"><CircleDollarSign size={24} /></div><div className="flex-1"><h2>{invoice.invoice_number}</h2><p className="muted">{invoice.customers?.full_name ?? 'Customer'} · Work Order {invoice.job_cards?.job_number ?? '—'} · Due {formatDate(invoice.due_date)}</p></div><span className={`status ${statusStyles[invoice.status] ?? ''}`}>{invoice.status.replaceAll('_', ' ')}</span></div>
    <div className="detail-info-grid">
      <div className="info-card"><CircleDollarSign size={16} /> <div><span>Total</span><strong>{formatKes(invoice.total_minor)}</strong></div></div>
      <div className="info-card"><CheckCircle2 size={16} /> <div><span>Paid</span><strong>{formatKes(invoice.amount_paid_minor)}</strong></div></div>
      <div className="info-card"><AlertTriangle size={16} /> <div><span>Balance</span><strong>{formatKes(balance)}</strong></div></div>
    </div>
    <div className="dashboard-grid" style={{ marginTop: 20 }}>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Line items</p><h3>Invoice items</h3></div></div>{invoice.invoice_items.length === 0 ? <Empty title="No items" text="This invoice has no items." /> : <div className="data-table">{invoice.invoice_items.map((item) => <div className="table-row" key={item.id}><div><strong>{item.description}</strong><span>{item.item_type} · {item.quantity} × {formatKes(item.unit_price_minor)}</span></div><span className="table-muted">{formatKes(item.line_total_minor)}</span></div>)}</div>}<div className="total-row"><strong>Grand total</strong><span>{formatKes(invoice.total_minor)}</span></div></section>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Reconciliation</p><h3>Payments</h3></div>{balance > 0 && can('payment.create') && <button className="button primary small" onClick={onPayment}><Plus size={15} /> Record payment</button>}</div>{invoice.payments.length === 0 ? <Empty title="No payments" text="Record a payment against this invoice." /> : <div className="data-table">{invoice.payments.map((p) => <div className="table-row" key={p.id}><div className="job-icon"><Banknote size={17} /></div><div><strong>{formatKes(p.amount_minor)}</strong><span>{p.method} · {formatDate(p.paid_at)}</span></div><span className="table-muted">{p.reference ?? '—'}</span></div>)}</div>}</section>
    </div>
  </>;
}

// === PAYMENTS ===
type PaymentWithDetail = Payment & { invoices: { invoice_number: string; customers: { full_name: string } | null; job_cards: { job_number: string } | null } | null };

function PaymentsSection({ onNotice }: { onNotice: (m: string) => void }) {
  const [payments, setPayments] = useState<PaymentWithDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PaymentWithDetail | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { supabase.from('payments').select('*, invoices(invoice_number, customers(full_name), job_cards(job_number))').order('paid_at', { ascending: false }).limit(100).then(({ data }) => { setPayments((data ?? []) as PaymentWithDetail[]); setLoading(false); }); }, []);

  async function exportCSV() {
    setExporting(true);
    const { data, error } = await supabase.from('payments').select('*, invoices(invoice_number, customers(full_name), job_cards(job_number))').order('paid_at', { ascending: false });
    setExporting(false);
    if (error) { onNotice('Unable to export payments. Please try again.'); return; }
    const rows = (data ?? []) as PaymentWithDetail[];
    if (rows.length === 0) { onNotice('There are no payments to export.'); return; }
    downloadCSV(`Oakland_Payments_${new Date().toISOString().slice(0, 10)}.csv`, rows.map((p) => ({
      'Date': formatDateTime(p.paid_at),
      'Amount (KES)': (p.amount_minor / 100).toFixed(2),
      'Method': p.method,
      'Reference': p.reference ?? '',
      'Customer': p.invoices?.customers?.full_name ?? '',
      'Invoice': p.invoices?.invoice_number ?? '',
      'Work Order': p.invoices?.job_cards?.job_number ?? '',
      'Notes': p.notes ?? '',
    })));
  }

  return <SectionPanel eyebrow="Transaction log" title="Payments" extra={<button className="button secondary small" disabled={exporting} onClick={() => void exportCSV()}><Download size={15} /> {exporting ? 'Exporting…' : 'Export CSV'}</button>}>
    {loading ? <Loading /> : payments.length === 0 ? <Empty title="No payments recorded" text="Payments will appear here once invoices are paid." /> : <div className="data-table">{payments.map((p) => <div className="table-row clickable" key={p.id} onClick={() => setSelected(p)}><div className="job-icon"><Banknote size={17} /></div><div><strong>{formatKes(p.amount_minor)}</strong><span>{p.invoices?.invoice_number ?? 'Invoice'} · Work Order {p.invoices?.job_cards?.job_number ?? '—'} · {p.method}</span></div><span className="table-muted">{formatDate(p.paid_at)}</span><span className="table-muted">{p.reference ?? '—'}</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
    {selected && <PaymentDetailModal payment={selected} onClose={() => setSelected(null)} />}
  </SectionPanel>;
}

function PaymentDetailModal({ payment, onClose }: { payment: PaymentWithDetail; onClose: () => void }) {
  return <Modal title={`Payment · ${formatKes(payment.amount_minor)}`} onClose={onClose}>
    <div className="detail-info-grid">
      <div className="info-card"><Banknote size={16} /><div><span>Amount</span><strong>{formatKes(payment.amount_minor)}</strong></div></div>
      <div className="info-card"><Smartphone size={16} /><div><span>Method</span><strong>{payment.method}</strong></div></div>
      <div className="info-card"><Calendar size={16} /><div><span>Paid at</span><strong>{formatDateTime(payment.paid_at)}</strong></div></div>
      <div className="info-card"><ScrollText size={16} /><div><span>Reference</span><strong>{payment.reference ?? '—'}</strong></div></div>
    </div>
    <div className="detail-info-grid" style={{ marginTop: 16 }}>
      <div className="info-card"><Users size={16} /><div><span>Customer</span><strong>{payment.invoices?.customers?.full_name ?? '—'}</strong></div></div>
      <div className="info-card"><CircleDollarSign size={16} /><div><span>Invoice</span><strong>{payment.invoices?.invoice_number ?? '—'}</strong></div></div>
      <div className="info-card"><ClipboardList size={16} /><div><span>Work order</span><strong>{payment.invoices?.job_cards?.job_number ?? '—'}</strong></div></div>
    </div>
    {payment.notes && <div className="info-card" style={{ marginTop: 16 }}><FileText size={16} /><div><span>Notes</span><strong>{payment.notes}</strong></div></div>}
  </Modal>;
}

type ReceiptPayment = Payment & { invoices: { invoice_number: string; total_minor: number; amount_paid_minor: number; customers: { full_name: string } | null; job_cards: { job_number: string } | null } | null };

function ReceiptsSection({ onNotice, can }: { onNotice: (m: string) => void; can: (p: string) => boolean }) {
  const [payments, setPayments] = useState<ReceiptPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReceiptPayment | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { supabase.from('payments').select('*, invoices(invoice_number, total_minor, amount_paid_minor, customers(full_name), job_cards(job_number))').order('paid_at', { ascending: false }).limit(50).then(({ data }) => { setPayments((data ?? []) as ReceiptPayment[]); setLoading(false); }); }, []);

  const [generalReceipts, setGeneralReceipts] = useState<GeneralReceipt[]>([]);
  const [generalLoading, setGeneralLoading] = useState(true);
  const [generalRefreshKey, setGeneralRefreshKey] = useState(0);
  const [showGeneralForm, setShowGeneralForm] = useState(false);
  const [selectedGeneral, setSelectedGeneral] = useState<GeneralReceipt | null>(null);
  useEffect(() => { supabase.from('general_receipts').select('*').order('receipt_date', { ascending: false }).limit(50).then(({ data }) => { setGeneralReceipts((data ?? []) as GeneralReceipt[]); setGeneralLoading(false); }); }, [generalRefreshKey]);

  async function exportCSV() {
    setExporting(true);
    const { data, error } = await supabase.from('payments').select('*, invoices(invoice_number, total_minor, amount_paid_minor, customers(full_name), job_cards(job_number))').order('paid_at', { ascending: false });
    setExporting(false);
    if (error) { onNotice('Unable to export receipts. Please try again.'); return; }
    const rows = (data ?? []) as ReceiptPayment[];
    if (rows.length === 0) { onNotice('There are no receipts to export.'); return; }
    downloadCSV(`Oakland_Receipts_${new Date().toISOString().slice(0, 10)}.csv`, rows.map((p) => ({
      'Receipt No': `RCP-${p.id.slice(-6).toUpperCase()}`,
      'Date': formatDateTime(p.paid_at),
      'Customer': p.invoices?.customers?.full_name ?? '',
      'Invoice': p.invoices?.invoice_number ?? '',
      'Work Order': p.invoices?.job_cards?.job_number ?? '',
      'Amount (KES)': (p.amount_minor / 100).toFixed(2),
      'Method': p.method,
      'Reference': p.reference ?? '',
      'Notes': p.notes ?? '',
    })));
  }

  return <>
    <SectionPanel eyebrow="Proof of payment" title="Receipts" extra={<button className="button secondary small" disabled={exporting} onClick={() => void exportCSV()}><Download size={15} /> {exporting ? 'Exporting…' : 'Export CSV'}</button>}>
      {loading ? <Loading /> : payments.length === 0 ? <Empty title="No receipts" text="Receipts are generated when payments are recorded." /> : <div className="data-table">{payments.map((p) => <div className="table-row clickable" key={p.id} onClick={() => setSelected(p)}><div className="job-icon"><Receipt size={17} /></div><div><strong>RCP-{p.id.slice(-6).toUpperCase()}</strong><span>{p.invoices?.customers?.full_name ?? 'Customer'} · {p.invoices?.invoice_number ?? 'Invoice'} · Work Order {p.invoices?.job_cards?.job_number ?? '—'}</span></div><span className="table-muted">{formatKes(p.amount_minor)}</span><span className="status bg-emerald-50 text-emerald-700">{p.method}</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
    </SectionPanel>

    <section className="panel table-panel" style={{ marginTop: 24 }}>
      <div className="panel-heading">
        <div><p className="eyebrow">Not tied to a vehicle or work order</p><h3>General Receipts</h3></div>
        {can('payment.create') && <button className="button primary small" onClick={() => setShowGeneralForm(true)}><Plus size={16} /> Create Receipt</button>}
      </div>
      {generalLoading ? <Loading /> : generalReceipts.length === 0 ? <Empty title="No general receipts" text="Create a receipt for work that isn't tied to a vehicle, e.g. welding a door for a company." /> : <div className="data-table">{generalReceipts.map((r) => <div className="table-row clickable" key={r.id} onClick={() => setSelectedGeneral(r)}><div className="job-icon"><Receipt size={17} /></div><div><strong>{r.receipt_number}</strong><span>{r.client_name}</span></div><span className="table-muted">{formatDate(r.receipt_date)}</span><span className="table-muted">{formatKes(r.total_minor)}</span><span className="status bg-emerald-50 text-emerald-700">{r.payment_method}</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>}
    </section>

    {selected && <PaymentDetailModal payment={selected} onClose={() => setSelected(null)} />}
    {showGeneralForm && <GeneralReceiptForm onClose={() => setShowGeneralForm(false)} onSaved={(m, r) => { onNotice(m); setGeneralRefreshKey((k) => k + 1); setShowGeneralForm(false); setSelectedGeneral(r); }} />}
    {selectedGeneral && <GeneralReceiptPrintView receipt={selectedGeneral} onClose={() => setSelectedGeneral(null)} onNotice={onNotice} />}
  </>;
}

type DraftReceiptItem = { id: number; description: string; quantity: number; unitPriceMinor: number };

function GeneralReceiptForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string, receipt: GeneralReceipt) => void }) {
  const [date, setDate] = useState(localDateStr());
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>(PAYMENT_METHODS[0]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [items, setItems] = useState<DraftReceiptItem[]>([]);
  const [nextItemId, setNextItemId] = useState(1);
  const [itemDesc, setItemDesc] = useState('');
  const [itemQty, setItemQty] = useState('1');
  const [itemPrice, setItemPrice] = useState('');

  function addItem() {
    const quantity = Math.max(0.01, parseFloat(itemQty) || 1);
    const unitPriceMinor = Math.round((parseFloat(itemPrice) || 0) * 100);
    if (!itemDesc.trim() || unitPriceMinor <= 0) return;
    setItems((prev) => [...prev, { id: nextItemId, description: itemDesc.trim(), quantity, unitPriceMinor }]);
    setNextItemId((n) => n + 1);
    setItemDesc(''); setItemQty('1'); setItemPrice('');
  }
  function removeItem(id: number) { setItems((prev) => prev.filter((i) => i.id !== id)); }

  const total = items.reduce((s, i) => s + Math.round(i.quantity * i.unitPriceMinor), 0);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (items.length === 0) { setError('Add at least one service.'); return; }
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('create_general_receipt', {
      p_date: date, p_client_name: clientName.trim(), p_client_phone: clientPhone.trim() || null,
      p_payment_method: paymentMethod, p_notes: notes.trim() || null,
      p_items: items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price_minor: i.unitPriceMinor })),
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message || 'Unable to create the receipt.'); return; }
    const receipt = data as GeneralReceipt;
    onSaved(`Receipt ${receipt.receipt_number} created.`, receipt);
  }

  return <Modal title="Create Receipt" onClose={onClose}>
    <form onSubmit={submit} className="modal-form">
      <p className="muted" style={{ margin: '-8px 0 0' }}>For work that isn&apos;t tied to a vehicle — e.g. welding a door for a company.</p>
      <label>Date<input type="date" value={date} max={localDateStr()} onChange={(e) => setDate(e.target.value)} required /></label>
      <div className="form-row">
        <label>Client name<input value={clientName} onChange={(e) => setClientName(e.target.value)} required placeholder="e.g. Aokland Garage" /></label>
        <label>Phone <span className="optional">Optional</span><input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} /></label>
      </div>

      <div className="form-row" style={{ gridTemplateColumns: '1fr 70px 110px auto', alignItems: 'end' }}>
        <label>Service / item<input value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} placeholder="e.g. Welding of a door" /></label>
        <label>Qty<input type="number" min={0.01} step="0.01" value={itemQty} onChange={(e) => setItemQty(e.target.value)} /></label>
        <label>Unit price (KES)<input type="number" min={0} step="0.01" value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} /></label>
        <button type="button" className="button secondary" disabled={!itemDesc.trim() || !(parseFloat(itemPrice) > 0)} onClick={addItem}><Plus size={15} /> Add</button>
      </div>

      {items.length > 0 && <div className="report-table-wrap">
        <table className="report-table">
          <thead><tr><th>#</th><th>Description</th><th className="numeric">Qty</th><th className="numeric">Unit Price</th><th className="numeric">Amount</th><th></th></tr></thead>
          <tbody>{items.map((i, idx) => <tr key={i.id}>
            <td>{idx + 1}</td>
            <td>{i.description}</td>
            <td className="numeric">{i.quantity}</td>
            <td className="numeric">{formatKes(i.unitPriceMinor)}</td>
            <td className="numeric">{formatKes(Math.round(i.quantity * i.unitPriceMinor))}</td>
            <td className="numeric"><button type="button" className="close-button" style={{ width: 28, height: 28 }} onClick={() => removeItem(i.id)}><X size={14} /></button></td>
          </tr>)}</tbody>
        </table>
      </div>}
      {items.length > 0 && <div className="total-row"><strong>Total</strong><span>{formatKes(total)}</span></div>}

      <label>Payment method<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
      <label>Notes <span className="optional">Optional</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="button primary wide" disabled={busy || items.length === 0}>{busy ? 'Creating...' : 'Create receipt'} <ArrowUpRight size={16} /></button>
    </form>
  </Modal>;
}

function GeneralReceiptPrintView({ receipt, onClose, onNotice }: { receipt: GeneralReceipt; onClose: () => void; onNotice: (m: string) => void }) {
  const [items, setItems] = useState<GeneralReceiptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { supabase.from('general_receipt_items').select('*').eq('general_receipt_id', receipt.id).order('created_at').then(({ data }) => { setItems((data ?? []) as GeneralReceiptItem[]); setLoading(false); }); }, [receipt.id]);

  const blankRows = Math.max(0, 5 - items.length);

  async function exportImage() {
    const original = document.getElementById('print-area');
    if (!original) return;
    setExporting(true);
    const clone = original.cloneNode(true) as HTMLElement;
    const wrapper = document.createElement('div');
    wrapper.style.position = 'absolute'; wrapper.style.top = '0'; wrapper.style.left = '-99999px';
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    try {
      await document.fonts?.ready;
      const dataUrl = await toPng(clone, { pixelRatio: 2, width: clone.scrollWidth, height: clone.scrollHeight, backgroundColor: '#ffffff', cacheBust: true });
      const link = document.createElement('a');
      link.download = `${receipt.receipt_number}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      onNotice('Unable to export the receipt as an image. Please try again.');
    } finally {
      document.body.removeChild(wrapper);
    }
    setExporting(false);
  }

  return <div className="print-overlay">
    <div className="print-toolbar no-print">
      <strong>{receipt.receipt_number}</strong>
      <div className="action-buttons">
        <button className="button primary small" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
        <button className="button secondary small" disabled={exporting} onClick={() => void exportImage()}><Download size={15} /> {exporting ? 'Exporting…' : 'Export as image'}</button>
        <button className="close-button" onClick={onClose}><X size={18} /></button>
      </div>
    </div>
    <div id="print-area" className="print-sheet">
      <div className="print-header">
        <div><img src="/logo.png" alt="Oakland Motor Care Ltd" /><h1>Oakland Motor Care Ltd.</h1><p className="muted">Receipt</p></div>
        <div style={{ textAlign: 'right' }}>
          <p className="print-field"><span>Receipt No</span><strong style={{ fontSize: 18 }}>{receipt.receipt_number}</strong></p>
          <p className="print-field"><span>Date</span><strong>{formatDate(receipt.receipt_date)}</strong></p>
        </div>
      </div>
      <div className="print-section">
        <h4>Received from</h4>
        <p className="print-field"><strong style={{ fontSize: 16 }}>{receipt.client_name}</strong></p>
        {receipt.client_phone && <p className="print-field"><span>Phone</span><strong>{receipt.client_phone}</strong></p>}
      </div>
      <div className="print-section">
        <h4>For</h4>
        {loading ? <p className="muted">Loading…</p> : <table className="print-table">
          <thead><tr><th style={{ width: '8%' }}>#</th><th style={{ width: '42%' }}>Description</th><th style={{ width: '15%' }}>Qty</th><th style={{ width: '17%' }}>Unit Price</th><th style={{ width: '18%' }}>Amount</th></tr></thead>
          <tbody>
            {items.map((i, idx) => <tr key={i.id}><td>{idx + 1}</td><td>{i.description}</td><td>{i.quantity}</td><td>{formatKes(i.unit_price_minor)}</td><td>{formatKes(i.line_total_minor)}</td></tr>)}
            {Array.from({ length: blankRows }).map((_, idx) => <tr key={`blank-${idx}`}><td>{items.length + idx + 1}</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>)}
          </tbody>
        </table>}
        <div className="print-totals"><table><tbody><tr><td><strong>Total received</strong></td><td><strong>{formatKes(receipt.total_minor)}</strong></td></tr></tbody></table></div>
      </div>
      <div className="print-section">
        <p className="print-field"><span>Payment method</span><strong>{receipt.payment_method}</strong></p>
        {receipt.notes && <p className="print-field"><span>Notes</span><strong>{receipt.notes}</strong></p>}
      </div>
      <div className="signature-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        <div className="signature-box">Received by<span>Signature</span></div>
        <div className="signature-box">Customer<span>Signature</span></div>
      </div>
    </div>
  </div>;
}

// === REPORTS ===
type ReportRow = Record<string, unknown>;
type ReportColumn = { key: string; label: string; numeric?: boolean; render: (row: ReportRow) => React.ReactNode; csv: (row: ReportRow) => string | number };
type ReportKpi = { label: string; value: string; icon: React.ReactNode; tone: string };

// KPI cards sum whatever rows were fetched, not a true unlimited aggregate — this cap was
// previously 100, silently excluding older records from "Total invoiced" etc. on a report
// spanning more than 100 rows. Raised generously; a truncation notice covers the rest.
const REPORT_ROW_LIMIT = 2000;

const REPORT_TYPES = [
  { id: 'operations', label: 'Operations', icon: <ClipboardList size={16} /> },
  { id: 'financial', label: 'Financial', icon: <CircleDollarSign size={16} /> },
  { id: 'sales', label: 'Sales', icon: <Receipt size={16} /> },
  { id: 'inventory', label: 'Inventory', icon: <Package size={16} /> },
  { id: 'procurement', label: 'Procurement', icon: <ShoppingCart size={16} /> },
  { id: 'technician', label: 'Technician', icon: <UserCog size={16} /> },
  { id: 'scrap', label: 'Scrap', icon: <Recycle size={16} /> },
];

function reportStatusPill(status: unknown) {
  const s = String(status ?? '');
  return <span className={`status ${statusStyles[s] ?? ''}`}>{s.replaceAll('_', ' ')}</span>;
}

const REPORT_COLUMNS: Record<string, ReportColumn[]> = {
  operations: [
    { key: 'job_number', label: 'Work Order', render: (r) => String(r.job_number ?? '—'), csv: (r) => String(r.job_number ?? '') },
    { key: 'created_at', label: 'Date', render: (r) => formatDate(r.created_at as string), csv: (r) => String(r.created_at ?? '') },
    { key: 'customer', label: 'Customer', render: (r) => (r.customers as { full_name: string } | null)?.full_name ?? '—', csv: (r) => (r.customers as { full_name: string } | null)?.full_name ?? '' },
    { key: 'vehicle', label: 'Vehicle', render: (r) => (r.vehicles as { registration_number: string } | null)?.registration_number ?? '—', csv: (r) => (r.vehicles as { registration_number: string } | null)?.registration_number ?? '' },
    { key: 'status', label: 'Status', render: (r) => reportStatusPill(r.status), csv: (r) => String(r.status ?? '') },
  ],
  financial: [
    { key: 'invoice_number', label: 'Invoice', render: (r) => String(r.invoice_number ?? '—'), csv: (r) => String(r.invoice_number ?? '') },
    { key: 'job_number', label: 'Work Order', render: (r) => (r.job_cards as { job_number: string } | null)?.job_number ?? '—', csv: (r) => (r.job_cards as { job_number: string } | null)?.job_number ?? '' },
    { key: 'created_at', label: 'Date', render: (r) => formatDate(r.created_at as string), csv: (r) => String(r.created_at ?? '') },
    { key: 'customer', label: 'Customer', render: (r) => (r.customers as { full_name: string } | null)?.full_name ?? '—', csv: (r) => (r.customers as { full_name: string } | null)?.full_name ?? '' },
    { key: 'total_minor', label: 'Total', numeric: true, render: (r) => formatKes(r.total_minor as number), csv: (r) => (((r.total_minor as number) ?? 0) / 100).toFixed(2) },
    { key: 'amount_paid_minor', label: 'Paid', numeric: true, render: (r) => formatKes(r.amount_paid_minor as number), csv: (r) => (((r.amount_paid_minor as number) ?? 0) / 100).toFixed(2) },
    { key: 'balance', label: 'Balance', numeric: true, render: (r) => formatKes((r.total_minor as number) - (r.amount_paid_minor as number)), csv: (r) => (((r.total_minor as number) - (r.amount_paid_minor as number)) / 100).toFixed(2) },
    { key: 'status', label: 'Status', render: (r) => reportStatusPill(r.status), csv: (r) => String(r.status ?? '') },
  ],
  sales: [
    { key: 'sale_number', label: 'Sale Number', render: (r) => String(r.sale_number ?? '—'), csv: (r) => String(r.sale_number ?? '') },
    { key: 'sale_date', label: 'Date', render: (r) => formatDate(r.sale_date as string), csv: (r) => String(r.sale_date ?? '') },
    { key: 'customer_name', label: 'Customer', render: (r) => String(r.customer_name ?? 'Walk-in'), csv: (r) => String(r.customer_name ?? '') },
    { key: 'salesperson_name', label: 'Salesperson', render: (r) => String(r.salesperson_name ?? '—'), csv: (r) => String(r.salesperson_name ?? '') },
    { key: 'payment_method', label: 'Payment Method', render: (r) => String(r.payment_method ?? '—'), csv: (r) => String(r.payment_method ?? '') },
    { key: 'total_minor', label: 'Total', numeric: true, render: (r) => formatKes(r.total_minor as number), csv: (r) => (((r.total_minor as number) ?? 0) / 100).toFixed(2) },
    { key: 'amount_paid_minor', label: 'Paid', numeric: true, render: (r) => formatKes(r.amount_paid_minor as number), csv: (r) => (((r.amount_paid_minor as number) ?? 0) / 100).toFixed(2) },
    { key: 'balance_minor', label: 'Balance', numeric: true, render: (r) => formatKes(r.balance_minor as number), csv: (r) => (((r.balance_minor as number) ?? 0) / 100).toFixed(2) },
    { key: 'status', label: 'Status', render: (r) => reportStatusPill(r.status), csv: (r) => String(r.status ?? '') },
  ],
  inventory: [
    { key: 'sku', label: 'SKU', render: (r) => String(r.sku ?? '—'), csv: (r) => String(r.sku ?? '') },
    { key: 'name', label: 'Part', render: (r) => String(r.name ?? '—'), csv: (r) => String(r.name ?? '') },
    { key: 'category', label: 'Category', render: (r) => String(r.category ?? '—'), csv: (r) => String(r.category ?? '') },
    { key: 'quantity_on_hand', label: 'In Stock', numeric: true, render: (r) => String(r.quantity_on_hand ?? 0), csv: (r) => Number(r.quantity_on_hand ?? 0) },
    { key: 'reorder_level', label: 'Reorder Level', numeric: true, render: (r) => String(r.reorder_level ?? 0), csv: (r) => Number(r.reorder_level ?? 0) },
    { key: 'selling_price_minor', label: 'Selling Price', numeric: true, render: (r) => formatKes(r.selling_price_minor as number), csv: (r) => (((r.selling_price_minor as number) ?? 0) / 100).toFixed(2) },
    { key: 'stock_value', label: 'Stock Value', numeric: true, render: (r) => formatKes((r.cost_price_minor as number) * (r.quantity_on_hand as number)), csv: (r) => (((r.cost_price_minor as number) * (r.quantity_on_hand as number)) / 100).toFixed(2) },
  ],
  procurement: [
    { key: 'po_number', label: 'PO Number', render: (r) => String(r.po_number ?? '—'), csv: (r) => String(r.po_number ?? '') },
    { key: 'supplier', label: 'Supplier', render: (r) => (r.suppliers as { name: string } | null)?.name ?? '—', csv: (r) => (r.suppliers as { name: string } | null)?.name ?? '' },
    { key: 'order_date', label: 'Order Date', render: (r) => formatDate(r.order_date as string), csv: (r) => String(r.order_date ?? '') },
    { key: 'total_minor', label: 'Total', numeric: true, render: (r) => formatKes(r.total_minor as number), csv: (r) => (((r.total_minor as number) ?? 0) / 100).toFixed(2) },
    { key: 'status', label: 'Status', render: (r) => reportStatusPill(r.status), csv: (r) => String(r.status ?? '') },
  ],
  technician: [
    { key: 'full_name', label: 'Technician', render: (r) => String(r.full_name ?? '—'), csv: (r) => String(r.full_name ?? '') },
    { key: 'specialization', label: 'Specialization', render: (r) => String(r.specialization ?? 'General mechanic'), csv: (r) => String(r.specialization ?? '') },
    { key: 'phone', label: 'Phone', render: (r) => String(r.phone ?? '—'), csv: (r) => String(r.phone ?? '') },
    { key: 'active_jobs', label: 'Active Jobs', numeric: true, render: (r) => String(r.active_jobs ?? 0), csv: (r) => Number(r.active_jobs ?? 0) },
  ],
  scrap: [
    { key: 'date', label: 'Date', render: (r) => formatDate(r.date as string), csv: (r) => String(r.date ?? '') },
    { key: 'scrap_item', label: 'Scrap Type', render: (r) => (r.scrap_items as { name: string } | null)?.name ?? '—', csv: (r) => (r.scrap_items as { name: string } | null)?.name ?? '' },
    { key: 'supplier', label: 'Supplier', render: (r) => String(r.supplier ?? '—'), csv: (r) => String(r.supplier ?? '') },
    { key: 'quantity_purchased', label: 'Weight', numeric: true, render: (r) => formatKg(r.quantity_purchased as number), csv: (r) => Number(r.quantity_purchased ?? 0) },
    { key: 'rate_used_minor', label: 'Rate / KG', numeric: true, render: (r) => formatKes(r.rate_used_minor as number), csv: (r) => (((r.rate_used_minor as number) ?? 0) / 100).toFixed(2) },
    { key: 'purchase_amount_minor', label: 'Amount', numeric: true, render: (r) => formatKes(r.purchase_amount_minor as number), csv: (r) => (((r.purchase_amount_minor as number) ?? 0) / 100).toFixed(2) },
    { key: 'status', label: 'Status', render: (r) => reportStatusPill(r.status), csv: (r) => String(r.status ?? '') },
  ],
};

function computeReportKpis(type: string, rows: ReportRow[]): ReportKpi[] {
  if (type === 'operations') {
    const completed = rows.filter((r) => r.status === 'COMPLETED').length;
    const inProgress = rows.filter((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS').length;
    const cancelled = rows.filter((r) => r.status === 'CANCELLED').length;
    return [
      { label: 'Total work orders', value: String(rows.length), icon: <ClipboardList size={17} />, tone: 'navy' },
      { label: 'Completed', value: String(completed), icon: <CheckCircle2 size={17} />, tone: 'green' },
      { label: 'In progress', value: String(inProgress), icon: <Activity size={17} />, tone: 'blue' },
      { label: 'Cancelled', value: String(cancelled), icon: <X size={17} />, tone: 'gold' },
    ];
  }
  if (type === 'financial') {
    const totalInvoiced = rows.reduce((s, r) => s + ((r.total_minor as number) ?? 0), 0);
    const totalPaid = rows.reduce((s, r) => s + ((r.amount_paid_minor as number) ?? 0), 0);
    const overdue = rows.filter((r) => r.status === 'OVERDUE').length;
    return [
      { label: 'Total invoiced', value: formatKes(totalInvoiced), icon: <CircleDollarSign size={17} />, tone: 'navy' },
      { label: 'Total collected', value: formatKes(totalPaid), icon: <CheckCircle2 size={17} />, tone: 'green' },
      { label: 'Outstanding', value: formatKes(totalInvoiced - totalPaid), icon: <AlertTriangle size={17} />, tone: 'gold' },
      { label: 'Overdue invoices', value: String(overdue), icon: <Clock size={17} />, tone: 'red' },
    ];
  }
  if (type === 'sales') {
    const active = rows.filter((r) => r.status !== 'VOIDED');
    const totalRevenue = active.reduce((s, r) => s + ((r.total_minor as number) ?? 0), 0);
    const totalCollected = active.reduce((s, r) => s + ((r.amount_paid_minor as number) ?? 0), 0);
    const voided = rows.filter((r) => r.status === 'VOIDED').length;
    return [
      { label: 'Total sales', value: String(active.length), icon: <Receipt size={17} />, tone: 'navy' },
      { label: 'Total revenue', value: formatKes(totalRevenue), icon: <CircleDollarSign size={17} />, tone: 'green' },
      { label: 'Outstanding', value: formatKes(totalRevenue - totalCollected), icon: <AlertTriangle size={17} />, tone: 'gold' },
      { label: 'Voided', value: String(voided), icon: <X size={17} />, tone: 'red' },
    ];
  }
  if (type === 'inventory') {
    const low = rows.filter((r) => (r.quantity_on_hand as number) > 0 && (r.quantity_on_hand as number) <= (r.reorder_level as number)).length;
    const out = rows.filter((r) => (r.quantity_on_hand as number) === 0).length;
    const stockValue = rows.reduce((s, r) => s + ((r.cost_price_minor as number) ?? 0) * ((r.quantity_on_hand as number) ?? 0), 0);
    return [
      { label: 'Total parts', value: String(rows.length), icon: <Package size={17} />, tone: 'navy' },
      { label: 'Low stock', value: String(low), icon: <AlertTriangle size={17} />, tone: 'gold' },
      { label: 'Out of stock', value: String(out), icon: <X size={17} />, tone: 'red' },
      { label: 'Stock value', value: formatKes(stockValue), icon: <Boxes size={17} />, tone: 'blue' },
    ];
  }
  if (type === 'procurement') {
    const pending = rows.filter((r) => ['DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(r.status as string)).length;
    const spend = rows.reduce((s, r) => s + ((r.total_minor as number) ?? 0), 0);
    return [
      { label: 'Total purchase orders', value: String(rows.length), icon: <ShoppingCart size={17} />, tone: 'navy' },
      { label: 'Pending', value: String(pending), icon: <Clock size={17} />, tone: 'gold' },
      { label: 'Total spend', value: formatKes(spend), icon: <CircleDollarSign size={17} />, tone: 'blue' },
    ];
  }
  if (type === 'technician') {
    const activeJobsTotal = rows.reduce((s, r) => s + ((r.active_jobs as number) ?? 0), 0);
    return [
      { label: 'Active technicians', value: String(rows.length), icon: <UserCog size={17} />, tone: 'navy' },
      { label: 'Jobs in progress', value: String(activeJobsTotal), icon: <Wrench size={17} />, tone: 'blue' },
    ];
  }
  const totalWeight = rows.reduce((s, r) => s + ((r.quantity_purchased as number) ?? 0), 0);
  const totalValue = rows.reduce((s, r) => s + ((r.purchase_amount_minor as number) ?? 0), 0);
  const avgRate = totalWeight > 0 ? Math.round(totalValue / totalWeight) : 0;
  return [
    { label: 'Total purchases', value: String(rows.length), icon: <Recycle size={17} />, tone: 'navy' },
    { label: 'Total weight', value: formatKg(totalWeight), icon: <Boxes size={17} />, tone: 'blue' },
    { label: 'Total value', value: formatKes(totalValue), icon: <CircleDollarSign size={17} />, tone: 'green' },
    { label: 'Avg rate / KG', value: formatKes(avgRate), icon: <TrendingUp size={17} />, tone: 'gold' },
  ];
}

function ReportsSection() {
  const [reportType, setReportType] = useState('operations');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      let result: ReportRow[] = [];
      if (reportType === 'operations') {
        const { data } = await supabase.from('job_cards').select('job_number,status,created_at,customers(full_name),vehicles(registration_number)').is('deleted_at', null).order('created_at', { ascending: false }).limit(REPORT_ROW_LIMIT);
        result = (data ?? []) as ReportRow[];
      } else if (reportType === 'financial') {
        const { data } = await supabase.from('invoices').select('invoice_number,status,created_at,total_minor,amount_paid_minor,customers(full_name),job_cards(job_number)').order('created_at', { ascending: false }).limit(REPORT_ROW_LIMIT);
        result = (data ?? []) as ReportRow[];
      } else if (reportType === 'sales') {
        const { data } = await supabase.from('sales').select('sale_number,sale_date,customer_name,salesperson_name,payment_method,total_minor,amount_paid_minor,balance_minor,status').order('sale_date', { ascending: false }).limit(REPORT_ROW_LIMIT);
        result = (data ?? []) as ReportRow[];
      } else if (reportType === 'inventory') {
        const { data } = await supabase.from('parts').select('sku,name,category,quantity_on_hand,reorder_level,cost_price_minor,selling_price_minor').eq('active', true).order('name');
        result = (data ?? []) as ReportRow[];
      } else if (reportType === 'procurement') {
        const { data } = await supabase.from('purchase_orders').select('po_number,status,order_date,total_minor,suppliers(name)').order('created_at', { ascending: false }).limit(REPORT_ROW_LIMIT);
        result = (data ?? []) as ReportRow[];
      } else if (reportType === 'technician') {
        const { data: emps } = await supabase.from('employees').select('full_name,specialization,phone,user_id').eq('active', true).order('full_name');
        const empList = (emps ?? []) as ReportRow[];
        for (const emp of empList) {
          const fullName = emp.full_name as string;
          emp.active_jobs = (await supabase.from('job_card_signoffs').select('job_card_id, job_cards!inner(status)', { count: 'exact', head: true }).eq('role', 'TECHNICIAN').eq('name', fullName).not('job_cards.status', 'in', '(COMPLETED,CANCELLED)')).count ?? 0;
        }
        result = empList;
      } else if (reportType === 'scrap') {
        const { data } = await supabase.from('scrap_purchases').select('date,supplier,quantity_purchased,rate_used_minor,purchase_amount_minor,status,scrap_items(name)').eq('status', 'ACTIVE').order('date', { ascending: false }).limit(REPORT_ROW_LIMIT);
        result = (data ?? []) as ReportRow[];
      }
      setRows(result); setLoading(false);
    })();
  }, [reportType]);

  const kpis = useMemo(() => computeReportKpis(reportType, rows), [reportType, rows]);
  const columns = REPORT_COLUMNS[reportType];

  function exportCSV() {
    downloadCSV(`Oakland_${reportType}_report_${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const col of columns) out[col.label] = col.csv(r);
      return out;
    }));
  }

  return <>
    <div className="page-heading"><div><p className="eyebrow">Business intelligence</p><h1>Reports</h1><p className="muted">Export and analyze your workshop data.</p></div><div className="heading-actions"><button className="button secondary" onClick={exportCSV}><Download size={16} /> Export CSV</button></div></div>
    <div className="report-tabs">{REPORT_TYPES.map((t) => <button key={t.id} className={reportType === t.id ? 'report-tab active' : 'report-tab'} onClick={() => setReportType(t.id)}>{t.icon} {t.label}</button>)}</div>
    {!loading && rows.length > 0 && <div className="kpi-row">{kpis.map((k) => <div className="metric-card" key={k.label}><div className={`metric-icon ${k.tone}`}>{k.icon}</div><div className="metric-copy"><span>{k.label}</span><strong>{k.value}</strong></div></div>)}</div>}
    {!loading && rows.length === REPORT_ROW_LIMIT && <div className="form-error" style={{ marginBottom: 16 }}>Showing the most recent {REPORT_ROW_LIMIT.toLocaleString()} records — there may be more, and the totals above only cover the records shown here.</div>}
    <section className="panel table-panel">
      {loading ? <Loading /> : rows.length === 0 ? <Empty title="No data" text="No records for this report." /> : <div className="report-table-wrap"><table className="report-table"><thead><tr>{columns.map((c) => <th key={c.key} className={c.numeric ? 'numeric' : ''}>{c.label}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{columns.map((c) => <td key={c.key} className={c.numeric ? 'numeric' : ''}>{c.render(row)}</td>)}</tr>)}</tbody></table></div>}
    </section>
  </>;
}

// === NOTIFICATIONS ===
type OverdueInvoiceRow = Invoice & { customers: { full_name: string } | null };

function NotificationsSection({ onRefresh, can, onSelectInvoice }: { onRefresh: () => void; can: (p: string) => boolean; onSelectInvoice: (id: string) => void }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [overdueInvoices, setOverdueInvoices] = useState<OverdueInvoiceRow[]>([]);
  const [overdueLoading, setOverdueLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) { const { data } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50); setNotifications((data ?? []) as Notification[]); }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!can('invoice.view')) { setOverdueLoading(false); return; }
    supabase.from('invoices').select('*, customers(full_name)').lt('due_date', localDateStr()).not('status', 'in', '(PAID,VOID)').order('due_date').limit(100).then(({ data }) => {
      const rows = ((data ?? []) as OverdueInvoiceRow[]).filter((inv) => inv.amount_paid_minor < inv.total_minor);
      setOverdueInvoices(rows); setOverdueLoading(false);
    });
  }, [can]);

  async function markRead(id: string) {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    onRefresh();
  }

  return <>
    {can('invoice.view') && !overdueLoading && overdueInvoices.length > 0 && <section className="panel table-panel" style={{ marginBottom: 24 }}>
      <div className="panel-heading"><div><p className="eyebrow">Not stored — computed live</p><h3>Overdue Invoices ({overdueInvoices.length})</h3></div></div>
      <div className="data-table">{overdueInvoices.map((inv) => <div className="table-row clickable" key={inv.id} onClick={() => onSelectInvoice(inv.id)}><div className="job-icon"><AlertTriangle size={17} /></div><div><strong>{inv.invoice_number}</strong><span>{inv.customers?.full_name ?? 'Customer'} · Due {formatDate(inv.due_date)}</span></div><span className="table-muted">{formatKes(inv.total_minor - inv.amount_paid_minor)} outstanding</span><span className="status bg-red-50 text-red-700">OVERDUE</span><ChevronRight size={17} className="row-arrow" /></div>)}</div>
    </section>}
    <SectionPanel eyebrow="Alerts" title={notifications.filter((n) => !n.read_at).length > 0 ? `Notifications (${notifications.filter((n) => !n.read_at).length} unread)` : 'Notifications'}>
      {loading ? <Loading /> : notifications.length === 0 ? <Empty title="No notifications" text="You're all caught up." /> : <div className="data-table">{notifications.map((n) => <div className={`table-row ${n.read_at ? 'read' : 'unread'}`} key={n.id} onClick={() => { if (!n.read_at) void markRead(n.id); }}><div className="job-icon"><Bell size={17} /></div><div><strong>{n.title}</strong><span>{n.message}</span></div><span className="table-muted">{formatDateTime(n.created_at)}</span>{!n.read_at && <span className="status bg-blue-50 text-blue-700">New</span>}</div>)}</div>}
    </SectionPanel>
  </>;
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
    if (!error) clearTaxRateCache();
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
        <label>Work order prefix<input value={settings.job_card_prefix} onChange={(e) => setSettings({ ...settings, job_card_prefix: e.target.value })} /></label>
        <label>Receipt prefix<input value={settings.receipt_prefix} onChange={(e) => setSettings({ ...settings, receipt_prefix: e.target.value })} /></label>
      </div>
    </section>
    <section className="panel" style={{ marginTop: 20 }}><div className="panel-heading"><div><p className="eyebrow">Document templates</p><h3>Work order terms &amp; conditions</h3></div></div>
      <label>Printed on every work order <span className="optional">Shown on Customer and Workshop copies</span><textarea value={settings.job_card_terms} onChange={(e) => setSettings({ ...settings, job_card_terms: e.target.value })} style={{ minHeight: 140 }} /></label>
    </section>
  </>;
}

// === USERS & ROLES ===
type StaffRow = Profile & { user_roles: { role_id: string; roles: { name: string; label: string } | null }[] };

// supabase-js treats any non-2xx Edge Function response as an "invoke error" and leaves
// `data` null, discarding the JSON error body the function actually sent — so the real
// reason (e.g. "Not authorized to manage users") gets swallowed unless we read it back off
// the FunctionsHttpError's `.context` Response ourselves.
async function readFunctionsError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context && typeof (context as Response).json === 'function') {
    try {
      const body = await (context as Response).json();
      if (body && typeof body.error === 'string' && body.error) return body.error;
    } catch { /* response wasn't JSON, or already consumed */ }
  }
  return fallback;
}

function UsersSection({ onNotice }: { onNotice: (m: string) => void }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolePerms, setRolePerms] = useState<Record<string, string[]>>({});
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [showCreateAccount, setShowCreateAccount] = useState(false);

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
    if (s.error) onNotice(s.error.message || 'Could not load the staff directory.');
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
    if (error) { onNotice(await readFunctionsError(error, 'That action could not be completed. Please try again.')); return false; }
    if (data?.error) { onNotice(data.error); return false; }
    return true;
  }
  async function suspend(userId: string) { if (await callAdmin({ action: 'suspend', userId })) { onNotice('User suspended.'); void loadAll(); } }
  async function reactivate(userId: string) { if (await callAdmin({ action: 'reactivate', userId })) { onNotice('User reactivated.'); void loadAll(); } }
  async function disable(userId: string) { if (await callAdmin({ action: 'disable', userId })) { onNotice('User disabled.'); void loadAll(); } }
  async function changeRole(userId: string, roleId: string) { if (await callAdmin({ action: 'changeRole', userId, roleId })) { onNotice('Role updated.'); void loadAll(); } }

  if (loading) return <Loading />;
  return <>
    <div className="page-heading"><div><p className="eyebrow">Access control</p><h1>Users & Roles</h1><p className="muted">Invite employees, manage account access, and configure role permissions.</p></div><div className="heading-actions"><button className="button secondary" onClick={() => setShowCreateAccount(true)}><Plus size={16} /> Create account</button><button className="button primary" onClick={() => setShowInvite(true)}><Plus size={16} /> Invite employee</button></div></div>

    <section className="panel table-panel" style={{ marginBottom: 24 }}>
      <div className="panel-heading"><div><p className="eyebrow">Directory</p><h3>Staff</h3></div></div>
      {staff.length === 0 ? <Empty title="No staff yet" text="Invite your first employee to get started." /> : <div className="data-table">{staff.map((person) => {
        const roleId = person.user_roles?.[0]?.role_id ?? '';
        return <div className="table-row" key={person.id}>
          <div className="job-icon"><UserCog size={17} /></div>
          <div><strong>{person.full_name || 'Unnamed'}</strong><span>{person.phone ?? '—'}</span></div>
          <select value={roleId} onChange={(e) => void changeRole(person.id, e.target.value)} disabled={!person.user_roles?.[0]}>
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
    {showCreateAccount && <CreateAccountForm roles={roles} onClose={() => setShowCreateAccount(false)} onSaved={(m) => { setShowCreateAccount(false); onNotice(m); void loadAll(); }} />}
  </>;
}

function CreateAccountForm({ roles, onClose, onSaved }: { roles: Role[]; onClose: () => void; onSaved: (m: string) => void }) {
  const [fullName, setFullName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [password, setPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState(''); const [roleId, setRoleId] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

    setBusy(true);
    const { data, error: invokeError } = await supabase.functions.invoke('admin-users', {
      body: { action: 'create', email: email.trim().toLowerCase(), fullName, phone: phone || null, roleId, password },
    });
    setBusy(false);
    if (invokeError) { setError(await readFunctionsError(invokeError, 'Unable to create account. Please try again.')); return; }
    if (data?.error) { setError(data.error); return; }
    onSaved(`Account created for ${email}. Share the password with them directly.`);
  }

  return <Modal title="Create account" onClose={onClose}><form onSubmit={submit} className="modal-form">
    <p className="muted" style={{ margin: '-6px 0 4px' }}>Sets up an active account immediately — no invitation email is sent, so share the password with the employee yourself.</p>
    <label>Full name<input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="e.g. Grace Wanjiru" /></label>
    <label>Work email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="grace@oaklandmotorcare.co.ke" /></label>
    <label>Phone <span className="optional">Optional</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" /></label>
    <label>Role<select value={roleId} onChange={(e) => setRoleId(e.target.value)} required><option value="">Select role...</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
    <div className="form-row">
      <label>Password<PasswordInput value={password} onChange={setPassword} placeholder="At least 6 characters" minLength={6} required autoComplete="new-password" /></label>
      <label>Confirm password<PasswordInput value={confirmPassword} onChange={setConfirmPassword} placeholder="Re-enter the password" minLength={6} required autoComplete="new-password" /></label>
    </div>
    {error && <div className="form-error">{error}</div>}
    <button className="button primary wide" disabled={busy}>{busy ? 'Creating account...' : 'Create account'} <ArrowUpRight size={16} /></button>
  </form></Modal>;
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
    if (invokeError) { setError(await readFunctionsError(invokeError, 'Unable to send invitation. Please try again.')); return; }
    if (data?.error) { setError(data.error); return; }
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
function SectionPanel({ eyebrow, title, onNew, newLabel, extra, children }: { eyebrow: string; title: string; onNew?: () => void; newLabel?: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return <section className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div><div className="action-buttons">{extra}{onNew && <button className="button primary small" onClick={onNew}><Plus size={16} /> {newLabel}</button>}</div></div>{children}</section>;
}
function PasswordInput({ value, onChange, placeholder, minLength, required, autoComplete }: { value: string; onChange: (v: string) => void; placeholder?: string; minLength?: number; required?: boolean; autoComplete?: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="password-field">
    <input type={visible ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} minLength={minLength} required={required} autoComplete={autoComplete} />
    <button type="button" className="password-toggle" tabIndex={-1} onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
  </div>;
}
function PoweredByFooter({ className }: { className?: string }) {
  return <a className={`powered-by ${className ?? ''}`} href="https://qeemlabs.co.ke" target="_blank" rel="noopener noreferrer">Created and Powered by Qeem Labs Ltd</a>;
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
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const { error: insertError } = await supabase.from('vehicles').insert({ customer_id: customerId, registration_number: regNumber.trim().toUpperCase(), make: make.trim() || null, model: model.trim() || null, year: year ? parseInt(year) : null, mileage: mileage ? parseInt(mileage) : 0, vin: vin || null, fuel_type: fuelType || null, colour: colour || null });
    setBusy(false);
    if (insertError) { setError(insertError.code === '23505' ? 'That registration number is already registered.' : insertError.message); return; }
    onSaved('Vehicle added successfully.');
  }
  return <Modal title="Add vehicle" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Customer<select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required><option value="">Select customer...</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.full_name} · {c.phone}</option>)}</select></label><label>Registration number<input value={regNumber} onChange={(e) => setRegNumber(e.target.value)} required placeholder="KDA 123A" /></label><div className="form-row"><label>Make <span className="optional">Optional</span><input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" /></label><label>Model <span className="optional">Optional</span><input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Hilux" /></label></div><div className="form-row"><label>Year <span className="optional">Optional</span><input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2020" /></label><label>Mileage <span className="optional">Optional</span><input type="number" value={mileage} onChange={(e) => setMileage(e.target.value)} min="0" /></label></div><label>VIN <span className="optional">Optional</span><input value={vin} onChange={(e) => setVin(e.target.value)} /></label><div className="form-row"><label>Fuel type<input value={fuelType} onChange={(e) => setFuelType(e.target.value)} placeholder="Diesel" /></label><label>Colour<input value={colour} onChange={(e) => setColour(e.target.value)} placeholder="White" /></label></div>{error && <div className="form-error">{error}</div>}<button className="button primary wide" disabled={busy || !customerId || !regNumber.trim()}>{busy ? 'Saving...' : 'Save vehicle'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function JobForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [customerId, setCustomerId] = useState(''); const [vehicleId, setVehicleId] = useState(''); const [jobType, setJobType] = useState(''); const [customers, setCustomers] = useState<Customer[]>([]); const [vehicles, setVehicles] = useState<Vehicle[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { supabase.from('customers').select('id,full_name,phone').is('deleted_at', null).order('full_name').limit(200).then(({ data }) => setCustomers((data ?? []) as Customer[])); }, []);
  useEffect(() => { setVehicleId(''); if (customerId) supabase.from('vehicles').select('*').eq('customer_id', customerId).is('deleted_at', null).then(({ data }) => setVehicles((data ?? []) as Vehicle[])); else setVehicles([]); }, [customerId]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const { data: jobNumber, error: numberError } = await supabase.rpc('generate_job_card_number');
    if (numberError || !jobNumber) { setBusy(false); setError('Unable to generate a work order number. Please try again.'); return; }
    const trimmedType = jobType.trim();
    const { error } = await supabase.from('job_cards').insert({ job_number: jobNumber, customer_id: customerId, vehicle_id: vehicleId, complaint: trimmedType, job_types: trimmedType ? [trimmedType] : [], mileage: vehicles.find((v) => v.id === vehicleId)?.mileage ?? 0 });
    setBusy(false);
    if (error) { setError(error.message); return; }
    onSaved(`Work order ${jobNumber} created successfully.`);
  }
  return <Modal title="Create work order" onClose={onClose}>
    <form onSubmit={submit} className="modal-form">
      <label>Customer<CustomerPicker customers={customers} customerId={customerId} onSelect={setCustomerId} onCreated={(c) => { setCustomers((prev) => [...prev, c]); setCustomerId(c.id); }} /></label>
      <label>Vehicle<VehiclePicker customerId={customerId} vehicles={vehicles} vehicleId={vehicleId} onSelect={setVehicleId} onCreated={(v) => { setVehicles((prev) => [...prev, v]); setVehicleId(v.id); }} /></label>
      <label>Job type<textarea value={jobType} onChange={(e) => setJobType(e.target.value)} required placeholder="e.g. Brake service, oil change" style={{ minHeight: 60 }} /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="button primary wide" disabled={busy || !vehicleId}>{busy ? 'Creating...' : 'Create work order'} <ArrowUpRight size={16} /></button>
    </form>
  </Modal>;
}

function ServiceForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(''); const [category, setCategory] = useState('General'); const [price, setPrice] = useState('0'); const [duration, setDuration] = useState('60'); const [description, setDescription] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); const { error } = await supabase.from('services').insert({ name, category, description: description || null, standard_price_minor: Math.round(parseFloat(price) * 100), estimated_minutes: parseInt(duration) }); setBusy(false); onSaved(error ? 'Unable to save service.' : 'Service added successfully.'); }
  return <Modal title="Add service" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Service name<input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Oil change" /></label><label>Category<input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Maintenance" /></label><div className="form-row"><label>Standard price (KES)<input type="number" value={price} onChange={(e) => setPrice(e.target.value)} required min="0" step="0.01" /></label><label>Estimated minutes<input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} required min="1" /></label></div><label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Service description..." /></label><button className="button primary wide" disabled={busy}>{busy ? 'Saving...' : 'Save service'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function TechnicianForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [fullName, setFullName] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [specialization, setSpecialization] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const { error: insertError } = await supabase.from('employees').insert({ full_name: fullName.trim(), phone: phone.trim() || null, email: email.trim() || null, specialization: specialization.trim() || null, role: 'TECHNICIAN' });
    setBusy(false);
    if (insertError) { setError(insertError.message); return; }
    onSaved('Technician added successfully.');
  }
  return <Modal title="Add technician" onClose={onClose}><form onSubmit={submit} className="modal-form">
    <label>Full name<input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="e.g. John Mwangi" /></label>
    <div className="form-row">
      <label>Phone <span className="optional">Optional</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xxxxxxxx" /></label>
      <label>Email <span className="optional">Optional</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    </div>
    <label>Specialization <span className="optional">Optional</span><input value={specialization} onChange={(e) => setSpecialization(e.target.value)} placeholder="e.g. Engine, Electrical, Body work" /></label>
    {error && <div className="form-error">{error}</div>}
    <button className="button primary wide" disabled={busy || !fullName.trim()}>{busy ? 'Saving...' : 'Save technician'} <ArrowUpRight size={16} /></button>
  </form></Modal>;
}

function PartForm({ part, onClose, onSaved }: { part?: Part; onClose: () => void; onSaved: (m: string) => void }) {
  const isEdit = !!part;
  const [sku, setSku] = useState(part?.sku ?? ''); const [name, setName] = useState(part?.name ?? ''); const [category, setCategory] = useState(part?.category ?? 'General'); const [brand, setBrand] = useState(part?.brand ?? ''); const [supplierId, setSupplierId] = useState(part?.supplier_id ?? ''); const [suppliers, setSuppliers] = useState<Supplier[]>([]); const [costPrice, setCostPrice] = useState(part ? String(part.cost_price_minor / 100) : '0'); const [sellPrice, setSellPrice] = useState(part ? String(part.selling_price_minor / 100) : '0'); const [qty, setQty] = useState('0'); const [reorder, setReorder] = useState(part ? String(part.reorder_level) : '0'); const [location, setLocation] = useState(part?.location ?? ''); const [active, setActive] = useState(part?.active ?? true); const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from('suppliers').select('*').eq('status', 'ACTIVE').is('deleted_at', null).order('name').then(({ data }) => setSuppliers((data ?? []) as Supplier[])); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const payload = { sku, name, category, brand: brand || null, supplier_id: supplierId || null, cost_price_minor: Math.round(parseFloat(costPrice) * 100), selling_price_minor: Math.round(parseFloat(sellPrice) * 100), reorder_level: parseInt(reorder), location: location || null };
    const { error: partError } = isEdit
      ? await supabase.from('parts').update({ ...payload, active }).eq('id', part!.id)
      : await supabase.from('parts').insert({ ...payload, quantity_on_hand: parseInt(qty) });
    if (partError) { setBusy(false); onSaved(`Unable to ${isEdit ? 'update' : 'save'} part. Please try again.`); return; }
    onSaved(isEdit ? 'Part updated successfully.' : 'Part added successfully.');
  }
  return <Modal title={isEdit ? 'Edit part' : 'Add part'} onClose={onClose}><form onSubmit={submit} className="modal-form"><label>SKU<input value={sku} onChange={(e) => setSku(e.target.value)} required placeholder="e.g. BP-001" /></label><label>Part name<input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Brake pads" /></label><div className="form-row"><label>Category<input value={category} onChange={(e) => setCategory(e.target.value)} /></label><label>Brand<input value={brand} onChange={(e) => setBrand(e.target.value)} /></label></div><label>Supplier<span className="optional">Optional</span><select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">No supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div className="form-row"><label>Cost price (KES)<input type="number" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} required min="0" step="0.01" /></label><label>Selling price (KES)<input type="number" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} required min="0" step="0.01" /></label></div><div className="form-row">{isEdit ? <label>Reorder level<input type="number" value={reorder} onChange={(e) => setReorder(e.target.value)} required min="0" /></label> : <><label>Quantity on hand<input type="number" value={qty} onChange={(e) => setQty(e.target.value)} required min="0" /></label><label>Reorder level<input type="number" value={reorder} onChange={(e) => setReorder(e.target.value)} required min="0" /></label></>}</div><label>Location/bin<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Shelf A-3" /></label>{isEdit && <label>Active<span className="optional">Inactive parts are hidden from the parts list</span><select value={active ? '1' : '0'} onChange={(e) => setActive(e.target.value === '1')}><option value="1">Active</option><option value="0">Inactive</option></select></label>}{isEdit && <p className="muted" style={{ margin: 0 }}>Quantity on hand isn&apos;t edited here — use Receive stock or Adjust stock so the movement ledger stays accurate.</p>}<button className="button primary wide" disabled={busy}>{busy ? 'Saving...' : isEdit ? 'Save changes' : 'Save part'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function SupplierForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(''); const [contactPerson, setContactPerson] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [address, setAddress] = useState(''); const [paymentTerms, setPaymentTerms] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); const { error } = await supabase.from('suppliers').insert({ name, contact_person: contactPerson || null, phone, email: email || null, address: address || null, payment_terms: paymentTerms || null }); setBusy(false); onSaved(error ? 'Unable to save supplier.' : 'Supplier added successfully.'); }
  return <Modal title="Add supplier" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Supplier name<input value={name} onChange={(e) => setName(e.target.value)} required /></label><label>Contact person<input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} /></label><label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} required /></label><label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" /></label><label>Address<input value={address} onChange={(e) => setAddress(e.target.value)} /></label><label>Payment terms<input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. Net 30" /></label><button className="button primary wide" disabled={busy}>{busy ? 'Saving...' : 'Save supplier'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function POForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [supplierId, setSupplierId] = useState(''); const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orderDate, setOrderDate] = useState(localDateStr()); const [expectedDelivery, setExpectedDelivery] = useState('');
  const [parts, setParts] = useState<Part[]>([]);
  const [pickPartId, setPickPartId] = useState(''); const [pickQty, setPickQty] = useState('1'); const [pickCost, setPickCost] = useState('0');
  const [items, setItems] = useState<{ partId: string; name: string; sku: string; quantity: number; unitCostMinor: number }[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { supabase.from('suppliers').select('*').eq('status', 'ACTIVE').is('deleted_at', null).order('name').then(({ data }) => setSuppliers((data ?? []) as Supplier[])); }, []);
  useEffect(() => { supabase.from('parts').select('*').eq('active', true).order('name').limit(500).then(({ data }) => setParts((data ?? []) as Part[])); }, []);

  function addItem() {
    const part = parts.find((p) => p.id === pickPartId); if (!part) return;
    const qty = Math.max(1, parseInt(pickQty) || 1); const cost = Math.max(0, Math.round((parseFloat(pickCost) || 0) * 100));
    setItems((prev) => {
      const existing = prev.find((i) => i.partId === part.id);
      if (existing) return prev.map((i) => i.partId === part.id ? { ...i, quantity: i.quantity + qty, unitCostMinor: cost } : i);
      return [...prev, { partId: part.id, name: part.name, sku: part.sku, quantity: qty, unitCostMinor: cost }];
    });
    setPickPartId(''); setPickQty('1'); setPickCost('0');
  }
  function removeItem(partId: string) { setItems((prev) => prev.filter((i) => i.partId !== partId)); }
  const totalMinor = items.reduce((s, i) => s + i.quantity * i.unitCostMinor, 0);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (items.length === 0) { setError('Add at least one part to the order.'); return; }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('create_purchase_order', {
      p_supplier_id: supplierId, p_order_date: orderDate, p_expected_delivery: expectedDelivery || null,
      p_items: items.map((i) => ({ part_id: i.partId, quantity: i.quantity, unit_cost_minor: i.unitCostMinor })),
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message || 'Unable to create the purchase order.'); return; }
    onSaved('Purchase order created.');
  }

  return <Modal title="New purchase order" onClose={onClose}><form onSubmit={submit} className="modal-form">
    <label>Supplier<select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required><option value="">Select supplier...</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <div className="form-row">
      <label>Order date<input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required /></label>
      <label>Expected delivery <span className="optional">Optional</span><input type="date" value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} /></label>
    </div>
    <div className="form-row" style={{ gridTemplateColumns: '1fr 80px 120px auto', alignItems: 'end' }}>
      <label>Part<select value={pickPartId} onChange={(e) => { const p = parts.find((x) => x.id === e.target.value); setPickPartId(e.target.value); if (p) setPickCost((p.cost_price_minor / 100).toString()); }}><option value="">Select part...</option>{parts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></label>
      <label>Qty<input type="number" min="1" value={pickQty} onChange={(e) => setPickQty(e.target.value)} /></label>
      <label>Unit cost (KES)<input type="number" min="0" step="0.01" value={pickCost} onChange={(e) => setPickCost(e.target.value)} /></label>
      <button type="button" className="button secondary" disabled={!pickPartId} onClick={addItem}><Plus size={15} /> Add</button>
    </div>
    {items.length > 0 && <div className="data-table">{items.map((i) => <div className="table-row" key={i.partId}><div><strong>{i.name}</strong><span>{i.sku}</span></div><span className="table-muted">{i.quantity} × {formatKes(i.unitCostMinor)}</span><span className="table-muted">{formatKes(i.quantity * i.unitCostMinor)}</span><button type="button" className="close-button" style={{ width: 28, height: 28 }} onClick={() => removeItem(i.partId)}><X size={14} /></button></div>)}</div>}
    {items.length > 0 && <div className="total-row"><strong>Total</strong><span>{formatKes(totalMinor)}</span></div>}
    {error && <div className="form-error">{error}</div>}
    <button className="button primary wide" disabled={busy || !supplierId || items.length === 0}>{busy ? 'Creating...' : 'Create PO'} <ArrowUpRight size={16} /></button>
  </form></Modal>;
}

function QuotationForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [jobId, setJobId] = useState(''); const [jobs, setJobs] = useState<(JobCard & { vehicles: { registration_number: string } | null; customers: { full_name: string } | null })[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from('job_cards').select('*, vehicles(registration_number), customers(full_name)').in('status', ['DRAFT','OPEN','IN_PROGRESS']).is('deleted_at', null).order('created_at', { ascending: false }).limit(50).then(({ data }) => setJobs((data ?? []) as (JobCard & { vehicles: { registration_number: string } | null; customers: { full_name: string } | null })[])); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const job = jobs.find((j) => j.id === jobId); if (!job) { setBusy(false); return; }
    const taxRate = await getTaxRate();
    const { data: labour } = await supabase.from('job_card_labour').select('*').eq('job_card_id', jobId);
    const { data: parts } = await supabase.from('job_card_parts').select('*, parts(name,selling_price_minor)').eq('job_card_id', jobId);
    const items: { item_type: 'LABOUR' | 'PART' | 'OTHER'; description: string; quantity: number; unit_price_minor: number; tax_rate: number; line_total_minor: number }[] = [];
    (labour ?? []).forEach((l: JobCardLabour) => items.push({ item_type: 'LABOUR', description: l.description, quantity: l.quantity, unit_price_minor: l.unit_price_minor, tax_rate: l.tax_rate, line_total_minor: computeLineTotal(l.quantity, l.unit_price_minor, l.tax_rate) }));
    (parts ?? []).forEach((p: JobCardPart & { parts: Part | null }) => items.push({ item_type: 'PART', description: p.parts?.name ?? 'Part', quantity: p.quantity, unit_price_minor: p.unit_price_minor, tax_rate: taxRate, line_total_minor: computeLineTotal(p.quantity, p.unit_price_minor, taxRate) }));
    if (job.other_charges_minor > 0) items.push({ item_type: 'OTHER', description: 'Other charges', quantity: 1, unit_price_minor: job.other_charges_minor, tax_rate: 0, line_total_minor: job.other_charges_minor });
    const subtotal = items.reduce((s, i) => s + i.line_total_minor, 0);
    const { data: quoteNumber, error: numError } = await supabase.rpc('generate_document_number', { p_doc_type: 'QUO', p_prefix: 'QUO', p_permission: 'quotation.create' });
    if (numError || !quoteNumber) { setBusy(false); onSaved('Unable to generate a quotation number.'); return; }
    const validUntil = new Date(); validUntil.setDate(validUntil.getDate() + 30);
    const { data: quote } = await supabase.from('quotations').insert({ quote_number: quoteNumber, customer_id: job.customer_id, vehicle_id: job.vehicle_id, job_card_id: jobId, subtotal_minor: subtotal, discount_minor: 0, tax_minor: 0, total_minor: subtotal, valid_until: validUntil.toISOString().slice(0, 10), status: 'PENDING_APPROVAL' }).select().single();
    if (quote) for (const item of items) void supabase.from('quotation_items').insert({ quotation_id: quote.id, ...item });
    setBusy(false); onSaved('Quotation created from work order.');
  }
  return <Modal title="Create quotation" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Work order<select value={jobId} onChange={(e) => setJobId(e.target.value)} required><option value="">Select job...</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.vehicles?.registration_number ?? 'Vehicle'} · {j.customers?.full_name ?? 'Customer'}</option>)}</select></label><button className="button primary wide" disabled={busy || !jobId}>{busy ? 'Creating...' : 'Create quotation'} <ArrowUpRight size={16} /></button></form></Modal>;
}

function InvoiceForm({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [jobId, setJobId] = useState(''); const [jobs, setJobs] = useState<(JobCard & { vehicles: { registration_number: string } | null; customers: { full_name: string } | null })[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      const [jobsRes, invoicedRes] = await Promise.all([
        supabase.from('job_cards').select('*, vehicles(registration_number), customers(full_name)').in('status', ['IN_PROGRESS','COMPLETED']).is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
        supabase.from('invoices').select('job_card_id').not('job_card_id', 'is', null).neq('status', 'VOID'),
      ]);
      const invoicedJobIds = new Set(((invoicedRes.data ?? []) as { job_card_id: string }[]).map((i) => i.job_card_id));
      const allJobs = (jobsRes.data ?? []) as (JobCard & { vehicles: { registration_number: string } | null; customers: { full_name: string } | null })[];
      setJobs(allJobs.filter((j) => !invoicedJobIds.has(j.id)));
    })();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const job = jobs.find((j) => j.id === jobId); if (!job) { setBusy(false); return; }
    const taxRate = await getTaxRate();
    const { data: labour } = await supabase.from('job_card_labour').select('*').eq('job_card_id', jobId);
    const { data: parts } = await supabase.from('job_card_parts').select('*, parts(name)').eq('job_card_id', jobId);
    const items: { item_type: 'LABOUR' | 'PART' | 'OTHER'; description: string; quantity: number; unit_price_minor: number; tax_rate: number; line_total_minor: number }[] = [];
    (labour ?? []).forEach((l: JobCardLabour) => items.push({ item_type: 'LABOUR', description: l.description, quantity: l.quantity, unit_price_minor: l.unit_price_minor, tax_rate: l.tax_rate, line_total_minor: computeLineTotal(l.quantity, l.unit_price_minor, l.tax_rate) }));
    (parts ?? []).forEach((p: JobCardPart & { parts: Part | null }) => items.push({ item_type: 'PART', description: p.parts?.name ?? 'Part', quantity: p.quantity, unit_price_minor: p.unit_price_minor, tax_rate: taxRate, line_total_minor: computeLineTotal(p.quantity, p.unit_price_minor, taxRate) }));
    if (job.other_charges_minor > 0) items.push({ item_type: 'OTHER', description: 'Other charges', quantity: 1, unit_price_minor: job.other_charges_minor, tax_rate: 0, line_total_minor: job.other_charges_minor });
    const subtotal = items.reduce((s, i) => s + i.line_total_minor, 0);
    const { data: invNumber, error: numError } = await supabase.rpc('generate_document_number', { p_doc_type: 'INV', p_prefix: 'INV', p_permission: 'invoice.create' });
    if (numError || !invNumber) { setBusy(false); onSaved('Unable to generate an invoice number.'); return; }
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 14);
    const { data: inv } = await supabase.from('invoices').insert({ invoice_number: invNumber, customer_id: job.customer_id, vehicle_id: job.vehicle_id, job_card_id: jobId, subtotal_minor: subtotal, discount_minor: 0, tax_minor: 0, total_minor: subtotal, due_date: dueDate.toISOString().slice(0, 10), status: 'ISSUED' }).select().single();
    if (!inv) { setBusy(false); onSaved('This work order already has an invoice.'); return; }
    for (const item of items) void supabase.from('invoice_items').insert({ invoice_id: inv.id, ...item });
    setBusy(false); onSaved('Invoice created from work order.');
  }
  return <Modal title="Create invoice" onClose={onClose}><form onSubmit={submit} className="modal-form"><label>Work order<select value={jobId} onChange={(e) => setJobId(e.target.value)} required><option value="">Select completed job...</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.vehicles?.registration_number ?? 'Vehicle'} · {j.customers?.full_name ?? 'Customer'}</option>)}</select></label><button className="button primary wide" disabled={busy || !jobId}>{busy ? 'Creating...' : 'Create invoice'} <ArrowUpRight size={16} /></button></form></Modal>;
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

type AdjustmentReasonMeta =
  | { value: string; kind: 'redirect'; hint: string; target: 'receive' | 'sales' | 'jobcards' }
  | { value: string; kind: 'fixed'; direction: 'IN' | 'OUT'; movementType: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'DAMAGE' }
  | { value: string; kind: 'choice' }
  | { value: string; kind: 'count' };

const ADJUSTMENT_REASONS: AdjustmentReasonMeta[] = [
  { value: 'Purchase/GRN', kind: 'redirect', target: 'receive', hint: 'Goods received against a purchase order — use "Receive stock" instead so it stays linked to the PO.' },
  { value: 'Sale', kind: 'redirect', target: 'sales', hint: 'Record this from the Sales module so revenue, receipts and reports stay accurate.' },
  { value: 'Workshop issue', kind: 'redirect', target: 'jobcards', hint: 'Issue parts to a work order from that job card so labour and billing stay linked.' },
  { value: 'Customer return', kind: 'fixed', direction: 'IN', movementType: 'ADJUSTMENT_IN' },
  { value: 'Supplier return', kind: 'fixed', direction: 'OUT', movementType: 'ADJUSTMENT_OUT' },
  { value: 'Stock adjustment', kind: 'choice' },
  { value: 'Damaged item', kind: 'fixed', direction: 'OUT', movementType: 'DAMAGE' },
  { value: 'Lost item', kind: 'fixed', direction: 'OUT', movementType: 'ADJUSTMENT_OUT' },
  { value: 'Stock count', kind: 'count' },
];

function StockAdjustForm({ onClose, onSaved, onGoToReceive, onGoToSales, onGoToWorkOrders }: { onClose: () => void; onSaved: (m: string) => void; onGoToReceive: () => void; onGoToSales: () => void; onGoToWorkOrders: () => void }) {
  const [partId, setPartId] = useState(''); const [reason, setReason] = useState('Customer return'); const [direction, setDirection] = useState<'IN' | 'OUT'>('IN'); const [qty, setQty] = useState('1'); const [countedQty, setCountedQty] = useState(''); const [detail, setDetail] = useState(''); const [parts, setParts] = useState<Part[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from('parts').select('*').eq('active', true).order('name').limit(200).then(({ data }) => setParts((data ?? []) as Part[])); }, []);
  const selectedPart = parts.find((p) => p.id === partId);
  const meta = ADJUSTMENT_REASONS.find((r) => r.value === reason)!;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (meta.kind === 'redirect') return;
    let adjType: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'DAMAGE';
    let quantity: number;
    if (meta.kind === 'count') {
      const onHand = selectedPart?.quantity_on_hand ?? 0;
      const delta = parseInt(countedQty || '0') - onHand;
      if (delta === 0) { onSaved('No difference between the counted and recorded quantity — nothing to adjust.'); return; }
      adjType = delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
      quantity = Math.abs(delta);
    } else if (meta.kind === 'fixed') {
      adjType = meta.movementType;
      quantity = parseInt(qty);
    } else {
      adjType = direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
      quantity = parseInt(qty);
    }
    setBusy(true);
    const reasonText = detail.trim() ? `${reason} — ${detail.trim()}` : reason;
    const { error } = await supabase.rpc('adjust_stock', { p_part_id: partId, p_adjustment_type: adjType, p_quantity: quantity, p_reason: reasonText });
    setBusy(false);
    onSaved(error ? 'Unable to adjust stock.' : 'Stock adjusted successfully.');
  }

  return <Modal title="Adjust stock" onClose={onClose}><form onSubmit={submit} className="modal-form">
    <label>Part<select value={partId} onChange={(e) => setPartId(e.target.value)} required><option value="">Select part...</option>{parts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.quantity_on_hand} in stock)</option>)}</select></label>
    <label>Reason<select value={reason} onChange={(e) => setReason(e.target.value)}>{ADJUSTMENT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.value}</option>)}</select></label>
    {meta.kind === 'redirect' && <div className="form-error">{meta.hint}<button type="button" className="text-button" style={{ marginTop: 8 }} onClick={meta.target === 'receive' ? onGoToReceive : meta.target === 'sales' ? onGoToSales : onGoToWorkOrders}>{meta.target === 'receive' ? 'Go to Receive stock' : meta.target === 'sales' ? 'Go to Sales' : 'Go to Work Orders'} <ArrowUpRight size={14} /></button></div>}
    {meta.kind === 'fixed' && <p className="muted" style={{ margin: 0 }}>{meta.direction === 'IN' ? 'This adds units back into stock.' : 'This removes units from stock.'}</p>}
    {meta.kind === 'choice' && <label>Direction<select value={direction} onChange={(e) => setDirection(e.target.value as 'IN' | 'OUT')}><option value="IN">Add to stock</option><option value="OUT">Remove from stock</option></select></label>}
    {meta.kind === 'count'
      ? <div className="form-row"><label>Recorded on hand<input value={selectedPart?.quantity_on_hand ?? 0} disabled /></label><label>Counted quantity<input type="number" value={countedQty} onChange={(e) => setCountedQty(e.target.value)} required min="0" /></label></div>
      : meta.kind !== 'redirect' && <label>Quantity<input type="number" value={qty} onChange={(e) => setQty(e.target.value)} required min="1" /></label>}
    {meta.kind !== 'redirect' && <label>Additional detail <span className="optional">Optional</span><input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="e.g. supplier credit note number" /></label>}
    <button className="button primary wide" disabled={busy || !partId || meta.kind === 'redirect'}>{busy ? 'Adjusting...' : 'Adjust stock'} <ArrowUpRight size={16} /></button>
  </form></Modal>;
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
  const [newMake, setNewMake] = useState(''); const [newModel, setNewModel] = useState(''); const [newYear, setNewYear] = useState(''); const [newMileage, setNewMileage] = useState(''); const [busy, setBusy] = useState(false); const [addError, setAddError] = useState('');
  const selected = vehicles.find((v) => v.id === vehicleId);
  const q = query.trim().toLowerCase();
  const matches = q ? vehicles.filter((v) => v.registration_number.toLowerCase().includes(q) || (v.make ?? '').toLowerCase().includes(q) || (v.model ?? '').toLowerCase().includes(q)) : vehicles;
  const canSave = !!customerId && !!query.trim();

  async function createVehicle() {
    setAddError('');
    if (!canSave) return;
    setBusy(true);
    const { data, error } = await supabase.from('vehicles').insert({ customer_id: customerId, registration_number: query.trim().toUpperCase(), make: newMake.trim() || null, model: newModel.trim() || null, year: newYear ? parseInt(newYear) : null, mileage: newMileage ? parseInt(newMileage) : 0 }).select().single();
    setBusy(false);
    if (error || !data) {
      setAddError(error?.code === '23505' ? 'That registration number is already registered.' : error?.message ?? 'Unable to save vehicle. Please try again.');
      return;
    }
    onCreated(data as Vehicle);
    setShowNew(false); setOpen(false); setQuery(''); setNewMake(''); setNewModel(''); setNewYear(''); setNewMileage(''); setAddError('');
  }

  if (!customerId) return <input disabled placeholder="Select a customer first..." />;

  return <div className="combobox">
    <input
      value={selected ? `${selected.registration_number}${[selected.make, selected.model].filter(Boolean).length ? ' · ' + [selected.make, selected.model].filter(Boolean).join(' ') : ''}` : query}
      onChange={(e) => { onSelect(''); setQuery(e.target.value); setShowNew(false); setAddError(''); setOpen(true); }}
      onFocus={() => { if (!selected) setOpen(true); }}
      onBlur={() => setTimeout(() => setOpen(false), 150)}
      placeholder="Type registration number, make or model..."
      required
    />
    {open && !selected && <div className="combobox-dropdown">
      {matches.length === 0 && <p className="combobox-empty">No vehicles yet for this customer.</p>}
      {matches.map((v) => <button type="button" key={v.id} className="combobox-option" onMouseDown={() => { onSelect(v.id); setQuery(''); setOpen(false); }}>{v.registration_number}{[v.make, v.model].filter(Boolean).length ? ` · ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}{v.year ? ` (${v.year})` : ''}</button>)}
      {q.length > 1 && <button type="button" className="combobox-option combobox-add" onMouseDown={() => setShowNew(true)}><Plus size={14} /> Add &quot;{query.trim().toUpperCase()}&quot; as new vehicle</button>}
    </div>}
    {showNew && <div className="combobox-new combobox-new-wrap">
      <input value={newMake} onChange={(e) => setNewMake(e.target.value)} placeholder="Make" />
      <input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="Model" />
      <input value={newYear} onChange={(e) => setNewYear(e.target.value)} placeholder="Year" type="number" />
      <input value={newMileage} onChange={(e) => setNewMileage(e.target.value)} placeholder="Mileage (KM)" type="number" />
      <button type="button" className="button primary small" disabled={busy || !canSave} onClick={() => void createVehicle()}>{busy ? 'Saving...' : 'Save vehicle'}</button>
      {addError && <p className="form-error" style={{ flexBasis: '100%' }}>{addError}</p>}
    </div>}
  </div>;
}
