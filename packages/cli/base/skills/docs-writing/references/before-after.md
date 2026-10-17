# Worked example - a real IGNIS changelog bullet, before and after

From the 2026-07-18 Repository Read Retry changelog. Every fact survives; the reading effort does not.

## Before (one bullet, 5 lines, two exceptions buried mid-paragraph)

> **Never a new error, and never a fabricated result either - with two deliberate exceptions.** A real database/engine error is never retried - it propagates immediately, exactly as before. Retries only happen because a read *succeeded* but the predicate said "not yet." On exhaustion the framework returns the last result as-is - it does not throw and does not invent a "not found." The two exceptions: an invalid `maxAttempts` (below `1`) throws immediately, before any read runs; and an aborted `signal` rejects the call rather than falling back to the last result, since the caller cancelled and no longer wants one.

Why it fails: 96 words in one bullet. Double negation ("never... never... with exceptions"). The reader must hold two exceptions in their head while parsing four other claims. Nothing is scannable.

## After (three one-idea sentences; numbers moved to the options table)

> - Retry happens only when the read SUCCEEDED but the result is not what you want yet.
> - A real database error is never retried. It throws immediately, same as before.
> - Out of attempts? You get the last result as-is. No new error.

The two exceptions became table rows and one-line notes where the reader actually needs them:

> | `maxAttempts` | `3` | Total reads, including the first. Below `1` throws. |
> | `signal` | - | Cancel the loop (rejects the call). |

## What the rewrite did, mechanically

1. Split 96 words into 3 bullets of one idea each (sentence-rules 1, 2).
2. Killed the double negation; each claim is stated positively.
3. Moved the exceptions out of the prose flow into the table rows they describe (page-anatomy rule 3, 4).
4. Kept the payoff rhythm: "Out of attempts? You get the last result as-is." - question bridge + short verdict (voice rules 5, 8).
5. Cut zero facts.

Calibrate to this distance. If your rewrite only trimmed 10% of the words and kept the paragraph shape, you have not applied the method yet.
