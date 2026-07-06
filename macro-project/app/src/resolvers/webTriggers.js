import { buildAcknowledgementsCsv } from './index';
import { buildAcknowledgementsPdf } from './pdfExport';

// Serves the audit CSV as a real file download. A web trigger is used (instead of returning
// the CSV through a resolver) because it is a plain HTTPS endpoint that can set
// Content-Disposition: attachment, which makes the browser download an actual .csv file —
// something a UI Kit resolver response cannot trigger on its own.
//
// Web trigger URLs are unauthenticated by default — anyone who obtains this URL could
// otherwise download the full audit trail (account IDs + timestamps) without being a
// Confluence user. A shared-secret token (set via `forge variables set --encrypt
// CSV_EXPORT_TOKEN`, appended to the URL by the getCsvExportUrl resolver) is required so the
// export only works when requested through the admin panel.
export async function handleCsvExport(request) {
  const token = request?.queryParameters?.token?.[0];
  if (!token || token !== process.env.CSV_EXPORT_TOKEN) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': ['text/plain; charset=utf-8'] },
      body: 'Forbidden',
    };
  }

  const csv = await buildAcknowledgementsCsv();

  return {
    statusCode: 200,
    headers: {
      'Content-Type': ['text/csv; charset=utf-8'],
      'Content-Disposition': ['attachment; filename="acknowledgement-records.csv"'],
    },
    body: csv,
  };
}

// Serves an audit PDF as a plain ASCII PDF string. Do not return pdf-lib base64 output here:
// Forge web triggers pass `body` through as a string, and Chrome receives the base64 text as
// application/pdf instead of decoded bytes, which makes the PDF viewer reject the file.
export async function handlePdfExport(request) {
  const token = request?.queryParameters?.token?.[0];
  if (!token || token !== process.env.CSV_EXPORT_TOKEN) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': ['text/plain; charset=utf-8'] },
      body: 'Forbidden',
    };
  }

  const pdf = await buildAcknowledgementsPdf();

  return {
    statusCode: 200,
    headers: {
      'Content-Type': ['application/pdf'],
      'Content-Disposition': ['attachment; filename="acknowledgement-records.pdf"'],
    },
    body: pdf,
  };
}
