# QA Checklist

Before anything is called done, it passes all four:

1. **Matches intent** — for a feature, the original description/sketch; for
   a bug fix, does the reported bug actually no longer reproduce.
2. **Survives a chaos user** — edge cases, careless/hostile input, not just
   the happy path. (E.g. the recent publish bug — what does clicking
   publish twice, or on a doc mid-edit, do?)
3. **Shortest safe path** — fewest steps to the task, no way to fall into a
   broken state.
4. **Human-readable errors** — plain-language error messages, not cryptic
   technical ones.

Then, and only then, merge the branch into main.
