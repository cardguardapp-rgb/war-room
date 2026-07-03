// Writes a realistic Calibri/navy resume .docx to the path in argv[2].
// Used to exercise the HTTP upload+parse pipeline end to end.
import { writeFile } from "node:fs/promises";
import JSZip from "jszip";

const NAVY = "1F3864";
const CAL = `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>`;

function run(text, o = {}) {
  const rpr =
    `<w:rPr>${CAL}` +
    (o.bold ? `<w:b/>` : "") +
    (o.sizeHalfPt ? `<w:sz w:val="${o.sizeHalfPt}"/>` : "") +
    (o.color ? `<w:color w:val="${o.color}"/>` : "") +
    `</w:rPr>`;
  return `<w:r>${rpr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}
const p = (text, o = {}) => `<w:p>${run(text, o)}</w:p>`;
const heading = (text) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run(text)}</w:p>`;
const bullet = (text) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(
    text,
  )}</w:p>`;

const body = [
  p("Jordan Blake", { bold: true, sizeHalfPt: 52, color: NAVY }),
  p("jordan.blake@email.com | 0412 345 678 | Sydney, NSW | linkedin.com/in/jordanblake"),
  heading("Professional Summary"),
  p("Detail-oriented commercial analyst with seven years experience turning messy data into decisions."),
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
  p("Excel, SQL, Python, Power BI, Stakeholder Management"),
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
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const zip = new JSZip();
zip.file("[Content_Types].xml", contentTypes);
zip.file("word/document.xml", documentXml);
zip.file("word/styles.xml", stylesXml);
const buffer = await zip.generateAsync({ type: "nodebuffer" });
await writeFile(process.argv[2] ?? "/tmp/fixture.docx", buffer);
console.log("wrote", process.argv[2], buffer.length, "bytes");
