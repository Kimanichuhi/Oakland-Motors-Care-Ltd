export const PERMISSIONS = [
  'dashboard.view','customer.view','customer.create','customer.update','customer.delete',
  'vehicle.view','vehicle.create','vehicle.update',
  'job.view','job.create','job.update','job.assign','job.complete','job.deliver',
  'inventory.view','inventory.create','inventory.issue','inventory.receive','inventory.adjust',
  'supplier.view','supplier.create','supplier.update',
  'purchase_order.view','purchase_order.create','purchase_order.approve','purchase_order.receive',
  'quotation.view','quotation.create','quotation.approve','quotation.reject',
  'invoice.view','invoice.create','invoice.update','invoice.void',
  'payment.view','payment.create','payment.reverse',
  'report.view','report.export','audit.view','settings.manage','users.manage',
] as const;

export type PermissionKey = typeof PERMISSIONS[number];

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Garage Manager',
  SERVICE_ADVISOR: 'Service Advisor',
  TECHNICIAN: 'Technician',
  STOREKEEPER: 'Storekeeper',
  ACCOUNTANT: 'Accountant',
  OWNER_READONLY: 'Owner',
};

export const JOB_STATUSES = [
  'DRAFT','RECEIVED','INSPECTION','DIAGNOSIS','AWAITING_APPROVAL','APPROVED',
  'WAITING_FOR_PARTS','IN_PROGRESS','QUALITY_CHECK','READY_FOR_COLLECTION','COLLECTED','CLOSED','CANCELLED',
] as const;

// Mirrors transition_job_status() in
// supabase/migrations/20260811090000_202608110001_oakland_job_card_status_pipeline.sql exactly.
export const JOB_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['RECEIVED','CANCELLED'],
  RECEIVED: ['INSPECTION','DIAGNOSIS','AWAITING_APPROVAL','CANCELLED'],
  INSPECTION: ['DIAGNOSIS','AWAITING_APPROVAL','CANCELLED'],
  DIAGNOSIS: ['AWAITING_APPROVAL','WAITING_FOR_PARTS','IN_PROGRESS','CANCELLED'],
  AWAITING_APPROVAL: ['APPROVED','WAITING_FOR_PARTS','IN_PROGRESS','CANCELLED'],
  APPROVED: ['WAITING_FOR_PARTS','IN_PROGRESS','CANCELLED'],
  WAITING_FOR_PARTS: ['IN_PROGRESS','CANCELLED'],
  IN_PROGRESS: ['QUALITY_CHECK','WAITING_FOR_PARTS','CANCELLED'],
  QUALITY_CHECK: ['READY_FOR_COLLECTION','IN_PROGRESS','CANCELLED'],
  READY_FOR_COLLECTION: ['COLLECTED'],
  COLLECTED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

export const JOB_TYPE_META = [
  { key: 'SERVICE', label: 'Service', description: 'Routine scheduled service' },
  { key: 'REPAIR', label: 'Repair', description: 'General mechanical repair' },
  { key: 'DIAGNOSTICS', label: 'Diagnostics', description: 'Fault-finding and scan tools' },
  { key: 'BODY_WORK', label: 'Body work', description: 'Panel beating and paint' },
  { key: 'ACCIDENT_REPAIR', label: 'Accident repair', description: 'Post-accident restoration' },
  { key: 'MAINTENANCE', label: 'Maintenance', description: 'Preventive maintenance check' },
  { key: 'AGRICULTURAL_MACHINERY', label: 'Agricultural machinery', description: 'Farm equipment servicing' },
  { key: 'TRACTOR_REPAIR', label: 'Tractor repair', description: 'Tractor-specific repair work' },
  { key: 'EQUIPMENT_REPAIR', label: 'Equipment repair', description: 'Other heavy equipment repair' },
  { key: 'OTHER', label: 'Other', description: 'Anything not listed above' },
] as const;

export const JOB_TYPES = JOB_TYPE_META.map((t) => t.key);

export const INSPECTION_CATEGORIES = ['ENGINE','TRANSMISSION','BRAKES','SUSPENSION','ELECTRICAL','TYRES','BODY_PAINT','OTHER'] as const;
export const INSPECTION_CONDITIONS = ['NORMAL','REQUIRES_ATTENTION','DAMAGED','NOT_CHECKED'] as const;

export const WORK_ITEM_STATUSES = ['PENDING','IN_PROGRESS','COMPLETED','CANCELLED'] as const;

export const QUALITY_CHECK_ITEMS = [
  { key: 'work_completed', label: 'Work completed' },
  { key: 'parts_installed_correctly', label: 'Parts installed correctly' },
  { key: 'customer_complaint_addressed', label: 'Customer complaint addressed' },
  { key: 'vehicle_inspected', label: 'Vehicle inspected' },
  { key: 'test_completed', label: 'Test completed' },
  { key: 'no_obvious_faults', label: 'No obvious faults' },
  { key: 'tools_removed', label: 'Tools removed' },
  { key: 'vehicle_ready_for_release', label: 'Vehicle ready for release' },
] as const;
export const QUALITY_CHECK_RESULTS = ['PASSED','FAILED','REWORK_REQUIRED'] as const;

export const SIGNOFF_ROLES = ['ADVISOR','TECHNICIAN','QUALITY_CHECK','CUSTOMER'] as const;

export const ACCOUNT_STATUSES = ['INVITED','ACTIVE','SUSPENDED','DISABLED'] as const;

export const PAYMENT_METHODS = ['CASH','MPESA','BANK','CARD','OTHER'] as const;

export const MOVEMENT_TYPES = ['OPENING_BALANCE','PURCHASE','JOB_CARD_USAGE','RETURN','ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGE','TRANSFER'] as const;

export const PO_STATUSES = ['DRAFT','SUBMITTED','APPROVED','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED'] as const;

export const QUOTATION_STATUSES = ['DRAFT','SENT','PENDING_APPROVAL','APPROVED','REJECTED','EXPIRED','CONVERTED'] as const;

export const INVOICE_STATUSES = ['DRAFT','ISSUED','PART_PAID','PAID','OVERDUE','VOID'] as const;

export const statusStyles: Record<string, string> = {
  RECEIVED: 'bg-amber-50 text-amber-700',
  INSPECTION: 'bg-cyan-50 text-cyan-700',
  DIAGNOSIS: 'bg-sky-50 text-sky-700',
  AWAITING_APPROVAL: 'bg-violet-50 text-violet-700',
  APPROVED: 'bg-teal-50 text-teal-700',
  WAITING_FOR_PARTS: 'bg-orange-50 text-orange-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  QUALITY_CHECK: 'bg-fuchsia-50 text-fuchsia-700',
  READY_FOR_COLLECTION: 'bg-lime-50 text-lime-700',
  COLLECTED: 'bg-slate-100 text-slate-600',
  CLOSED: 'bg-slate-200 text-slate-700',
  CANCELLED: 'bg-red-50 text-red-700',
  DRAFT: 'bg-slate-100 text-slate-600',
  ISSUED: 'bg-blue-50 text-blue-700',
  PART_PAID: 'bg-amber-50 text-amber-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  OVERDUE: 'bg-red-50 text-red-700',
  VOID: 'bg-slate-100 text-slate-500',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  ARCHIVED: 'bg-slate-100 text-slate-500',
  INVITED: 'bg-sky-50 text-sky-700',
  SUSPENDED: 'bg-amber-50 text-amber-700',
  DISABLED: 'bg-red-50 text-red-700',
  PENDING: 'bg-slate-100 text-slate-600',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  PASSED: 'bg-emerald-50 text-emerald-700',
  FAILED: 'bg-red-50 text-red-700',
  REWORK_REQUIRED: 'bg-amber-50 text-amber-700',
  NORMAL: 'bg-emerald-50 text-emerald-700',
  REQUIRES_ATTENTION: 'bg-amber-50 text-amber-700',
  DAMAGED: 'bg-red-50 text-red-700',
  NOT_CHECKED: 'bg-slate-100 text-slate-500',
};
