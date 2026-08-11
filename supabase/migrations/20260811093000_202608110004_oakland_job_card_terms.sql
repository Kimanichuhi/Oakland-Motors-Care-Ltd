/*
# Oakland Motor Care Ltd Job Card module — configurable Terms & Conditions

1. Purpose
- The printable Job Card must show approved Terms & Conditions, editable via
  Settings rather than hard-coded into the frontend (spec Part 23).
- Reuses business_settings (already the business-wide settings singleton) rather than
  introducing a separate document_templates table for a single text field.
*/
alter table public.business_settings add column if not exists job_card_terms text not null default
  'Vehicles are received on the understanding that Oakland Motor Care Ltd is not responsible for loss or damage to the vehicle or its contents from causes beyond its control, including fire, theft, or accident. Estimates are approximate; the customer will be notified of significant additional work before it is carried out. Storage charges may apply to vehicles not collected within 7 days of notification of completion. Payment is due in full on collection unless otherwise agreed in writing.';
