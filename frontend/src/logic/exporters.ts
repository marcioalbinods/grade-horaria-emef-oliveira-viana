import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Report } from './reports';
import { contrastText, downloadBlob, safeFile } from './util';

function stamp() {
  return new Date().toLocaleString('pt-BR');
}

function csvCell(v: string | number) {
  const s = String(v ?? '').replace(/\n/g, ' / ');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(r: Report): string {
  const lines: string[] = [];
  for (const t of r.tables) {
    lines.push(csvCell(t.title));
    if (t.subtitle) lines.push(csvCell(t.subtitle));
    lines.push(t.head.map(csvCell).join(';'));
    for (const row of t.rows) lines.push(row.map(csvCell).join(';'));
    lines.push('');
  }
  return lines.join('\r\n');
}

export function exportCsv(r: Report, school: string) {
  // BOM para o Excel reconhecer acentuação; separador ";" (padrão brasileiro)
  const blob = new Blob(['﻿' + reportToCsv(r)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, safeFile(`${school} - ${r.title}.csv`));
}

export function reportToWorkbook(r: Report): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const sheetName = (s: string) => {
    let base = s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || 'Planilha';
    let name = base, i = 2;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 25)} ${i++}`;
    used.add(name.toLowerCase());
    return name;
  };
  const single = r.tables.length > 40; // muitas tabelas: tudo em uma planilha
  if (single) {
    const aoa: (string | number)[][] = [];
    for (const t of r.tables) {
      aoa.push([t.title]);
      if (t.subtitle) aoa.push([t.subtitle]);
      aoa.push(t.head, ...t.rows, []);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName(r.title));
  } else {
    for (const t of r.tables) {
      const aoa: (string | number)[][] = [[t.title]];
      if (t.subtitle) aoa.push([t.subtitle]);
      aoa.push(t.head, ...t.rows);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = t.head.map((_, i) => ({ wch: i < 2 && t.grid ? 10 : 24 }));
      XLSX.utils.book_append_sheet(wb, ws, sheetName(t.title));
    }
  }
  return wb;
}

export function exportXlsx(r: Report, school: string) {
  const wb = reportToWorkbook(r);
  XLSX.writeFile(wb, safeFile(`${school} - ${r.title}.xlsx`));
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function reportToPdf(r: Report, school: string): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  r.tables.forEach((t, i) => {
    if (i > 0 && (t.grid || (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY > 420)) doc.addPage();
    const startY = i === 0 || t.grid ? 40 : (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 30;
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`${school} · ${r.title}`, 40, startY - 18);
    doc.text(`Emitido em ${stamp()}`, W - 40, startY - 18, { align: 'right' });
    doc.setFontSize(13);
    doc.setTextColor(20);
    doc.text(t.title, 40, startY);
    let y = startY + 6;
    if (t.subtitle) {
      doc.setFontSize(9);
      doc.setTextColor(80);
      doc.text(doc.splitTextToSize(t.subtitle, W - 80), 40, startY + 14);
      y = startY + 22;
    }
    autoTable(doc, {
      startY: y,
      head: [t.head],
      body: t.rows.map((row) => row.map((c) => String(c))),
      styles: { fontSize: t.grid ? 8 : 8.5, cellPadding: 3, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: [30, 64, 175], textColor: 255, halign: 'center' },
      columnStyles: t.grid ? { 0: { cellWidth: 32, halign: 'center' }, 1: { cellWidth: 62, halign: 'center' } } : {},
      bodyStyles: t.grid ? { halign: 'center', minCellHeight: 26 } : {},
      margin: { left: 40, right: 40 },
      didParseCell: (h) => {
        if (h.section !== 'body' || !t.colors) return;
        const col = t.colors[h.row.index]?.[h.column.index];
        if (col) {
          h.cell.styles.fillColor = hexToRgb(col);
          h.cell.styles.textColor = contrastText(col) === '#ffffff' ? 255 : 20;
        }
      },
    });
  });
  return doc;
}

export function exportPdf(r: Report, school: string) {
  reportToPdf(r, school).save(safeFile(`${school} - ${r.title}.pdf`));
}
