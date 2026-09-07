import React, { useCallback, useState } from 'react';
import ScrapRecordsHistory from './ScrapRecordsHistory';

export default function ScrapRecordsPage({ can, onNotice }: { can: (p: string) => boolean; onNotice: (m: string) => void }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div>
      <div className="page-heading">
        <div><p className="eyebrow">Scrap yard</p><h1>Daily Records</h1><p className="muted">Every day&apos;s scrap purchases, expenses and cash, drillable to the transaction.</p></div>
      </div>
      <ScrapRecordsHistory can={can} onNotice={onNotice} onRefresh={refresh} refreshKey={refreshKey} />
    </div>
  );
}
