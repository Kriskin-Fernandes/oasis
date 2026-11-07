# firecrawl/

Drop Firecrawl output here as `.json` files. Oasis indexes them for signposting
and **re-indexes automatically** while the host is running (no restart needed).

Accepted shapes (mix freely, one or many per file):

- `/scrape`  → `{ "success": true, "data": { "markdown": "...", "metadata": { "title": "...", "sourceURL": "..." } } }`
- `/crawl`   → `{ "data": [ { "markdown": "...", "metadata": { ... } }, ... ] }` or a bare array
- `/extract` → `{ "data": { "people": [ { "name": "...", "role": "...", "email": "..." } ] } }`, any structure
- hand-written → `[ { "title": "...", "url": "...", "content": "..." } ]`

Check what was picked up: `npm run test:kb` (or open **System details** in the app).
While this folder has no JSON, clearly-labelled sample data from
`examples/firecrawl-sample/` is used instead.

Tips: scrape the wellbeing, counselling, disability, student-advice, SRC/student
council, ambassador and "report and support" pages. Use `/extract` with a schema
like `{ name, role, area, email, url }` for people lists.
