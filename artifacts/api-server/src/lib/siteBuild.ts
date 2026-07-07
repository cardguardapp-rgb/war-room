// Generates a self-contained, multi-page static personal website from the
// user's resume_json plus website-specific config. Pure — no I/O. The output is
// a { path: contents } map ready to zip (for download) or serve (for preview).

import type { ResumeJson, ResumeSection } from "./resumeParser";

export interface WebsiteLink {
  label: string;
  url: string;
}

export interface WebsiteConfig {
  siteTitle: string; // browser tab + site name
  name: string; // display name
  headline: string; // e.g. "Head of Product"
  tagline: string; // one short line under the headline
  bio: string; // a few sentences for the home page
  about: string; // longer about text; blank lines separate paragraphs
  accent: string; // hex colour, e.g. "#1e3a5f"
  email: string;
  phone: string;
  location: string;
  showPhone: boolean;
  links: WebsiteLink[];
  sections: {
    about: boolean;
    experience: boolean;
    education: boolean;
    skills: boolean;
    contact: boolean;
  };
}

type PageKey = "index" | "about" | "experience" | "skills" | "education" | "contact";
type LinkMode = "files" | "preview";

// --- helpers -------------------------------------------------------------

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hexOr(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim())
    ? value.trim()
    : fallback;
}

function findSection<K extends ResumeSection["kind"]>(
  resume: ResumeJson,
  kind: K,
): Extract<ResumeSection, { kind: K }> | undefined {
  return resume.sections.find((s) => s.kind === kind) as
    | Extract<ResumeSection, { kind: K }>
    | undefined;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || url;
  }
}

/** Build the default website config from what the resume already knows. */
export function defaultWebsiteConfig(resume: ResumeJson | null): WebsiteConfig {
  const contact = resume ? findSection(resume, "contact") : undefined;
  const summary = resume ? findSection(resume, "summary") : undefined;
  const firstRole = resume ? findSection(resume, "experience")?.items?.[0] : undefined;
  const links: WebsiteLink[] = (contact?.links ?? []).map((u) => ({
    label: hostLabel(u),
    url: /^https?:\/\//.test(u) ? u : `https://${u}`,
  }));
  const name = contact?.name || "Your Name";
  return {
    siteTitle: name,
    name,
    headline: firstRole?.title || "",
    tagline: "",
    bio: (summary?.paragraphs ?? [])[0] ?? "",
    about: (summary?.paragraphs ?? []).join("\n\n"),
    accent: "#1e3a5f",
    email: contact?.email || "",
    phone: contact?.phone || "",
    location: contact?.location || "",
    showPhone: false,
    links,
    sections: {
      about: !!(summary?.paragraphs?.length),
      experience: !!(resume && findSection(resume, "experience")?.items?.length),
      education: !!(resume && findSection(resume, "education")?.items?.length),
      skills: !!(resume && findSection(resume, "skills")?.items?.length),
      contact: true,
    },
  };
}

/** Validate/normalise a config from the client, filling gaps from defaults. */
export function normaliseWebsiteConfig(raw: unknown, resume: ResumeJson | null): WebsiteConfig {
  const d = defaultWebsiteConfig(resume);
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fb: string, max = 4000): string =>
    typeof v === "string" ? v.trim().slice(0, max) : fb;
  const sec = (o["sections"] ?? {}) as Record<string, unknown>;
  const links = Array.isArray(o["links"])
    ? (o["links"] as unknown[])
        .map((l) => {
          const lo = (l ?? {}) as Record<string, unknown>;
          const url = str(lo["url"], "", 500);
          if (!url) return null;
          return {
            url: /^https?:\/\//.test(url) ? url : `https://${url}`,
            label: str(lo["label"], hostLabel(url), 60) || hostLabel(url),
          };
        })
        .filter((l): l is WebsiteLink => !!l)
        .slice(0, 12)
    : d.links;
  return {
    siteTitle: str(o["siteTitle"], d.siteTitle, 120),
    name: str(o["name"], d.name, 120),
    headline: str(o["headline"], d.headline, 160),
    tagline: str(o["tagline"], d.tagline, 240),
    bio: str(o["bio"], d.bio, 2000),
    about: str(o["about"], d.about, 8000),
    accent: hexOr(o["accent"], d.accent),
    email: str(o["email"], d.email, 200),
    phone: str(o["phone"], d.phone, 60),
    location: str(o["location"], d.location, 160),
    showPhone: typeof o["showPhone"] === "boolean" ? o["showPhone"] : d.showPhone,
    links,
    sections: {
      about: typeof sec["about"] === "boolean" ? sec["about"] : d.sections.about,
      experience:
        typeof sec["experience"] === "boolean" ? sec["experience"] : d.sections.experience,
      education: typeof sec["education"] === "boolean" ? sec["education"] : d.sections.education,
      skills: typeof sec["skills"] === "boolean" ? sec["skills"] : d.sections.skills,
      contact: typeof sec["contact"] === "boolean" ? sec["contact"] : d.sections.contact,
    },
  };
}

// --- rendering -----------------------------------------------------------

function activePages(config: WebsiteConfig): { key: PageKey; nav: string; title: string }[] {
  const pages: { key: PageKey; nav: string; title: string }[] = [
    { key: "index", nav: "Home", title: "Home" },
  ];
  if (config.sections.about) pages.push({ key: "about", nav: "About", title: "About" });
  if (config.sections.experience)
    pages.push({ key: "experience", nav: "Experience", title: "Experience" });
  if (config.sections.skills) pages.push({ key: "skills", nav: "Skills", title: "Skills" });
  if (config.sections.education)
    pages.push({ key: "education", nav: "Education", title: "Education" });
  if (config.sections.contact) pages.push({ key: "contact", nav: "Contact", title: "Contact" });
  return pages;
}

function hrefFor(key: PageKey, mode: LinkMode): string {
  if (mode === "preview") return key === "index" ? "?page=index" : `?page=${key}`;
  return key === "index" ? "index.html" : `${key}.html`;
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function renderHome(resume: ResumeJson, c: WebsiteConfig): string {
  const roles = findSection(resume, "experience")?.items?.slice(0, 3) ?? [];
  const ctas: string[] = [];
  if (c.email) ctas.push(`<a class="btn primary" href="mailto:${esc(c.email)}">Get in touch</a>`);
  if (c.links[0]) ctas.push(`<a class="btn" href="${esc(c.links[0].url)}" target="_blank" rel="noopener">${esc(c.links[0].label)}</a>`);
  return `
  <section class="hero">
    <h1>${esc(c.name)}</h1>
    ${c.headline ? `<p class="headline">${esc(c.headline)}</p>` : ""}
    ${c.tagline ? `<p class="tagline">${esc(c.tagline)}</p>` : ""}
    ${ctas.length ? `<div class="cta">${ctas.join("")}</div>` : ""}
  </section>
  ${c.bio ? `<section class="card"><h2>About</h2>${paragraphs(c.bio)}</section>` : ""}
  ${
    roles.length
      ? `<section class="card"><h2>Recent experience</h2><ul class="highlights">${roles
          .map(
            (r) =>
              `<li><strong>${esc(r.title)}</strong>${r.company ? ` &middot; ${esc(r.company)}` : ""}${
                r.dates ? `<span class="muted"> — ${esc(r.dates)}</span>` : ""
              }</li>`,
          )
          .join("")}</ul></section>`
      : ""
  }`;
}

function renderAbout(c: WebsiteConfig): string {
  return `<section class="card"><h2>About</h2>${paragraphs(c.about || c.bio)}</section>`;
}

function renderExperience(resume: ResumeJson): string {
  const items = findSection(resume, "experience")?.items ?? [];
  return `<section class="card"><h2>Experience</h2>${items
    .map(
      (r) => `
    <article class="role">
      <div class="role-head">
        <h3>${esc(r.title)}</h3>
        ${r.dates ? `<span class="muted">${esc(r.dates)}</span>` : ""}
      </div>
      <p class="role-meta">${[r.company, r.location].filter(Boolean).map(esc).join(" &middot; ")}</p>
      ${r.bullets?.length ? `<ul>${r.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
    </article>`,
    )
    .join("")}</section>`;
}

function renderSkills(resume: ResumeJson): string {
  const sk = findSection(resume, "skills");
  if (!sk) return "";
  if (sk.groups?.length) {
    return `<section class="card"><h2>Skills</h2>${sk.groups
      .map(
        (g) =>
          `<div class="skill-group"><h3>${esc(g.label)}</h3><div class="chips">${g.items
            .map((i) => `<span class="chip">${esc(i)}</span>`)
            .join("")}</div></div>`,
      )
      .join("")}</section>`;
  }
  return `<section class="card"><h2>Skills</h2><div class="chips">${(sk.items ?? [])
    .map((i) => `<span class="chip">${esc(i)}</span>`)
    .join("")}</div></section>`;
}

function renderEducation(resume: ResumeJson): string {
  const items = findSection(resume, "education")?.items ?? [];
  return `<section class="card"><h2>Education</h2>${items
    .map(
      (e) => `
    <article class="role">
      <div class="role-head">
        <h3>${esc(e.qualification || e.institution)}</h3>
        ${e.dates ? `<span class="muted">${esc(e.dates)}</span>` : ""}
      </div>
      <p class="role-meta">${[e.institution, e.location].filter(Boolean).map(esc).join(" &middot; ")}</p>
      ${e.details?.length ? `<ul>${e.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
    </article>`,
    )
    .join("")}</section>`;
}

function renderContact(c: WebsiteConfig): string {
  const rows: string[] = [];
  if (c.email) rows.push(`<li><span class="muted">Email</span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>`);
  if (c.showPhone && c.phone) rows.push(`<li><span class="muted">Phone</span><span>${esc(c.phone)}</span></li>`);
  if (c.location) rows.push(`<li><span class="muted">Location</span><span>${esc(c.location)}</span></li>`);
  for (const l of c.links)
    rows.push(`<li><span class="muted">Link</span><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`);
  return `<section class="card"><h2>Contact</h2><ul class="contact-list">${rows.join("")}</ul></section>`;
}

function pageBody(key: PageKey, resume: ResumeJson, c: WebsiteConfig): string {
  switch (key) {
    case "index":
      return renderHome(resume, c);
    case "about":
      return renderAbout(c);
    case "experience":
      return renderExperience(resume);
    case "skills":
      return renderSkills(resume);
    case "education":
      return renderEducation(resume);
    case "contact":
      return renderContact(c);
  }
}

function buildCss(c: WebsiteConfig): string {
  return `:root{--accent:${c.accent};--ink:#1a1a1a;--muted:#6b7280;--bg:#ffffff;--soft:#f6f7f9;--line:#e5e7eb;}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6;font-size:17px}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}
header.site{position:sticky;top:0;background:rgba(255,255,255,.92);backdrop-filter:blur(6px);border-bottom:1px solid var(--line);z-index:10}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;height:60px}
header.site .brand{font-weight:700;color:var(--ink)}
nav a{color:var(--muted);margin-left:18px;font-size:15px;font-weight:500}
nav a.active,nav a:hover{color:var(--accent);text-decoration:none}
main{padding:40px 0 64px}
.hero{padding:24px 0 8px}
.hero h1{font-size:2.4rem;line-height:1.1;margin:0 0 8px}
.hero .headline{font-size:1.3rem;color:var(--accent);font-weight:600;margin:0 0 4px}
.hero .tagline{color:var(--muted);font-size:1.1rem;margin:0}
.cta{margin-top:20px;display:flex;flex-wrap:wrap;gap:10px}
.btn{display:inline-block;padding:10px 18px;border-radius:10px;border:1px solid var(--line);color:var(--ink);font-weight:600;font-size:15px}
.btn:hover{text-decoration:none;border-color:var(--accent)}
.btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.card{background:var(--soft);border:1px solid var(--line);border-radius:16px;padding:24px;margin-top:24px}
.card h2{margin:0 0 14px;font-size:1.35rem}
.card p{margin:0 0 12px}.card p:last-child{margin-bottom:0}
.highlights{list-style:none;padding:0;margin:0}.highlights li{padding:8px 0;border-bottom:1px solid var(--line)}.highlights li:last-child{border-bottom:0}
.role{padding:16px 0;border-bottom:1px solid var(--line)}.role:last-child{border-bottom:0;padding-bottom:0}.role:first-of-type{padding-top:0}
.role-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.role h3{margin:0;font-size:1.1rem}
.role-meta{color:var(--muted);margin:2px 0 8px;font-size:.95rem}
.role ul{margin:8px 0 0;padding-left:20px}.role li{margin:4px 0}
.muted{color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:14px}
.skill-group{margin-bottom:16px}.skill-group:last-child{margin-bottom:0}.skill-group h3{margin:0 0 8px;font-size:1rem}
.contact-list{list-style:none;padding:0;margin:0}
.contact-list li{display:flex;gap:14px;padding:10px 0;border-bottom:1px solid var(--line)}.contact-list li:last-child{border-bottom:0}
.contact-list .muted{min-width:80px}
footer.site{border-top:1px solid var(--line);color:var(--muted);font-size:14px;padding:24px 0}
@media(max-width:560px){.hero h1{font-size:2rem}nav a{margin-left:12px;font-size:14px}body{font-size:16px}}`;
}

function renderPage(
  key: PageKey,
  resume: ResumeJson,
  c: WebsiteConfig,
  mode: LinkMode,
  css: string,
): string {
  const pages = activePages(c);
  const nav = pages
    .map(
      (p) =>
        `<a href="${hrefFor(p.key, mode)}"${p.key === key ? ' class="active"' : ""}>${esc(p.nav)}</a>`,
    )
    .join("");
  const title = key === "index" ? esc(c.siteTitle) : `${esc(pages.find((p) => p.key === key)?.title ?? "")} — ${esc(c.name)}`;
  const desc = esc((c.tagline || c.headline || c.bio || `${c.name} — professional profile`).slice(0, 160));
  const head = mode === "preview" ? `<style>${css}</style>` : `<link rel="stylesheet" href="styles.css">`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="website">
${head}
</head>
<body>
<header class="site"><div class="wrap"><a class="brand" href="${hrefFor("index", mode)}">${esc(c.name)}</a><nav>${nav}</nav></div></header>
<main><div class="wrap">
${pageBody(key, resume, c)}
</div></main>
<footer class="site"><div class="wrap">&copy; ${esc(c.name)}</div></footer>
</body>
</html>`;
}

/**
 * Build the whole site. `mode: "files"` links to real .html files + a shared
 * styles.css (for the downloadable zip); `mode: "preview"` inlines the CSS and
 * links pages with ?page= (for the in-app preview endpoint).
 */
export function buildSite(
  resume: ResumeJson,
  config: WebsiteConfig,
  mode: LinkMode = "files",
): Record<string, string> {
  const css = buildCss(config);
  const files: Record<string, string> = {};
  for (const p of activePages(config)) {
    files[p.key === "index" ? "index.html" : `${p.key}.html`] = renderPage(
      p.key,
      resume,
      config,
      mode,
      css,
    );
  }
  if (mode === "files") {
    files["styles.css"] = css;
    files["robots.txt"] = "User-agent: *\nAllow: /\n";
    files["README.txt"] = readme(config);
  }
  return files;
}

/** Render a single page for the in-app preview (self-contained HTML). */
export function buildPreviewPage(resume: ResumeJson, config: WebsiteConfig, page: string): string {
  const key = (["index", "about", "experience", "skills", "education", "contact"] as PageKey[]).includes(
    page as PageKey,
  )
    ? (page as PageKey)
    : "index";
  const enabled = activePages(config).some((p) => p.key === key);
  return buildSite(resume, config, "preview")[
    (enabled ? key : "index") === "index" ? "index.html" : `${key}.html`
  ]!;
}

function readme(c: WebsiteConfig): string {
  return `${c.name} — personal website
==============================

This folder is a complete, ready-to-publish website. There is NO build step —
every file is plain HTML/CSS.

QUICKEST WAY TO PUBLISH (drag & drop):
  1. Go to https://app.netlify.com/drop
  2. Drag this whole folder onto the page.
  3. You'll get a live URL instantly (e.g. your-site.netlify.app).

ALTERNATIVE (Cloudflare Pages):
  1. Go to https://pages.cloudflare.com and create a project via "Direct upload".
  2. Upload this folder.

CUSTOM DOMAIN:
  - After publishing, open the host's "Domains" settings and add your domain.
  - Follow their DNS instructions (usually a CNAME record at your registrar).
  - HTTPS is provisioned automatically.

TO UPDATE:
  - Edit your details in the Job Search Assistant app, download the site again,
    and re-drop the new folder (same steps).
`;
}
