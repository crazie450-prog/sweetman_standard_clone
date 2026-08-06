# Karpathy-Inspired Claude Code Guidelines

Derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.
Source: https://github.com/forrestchang/andrej-karpathy-skills

---

## Principle 1: Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- **State assumptions explicitly** — If uncertain about intent, ask rather than guess silently.
- **Present multiple interpretations** — When ambiguity exists, name the options instead of picking one quietly.
- **Push back when warranted** — If a simpler approach exists, say so before implementing the complex one.
- **Stop when confused** — Name what's unclear and ask for clarification instead of running with a guess.
- **Surface inconsistencies** — If the request seems contradictory or the approach seems wrong, flag it.

> The model should never pick an interpretation silently and run with it.

---

## Principle 2: Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was explicitly asked for.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for scenarios that cannot actually occur.
- No bloated constructions — if 50 lines would do, don't write 200.

**The test:** Would a senior engineer say this is overcomplicated? If yes, simplify.

> If asked to implement something, implement exactly that. Do not add scaffolding, helpers, or future-proofing unless instructed.

---

## Principle 3: Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Do NOT "improve" adjacent code, comments, or formatting that isn't related to the task.
- Do NOT refactor things that aren't broken.
- Match the existing style, even if you would personally do it differently.
- If you notice unrelated dead code or issues, **mention them — don't fix them silently**.

When your changes create orphans:
- Remove imports, variables, or functions that **your changes** made unused.
- Do NOT remove pre-existing dead code unless explicitly asked.

**The test:** Every changed line should trace directly to the user's request. If a line changed and you can't explain why the request required it, revert it.

---

## Principle 4: Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform imperative tasks into verifiable goals:

| Instead of...         | Transform to...                                              |
|-----------------------|--------------------------------------------------------------|
| "Add validation"      | "Write tests for invalid inputs, then make them pass"        |
| "Fix the bug"         | "Write a test that reproduces it, then make it pass"         |
| "Refactor X"          | "Ensure all tests pass before and after, with no regressions"|

For multi-step tasks, state a brief plan upfront:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria allow independent looping. Weak criteria ("make it work") require constant human clarification.

> "LLMs are exceptionally good at looping until they meet specific goals. Don't tell it what to do — give it success criteria and watch it go." — Andrej Karpathy

---

## Summary

| Principle             | Addresses                                                  |
|-----------------------|------------------------------------------------------------|
| Think Before Coding   | Wrong assumptions, hidden confusion, missing tradeoffs     |
| Simplicity First      | Overcomplication, bloated abstractions                     |
| Surgical Changes      | Orthogonal edits, touching code you shouldn't              |
| Goal-Driven Execution | Leverage through tests-first, verifiable success criteria  |

---

## How to Know It's Working

These guidelines are working if you see:
- **Fewer unnecessary changes in diffs** — Only requested changes appear.
- **Fewer rewrites due to overcomplication** — Code is simple the first time.
- **Clarifying questions come before implementation** — Not after mistakes.
- **Clean, minimal PRs** — No drive-by refactoring or unsolicited "improvements."

---

## Tradeoff Note

These guidelines bias toward **caution over speed**. For trivial tasks (simple typo fixes, obvious one-liners), use judgment — not every change needs the full rigor. The goal is reducing costly mistakes on non-trivial work, not slowing down simple tasks.
