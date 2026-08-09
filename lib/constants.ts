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
  'report.view','report.export','audit.view','settings.manage',
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
  'RECEIVED','DIAGNOSING','AWAITING_APPROVAL','APPROVED','IN_PROGRESS','AWAITING_PARTS','COMPLETED','READY_FOR_PICKUP','DELIVERED','CANCELLED',
] as const;

export const JOB_TRANSITIONS: Record<string, string[]> = {
  RECEIVED: ['DIAGNOSING','AWAITING_APPROVAL','CANCELLED'],
  DIAGNOSING: ['AWAITING_APPROVAL','IN_PROGRESS','CANCELLED'],
  AWAITING_APPROVAL: ['APPROVED','IN_PROGRESS','CANCELLED'],
  APPROVED: ['IN_PROGRESS','CANCELLED'],
  IN_PROGRESS: ['AWAITING_PARTS','COMPLETED','CANCELLED'],
  AWAITING_PARTS: ['IN_PROGRESS','CANCELLED'],
  COMPLETED: ['READY_FOR_PICKUP'],
  READY_FOR_PICKUP: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const PAYMENT_METHODS = ['CASH','MPESA','BANK','CARD','OTHER'] as const;

export const MOVEMENT_TYPES = ['OPENING_BALANCE','PURCHASE','JOB_CARD_USAGE','RETURN','ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGE','TRANSFER'] as const;

export const PO_STATUSES = ['DRAFT','SUBMITTED','APPROVED','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED'] as const;

export const QUOTATION_STATUSES = ['DRAFT','SENT','PENDING_APPROVAL','APPROVED','REJECTED','EXPIRED','CONVERTED'] as const;

export const INVOICE_STATUSES = ['DRAFT','ISSUED','PART_PAID','PAID','OVERDUE','VOID'] as const;

export const statusStyles: Record<string, string> = {
  RECEIVED: 'bg-amber-50 text-amber-700',
  DIAGNOSING: 'bg-sky-50 text-sky-700',
  AWAITING_APPROVAL: 'bg-violet-50 text-violet-700',
  APPROVED: 'bg-teal-50 text-teal-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  AWAITING_PARTS: 'bg-orange-50 text-orange-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  READY_FOR_PICKUP: 'bg-lime-50 text-lime-700',
  DELIVERED: 'bg-slate-100 text-slate-600',
  CANCELLED: 'bg-red-50 text-red-700',
  DRAFT: 'bg-slate-100 text-slate-600',
  ISSUED: 'bg-blue-50 text-blue-700',
  PART_PAID: 'bg-amber-50 text-amber-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  OVERDUE: 'bg-red-50 text-red-700',
  VOID: 'bg-slate-100 text-slate-500',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  ARCHIVED: 'bg-slate-100 text-slate-500',
};
