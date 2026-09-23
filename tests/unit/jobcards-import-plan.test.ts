import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseJobCardsCSV, planJobCardRows, customerKey, vehicleKey, WALK_IN_CUSTOMER_NAME,
  type ExistingCustomer, type ExistingVehicle,
} from '@/lib/jobCardsImport';

function maps(customerNames: string[], vehicleRegs: string[]) {
  const customersByKey = new Map<string, ExistingCustomer>(customerNames.map((n, i) => [customerKey(n), { id: `cust-${i}`, full_name: n }]));
  const vehiclesByKey = new Map<string, ExistingVehicle>(vehicleRegs.map((r, i) => [vehicleKey(r), { id: `veh-${i}`, customer_id: 'cust-0', registration_number: r }]));
  return { customersByKey, vehiclesByKey };
}

const HEADER = 'Date In,Customer Name,Customer Phone,Registration Number,Make,Model,Technician,Reason / Service Required,Job Card No.,Total Charge,Amount Paid,Payment Status,Amount Owed,Mpesa Code,Job Status';

describe('parseJobCardsCSV', () => {
  it('reads a header-keyed row and drops fully blank rows', () => {
    const csv = [HEADER, '12 Aug 2026,,,KCE720A,,,MUIGAI,Welding,JB-001,100,100,Paid,0,UHDDM2T6XW,Completed', ',,,,,,,,,,,,,,'].join('\r\n');
    const rows = parseJobCardsCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].registrationNumber).toBe('KCE720A');
    expect(rows[0].jobStatus).toBe('Completed');
  });
});

describe('planJobCardRows', () => {
  it('plans a paid, completed row with a technician assigned', () => {
    const { customersByKey, vehiclesByKey } = maps([WALK_IN_CUSTOMER_NAME], ['KCE720A']);
    const rows = parseJobCardsCSV([HEADER, '12 Aug 2026,,,KCE720A,,,MUIGAI,Welding,JB-001,100,100,Paid,0,UHDDM2T6XW,Completed'].join('\n'));
    const planned = planJobCardRows(rows, customersByKey, vehiclesByKey);
    expect(planned[0].action).toBe('CREATE');
    expect(planned[0].payload).toMatchObject({
      complaint: 'Welding', otherChargesMinor: 10000, targetStatuses: ['OPEN', 'IN_PROGRESS', 'COMPLETED'],
      technicianName: 'MUIGAI', payment: { amountMinor: 10000, method: 'MPESA', reference: 'UHDDM2T6XW' },
    });
  });

  it('plans an unpaid, pending row with no payment and no technician', () => {
    const { customersByKey, vehiclesByKey } = maps([WALK_IN_CUSTOMER_NAME], ['KCG695A']);
    const rows = parseJobCardsCSV([HEADER, '3 Sep 2026,,,KCG695A,Probox,,,FULL BODY,JB-051,2000,0,Unpaid,2000,,Pending'].join('\n'));
    const planned = planJobCardRows(rows, customersByKey, vehiclesByKey);
    expect(planned[0].action).toBe('CREATE');
    expect(planned[0].payload).toMatchObject({ targetStatuses: ['OPEN'], payment: null, technicianName: null });
  });

  it('plans a partially paid, in-progress row for the partial amount only', () => {
    const { customersByKey, vehiclesByKey } = maps(['MALAENGE'], ['KAA000A']);
    const rows = parseJobCardsCSV([HEADER, '4 Sep 2026,MALAENGE,0789357044,KAA000A,,,,FULL BODY,JB-053,2000,1000,Partially Paid,1000,,In Progress'].join('\n'));
    const planned = planJobCardRows(rows, customersByKey, vehiclesByKey);
    expect(planned[0].payload).toMatchObject({ targetStatuses: ['OPEN', 'IN_PROGRESS'], payment: { amountMinor: 100000, method: 'CASH', reference: null } });
  });

  it('maps "On Hold" to OPEN with a warning', () => {
    const { customersByKey, vehiclesByKey } = maps([WALK_IN_CUSTOMER_NAME], ['KBP568L']);
    const rows = parseJobCardsCSV([HEADER, '16 Sep 2026,,,KBP568L,WISH,,,ACCIDENT,JB-076,2000,0,Unpaid,2000,,On Hold'].join('\n'));
    const planned = planJobCardRows(rows, customersByKey, vehiclesByKey);
    expect(planned[0].payload?.targetStatuses).toEqual(['OPEN']);
    expect(planned[0].warnings.some((w) => w.includes('On Hold'))).toBe(true);
  });

  it('errors when the customer has not been resolved/created', () => {
    const { customersByKey, vehiclesByKey } = maps([], ['KCE720A']);
    const rows = parseJobCardsCSV([HEADER, '12 Aug 2026,,,KCE720A,,,MUIGAI,Welding,JB-001,100,100,Paid,0,,Completed'].join('\n'));
    const planned = planJobCardRows(rows, customersByKey, vehiclesByKey);
    expect(planned[0].action).toBe('ERROR');
    expect(planned[0].errors[0]).toMatch(/Customer/);
  });

  it('errors when the vehicle has not been resolved/created', () => {
    const { customersByKey, vehiclesByKey } = maps([WALK_IN_CUSTOMER_NAME], []);
    const rows = parseJobCardsCSV([HEADER, '12 Aug 2026,,,KCE720A,,,MUIGAI,Welding,JB-001,100,100,Paid,0,,Completed'].join('\n'));
    const planned = planJobCardRows(rows, customersByKey, vehiclesByKey);
    expect(planned[0].action).toBe('ERROR');
    expect(planned[0].errors[0]).toMatch(/Vehicle/);
  });

  it('errors on a future-dated row', () => {
    const { customersByKey, vehiclesByKey } = maps([WALK_IN_CUSTOMER_NAME], ['KCE720A']);
    const rows = parseJobCardsCSV([HEADER, '1 Jan 2099,,,KCE720A,,,MUIGAI,Welding,JB-001,100,100,Paid,0,,Completed'].join('\n'));
    const planned = planJobCardRows(rows, customersByKey, vehiclesByKey);
    expect(planned[0].action).toBe('ERROR');
    expect(planned[0].errors[0]).toMatch(/future/);
  });

  it('treats a blank/NULL Total Charge as KES 0 with a warning, not a hard error', () => {
    const { customersByKey, vehiclesByKey } = maps([WALK_IN_CUSTOMER_NAME], ['KDB152J']);
    const rows = parseJobCardsCSV([HEADER, '21 Sep 2026,,,KDB152J,Nissan,Tiana,VINNIE,Service,JB-094,NULL,,Unpaid,0,,Pending'].join('\n'));
    const planned = planJobCardRows(rows, customersByKey, vehiclesByKey);
    expect(planned[0].action).toBe('CREATE');
    expect(planned[0].payload?.otherChargesMinor).toBe(0);
    expect(planned[0].warnings.some((w) => w.includes('Total Charge'))).toBe(true);
  });
});

describe('planJobCardRows against the real daily jobcards ledger', () => {
  it('plans every row, flagging only the rows the source file is genuinely missing data for', () => {
    const csvPath = join(__dirname, '../../daily jobcards.csv');
    const rawRows = parseJobCardsCSV(readFileSync(csvPath, 'utf8'));

    const customerNames = new Set<string>();
    const vehicleRegs = new Set<string>();
    for (const r of rawRows) {
      customerNames.add(r.customerName.trim() || WALK_IN_CUSTOMER_NAME);
      if (r.registrationNumber.trim()) vehicleRegs.add(r.registrationNumber.trim());
    }
    const { customersByKey, vehiclesByKey } = maps(Array.from(customerNames), Array.from(vehicleRegs));

    const planned = planJobCardRows(rawRows, customersByKey, vehiclesByKey);
    const errorRows = planned.filter((r) => r.action === 'ERROR');
    // Three rows in the source file are genuinely incomplete — no registration
    // number (row 54) or no reason/service description (rows 81, 94). These
    // can't be safely guessed at, so they're expected to need a manual fix in
    // the CSV rather than a planner bug.
    expect(errorRows.map((r) => r.rowNumber)).toEqual([54, 81, 94]);
    expect(planned.length).toBe(rawRows.length);
  });
});
