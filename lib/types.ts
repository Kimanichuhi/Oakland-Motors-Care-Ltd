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
  make: string | null;
  model: string | null;
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
  vehicle_make: string | null;
  vehicle_model: string | null;
  model_year_version: string | null;
  compatible_vehicle: string | null;
  supplier_id: string | null;
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
  other_charges_minor: number;
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

export type GeneralReceipt = {
  id: string;
  receipt_number: string;
  receipt_date: string;
  client_name: string;
  client_phone: string | null;
  payment_method: 'CASH' | 'MPESA' | 'BANK' | 'CARD' | 'OTHER';
  total_minor: number;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type GeneralReceiptItem = {
  id: string;
  general_receipt_id: string;
  description: string;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
  created_at: string;
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
  reference_id: string | null;
  user_id: string | null;
  created_at: string;
};

export type Sale = {
  id: string;
  sale_number: string;
  sale_date: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_type: 'WALK_IN' | 'VEHICLE_OWNER' | 'BUSINESS' | 'GARAGE_WORKSHOP' | 'OTHER';
  salesperson_id: string | null;
  salesperson_name: string | null;
  technician_id: string | null;
  technician_name: string | null;
  payment_method: 'CASH' | 'MPESA' | 'BANK' | 'CARD' | 'CREDIT' | 'JOB_CARD' | 'OTHER';
  payment_status: 'PAID' | 'PARTIAL' | 'PENDING';
  status: 'COMPLETED' | 'PARTIALLY_RETURNED' | 'RETURNED' | 'VOIDED';
  subtotal_minor: number;
  discount_minor: number;
  total_minor: number;
  amount_paid_minor: number;
  balance_minor: number;
  payment_reference: string | null;
  payment_reference_at: string | null;
  job_card_id: string | null;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  part_id: string;
  part_name: string;
  part_sku: string;
  category: string | null;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
  returned_quantity: number;
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

export type DebtRecord = {
  id: string;
  debt_type: 'CUSTOMER' | 'STAFF';
  responsible_employee_id: string | null;
  responsible_name: string;
  customer_id: string | null;
  job_card_id: string | null;
  part_id: string | null;
  item_description: string;
  amount_minor: number;
  amount_recovered_minor: number;
  status: 'OUTSTANDING' | 'PARTIALLY_RECOVERED' | 'RECOVERED' | 'WRITTEN_OFF';
  incurred_date: string;
  notes: string | null;
  write_off_reason: string | null;
  created_at: string;
  updated_at: string;
  recovered_at: string | null;
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

export type ScrapItem = {
  id: string;
  name: string;
  current_rate_minor: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type StockCycle = {
  id: string;
  scrap_item_id: string;
  cycle_number: number;
  opening_quantity: number;
  opening_date: string;
  current_quantity: number;
  closing_quantity: number | null;
  closing_date: string | null;
  status: 'OPEN' | 'CLOSED';
  notes: string | null;
  created_at: string;
};

export type ScrapCurrentStockRow = {
  scrap_item_id: string;
  name: string;
  current_rate_minor: number | null;
  active: boolean;
  stock_cycle_id: string | null;
  cycle_number: number | null;
  opening_quantity: number | null;
  opening_date: string | null;
  current_quantity: number;
};

export type ScrapDailyRecord = {
  id: string;
  date: string;
  previous_closing_cash_minor: number;
  cash_added_minor: number;
  cash_available_minor: number;
  total_kg_purchased: number;
  total_scrap_purchase_minor: number;
  total_expenses_minor: number;
  closing_cash_minor: number;
  has_discrepancy: boolean;
  notes: string | null;
  status: 'ACTIVE' | 'VOID';
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ScrapPurchase = {
  id: string;
  daily_record_id: string | null;
  scrap_item_id: string;
  stock_cycle_id: string;
  rate_used_minor: number;
  opening_stock: number;
  quantity_purchased: number;
  purchase_amount_minor: number;
  closing_stock: number;
  date: string;
  change_in_days: number;
  supplier: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'VOID';
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ScrapExpense = {
  id: string;
  daily_record_id: string | null;
  category: string;
  amount_minor: number;
  description: string | null;
  date: string;
  change_in_days: number;
  notes: string | null;
  status: 'ACTIVE' | 'VOID';
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CashTransaction = {
  id: string;
  date: string;
  change_in_days: number;
  transaction_type: 'CASH_ADDED' | 'ADJUSTMENT';
  amount_minor: number;
  added_by: string | null;
  reason: string | null;
  reference: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'VOID';
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ScrapCashSummary = {
  date: string;
  opening_cash_minor: number;
  cash_added_minor: number;
  purchases_minor: number;
  expenses_minor: number;
  adjustments_minor: number;
  closing_cash_minor: number;
  total_kg_purchased: number;
  has_discrepancy: boolean;
  updated_at: string;
};

export type ScrapStockAdjustment = {
  id: string;
  scrap_item_id: string;
  stock_cycle_id: string;
  date: string;
  adjustment_type: 'CLEARANCE' | 'OPENING' | 'CORRECTION_INCREASE' | 'CORRECTION_DECREASE';
  quantity: number;
  previous_stock: number;
  resulting_stock: number;
  reason: string;
  authorized_by: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type ScrapClearanceSale = {
  id: string;
  stock_adjustment_id: string;
  amount_minor: number;
  buyer: string | null;
  reference: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
};

export type ScrapSettings = {
  id: boolean;
  opening_cash_minor: number | null;
  opening_cash_date: string | null;
  opening_notes: string | null;
  established_by: string | null;
  established_at: string | null;
};

export type VehicleRegisterEntry = {
  id: string;
  date: string;
  registration_number: string;
  make_model: string;
  time_in: string;
  time_out: string | null;
  status: 'ACTIVE' | 'VOID';
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
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
