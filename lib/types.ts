export type Customer = {
  id: string;
  full_name: string;
  company_name: string | null;
  customer_type: 'INDIVIDUAL' | 'COMPANY';
  phone: string;
  alternative_phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  created_at: string;
};

export type Vehicle = {
  id: string;
  customer_id: string;
  registration_number: string;
  make: string;
  model: string;
  year: number | null;
  vin: string | null;
  mileage: number;
  colour: string | null;
  engine_number: string | null;
  fuel_type: string | null;
  transmission: string | null;
  notes: string | null;
  created_at: string;
};

export type Service = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  standard_price_minor: number;
  estimated_minutes: number;
  tax_rate: number;
  active: boolean;
};

export type Part = {
  id: string;
  sku: string;
  name: string;
  category: string;
  brand: string | null;
  cost_price_minor: number;
  selling_price_minor: number;
  quantity_on_hand: number;
  reorder_level: number;
  location: string | null;
  active: boolean;
};

export type Supplier = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  payment_terms: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
};

export type JobCard = {
  id: string;
  job_number: string;
  customer_id: string;
  vehicle_id: string;
  mileage: number;
  complaint: string;
  requested_service: string | null;
  recommended_work: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: string;
  job_types: string[];
  promised_at: string | null;
  received_at: string | null;
  released_at: string | null;
  estimated_completion_date: string | null;
  created_at: string;
};

export type JobCardInspectionItem = {
  id: string;
  job_card_id: string;
  category: 'ENGINE' | 'TRANSMISSION' | 'BRAKES' | 'SUSPENSION' | 'ELECTRICAL' | 'TYRES' | 'BODY_PAINT' | 'OTHER';
  condition: 'NORMAL' | 'REQUIRES_ATTENTION' | 'DAMAGED' | 'NOT_CHECKED';
  notes: string | null;
  checked_by: string | null;
  checked_at: string;
};

export type JobCardWorkItem = {
  id: string;
  job_card_id: string;
  description: string;
  assigned_technician_id: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type JobCardDiagnosis = {
  id: string;
  job_card_id: string;
  findings: string;
  fault_codes: string | null;
  observations: string | null;
  recommended_repairs: string | null;
  technician_id: string | null;
  created_at: string;
};

export type JobCardQualityCheck = {
  id: string;
  job_card_id: string;
  checklist: Record<string, boolean>;
  result: 'PASSED' | 'FAILED' | 'REWORK_REQUIRED';
  notes: string | null;
  checked_by: string | null;
  checked_at: string;
};

export type JobCardSignoff = {
  id: string;
  job_card_id: string;
  role: 'ADVISOR' | 'TECHNICIAN' | 'QUALITY_CHECK' | 'CUSTOMER';
  name: string;
  signed_at: string;
  user_id: string | null;
};

export type JobCardLabour = {
  id: string;
  job_card_id: string;
  service_id: string | null;
  description: string;
  quantity: number;
  unit_price_minor: number;
  tax_rate: number;
};

export type JobCardPart = {
  id: string;
  job_card_id: string;
  part_id: string;
  quantity: number;
  unit_price_minor: number;
  issued_at: string | null;
};

export type JobCardStatusHistory = {
  id: string;
  job_card_id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string | null;
  changed_at: string;
};

export type Invoice = {
  id: string;
  invoice_number: string;
  customer_id: string;
  vehicle_id: string | null;
  job_card_id: string | null;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  amount_paid_minor: number;
  due_date: string | null;
  status: 'DRAFT' | 'ISSUED' | 'PART_PAID' | 'PAID' | 'OVERDUE' | 'VOID';
  created_at: string;
};

export type InvoiceItem = {
  id: string;
  invoice_id: string;
  item_type: 'LABOUR' | 'PART' | 'OTHER';
  description: string;
  quantity: number;
  unit_price_minor: number;
  tax_rate: number;
  line_total_minor: number;
};

export type Payment = {
  id: string;
  invoice_id: string;
  amount_minor: number;
  method: 'CASH' | 'MPESA' | 'BANK' | 'CARD' | 'OTHER';
  reference: string | null;
  paid_at: string;
  recorded_by: string | null;
  notes: string | null;
};

export type Quotation = {
  id: string;
  quote_number: string;
  customer_id: string;
  vehicle_id: string | null;
  job_card_id: string | null;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  valid_until: string | null;
  terms: string | null;
  notes: string | null;
  status: 'DRAFT' | 'SENT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
};

export type QuotationItem = {
  id: string;
  quotation_id: string;
  item_type: 'LABOUR' | 'PART' | 'OTHER';
  description: string;
  quantity: number;
  unit_price_minor: number;
  tax_rate: number;
  line_total_minor: number;
};

export type PurchaseOrder = {
  id: string;
  po_number: string;
  supplier_id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  order_date: string;
  expected_delivery: string | null;
  received_date: string | null;
  notes: string | null;
  total_minor: number;
  created_at: string;
};

export type PurchaseOrderItem = {
  id: string;
  purchase_order_id: string;
  part_id: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost_minor: number;
  line_total_minor: number;
};

export type StockMovement = {
  id: string;
  part_id: string;
  movement_type: string;
  quantity: number;
  previous_balance: number;
  new_balance: number;
  unit_cost_minor: number;
  reason: string | null;
  reference: string | null;
  created_at: string;
};

export type Employee = {
  id: string;
  user_id: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: string;
  specialization: string | null;
  active: boolean;
};

export type Notification = {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  read_at: string | null;
  created_at: string;
};

export type AuditLog = {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type BusinessSettings = {
  id: string;
  business_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  tax_rate: number;
  currency: string;
  invoice_prefix: string;
  quote_prefix: string;
  job_card_prefix: string;
  receipt_prefix: string;
  job_card_terms: string;
};

export type Role = { id: string; name: string; label: string };
export type Permission = { id: string; key: string; label: string };

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  job_title: string | null;
  avatar_url: string | null;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  invited_at: string | null;
  activated_at: string | null;
};
