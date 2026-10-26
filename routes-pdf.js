'use strict';
// PDF report. Light on memory: the PDF is drawn directly with pdfkit and streamed to the customer. Nothing is saved on the server.
const PDFDocument = require('pdfkit');

module.exports = function register(app, core) {
  const { auth, requirePro, buildContext, wrap } = core;
  const sum = o => Object.values(o || {}).reduce((a, n) => a + n, 0);

  app.get('/api/report/pdf', auth, requirePro, wrap(async (req, res) => {
    const days = Math.max(1, Math.min(30, parseInt(req.query.days, 10) || 1));
    const tz = req.userDoc.timezone;
    const data = await buildContext(req.user.uid, tz, days);

    const peak = Object.entries(data.people.byHour).sort((a, b) => b[1] - a[1])[0];
    const totalPeople = sum(data.people.byDay);
    const totalVehicles = sum(data.vehicles.byDay);
    const totalSales = Math.round(sum(data.sales.byDay));
    const totalAlerts = sum(data.alertsByType);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="secure-assistant-report.pdf"');
    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(20).text('Secure Assistant - Report', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#555555').text(`Last ${days} day(s) - timezone ${data.timezone} - created ${new Date().toISOString()}`);
    doc.fillColor('#000000').moveDown();

    doc.fontSize(14).text('Summary');
    doc.fontSize(11);
    doc.text(`People counted (sampled): ${totalPeople}`);
    doc.text(`Vehicles counted (sampled): ${totalVehicles}`);
    doc.text(`Busiest hour: ${peak && totalPeople > 0 ? peak[0] + ':00' : 'not enough data'}`);
    doc.text(`Bills recorded: ${data.billsCount}`);
    doc.text(`Total sales: ${totalSales}`);
    doc.text(`Alerts: ${totalAlerts}`);
    doc.moveDown();

    doc.fontSize(14).text('People by day');
    doc.fontSize(11);
    const dayList = Object.entries(data.people.byDay).sort((a, b) => a[0].localeCompare(b[0]));
    if (!dayList.length) doc.text('No data.');
    dayList.forEach(([d, n]) => doc.text(`${d}: ${n}`));
    doc.moveDown();

    doc.fontSize(14).text('Alerts by type');
    doc.fontSize(11);
    const alertList = Object.entries(data.alertsByType);
    if (!alertList.length) doc.text('No alerts.');
    alertList.forEach(([t, n]) => doc.text(`${t}: ${n}`));
    doc.moveDown();

    doc.fontSize(9).fillColor('#555555').text('Counts are sampled from camera frames. Images are not stored. This report is a guide and not a certified record.');
    doc.end();
  }));
};