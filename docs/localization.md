# Japanese and English public pages

Japanese URLs remain unchanged. English pages live under `/en/` and retain the
original route’s case and trailing slash. Public navigation never redirects based
on browser language; readers choose the language explicitly.

- Main pages: `index.html`, `about/`, `notes/`, `memory/`, `privacy/`, `sitemap.html`;
  English equivalents are under `en/`.
- Japanese articles and galleries: `_notes/` and `_memories/`.
- English articles and galleries: `en/notes/<same-filename>.md` and
  `en/memory/<same-filename>.md`, with `lang: en`, `layout: note` or `memory`,
  `sitemap: true`, and the corresponding `/en/` permalink.
- Keep original images, reference URLs, gallery photo order, and publication dates.
  Translate the title, description, image alt text, tags where appropriate,
  captions, and body. When updating an original, review its English counterpart.
- A Japanese article without an English counterpart remains valid. The language
  switch and alternate-language SEO links appear only when that counterpart exists.
  Authoring tools continue to publish Japanese originals; English versions are
  maintained in the repository.

`_includes/locale.html` selects each language’s article and gallery lists.
`_includes/seo.html` and `sitemap-languages.html` generate language alternatives.
The XML sitemap includes both languages and excludes private/unindexed pages.
Memory pages continue to omit description meta tags in both languages.

# Shared styles and analytics

Edit shared CSS in `_includes/styles/style.css`, `enhancements.css`, and
`header.css`. Run `npm ci` once and `npm run build:assets` after source changes.
Commit `_includes/styles/public.min.css`, `assets/`, and `_data/assets.json`.
Public pages inline the minified CSS to avoid blocking stylesheet requests;
JavaScript uses content-hashed filenames so repeated visits reuse cached code.
The standalone `style.css` and `enhancements.css` endpoints remain for editors.
The source JavaScript is not copied into the public site.

`theme.js` queues analytics events immediately and loads the Google script after
page load, during an idle callback (with a 2-second timeout). Short visits before
the script loads may not be measured, and analytics blockers still apply.

# Responsive images

Original image URLs, gallery photo metadata, article text, and editor image
storage formats remain unchanged. Public templates use `_data/media.json` to select
WebP files from `images/optimized/`. They emit real dimensions and responsive
sizes; the first image is eager and prioritized, and later images are lazy.
New images without derivatives fall back to their original URL until optimized.

To regenerate: `python -m pip install -r scripts/media-requirements.txt`, then
`npm run build:media`. Originals are never recompressed or replaced. Display
variants have a maximum 2000px edge, with 640px and 1280px widths when applicable.
The script corrects EXIF orientation, preserves color profiles/transparency,
skips animations, and reuses variants when the source hash is unchanged.
The image workflow handles new Memory and Notes uploads, commits derivatives,
and explicitly requests a Pages build after a bot commit.

Run `npm run doctor`, `npm test`, and `python tests/media-generator.test.py`.
Preview Jekyll output including `/tecirc`, both languages, mobile and desktop,
light and dark themes. For the existing local video, a small poster and known
dimensions allow `preload="none"` without an empty or unstable layout.

Notes use a plain dated list, without search, filters, tags, or category navigation.
New Markdown and drafts omit tags. Old drafts and imports still restore their
titles, bodies, URLs, images, and dates while ignoring old tags.
The header stays on one row with navigation on the right. Language selection
uses a native globe disclosure in the footer, next to the theme control.
