import { Capacitor } from '@capacitor/core';

/** A report table: heading, column names, rows. */
export interface ReportTable { heading: string; head: string[]; body: (string | number)[][]; }

/** Save a file: download in a browser; on the Android app, open the share sheet (save to Files, WhatsApp, email …). */
export async function saveFile(name: string, blob: Blob) {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const data = await new Promise<string>((ok, bad) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1] ?? '');
      r.onerror = () => bad(r.error);
      r.readAsDataURL(blob);
    });
    const file = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
    await Share.share({ title: name, url: file.uri, dialogTitle: 'Save or send the report' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Excel opens this directly (CSV with a UTF-8 mark so "KSh" and names show correctly). */
export function excelCsv(title: string, tables: ReportTable[]): Blob {
  const cell = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [cell(title), ''];
  for (const t of tables) {
    lines.push(cell(t.heading), t.head.map(cell).join(','), ...t.body.map((r) => r.map(cell).join(',')), '');
  }
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

/** A printable PDF with one table per section (the PDF library loads only when needed). */
export async function pdfReport(title: string, subtitle: string, tables: ReportTable[]): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(16);
  doc.text(title, 40, 48);
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(subtitle, 40, 66);
  doc.setTextColor(0);
  let y = 86;
  for (const t of tables) {
    if (y > 740) { doc.addPage(); y = 48; }
    doc.setFontSize(12);
    doc.text(t.heading, 40, y);
    autoTable(doc, {
      startY: y + 8, head: [t.head], body: t.body.map((r) => r.map(String)), margin: { left: 40, right: 40 },
      styles: { fontSize: 9, cellPadding: 4 }, headStyles: { fillColor: [123, 30, 46] },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 26;
  }
  return doc.output('blob');
}
