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

Edit shared CSS in `_includes/styles/`. Public pages embed these small styles
through `assets.html`, eliminating render-blocking stylesheet round trips.
`style.css` and `enhancements.css` expose the same sources as standalone stylesheets
for the existing authoring tools. These endpoints require Jekyll processing.

`theme.js` queues analytics events immediately and loads the Google script after
page load, during an idle callback (with a 2-second timeout). Short visits before
the script loads may not be measured, and analytics blockers still apply.

Run `npm run doctor` and `npm test`. Preview the Jekyll output, including `/tecirc`
and both languages, at mobile and desktop widths with light and dark themes.
