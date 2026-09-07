import React, { useState } from 'react';
import { Download } from 'lucide-react';
import ScrapReports from './ScrapReports';
import ScrapExportDialog from './ScrapExportDialog';

export default function ScrapReportsPage({ can }: { can: (p: string) => boolean }) {
  const [showExportDialog, setShowExportDialog] = useState(false);

  return (
    <div>
      <div className="page-heading">
        <div><p className="eyebrow">Scrap yard</p><h1>Reports</h1><p className="muted">Monthly and daily scrap activity, stock position, cycles and clearances.</p></div>
        {can('scrap.manage') && <div className="heading-actions"><button className="button secondary" onClick={() => setShowExportDialog(true)}><Download size={16} /> Export CSV</button></div>}
      </div>
      <ScrapReports />
      {showExportDialog && <ScrapExportDialog onClose={() => setShowExportDialog(false)} />}
    </div>
  );
}
