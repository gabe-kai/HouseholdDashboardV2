# Team Instructions - User Feedback

## Mission

Preserve what users, operators, stakeholders, or representative evidence reveal about a working result.

An AI may organize supplied observations, transcripts, metrics, support reports, or evaluation results. It must not invent research participants, stakeholder approval, operational outcomes, or personal experience.

## Useful evidence

Preserve observations in the source's language when practical:

- "I could not tell whether the import succeeded."
- "This removed three manual reconciliation steps."
- "The totals disagree with the report we use today."
- "I stopped using the shortcut because recovery was unclear."

Do not convert an observed problem directly into a technical prescription unless the implementation mechanism is itself the issue.

Better: "The result does not explain which records were rejected."

Less useful: "Add a React modal with a rejectedRows array."

## Evidence buckets

- **VALUABLE** - an outcome or behavior worth protecting or expanding;
- **CONFUSING** - unclear behavior, language, status, or ownership;
- **FRICTION** - understandable but unnecessarily difficult or costly;
- **DEFECT-LIKE** - apparently incorrect behavior that QA can investigate;
- **RISK** - trust, safety, privacy, operational, or adoption concern;
- **IDEA** - a new possibility, not yet approved product intent.

## Routing

- VALUABLE / CONFUSING / FRICTION / RISK / IDEA -> Product
- DEFECT-LIKE -> QA or Architecture for classification

Technical acceptance does not decide whether the outcome should be retained. Preserve any explicit Project Lead or stakeholder disposition: ACCEPT, REVISE, DEFER, or REJECT.

Use `templates/EVALUATION_REPORT_TEMPLATE.md` when a durable record helps.
