import React, { useEffect, useRef, useState } from 'react';
import { copyUploadErrorReport, exportUploadErrorReportPdf, printUploadErrorReport, type UploadErrorReport } from '@/lib/uploadErrorReport';
import { Printer, FileDown, Copy, Check } from 'lucide-react';

/** Print / Export PDF / Copy for a bulk upload's error report. `getReport` is
 * called on click so the report always reflects the latest rows. */
export default function UploadErrorReportActions({ getReport, compact = false, style }: { getReport: () => UploadErrorReport; compact?: boolean; style?: React.CSSProperties }) {
  const [exporting, setExporting] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [exportFailed, setExportFailed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  const buttonClass = `button secondary${compact ? ' small' : ''}`;
  const iconSize = compact ? 14 : 16;

  async function exportPdf() {
    setExporting(true); setExportFailed(false);
    try { await exportUploadErrorReportPdf(getReport()); } catch { setExportFailed(true); } finally { setExporting(false); }
  }

  async function copy() {
    try { await copyUploadErrorReport(getReport()); setCopyState('copied'); } catch { setCopyState('failed'); }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState('idle'), 2500);
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', ...style }}>
      <button type="button" className={buttonClass} onClick={() => printUploadErrorReport(getReport())} title="Print the error report"><Printer size={iconSize} /> Print</button>
      <button type="button" className={buttonClass} disabled={exporting} onClick={() => void exportPdf()} title="Download the error report as a PDF file"><FileDown size={iconSize} /> {exporting ? 'Exporting…' : exportFailed ? 'Export failed — retry' : 'Export PDF'}</button>
      <button type="button" className={buttonClass} onClick={() => void copy()} title="Copy the error report to paste into WhatsApp, email or Excel">
        {copyState === 'copied' ? <><Check size={iconSize} /> Copied</> : <><Copy size={iconSize} /> {copyState === 'failed' ? 'Copy failed' : 'Copy'}</>}
      </button>
    </div>
  );
}
