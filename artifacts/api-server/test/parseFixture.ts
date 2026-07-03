/**
 * Dev-only smoke test for the resume parser. Builds a realistic Calibri/navy
 * resume .docx in memory (no external fixture file needed) and runs it through
 * parseResumeDocx, printing the structured result, the style map, and any
 * classification warnings.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx test/parseFixture.ts
 */
import JSZip from "jszip";
import { parseResumeDocx } from "../src/lib/resumeParser";

const NAVY = "1F3864";
const CAL = `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>`;

interface RunOpts {
  bold?: boolean;
  sizeHalfPt?: number;
  color?: string;
}

function run(text: string, o: RunOpts = {}): string {
  const rpr =
    `<w:rPr>${CAL}` +
    (o.bold ? `<w:b/>` : "") +
    (o.sizeHalfPt ? `<w:sz w:val="${o.sizeHalfPt}"/>` : "") +
    (o.color ? `<w:color w:val="${o.color}"/>` : "") +
    `</w:rPr>`;
  return `<w:r>${rpr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

/** Plain paragraph with direct run formatting. */
function p(text: string, o: RunOpts = {}): string {
  return `<w:p>${run(text, o)}</w:p>`;
}

/** Heading paragraph that references the Heading1 style (tests style resolution). */
function heading(text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run(text)}</w:p>`;
}

/** Numbered/bulleted list item (numPr present -> treated as a bullet). */
function bullet(text: string): string {
  return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:pPr></w:pPr>${run(
    text,
  )}</w:p>`;
}

const body = [
  // Name (direct formatting: Calibri 26pt bold navy)
  p("Jordan Blake", { bold: true, sizeHalfPt: 52, color: NAVY }),
  // Contact line
  p("jordan.blake@email.com | 0412 345 678 | Sydney, NSW | linkedin.com/in/jordanblake"),

  heading("Professional Summary"),
  p(
    "Detail-oriented commercial analyst with seven years experience turning messy data into decisions. Known for clear reporting and calm delivery under deadline.",
  ),

  heading("Experience"),
  p("Senior Commercial Analyst | Acme Corporation", { bold: true, sizeHalfPt: 24 }),
  p("Feb 2020 – Present"),
  bullet("Built the monthly board reporting pack, cutting prep time by 40%."),
  bullet("Led a cross-team pricing review that recovered $1.2M in margin."),
  p("Commercial Analyst | Globex Pty Ltd", { bold: true, sizeHalfPt: 24 }),
  p("Jan 2017 – Dec 2019"),
  bullet("Automated weekly sales reconciliation using SQL and Excel."),

  heading("Education"),
  p("University of Sydney", { bold: true, sizeHalfPt: 24 }),
  p("Bachelor of Commerce (Finance) — 2013 – 2016"),

  heading("Skills"),
  p("Excel, SQL, Python, Power BI, Stakeholder Management, Financial Modelling"),

  // Deliberately unusual heading -> should land in "Other" with a warning.
  heading("Referees"),
  p("Available on request."),
].join("");

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr>${CAL}<w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr>${CAL}<w:b/><w:sz w:val="28"/><w:color w:val="${NAVY}"/></w:rPr></w:style>
</w:styles>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

async function main() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", stylesXml);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  const result = await parseResumeDocx(buffer);

  console.log("=================== RESUME JSON ===================");
  console.log(JSON.stringify(result.resumeJson, null, 2));
  console.log("\n=================== STYLE MAP ====================");
  console.log(JSON.stringify(result.styleMap, null, 2));
  console.log("\n=================== WARNINGS =====================");
  if (result.warnings.length === 0) console.log("(none)");
  else result.warnings.forEach((w) => console.log("• " + w));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
