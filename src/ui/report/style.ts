/**
 * The look of a Helm report on paper.
 *
 * `printToPDF` is called with zero hardware margins, so the page padding below *is* the margin. That
 * keeps the layout width exactly A4 (794px at 96dpi, matching the render frame) and guarantees nothing
 * overflows the sheet. Same arrangement the other plugins in this vault settled on.
 */
export const REPORT_CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }

/* Roles, not raw hex, so the palette lives in one place. Fixed light values with no dark variant:
   this document is going onto paper, where "dark mode" means an unreadable page and a cartridge of
   toner. */
:root {
  --ink:        #0b0b0b;
  --ink-2:      #52514e;
  --ink-muted:  #898781;
  --rule:       #e1e0d9;
  --rule-2:     #c3c2b7;
  --surface:    #fcfcfb;
  --series:     #2a78d6;
  --series-soft:#cde2fb;
  --neg:        #d03b3b;
  --pos:        #006300;
  --warn-edge:  #fab219;
  --warn-bg:    #fdf6e7;
}
body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
       color: var(--ink); background: #fff; margin: 0; padding: 13mm 12mm; font-size: 11.5px; line-height: 1.5;
       -webkit-print-color-adjust: exact; print-color-adjust: exact; }

/* ---- masthead ---- */
.masthead { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px;
            padding-bottom: 10px; border-bottom: 2px solid var(--ink); }
h1 { font-size: 21px; line-height: 1.2; margin: 0; letter-spacing: -0.01em; }
.masthead .period { margin: 3px 0 0; font-size: 12.5px; color: var(--ink-2); }
.masthead .meta { text-align: right; font-size: 9.5px; color: var(--ink-muted); line-height: 1.6; white-space: nowrap; }

/* ---- headline figures: one hero, the rest as a KPI row ---- */
.hero-row { display: flex; gap: 10px; align-items: stretch; margin: 16px 0 4px; }
.hero { flex: 0 0 34%; padding: 12px 14px; border-radius: 10px; background: var(--surface); border: 1px solid var(--rule); }
.hero .label, .tile .label { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-muted); }
.hero .value { font-size: 32px; font-weight: 650; line-height: 1.1; margin-top: 4px; letter-spacing: -0.02em;
               font-variant-numeric: tabular-nums; }
.hero .sub { font-size: 10px; color: var(--ink-2); margin-top: 3px; }
.tiles { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.tile { padding: 8px 11px; border-radius: 8px; border: 1px solid var(--rule); }
.tile .value { font-size: 15px; font-weight: 600; margin-top: 1px; font-variant-numeric: tabular-nums; }
.tile .sub { font-size: 9px; color: var(--ink-muted); }

/* ---- sections ---- */
h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--ink-2);
     margin: 24px 0 9px; padding-bottom: 5px; border-bottom: 1px solid var(--rule); }
h3 { font-size: 11.5px; margin: 12px 0 5px; }
section { break-inside: auto; }

/* ---- horizontal bars ---- */
.bars { display: flex; flex-direction: column; gap: 5px; }
.bar-row { display: grid; grid-template-columns: minmax(90px, 30%) 1fr auto; align-items: center; gap: 10px; break-inside: avoid; }
.bar-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { height: 9px; border-radius: 5px; background: var(--series-soft); overflow: hidden; }
.bar-fill { height: 100%; background: var(--series); border-radius: 0 4px 4px 0; }
.bar-value { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }
.bar-share { color: var(--ink-muted); font-weight: 400; margin-left: 5px; }

/* ---- column chart ---- */
.chart { width: 100%; height: auto; break-inside: avoid; }
.chart .axis { stroke: var(--rule-2); stroke-width: 1; }
.chart .col { fill: var(--series); }
.chart .col-soft { fill: var(--series-soft); }
.chart .tick { fill: var(--ink-muted); font-size: 8.5px; }
.chart .peak { fill: var(--ink); font-size: 8.5px; font-weight: 600; }

/* ---- tables ---- */
table { width: 100%; border-collapse: collapse; margin-top: 2px; }
th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .06em;
     color: var(--ink-muted); border-bottom: 1px solid var(--rule-2); padding: 5px 7px; font-weight: 600; }
td { padding: 4px 7px; border-bottom: 1px solid var(--rule); vertical-align: top; }
td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tbody tr:nth-child(even) td { background: var(--surface); }
tfoot td { font-weight: 700; border-top: 1.5px solid var(--ink); border-bottom: none; background: #fff; }
.date { color: var(--ink-2); white-space: nowrap; }

/* ---- task lines ---- */
.box { display: inline-block; width: 8px; height: 8px; border: 1px solid var(--rule-2); border-radius: 2px;
       margin-right: 6px; vertical-align: baseline; }
.box.done { background: var(--ink); border-color: var(--ink); }
.done-text { color: var(--ink-2); text-decoration: line-through; }
.step { color: var(--ink-2); padding-left: 16px; }
.tag { display: inline-block; border: 1px solid var(--rule); border-radius: 9px; padding: 0 6px; margin-left: 5px;
       font-size: 8.5px; color: var(--ink-2); white-space: nowrap; }
.tag.due { border-color: var(--warn-edge); background: var(--warn-bg); }
.tag.late { border-color: var(--neg); color: var(--neg); }

/* ---- day cards, for a week ---- */
.days { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.day { border: 1px solid var(--rule); border-radius: 8px; padding: 8px 10px; break-inside: avoid; }
.day-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 4px; }
.day-head .name { font-weight: 650; }
.day-head .count { font-size: 9px; color: var(--ink-muted); }
.day ul { margin: 0; padding: 0; list-style: none; }
.day li { padding: 1px 0; }

/* ---- diary ---- */
.diary-day { margin-bottom: 10px; break-inside: avoid; }
.diary-entry { display: grid; grid-template-columns: 42px 1fr; gap: 8px; padding: 2px 0; }
.diary-time { color: var(--ink-muted); font-variant-numeric: tabular-nums; }
.diary-reply { padding-left: 12px; color: var(--ink-2); }

.neg { color: var(--neg); }
.pos { color: var(--pos); }
.muted { color: var(--ink-muted); }
.note { color: var(--ink-muted); font-size: 10px; margin: 0 0 6px; }
.foot { margin-top: 26px; padding-top: 8px; border-top: 1px solid var(--rule);
        color: var(--ink-muted); font-size: 9px; display: flex; justify-content: space-between; gap: 12px; }
.warn { margin-top: 12px; padding: 8px 10px; border-left: 3px solid var(--warn-edge); background: var(--warn-bg);
        font-size: 10.5px; break-inside: avoid; }
.empty { color: var(--ink-muted); font-style: italic; }

@media print {
  /* The body padding is the page margin now, so it must survive printing rather than be reset.
     Repeating the table header is what keeps a long list readable past page one. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  h2 { page-break-after: avoid; }
  .hero-row, .bars, .chart, .day, .diary-day { page-break-inside: avoid; }
}
`;
