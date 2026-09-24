# Reports and local visual evidence

Build Reports, readiness reviews, Architecture reviews, and concise text
evidence are tracked. Browser screenshots are generated evidence for local
Product/Architecture review and are retained outside the tracked tree in
`reports/_local-screenshots/`.

The local archive preserves the original screenshot-directory names, so a
report reference such as `reports/p0-007b-r1-screenshots/` maps to
`reports/_local-screenshots/p0-007b-r1-screenshots/` on a working copy that
has retained the archive. Screenshots are not required to run the product or
the validation suites; the reports and automated assertions remain the
authoritative durable evidence.
