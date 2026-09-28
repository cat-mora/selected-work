#!/usr/bin/env node
// Tells IndexNow which pages changed in this push, so participating search
// engines pick them up in minutes instead of waiting for a crawl. Bing acts on
// this; Google does not take part and keeps working from sitemap.xml.
//
// The key is NOT a secret. IndexNow proves you control the site by having you
// publish the key as a plain text file at the root of the domain, so it is meant
// to be public and belongs in this repo. Anyone can read it and it grants no
// access to anything. Do not treat it like an API key.
//
// Run: node scripts/ping-indexnow.mjs
// Optional env: BEFORE_SHA (the commit this push started from), DRY_RUN=1.

import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const HOST = "kindredsystems.com.au";
const SITE = `https://${HOST}`;
const ENDPOINT = "https://api.indexnow.org/indexnow";
const DRY_RUN = process.env.DRY_RUN === "1";

// The key file is the one file at the repo root named <key>.txt where the name
// is hex. Finding it this way means rotating the key is a rename, nothing else.
function findKey() {
  const candidates = readdirSync(process.cwd()).filter((f) =>
    /^[0-9a-f]{8,128}\.txt$/i.test(f),
  );
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one IndexNow key file at the repo root, found ${candidates.length}. ` +
        `It should be named <key>.txt where <key> is 8 to 128 hex characters.`,
    );
  }
  const file = candidates[0];
  const key = file.replace(/\.txt$/i, "");
  const contents = readFileSync(file, "utf8").trim();
  if (contents !== key) {
    throw new Error(
      `IndexNow key file ${file} must contain exactly its own key and nothing else.`,
    );
  }
  return { key, keyLocation: `${SITE}/${file}` };
}

function changedPages() {
  const before = process.env.BEFORE_SHA;
  const range =
    before && !/^0{40}$/.test(before) ? `${before}..HEAD` : "HEAD~1..HEAD";

  let out;
  try {
    out = execFileSync("git", ["diff", "--name-only", range], {
      encoding: "utf8",
    });
  } catch {
    // Shallow clone, first commit, or a force push. Submitting nothing is safer
    // than submitting the whole site, which wastes the quota for no gain.
    console.log(`Could not diff ${range}, submitting nothing.`);
    return [];
  }

  const urls = new Set();
  for (const file of out.split("\n").map((s) => s.trim()).filter(Boolean)) {
    if (!file.endsWith("index.html")) continue;
    const dir = file.replace(/index\.html$/, "");
    urls.add(`${SITE}/${dir}`);
  }
  return [...urls].sort();
}

const urlList = changedPages();

if (urlList.length === 0) {
  console.log("No page changes in this push, nothing to submit.");
  process.exit(0);
}

// The protocol accepts up to 10,000 URLs per request. This site is nowhere near
// that, but a runaway submission would be worse than a truncated one.
if (urlList.length > 10000) {
  console.log(`Truncating ${urlList.length} URLs to the 10,000 limit.`);
  urlList.length = 10000;
}

const { key, keyLocation } = findKey();
const payload = { host: HOST, key, keyLocation, urlList };

console.log(`Submitting ${urlList.length} URL(s) to IndexNow:`);
for (const u of urlList) console.log(`  ${u}`);

if (DRY_RUN) {
  console.log("DRY_RUN set, not sending.");
  process.exit(0);
}

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(payload),
});

// A failed ping is not a reason to fail the build. The sitemap still carries
// every page, so the worst case is that Bing finds the change on its own later.
if (res.ok) {
  console.log(`IndexNow accepted the submission (HTTP ${res.status}).`);
} else {
  console.log(
    `IndexNow returned HTTP ${res.status}. The sitemap still covers these pages, ` +
      `so this is worth noticing but not worth failing the build over.`,
  );
}
