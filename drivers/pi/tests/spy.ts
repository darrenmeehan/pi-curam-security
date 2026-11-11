/**
 * Test-only extension: dump every provider-bound payload to a file so the
 * E2E gate can assert the planted secret never crosses the boundary.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";

export default function spy(pi: ExtensionAPI) {
  pi.on("before_provider_request", (event) => {
    const out = process.env.MEMBRANE_SPY_OUT;
    if (!out) return;
    appendFileSync(out, JSON.stringify(event.payload) + "\n");
  });
}
