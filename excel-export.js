(function () {
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function xlsxEscape(value) {
    return String(value ?? '').replace(/[<>&"']/g, ch => ({
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;'
    }[ch]));
  }

  function cleanSheetName(name) {
    return String(name).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31);
  }

  function reportFileName(trip) {
    const clean = (trip.name || 'trip-vault')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    return `${clean || 'trip-vault'}-expense-report.xlsx`;
  }

  function colName(index) {
    let name = '';
    let n = index + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function cellXml(cell, rowIndex, colIndex) {
    const spec = typeof cell === 'object' && cell !== null && !Array.isArray(cell) ? cell : { value: cell };
    const value = spec.value ?? '';
    const ref = `${colName(colIndex)}${rowIndex}`;
    const style = spec.style ?? 0;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    }
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${xlsxEscape(value)}</t></is></c>`;
  }

  function rowsXml(rows) {
    return rows.map((row, r) => {
      const rowIndex = r + 1;
      return `<row r="${rowIndex}">${row.map((cell, c) => cellXml(cell, rowIndex, c)).join('')}</row>`;
    }).join('');
  }

  function worksheetXml(rows, widths) {
    const cols = widths?.length
      ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 ${cols}
 <sheetData>${rowsXml(rows)}</sheetData>
</worksheet>`;
  }

  function header(values) {
    return values.map(value => ({ value, style: 2 }));
  }

  function title(value) {
    return [{ value, style: 1 }];
  }

  function keyValue(label, value) {
    return [{ value: label, style: 3 }, { value, style: 3 }];
  }

  function paymentLabel(value) {
    if (typeof getPaymentMethod === 'function') return getPaymentMethod(value || 'Cash');
    return value || 'Cash';
  }

  function calcWidths(rows) {
    if (!rows || rows.length === 0) return [];
    const colsCount = rows.reduce((max, row) => Math.max(max, row.length || 0), 0);
    const widths = Array(colsCount).fill(12); // Minimum width
    rows.forEach(row => {
      for (let i = 0; i < colsCount; i++) {
        const cell = row[i];
        if (cell === undefined || cell === null) continue;
        const val = (typeof cell === 'object' && !Array.isArray(cell)) ? (cell.value ?? '') : cell;
        const len = String(val).length;
        const desired = Math.min(len + 4, 255); // Excel max column width
        if (desired > widths[i]) widths[i] = desired;
      }
    });
    return widths;
  }

  function settlementStatus(settlement) {
    return (settlement.status || 'confirmed') === 'confirmed' ? 'Confirmed received' : 'Awaiting receiver confirmation';
  }

  function buildWorkbookModel(trip) {
    const members = Object.values(trip.members || {});
    const poolUsed = calcPoolContributionUsage(trip);
    const balances = calcBalances();
    const due = calcSettlements();
    const allSettlements = trip.settlements || [];
    const confirmedSettlements = allSettlements.filter(s => (s.status || 'confirmed') === 'confirmed');
    const awaitingSettlements = allSettlements.filter(s => (s.status || 'confirmed') === 'pending_confirmation');
    const poolContrib = (trip.transactions || []).filter(t => t.type === 'pool');
    const totalContrib = members.reduce((s, m) => money(s + (m.contribution || 0)), 0);
    const poolSpent = (trip.expenses || []).reduce((s, e) => money(s + (isPoolExpense(trip, e) ? e.amount : 0)), 0);
    const personalSpent = (trip.expenses || []).reduce((s, e) => money(s + (!isPoolExpense(trip, e) ? e.amount : 0)), 0);
    const pendingTotal = due.reduce((s, r) => money(s + r.amount), 0);
    const confirmedTotal = confirmedSettlements.reduce((s, r) => money(s + r.amount), 0);
    const awaitingTotal = awaitingSettlements.reduce((s, r) => money(s + r.amount), 0);

    const summary = [
      title('Trip Vault Expense Report 🚀'),
      keyValue('Trip Name 🏖️', trip.name),
      keyValue('Join Code 🔑', trip.code),
      keyValue('Exported At 🕒', formatDateTime(Date.now())),
      keyValue('Members 👥', members.length),
      keyValue('Total Pool Contributions 💰', totalContrib),
      keyValue('Current Pool Balance 💵', trip.currentPool || 0),
      keyValue('Total Spent 💸', poolSpent + personalSpent),
      keyValue('Pending Reimbursements ⏳', pendingTotal),
    ];

    const memberRows = [
      header(['Member', 'Role', 'Contributed', 'Pool Used', 'Pool Remaining', 'Net Balance']),
      ...members.map(m => {
        const used = poolUsed[m.id] || 0;
        const bal = balances[m.id] || 0;
        return [
          m.name,
          m.id === trip.adminId ? 'Admin' : 'Member',
          { value: m.contribution || 0, style: 4 },
          { value: used, style: 4 },
          { value: Math.max(0, money((m.contribution || 0) - used)), style: 4 },
          { value: bal, style: bal < 0 ? 6 : 5 }
        ];
      })
    ];

    const expenseRowsHeader = header(['Date', 'Description', 'Category', 'Paid By', 'Amount', 'Payment Method', 'Split Type']);
    members.forEach(m => expenseRowsHeader.push({ value: m.name + ' Share', style: 2 }));
    
    const expenseRows = [
      expenseRowsHeader,
      ...(trip.expenses || []).map(e => {
        const row = [
          formatDateTime(e.timestamp),
          e.desc,
          e.category,
          getMemberName(trip, e.paidBy),
          { value: e.amount || 0, style: 4 },
          paymentLabel(e.paymentMethod),
          e.splitLabel || ''
        ];
        members.forEach(m => row.push({ value: (e.splits && e.splits[m.id]) || 0, style: 4 }));
        return row;
      })
    ];

    const splitRows = [header(['Expense Date', 'Expense', 'Paid By', 'Split Member', 'Share Amount'])];
    (trip.expenses || []).forEach(e => {
      Object.entries(e.splits || {}).forEach(([memberId, amount]) => {
        splitRows.push([
          formatDateTime(e.timestamp),
          e.desc,
          getMemberName(trip, e.paidBy),
          getMemberName(trip, memberId),
          { value: amount || 0, style: 4 }
        ]);
      });
    });

    const contributionRows = [
      header(['Date', 'Member', 'Payment Method', 'Amount', 'Recorded Note']),
      ...poolContrib.map(t => [
        formatDateTime(t.timestamp),
        getMemberName(trip, t.userId),
        paymentLabel(t.paymentMethod),
        { value: t.amount || 0, style: 4 },
        t.desc
      ])
    ];

    const reimbursementRows = [
      header(['From', 'To', 'Amount Due', 'Status']),
      ...due.map(r => [
        getMemberName(trip, r.from),
        getMemberName(trip, r.to),
        { value: r.amount || 0, style: 6 },
        'Pending payment'
      ]),
      ...awaitingSettlements.map(s => [
        getMemberName(trip, s.from),
        getMemberName(trip, s.to),
        { value: s.amount || 0, style: 6 },
        'Paid, awaiting receiver confirmation'
      ])
    ];

    const disbursementRows = [
      header(['Paid At', 'Confirmed At', 'From', 'To', 'Payment Method', 'Amount', 'Status', 'Recorded By', 'Confirmed By']),
      ...allSettlements.map(s => [
        formatDateTime(s.paidAt || s.timestamp),
        s.confirmedAt ? formatDateTime(s.confirmedAt) : '',
        getMemberName(trip, s.from),
        getMemberName(trip, s.to),
        paymentLabel(s.paymentMethod),
        { value: s.amount || 0, style: (s.status || 'confirmed') === 'confirmed' ? 5 : 6 },
        settlementStatus(s),
        getMemberName(trip, s.recordedBy || s.from),
        getMemberName(trip, s.confirmedBy)
      ])
    ];

    const txRows = [
      header(['Date', 'Type', 'Member', 'Payment Method', 'Amount', 'Description']),
      ...(trip.transactions || []).map(t => [
        formatDateTime(t.timestamp),
        t.type,
        getMemberName(trip, t.userId),
        t.paymentMethod || '',
        { value: t.amount || 0, style: t.type === 'expense' ? 6 : 4 },
        t.desc
      ])
    ];

    const detailedLogsRows = [
      title('Trip Detailed Logs 🕵️'),
      header(['Timestamp', 'Action Type', 'Description', 'Member Involved', 'Amount Transacted', 'Method']),
      ...(trip.transactions || []).map(t => {
        let amtStyle = 3;
        if (t.type === 'expense') amtStyle = 6;
        else if (t.type === 'pool' || t.type === 'settlement') amtStyle = 5;
        
        return [
          formatDateTime(t.timestamp),
          t.type.toUpperCase(),
          t.desc,
          getMemberName(trip, t.userId) || 'System',
          { value: t.amount || 0, style: amtStyle },
          t.paymentMethod || 'N/A'
        ];
      })
    ];

    const auditRows = [
      title('Notes & Tips 💡'),
      ['Welcome to the Trip Vault!', 'This sheet helps you audit everyone\'s contributions effortlessly.', {value: '', style: 2}],
      ['Reimbursements', 'Pending means calculated but unpaid. Confirmed means safely received.', {value: '', style: 2}],
      ['Colors', 'Green = Received/Pool Added. Red = Money spent/Due to pay.', {value: '', style: 2}],
      ['Security', 'No passwords are ever exported in this Excel file.', {value: '', style: 2}],
    ];

    return [
      { name: 'Summary', widths: calcWidths(summary), rows: summary },
      { name: 'Members', widths: calcWidths(memberRows), rows: memberRows },
      { name: 'Expenses', widths: calcWidths(expenseRows), rows: expenseRows },
      { name: 'Expense Splits', widths: calcWidths(splitRows), rows: splitRows },
      { name: 'Pool Contributions', widths: calcWidths(contributionRows), rows: contributionRows },
      { name: 'Reimbursements Due', widths: calcWidths(reimbursementRows), rows: reimbursementRows },
      { name: 'Disbursements Paid', widths: calcWidths(disbursementRows), rows: disbursementRows },
      { name: 'All Transactions', widths: calcWidths(txRows), rows: txRows },
      { name: 'Detailed Logs', widths: calcWidths(detailedLogsRows), rows: detailedLogsRows },
      { name: 'Notes & Tips', widths: calcWidths(auditRows), rows: auditRows }
    ];
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;INR&quot; #,##0.00"/></numFmts>
 <fonts count="6">
  <font><sz val="11"/><name val="Calibri"/></font>
  <font><b/><u/><color rgb="FFFFFFFF"/><sz val="16"/><name val="Aptos Display"/></font>
  <font><b/><color rgb="FF111827"/><sz val="11"/><name val="Calibri"/></font>
  <font><b/><sz val="11"/><name val="Calibri"/></font>
  <font><color rgb="FF166534"/><sz val="11"/><name val="Consolas"/></font>
  <font><color rgb="FF991B1B"/><sz val="11"/><name val="Consolas"/></font>
 </fonts>
 <fills count="6">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill>
 </fills>
 <borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border><left/><right/><top/><bottom style="thin"><color rgb="FFE5E7EB"/></bottom/><diagonal/></border>
 </borders>
 <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
 <cellXfs count="7">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
  <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
  <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
  <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  <xf numFmtId="164" fontId="4" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
  <xf numFmtId="164" fontId="5" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
 </cellXfs>  <cellStyles count="1">
   <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles></styleSheet>`;
  }

  function workbookXml(sheets) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <sheets>${sheets.map((s, i) => `<sheet name="${xlsxEscape(cleanSheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`;
  }

  function workbookRelsXml(sheets) {
    const sheetRels = sheets.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    ).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 ${sheetRels}
 <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  }

  function contentTypesXml(sheets) {
    const sheetTypes = sheets.map((_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
 <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
 ${sheetTypes}
</Types>`;
  }

  function rootRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  }

  function crc32(bytes) {
    let crc = -1;
    for (const b of bytes) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  function u16(value) {
    return [value & 0xff, (value >>> 8) & 0xff];
  }

  function u32(value) {
    return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
  }

  function dosTimeDate(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = (date.getFullYear() - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  function concatArrays(parts) {
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    parts.forEach(p => {
      out.set(p, offset);
      offset += p.length;
    });
    return out;
  }

  function zipBlob(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { time, day } = dosTimeDate();

    files.forEach(file => {
      const nameBytes = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      const crc = crc32(data);
      const localHeader = new Uint8Array([
        ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(time), ...u16(day),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)
      ]);
      localParts.push(localHeader, nameBytes, data);

      const centralHeader = new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(time), ...u16(day),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
      ]);
      centralParts.push(centralHeader, nameBytes);
      offset += localHeader.length + nameBytes.length + data.length;
    });

    const central = concatArrays(centralParts);
    const end = new Uint8Array([
      ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
      ...u32(central.length), ...u32(offset), ...u16(0)
    ]);
    return new Blob([concatArrays([...localParts, central, end])], { type: XLSX_MIME });
  }

  function buildXlsxBlob(trip) {
    const sheets = buildWorkbookModel(trip);
    const files = [
      { name: '[Content_Types].xml', content: contentTypesXml(sheets) },
      { name: '_rels/.rels', content: rootRelsXml() },
      { name: 'xl/workbook.xml', content: workbookXml(sheets) },
      { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml(sheets) },
      { name: 'xl/styles.xml', content: stylesXml() },
      ...sheets.map((sheet, i) => ({
        name: `xl/worksheets/sheet${i + 1}.xml`,
        content: worksheetXml(sheet.rows, sheet.widths)
      }))
    ];
    return zipBlob(files);
  }

  window.exportTripExcel = function exportTripExcel() {
    const trip = getTrip();
    if (!trip) { showToast('Open a trip first.'); return; }
    const blob = buildXlsxBlob(trip);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = reportFileName(trip);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Excel .xlsx workbook exported!');
  };
})();
