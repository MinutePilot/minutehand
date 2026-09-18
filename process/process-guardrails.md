# Process Guardrails

Diagnosis and planning happen in chat with Claude. Execution happens in
Claude Code (CC) from an approved prompt.

- **Diagnose in chat, first.** Understand the root cause (bug) or actual
  requirement (feature) fully in chat before any prompt goes to CC.
- **Read before drafting a prompt.** Look at what already exists in the repo
  rather than assuming.
- **Prompt is the proposal; approval hands it to CC.** Claude writes a clear,
  scoped prompt describing the change. Norm reviews and approves it in chat,
  then hands it to CC to execute.
- **Branch first, small verified steps.** Before any CC prompt makes changes,
  it should create or confirm a feature/fix branch off main, so main stays
  deployable throughout. Break big asks into smaller pieces CC can execute
  and Norm can check one at a time.
