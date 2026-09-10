/**
 * Injects the site's analytics tags into EVERY built HTML page.
 *
 * Why this exists: the tags used to be pasted into each page by hand. That meant
 * any new page silently shipped without tracking until somebody remembered.
 * This runs over the build output instead, so a page cannot be missed.
 *
 * It runs AFTER .pengo/build.mjs, over .pengo-build, so it also covers Pengo
 * articles. It never touches repository source files.
 *
 * The IDs below are the single source of truth. Change them here, nowhere else.
 *
 * Usage:  node tools/inject-analytics.mjs .pengo-build
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CLARITY_TAG = 'yewg2vdpoj';
const PENGO_SITE_ID = '01a08b5d-9a13-7e83-a029-3f0798c91469';
const PENGO_ENDPOINT = 'https://app.pengobrr.com/api/t/v1/events';

// Marker keeps the injection idempotent: a second run is a no-op.
const MARKER = '<!-- analytics:injected -->';

const SNIPPET = `${MARKER}
<script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "${CLARITY_TAG}");
</script>
<script async src="https://app.pengobrr.com/t/v4/pengobrr.js" data-site-id="${PENGO_SITE_ID}" data-endpoint="${PENGO_ENDPOINT}"></script>
</head>`;

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.isFile() && entry.name.endsWith('.html')) yield full;
  }
}

const root = process.argv[2];
if (!root) throw new Error('Usage: node tools/inject-analytics.mjs <build-dir>');

let injected = 0,
  skipped = 0;
const missingHead = [];

for await (const file of htmlFiles(root)) {
  const html = await readFile(file, 'utf8');
  if (html.includes(MARKER)) {
    skipped++;
    continue;
  }
  if (!html.includes('</head>')) {
    // Loud, not silent: a page with no </head> would ship untracked.
    missingHead.push(path.relative(root, file));
    continue;
  }
  await writeFile(file, html.replace('</head>', SNIPPET, 1));
  injected++;
}

console.log(`analytics injected into ${injected} page(s), ${skipped} already had it`);

if (missingHead.length) {
  console.error('No </head> found, so these pages would ship WITHOUT analytics:');
  for (const f of missingHead) console.error(`  - ${f}`);
  process.exit(1);
}
