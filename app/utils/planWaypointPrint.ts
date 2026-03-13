export interface PlanPdfOverviewRow {
  waypointName: string;
  distanceFromStart: string;
  timeEstimate: string;
  distanceToNext: string;
  timeToNext: string;
}

export interface PlanPdfDetailRow extends PlanPdfOverviewRow {
  mapImageDataUrl?: string;
  mapAttribution?: string;
  mapImageError?: string;
  waypointElevation: string;
  plannedDelay: string;
  elevationGainToNext: string;
  elevationLossToNext: string;
  segmentPace: string;
  segmentGrade: string;
  tags: string;
  notes: string;
}

interface BuildPlanPdfHtmlOptions {
  courseName: string;
  planName: string;
  generatedAt: string;
  overviewMapImageDataUrl?: string;
  overviewMapAttribution?: string;
  overviewMapError?: string;
  overviewRows: PlanPdfOverviewRow[];
  detailRows: PlanPdfDetailRow[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nlToBreaks(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br />');
}

export function buildPlanPdfHtml(
  options: BuildPlanPdfHtmlOptions,
): string {
  const overviewRows = options.overviewRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.waypointName)}</td>
          <td>${escapeHtml(row.distanceFromStart)}</td>
          <td>${escapeHtml(row.timeEstimate)}</td>
          <td>${escapeHtml(row.distanceToNext)}</td>
          <td>${escapeHtml(row.timeToNext)}</td>
        </tr>`,
    )
    .join('');

  const detailSections = options.detailRows
    .map(
      (row, index) => `
        <section class="detail-page">
          <div class="detail-header">
            <div class="detail-header-main">
              <div class="eyebrow">Waypoint ${index + 1}</div>
              <div class="detail-title-row">
                <h2>${escapeHtml(row.waypointName)}</h2>
                <div class="detail-stats-inline">
                  <div class="detail-chip">${escapeHtml(row.distanceFromStart)} from start</div>
                  <div class="detail-chip">${escapeHtml(row.waypointElevation)} elevation</div>
                </div>
              </div>
            </div>
          </div>

          <div class="map-block">
            ${
              row.mapImageDataUrl
                ? `<img
                    class="map-image"
                    src="${row.mapImageDataUrl}"
                    alt="${escapeHtml(row.waypointName)} map snapshot"
                  />`
                : `<div class="map-placeholder">${escapeHtml(row.mapImageError || 'Map snapshot unavailable')}</div>`
            }
            <div class="map-attribution">${escapeHtml(row.mapAttribution || '')}</div>
          </div>

          <div class="detail-grid">
            <div class="metric-card">
              <span class="metric-label">Waypoint elevation</span>
              <span class="metric-value">${escapeHtml(row.waypointElevation)}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Time estimate</span>
              <span class="metric-value">${escapeHtml(row.timeEstimate)}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Planned stop</span>
              <span class="metric-value">${escapeHtml(row.plannedDelay)}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Distance to next</span>
              <span class="metric-value">${escapeHtml(row.distanceToNext)}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Time to next</span>
              <span class="metric-value">${escapeHtml(row.timeToNext)}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Elevation gain to next</span>
              <span class="metric-value">${escapeHtml(row.elevationGainToNext)}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Elevation loss to next</span>
              <span class="metric-value">${escapeHtml(row.elevationLossToNext)}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Segment pace</span>
              <span class="metric-value">${escapeHtml(row.segmentPace)}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Segment grade</span>
              <span class="metric-value">${escapeHtml(row.segmentGrade)}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Tags</span>
              <span class="metric-value">${escapeHtml(row.tags)}</span>
            </div>
          </div>

          <div class="notes-block">
            <div class="notes-label">Notes</div>
            <div class="notes-body">${nlToBreaks(row.notes)}</div>
          </div>
        </section>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(options.courseName)} - ${escapeHtml(options.planName)} PDF Export</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #18212b;
        --muted: #5f6c79;
        --line: #d5dde5;
        --panel: #f6f1e8;
        --panel-strong: #e6dbc9;
        --accent: #8a5a2b;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--ink);
        font-family: "Georgia", "Iowan Old Style", serif;
        background: white;
      }

      .page {
        width: 100%;
        min-height: 100vh;
        padding: 0.7in;
      }

      .cover {
        page-break-after: always;
      }

      .eyebrow {
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--accent);
        font-family: "Helvetica Neue", "Arial", sans-serif;
        margin-bottom: 10px;
      }

      h1,
      h2,
      h3,
      p {
        margin: 0;
      }

      .cover-header {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        align-items: flex-end;
        margin-bottom: 24px;
        padding-bottom: 18px;
        border-bottom: 2px solid var(--panel-strong);
      }

      .cover-header h1 {
        font-size: 30px;
        line-height: 1.1;
      }

      .cover-header p {
        font-size: 14px;
        color: var(--muted);
        margin-top: 8px;
      }

      .meta-box {
        padding: 14px 16px;
        background: linear-gradient(180deg, var(--panel), white);
        border: 1px solid var(--panel-strong);
        min-width: 220px;
      }

      .meta-box div + div {
        margin-top: 8px;
      }

      .meta-label {
        display: block;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        font-family: "Helvetica Neue", "Arial", sans-serif;
        margin-bottom: 2px;
      }

      .meta-value {
        font-size: 15px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }

      thead th {
        text-align: left;
        font-weight: 600;
        font-family: "Helvetica Neue", "Arial", sans-serif;
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 10px 8px;
        border-bottom: 1px solid var(--line);
        color: var(--muted);
      }

      tbody td {
        padding: 10px 8px;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
      }

      tbody tr:nth-child(odd) {
        background: #fbfaf8;
      }

      .summary-title {
        font-size: 18px;
        margin-bottom: 10px;
      }

      .summary-copy {
        font-size: 13px;
        color: var(--muted);
        margin-bottom: 16px;
        max-width: 42rem;
      }

      .overview-page {
        page-break-after: always;
      }

      .overview-page-header {
        margin-bottom: 16px;
      }

      .overview-page-header h2 {
        font-size: 28px;
        line-height: 1.1;
      }

      .overview-page-copy {
        font-size: 14px;
        color: var(--muted);
        margin-top: 6px;
      }

      .overview-map-block {
        border: 1px solid var(--line);
        background: linear-gradient(180deg, #fff, #fbfaf8);
        padding: 14px;
      }

      .overview-map-image {
        display: block;
        width: 100%;
        height: auto;
        margin: 0 auto;
        border: 1px solid var(--panel-strong);
      }

      .overview-map-placeholder {
        width: 100%;
        min-height: 420px;
        border: 1px dashed var(--panel-strong);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
        color: var(--muted);
        font-family: "Helvetica Neue", "Arial", sans-serif;
        font-size: 13px;
        text-align: center;
      }

      .detail-page {
        page-break-before: always;
        min-height: auto;
        padding: 0.55in 0.6in;
      }

      .detail-header {
        margin-bottom: 14px;
      }

      .detail-header-main {
        min-width: 0;
      }

      .detail-title-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px 14px;
      }

      .detail-stats-inline {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .detail-header h2 {
        font-size: 24px;
        line-height: 1.1;
      }

      .detail-chip {
        border: 1px solid var(--panel-strong);
        background: var(--panel);
        padding: 6px 10px;
        font-size: 12px;
        white-space: nowrap;
        line-height: 1.2;
      }

      .detail-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 14px;
      }

      .map-block {
        border: 1px solid var(--line);
        background: linear-gradient(180deg, #fff, #fbfaf8);
        padding: 10px;
        margin: 0 auto 12px;
        max-width: 320px;
      }

      .map-image {
        display: block;
        width: 100%;
        height: auto;
        margin: 0 auto;
        border: 1px solid var(--panel-strong);
      }

      .map-placeholder {
        width: 100%;
        min-height: 170px;
        margin: 0 auto;
        border: 1px dashed var(--panel-strong);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 14px;
        color: var(--muted);
        font-family: "Helvetica Neue", "Arial", sans-serif;
        font-size: 12px;
        text-align: center;
      }

      .map-attribution {
        margin-top: 6px;
        text-align: center;
        font-size: 10px;
        color: var(--muted);
        font-family: "Helvetica Neue", "Arial", sans-serif;
      }

      .metric-card {
        border: 1px solid var(--line);
        padding: 10px 12px;
        min-height: 58px;
      }

      .metric-label {
        display: block;
        font-size: 10px;
        font-family: "Helvetica Neue", "Arial", sans-serif;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 5px;
      }

      .metric-value {
        display: block;
        font-size: 16px;
        line-height: 1.2;
      }

      .notes-block {
        border: 1px solid var(--line);
        background: linear-gradient(180deg, #fff, #fbfaf8);
        padding: 12px;
      }

      .notes-label {
        font-size: 10px;
        font-family: "Helvetica Neue", "Arial", sans-serif;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 6px;
      }

      .notes-body {
        font-size: 13px;
        line-height: 1.45;
        min-height: 54px;
      }

      @page {
        margin: 0;
        size: letter portrait;
      }

      @media print {
        .cover,
        .detail-page {
          break-after: page;
        }

        .detail-page:last-child {
          break-after: auto;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="page cover">
        <div class="cover-header">
          <div>
            <div class="eyebrow">Plan export</div>
            <h1>${escapeHtml(options.planName)}</h1>
            <p>${escapeHtml(options.courseName)}</p>
          </div>
          <div class="meta-box">
            <div>
              <span class="meta-label">Generated</span>
              <span class="meta-value">${escapeHtml(options.generatedAt)}</span>
            </div>
            <div>
              <span class="meta-label">Waypoints</span>
              <span class="meta-value">${options.detailRows.length}</span>
            </div>
          </div>
        </div>

        <div class="summary-title">Quick reference</div>
        <p class="summary-copy">
          First-page overview of each waypoint. Subsequent pages break each waypoint
          out into its own detail section for printing or saving as PDF.
        </p>

        <table>
          <thead>
            <tr>
              <th>Waypoint</th>
              <th>From start</th>
              <th>Time estimate</th>
              <th>To next</th>
              <th>Time to next</th>
            </tr>
          </thead>
          <tbody>
            ${overviewRows}
          </tbody>
        </table>
      </section>

      <section class="page overview-page">
        <div class="overview-page-header">
          <div>
            <div class="eyebrow">Course overview</div>
            <h2>Whole-course map</h2>
            <p class="overview-page-copy">
              Full route context before the waypoint-by-waypoint breakdown.
            </p>
          </div>
        </div>

        <div class="overview-map-block">
          ${
            options.overviewMapImageDataUrl
              ? `<img
                  class="overview-map-image"
                  src="${options.overviewMapImageDataUrl}"
                  alt="${escapeHtml(options.courseName)} course overview map"
                />`
              : `<div class="overview-map-placeholder">${escapeHtml(options.overviewMapError || 'Overview map unavailable')}</div>`
          }
          <div class="map-attribution">${escapeHtml(options.overviewMapAttribution || '')}</div>
        </div>
      </section>

      ${detailSections}
    </main>
  </body>
</html>`;
}
