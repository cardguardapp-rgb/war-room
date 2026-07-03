// Non-AI test: build resume + cover-letter .docx from JSON + style map, convert
// to PDF via LibreOffice, and exercise the pdf-lib fallback. No API key needed.
// Run: pnpm --filter @workspace/api-server exec tsx test/docTest.ts
import { writeFileSync } from "node:fs";
import {
  buildResumeDocx,
  buildCoverLetterDocx,
  defaultStyleMap,
  docFilename,
} from "../src/lib/docBuild";
import { docxToPdf, buildResumePdfFallback } from "../src/lib/pdf";
import type { ResumeJson } from "../src/lib/resumeParser";
import type { CoverLetterFull } from "../src/lib/coverLetters";

const resume: ResumeJson = {
  version: 1,
  sections: [
    {
      id: "sec-0",
      kind: "contact",
      heading: "Contact",
      name: "Amy Gibbons",
      email: "amy.gibbons@email.com",
      phone: "0412 345 678",
      location: "Sydney, NSW",
      links: ["linkedin.com/in/amygibbons"],
      otherLines: [],
    },
    {
      id: "sec-1",
      kind: "summary",
      heading: "Professional Summary",
      paragraphs: [
        "Commercial analyst who turns messy data into decisions leaders act on. Seven years across FMCG and SaaS, most recently owning the board reporting pack. Calm under deadline and trusted with the numbers.",
      ],
    },
    {
      id: "sec-2",
      kind: "experience",
      heading: "Experience",
      items: [
        {
          id: "exp-0",
          title: "Senior Commercial Analyst",
          company: "Acme Corporation",
          dates: "Feb 2020 – Present",
          location: "Sydney",
          bullets: [
            "Rebuilt the monthly board pack, cutting prep time from three days to one.",
            "Led a pricing review that recovered $1.2M in annual margin.",
          ],
        },
        {
          id: "exp-1",
          title: "Commercial Analyst",
          company: "Globex Pty Ltd",
          dates: "Jan 2017 – Dec 2019",
          location: "Sydney",
          bullets: ["Automated weekly sales reconciliation using SQL and Excel."],
        },
      ],
    },
    {
      id: "sec-3",
      kind: "education",
      heading: "Education",
      items: [
        {
          id: "edu-0",
          institution: "University of Sydney",
          qualification: "Bachelor of Commerce (Finance)",
          dates: "2013 – 2016",
          location: "",
          details: [],
        },
      ],
    },
    {
      id: "sec-4",
      kind: "skills",
      heading: "Skills",
      items: ["Excel", "SQL", "Python", "Power BI", "Stakeholder management"],
    },
  ],
};

const letter: CoverLetterFull = {
  salutation: "Dear Hiring Manager",
  re: "Re: Senior Commercial Analyst at Acme",
  body:
    "Your board pack is late every month and everyone knows it. I fixed exactly that at Globex, and I can do it here.\n\nOver seven years I've owned the numbers leaders make calls on. At Acme's scale, the pricing review alone looks like a quick win.\n\nI'd bring the reporting under control in the first quarter.",
};

async function main() {
  const style = defaultStyleMap();

  const resumeDocx = await buildResumeDocx(resume, style);
  writeFileSync("/tmp/test-resume.docx", resumeDocx);
  console.log(`resume .docx: ${resumeDocx.length} bytes  (${docFilename("Amy Gibbons", "Acme Corp", "Resume", "docx")})`);

  const resumePdf = await docxToPdf(resumeDocx);
  writeFileSync("/tmp/test-resume.pdf", resumePdf);
  console.log(`resume .pdf (LibreOffice): ${resumePdf.length} bytes`);

  const letterDocx = await buildCoverLetterDocx(letter, "Amy Gibbons", style);
  writeFileSync("/tmp/test-letter.docx", letterDocx);
  const letterPdf = await docxToPdf(letterDocx);
  writeFileSync("/tmp/test-letter.pdf", letterPdf);
  console.log(`cover letter .docx: ${letterDocx.length} bytes, .pdf: ${letterPdf.length} bytes`);

  const fallback = await buildResumePdfFallback(resume, style);
  writeFileSync("/tmp/test-resume-fallback.pdf", fallback);
  console.log(`resume .pdf (pdf-lib fallback): ${fallback.length} bytes`);

  console.log("OK — all documents generated.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
