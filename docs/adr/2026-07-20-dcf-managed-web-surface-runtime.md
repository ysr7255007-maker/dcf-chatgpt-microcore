# ADR: Bootstrap DCF through BrowserOS Chromium, a registered web surface and a local AI

Date: 2026-07-20  
Status: accepted direction; BrowserOS-first installation and pairing spike pending

## Context

The first DCF web adapter runs inside a normal Chrome tab through an extension and injected scripts. It proved the product semantics, but the remote web AI, browser runtime and local AI still see different partial realities. The remote web AI cannot directly call a loopback MCP endpoint, while the local AI can control a browser only if it knows which browser instance, page and provider conversation belong to the DCF task.

DCF needs a real, persistent Chromium-family browser which the user can inhabit normally and which a local AI can observe and operate through a stable local control surface.

The selected candidate is the exact project **`browseros-ai/BrowserOS`**:

- an open-source Chromium fork;
- a built-in local MCP server exposed from `chrome://browseros/mcp`;
- Chrome-extension compatibility and Chrome data import;
- generic page, tab, window, DOM, accessibility snapshot, input, upload, download, history and bookmark tools;
- external MCP clients such as Codex, Claude Code, Gemini CLI and OpenClaw.

A naming collision caused a temporary architecture error. The independent `browserclaw` library is born from OpenClaw's browser automation module and is a Playwright/CDP eyes-and-hands library, not the BrowserOS Chromium substrate selected for DCF. A separate `browseros-ai/openclaw` fork also exists. Neither is evidence that DCF should replace BrowserOS Chromium with “BrowserClaw.” All DCF substrate references must therefore include the exact repository and product identity rather than relying on the ambiguous name.

## Decision

1. DCF will introduce a **managed web surface runtime** for web AI adapters.
2. **`browseros-ai/BrowserOS` Chromium is the lead substrate for the first web–local bootstrap spike.**
3. The remote web AI does not directly connect to BrowserOS MCP. The MCP endpoint is a local control plane consumed by DCF Core and/or a local MCP-capable AI.
4. The first pairing is:

   ```text
   ChatGPT web surface inside BrowserOS
   → DCF ChatGPT adapter
   → DCF Core task/event store
   → OpenCode or Codex
   → BrowserOS MCP
   → BrowserOS pages and browser actions
   ```

5. BrowserOS provides generic browser eyes and hands. DCF provides provider semantics, durable task identity, conversation continuity, permissions, result routing, recovery and cross-adapter state. BrowserOS is a substrate, not the DCF coordinator.
6. The current DCF dialogue loop may be reused for the first spike. Once the same OpenCode or Codex instance used by DCF has the BrowserOS MCP endpoint configured, a page-originated DCF task can delegate browser inspection or action without making the page itself an MCP client.
7. The first missing protocol is **DCF Surface Registration**, not a new general browser-control protocol. A registered surface exposes at least:
   - `browser_runtime`: exact substrate and version;
   - `browser_instance_id`;
   - BrowserOS tab/page ID;
   - provider and account/profile hint;
   - durable provider conversation key when available;
   - ephemeral page-instance ID;
   - DCF adapter ID and version;
   - current URL/title and last consumed event cursor;
   - current human/AI control owner.
8. Browser tab IDs and page targets are ephemeral. DCF tasks bind durably to the provider conversation key and DCF surface identity; the adapter re-registers the current page after reload or browser restart.
9. The DCF provider adapter is authoritative for ChatGPT-specific events such as assistant completion, streaming state, conversation attribution and composer delivery. BrowserOS MCP is authoritative for generic page discovery, observation and browser actions.
10. Result delivery remains provider-semantic where possible: DCF Core sends the result to the ChatGPT adapter, which writes it into the correct composer and confirms delivery. BrowserOS MCP is a maintenance and fallback action path, not the default replacement for semantic adapters.
11. BrowserOS console, network, worker and process evidence must be verified rather than assumed. Its published MCP surface is strong in general automation, while deeper DevTools evidence may still require CDP or a DCF runtime-evidence companion.
12. Stock Chrome/Chromium with a DCF-managed profile remains the fallback if BrowserOS cannot reliably run the target providers, load DCF extensions or expose the required surface identity and lifecycle facts.
13. DCF will consume BrowserOS as an installed external runtime first. It will not fork Chromium or modify BrowserOS engine code until a missing requirement is proven impossible to satisfy through its MCP, extension, CLI, SDK or CDP surfaces.

## Installation and pairing spike

The first spike proceeds in this order:

1. Install BrowserOS from the official `browseros-ai/BrowserOS` distribution.
2. Import the chosen Chrome data or establish fresh persistent logins, then verify ChatGPT and one second AI provider under ordinary human use.
3. Install the current DCF Chrome extension and verify Shell, plugin registry, Dialogue Loop and provider semantics.
4. Open `chrome://browseros/mcp`, copy the actual local Server URL shown by the installed browser, and configure it in Codex first because BrowserOS publishes a direct Codex MCP command.
5. Configure the same endpoint in the exact OpenCode installation and service process used by DCF. BrowserOS documentation does not currently publish an OpenCode-specific one-click path, so this must be verified against OpenCode's HTTP MCP configuration rather than inferred from another client.
6. Restart the selected local AI/service and prove it can call `list_pages`, identify BrowserOS, open a harmless test page, take a snapshot and return a bounded result.
7. Add the smallest possible surface-registration payload to the DCF ChatGPT adapter and persist the mapping in DCF local state.
8. Delegate a read-only DCF request from the ChatGPT page. The local AI must use BrowserOS MCP to locate the registered source page rather than guessing from the active tab.
9. Return the result through the existing DCF provider-semantic delivery path.
10. Refresh the ChatGPT page and prove the durable conversation binding survives replacement of the ephemeral page identity.
11. Focus another application for a meaningful interval and prove the DCF task remains durable even if browser rendering or adapter events are delayed.

## Minimal bootstrap acceptance

The BrowserOS-first bootstrap is accepted only when:

1. BrowserOS runs the real ChatGPT website with the user's persistent login and the DCF extension loaded;
2. the exact OpenCode or Codex instance used by DCF has BrowserOS MCP tools;
3. a page-originated DCF task reaches the local AI without the user copying the MCP URL, page ID, session ID or task packet during the run;
4. the local AI identifies the registered source surface rather than guessing from the active page;
5. the local AI can inspect the source surface and operate a separate test page within the same DCF task;
6. the final result returns to the original ChatGPT conversation through the DCF semantic adapter;
7. page reload replaces ephemeral target identity without losing durable task/conversation identity;
8. browser-action evidence and DCF task/delivery evidence can be correlated by one DCF task ID;
9. the browser or adapter may disappear temporarily without erasing the local-AI task, permission history or pending delivery;
10. the same DCF Core can later attach a second web provider without changing the local-AI BrowserOS MCP contract.

## Consequences

- DCF can use an existing agent-adapted Chromium rather than reproduce browser maintenance and generic control tools from scratch.
- The remote ChatGPT page remains a participant rather than a privileged local process; its bridge to local execution is DCF Surface Registration and the durable task protocol.
- The local AI gains direct access to the same visible BrowserOS instance that contains the DCF page, enabling runtime observation and repair from the same task.
- BrowserOS's generic tools do not eliminate the need for provider-specific DCF adapters or deeper runtime evidence.
- Exact repository/product identity becomes mandatory in architecture decisions where similarly named projects exist.

## Reconsideration conditions

Reconsider BrowserOS as the lead substrate if real AI providers fail materially, DCF extensions cannot run, the exact local AI cannot consume its MCP endpoint, page identity is too weak for durable surface registration, deeper runtime facts cannot be added, or maintaining compatibility becomes harder than supervising stock Chrome. These conditions change the browser substrate, not the surface-registration and durable-core architecture.
