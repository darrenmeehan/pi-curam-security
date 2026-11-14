default: help

.PHONY: help
help: ## This menu
	@grep -P "##\s(.*)$$" $(MAKEFILE_LIST) | sed 's/:.*##/:/'

.PHONY: test
test: ## Driver unit tests + mem/1 contract (no model, no engine build needed)
	bun test drivers/pi
	python3 drivers/pi/tests/test_mem_contract.py

.PHONY: gate
gate: test ## Everything that needs no model call: unit, contract, latency, crash probe
	python3 drivers/pi/tests/probe_latency.py
	bun drivers/pi/tests/probe_respawn.ts

.PHONY: gate-e2e
gate-e2e: ## Provider-boundary gates; each needs a model call
	E2E_COMPILED_DRIVER=$(E2E_COMPILED_DRIVER) bash drivers/pi/tests/e2e_spy.sh
	E2E_COMPILED_DRIVER=$(E2E_COMPILED_DRIVER) bash drivers/pi/tests/probe_kinds.sh
	E2E_COMPILED_DRIVER=$(E2E_COMPILED_DRIVER) bash drivers/pi/tests/probe_gaps.sh
