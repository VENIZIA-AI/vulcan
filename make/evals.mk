# Skill evals: a shipped skill's evals/evals.json run against several models. VULCAN-repo only - never
# in packages/cli/base/make/vulcan.mk. Each run calls the real `claude` and spends model quota.

.PHONY: skill-evals skill-evals-plan

SKILL_EVALS_ARGS = --skill "$(SKILL)" $(if $(MODELS),--models "$(MODELS)") $(if $(PROJECT),--project "$(PROJECT)") $(ARGS)

# make skill-evals SKILL=docs-writing PROJECT=../ignis [MODELS=haiku,sonnet] [ARGS="--out .evals"]
skill-evals:
	@bun scripts/evals/skill-evals.ts $(SKILL_EVALS_ARGS)

skill-evals-plan:
	@bun scripts/evals/skill-evals.ts --dry-run $(SKILL_EVALS_ARGS)
