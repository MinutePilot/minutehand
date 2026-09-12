# Generation Quality Regression Fixture

Run this fixture manually before deploying any prompt changes to `generate-minutes/index.ts`. Paste the source notes into MinuteHand using the **STRATA** template and verify each expected behavior against the output.

---

## Source Notes (paste as-is)

```
Strata Council Meeting — KAS 1117
Sept 15 2026 — started around 7pm

On the call: Priya S (president), Ellen R (treasurer), Marcus T (council member). Dan B sent apologies, couldn't make it.

Quorum: we had 3 out of 5 council members, which is enough.

Priya called the meeting to order.

Financial report — Ellen went through the September statement. Operating fund balance is approximately $42,000 (exact figure pending bank rec). Reserve fund roughly $118,500. No issues flagged.

New Business:
- Roof drainage issue on the east side. Marcus moved to get three quotes from licensed contractors. Priya seconded. Passed 3-0.
- Bylaws update re: short-term rentals. Priya moved to draft a notice to owners for review at the next meeting. Seconded. Passed 3-0.

Action items:
- Marcus to obtain contractor quotes for roof drainage — needed for review at next meeting.
- Someone needs to draft the STR bylaw notice — for the next meeting.

Meeting adjourned around 8:15pm. Next meeting: October 20, 2026.
```

---

## Expected Behaviors — check each

### Fix 1: No fabricated names for unattributed facts

- The bylaws motion was "Seconded" without naming who seconded. The output **must not** name a specific person as the seconder — not even with a caveat or footnote. Acceptable output: `MOVED by Priya S, SECONDED — CARRIED (3–0)` or `SECONDED (seconder not stated)`.
- The STR bylaw notice action item has no named owner. The Responsible Party column **must** show `[Owner not stated]`, not a guessed name.

**FAIL if:** Any specific name appears as the seconder for the bylaws motion, or any name is assigned to the STR action item, when those names are not in the source.

---

### Fix 2: Meeting format inferred from context

- The source says "On the call:" — a clear teleconference/video signal. The Location field **must** infer a virtual/teleconference format and label it as inferred, e.g.:
  `> **Location:** Teleconference — inferred from source context`
  
**FAIL if:** Location shows `[Not stated — please confirm]` when "on the call" is present in the source.

---

### Fix 3: No empty boilerplate sections

- The source has no mention of: Correspondence, Approval of Agenda, Old Business, Approval of Previous Minutes.
- These sections **must not appear** in the output. They should be omitted entirely.
- Sections that **should** appear: Quorum, Call to Order, Financial Report, New Business, Action Items, Adjournment, Next Meeting.

**FAIL if:** Any of Correspondence, Approval of Agenda, Old Business appear with only `[Not stated — please confirm]` as content.

---

### Fix 4: Draft disclaimer present

- The output **must** end with a line like:
  `These minutes are presented in draft form and are subject to approval at the next Strata Council (BC).`
  (Optionally with the next meeting date: `...at the next Strata Council (BC). (Next meeting: October 20, 2026)`)

**FAIL if:** This line is absent from the generated output.

---

### Fix 5: Due dates inferred from action item context

- Marcus's action item ("contractor quotes — needed for review at next meeting") should have Due Date `October 20, 2026` or `Next meeting (October 20, 2026)` — not `[Not stated — please confirm]`.
- The STR bylaw notice action item similarly implies "next meeting" as due date.

**FAIL if:** Either action item's Due Date shows `[Not stated — please confirm]` when the source clearly implies the next meeting deadline.

---

## How to Re-Run

1. Open the MinuteHand app (local dev or production).
2. Paste the source notes above into the notes input field.
3. Select template: **Strata Council (BC)**.
4. Generate minutes.
5. Check each of the five behaviors above against the output.
6. Note any failures with the exact generated text for debugging.

Run this fixture after any change to `supabase/functions/generate-minutes/index.ts` before deploying.
