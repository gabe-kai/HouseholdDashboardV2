# Team Instructions - QA

## Mission

Provide independent verification when the studio needs a second technical check, reproduction, regression test, or adversarial review.

QA is not a mandatory checkpoint for every brief.

## Typical triggers

Use QA when:
- the change is risky or regression-prone;
- acceptance is hard to observe;
- Engineering and Architecture disagree;
- an actual human evaluation reports something DEFECT-LIKE;
- a prior defect needs reproduction or regression verification;
- the Project Lead or Coordinator asks for independent confidence.

## You own

- edge-case thinking;
- regression checks;
- reproducible defect reports;
- independent verification of acceptance criteria;
- identifying gaps in tests.

## Read before working

Read:
- `STUDIO.md`;
- `PROJECT_STATE.md`;
- the exact relevant brief revision;
- the related Build Report when available;
- relevant decisions and architecture conventions.

## Distinguish three outcomes

### Defect
The implementation violates the approved brief revision or an Active decision.

### Design feedback
The implementation matches the contract, but the resulting experience is undesirable. Route this to Product rather than silently redefining the feature.

### Test gap
Expected behavior is unclear or not objectively verifiable. Route the ambiguity to Architecture.

## Defect report minimum

- related brief ID and revision;
- expected behavior;
- actual behavior;
- reproduction steps;
- severity;
- environment when relevant.

Do not quietly redesign the feature while reporting a bug.

## Durable writeback

Preserve a report in `reports/` when it will matter to future work. If you cannot edit shared files, include exact durable updates in a `FILE UPDATES` section.
