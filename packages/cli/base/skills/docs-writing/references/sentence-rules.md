# Sentence rules - 20 checkable gates

Sources: Google developer documentation style guide, Microsoft Writing Style Guide, plainlanguage.gov, GOV.UK content guide, GitLab docs style guide, Orwell's six rules, Strunk & White.

Format: RULE | why | BAD -> GOOD.

1. **Sentence <= 20 words; split anything over 25.** Long sentences lose the reader. | "If the VM has started and the network is reachable and credentials are valid, then the request, once retried, will succeed." -> "The retry succeeds once the VM is running, the network is reachable, and the credentials are valid."
2. **One idea per sentence.** Compound ideas hide the point. | "The boot phase resolves bindings and it also runs migrations, which can fail." -> "The boot phase resolves bindings. It then runs migrations, which can fail."
3. **Paragraph <= 3-4 sentences.** Walls block scanning. | Count sentences; over 4 fails.
4. **Active voice.** Passive hides who does what. | "The record is validated by the repository." -> "The repository validates the record."
5. **Present tense for behavior.** Timeless facts read as facts. | "The server will send an ack." -> "The server sends an ack."
6. **"You" + imperative for steps.** Direct responsibility. | "One can configure the pool." -> "Configure the pool."
7. **Condition or goal BEFORE the instruction.** The reader decides whether to act before acting. | "Call commit() to persist the transaction." -> "To persist the transaction, call commit()."
8. **No hidden verbs** (-tion, -ment, "perform/make/do + noun"). The buried verb is the strong verb. | "Perform a validation of the input." -> "Validate the input."
9. **Cut filler phrases.** Every word must tell. | "in order to" -> "to"; "at this point in time" -> "now"; "due to the fact that" -> "because".
10. **Short common word over long word.** | "utilize/commence/leverage" -> "use/start/use".
11. **Replace ambiguous pronouns with the noun.** "it/this/they" force a re-read. | "If the query fails, retry it." -> "If the query fails, retry the query."
12. **No difficulty words: simply, just, easy, obviously, of course.** Easy varies by reader. | "Simply inject the repository." -> "Inject the repository."
13. **No self-referential filler: "This page/section/guide describes...".** Say the thing instead. | "This section explains how to configure X." -> "Configure X by...".
14. **Spell out Latin: "for example", "that is" - not e.g./i.e.** Translation-safe and clearer.
15. **Avoid weak verbs: there is/there are/be/have/make/do.** They pad. | "There are three options that exist." -> "You have three options."
16. **Qualifying clause first, subject-verb-object order.** | "Retry the read, but only if replica lag is suspected." -> "If you suspect replica lag, retry the read."
17. **"Must" for requirements, "can/may" for options, never "shall".**
18. **No idioms, humor, or cultural metaphors.** They fail global readers.
19. **No directional words (above/below); use "earlier/later/the following".** Layout changes; direction lies.
20. **One term per concept, everywhere.** Synonyms read as new concepts. | Pick "repository"; never alternate with "repo"/"store".

## Hard numbers

| Metric | Number | Source |
|---|---|---|
| Words per sentence (target) | 15-20 | plainlanguage.gov |
| Words per sentence (hard split) | > 25 | GOV.UK |
| Sentences per paragraph | max 3-4 | GOV.UK |
| Reading-age target | ~9 | GOV.UK |
| One-sentence paragraphs | 3-5 per ~1000 words, payoffs only | Pocock analysis |
| First code block | within ~15 lines of the top | Pocock analysis |
| Acronyms | spell out on first use, once per page | GitLab |
