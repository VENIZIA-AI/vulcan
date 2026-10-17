# The teaching voice - 16 rules reverse-engineered from Matt Pocock

Sources: 8 pieces read in full across totaltypescript.com and aihero.dev (generics articles, satisfies, enums critique, tokens, MCP explainer). Quotes are his.

1. **Open with the concept, a reframe, or a concrete artifact - sentence 1.** Never a preamble. | "There is no such thing as a 'generic'."
2. **First code block (or diagram) within the first screen** - roughly 3 sentences / 15 lines in. Never stack 8+ sentences of prose first.
3. **Weld the stakes to the definition.** "X is Y - and it matters because Z." | "Tokens are the fundamental building blocks... Understanding them is essential, especially since you're billed based on token usage."
4. **Sentences 10-18 words, paragraphs 2-4 sentences.**
5. **One-sentence paragraphs are payoffs.** Drop one every 4-6 paragraphs, reserved for a verdict or thesis. | "Don't do this."
6. **Every example is a loop: prose sets up -> code -> prose points at what to notice.** Never drop code cold. Never explain unseen code.
7. **Transition on "But..." naming the problem the next section solves.** Never "Additionally/Moreover/Furthermore". | "But, we don't want to pass any values to it initially."
8. **Questions as section bridges.** | "So, what terms should we use instead?"
9. **"You" and "we", contractions everywhere.** Never "one can", never "the developer should".
10. **Bare imperatives drive steps.** | "Add a type argument to it:" - never "you might want to consider adding".
11. **Quote the reader's likely wrong assumption, then correct it.** | "You might look at the code below and say 'we're passing a generic to useState'."
12. **Small caveats inline as parentheticals**; a dedicated subsection only for a genuinely tricky one. Never derail the main thread with an edge case.
13. **Defer advanced complexity explicitly, with reassurance.** | "Generics get a lot more complex from here... but this mental model stays the same."
14. **Steelman before criticizing; hedge subjective claims honestly.** | "I like enums. I like them a lot... But TypeScript's implementation of them is weird enough for me not to recommend them."
15. **End on reader capability or a next action. Stop abruptly.** Never "In conclusion", never a recap.
16. **Bold a term only at its defining first appearance. One plain analogy per hard concept, never stacked metaphors.** | "a type parameter is like a function parameter."

## The style in one sentence

Reframe the reader's wrong model in sentence one, show code within the first screen, teach in prose-code-notice loops of short sentences, pivot on "But..." and questions, keep caveats inline, defer the hard stuff with a promise the model holds, speak as "you" with imperatives - and stop the moment the reader can act.
