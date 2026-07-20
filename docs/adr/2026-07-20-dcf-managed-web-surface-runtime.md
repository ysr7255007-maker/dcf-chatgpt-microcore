# ADR: Bootstrap DCF through BrowserClaw, a registered web surface and a local AI

Date: 2026-07-20  
Status: accepted direction; BrowserClaw-first bootstrap spike pending

## Context

The first DCF web adapter runs inside a normal Chrome tab through an extension and injected scripts. It proved the product semantics, but the remote web AI, the browser runtime and the local AI still see different partial realities. The remote web AI cannot directly call a loopback MCP endpoint, while the local AI can control a browser only if it knows which browser instance, tab and conversation belong to the DCF task.

The BrowserOS repository now ships two browsers from one codebase:

- **BrowserOS** is a human-driven Chromium browser with its own built-in AI agent;
- **BrowserClaw** is a Chromium browser specifically driven by external MCP-capable agents such as Codex, OpenCode, Claude Code and Cursor.

BrowserClaw is closer to DCF's first bootstrap need. It is a visible real browser with persistent logins and Chrome-compatible extensions. It exposes one local MCP endpoint, currently documented as `http://127.0.0.1:9200/mcp`, and supports one-click configuration for OpenCode and Codex. Agent runs receive their own grouped tabs, while user-opened tabs remain distinct and may be operated only when explicitly selected. BrowserClaw also persists local audit and replay evidence under `~/.browserclaw/`.

This changes the first integration problem. DCF does not need to make a remote ChatGPT page into an MCP client. It needs to bind a remote web surface, a durable DCF task and a local MCP-capable AI to the same identity.

## Decision

1. DCF will introduce a **managed web surface runtime** for web AI adapters.
2. **BrowserClaw is the lead substrate for the first web–local bootstrap spike.** BrowserOS remains a related upstream and a possible later human-first browser, but BrowserClaw is the product explicitly designed for external local agents.
3. The remote web AI does not directly connect to BrowserClaw MCP. BrowserClaw MCP is a local control plane consumed by DCF Core and local AI clients.
4. The first pairing is:

   ```text
   ChatGPT web surface in BrowserClaw
   → DCF ChatGPT adapter
   → DCF Core task/event store
   → OpenCode or Codex
   → BrowserClaw MCP
   → BrowserClaw tabs and page actions
   ```

5. BrowserClaw provides generic browser eyes and hands. DCF provides provider semantics, task identity, permissions, conversation continuity, result routing and recovery. BrowserClaw is not the DCF coordinator.
6. The current DCF dialogue loop may be reused for the first spike. After BrowserClaw connects its MCP endpoint to the same OpenCode installation used by DCF, a DCF-delegated OpenCode session can call BrowserClaw tools without the web page becoming an MCP client.
7. The first missing protocol is **DCF Surface Registration**, not a new general browser-control protocol. A registered surface must expose at least:
   - `browser_instance_id`;
   - browser tab/page ID as returned by the browser control plane;
   - provider and account/profile hint;
   - durable provider conversation key when available;
   - ephemeral page-instance ID;
   - DCF adapter ID and version;
   - current URL/title and last consumed event cursor;
   - current human/AI control owner.
8. Browser tab IDs and page targets are ephemeral. DCF tasks bind durably to the provider conversation key and DCF surface identity; the adapter re-registers the current tab/target after reload or browser restart.
9. The DCF browser extension/provider adapter is the authoritative source for ChatGPT-specific events such as assistant completion, streaming state, conversation attribution and composer delivery. BrowserClaw MCP is the authoritative generic action surface for listing pages, snapshots, clicks, input and browser-managed sessions.
10. Result delivery should remain provider-semantic where possible: DCF Core sends the result to the ChatGPT adapter, which writes it into the correct composer and confirms delivery. BrowserClaw MCP is a fallback and maintenance path, not the default replacement for semantic adapters.
11. The first DCF surface may be a user-opened ChatGPT tab that is explicitly enrolled, or a persistent DCF-owned ChatGPT tab. BrowserClaw's normal agent-session tabs are not assumed to be durable because they may close when the MCP session ends.
12. DCF will eventually distinguish three tab roles even if BrowserClaw currently exposes two:
   - personal user tab;
   - ephemeral agent tab;
   - persistent DCF cohabited surface, explicitly shared by user and DCF.
13. BrowserClaw's local audit and replay are adopted as browser-action evidence, but they do not replace DCF task, permission, adapter and delivery evidence.
14. Stock Chrome/Chromium with a DCF-managed profile remains the fallback if BrowserClaw cannot host the provider adapters or expose the required surface identity.
15. DCF will consume BrowserClaw as an installed external runtime before considering changes to its agent/server layer or Chromium patches.

## Installation and pairing spike

The first spike proceeds in this order:

1. Install BrowserClaw on the user's machine and use it as a normal browser long enough to establish the required ChatGPT login and ordinary page behavior.
2. Open a new BrowserClaw tab, select **MCP**, and use the one-click **Connect** action for OpenCode and/or Codex. BrowserClaw writes one MCP entry named `BrowserClaw` pointing to its loopback endpoint.
3. Restart the selected local AI so it loads the new MCP configuration.
4. Verify the local AI can list BrowserClaw pages, open an agent tab, navigate, take a snapshot and perform one harmless action.
5. Install the current DCF Chrome extension in BrowserClaw and verify the Shell, plugin registry and ChatGPT provider behavior load.
6. Restart the standalone OpenCode service used by DCF and verify that this exact service process sees the BrowserClaw MCP tools; a different desktop/TUI installation is not sufficient proof.
7. Add the smallest possible surface-registration payload to the DCF ChatGPT adapter and persist the mapping in the local core or, for the initial spike, the existing dialogue bridge state.
8. Delegate a DCF request from the ChatGPT page to OpenCode. The OpenCode session must use BrowserClaw MCP to identify and inspect the registered source page, then return a bounded result through the existing DCF return path.
9. Refresh the ChatGPT page and prove that the provider conversation remains bound while the page-instance and target IDs are replaced.
10. Focus another application for a meaningful interval and prove that the DCF task remains durable even if the page becomes delayed or temporarily unavailable.

## Minimal bootstrap acceptance

The BrowserClaw-first bootstrap is accepted only when:

1. BrowserClaw runs the real ChatGPT website with the user's persistent login and the DCF extension loaded;
2. the exact OpenCode or Codex instance used by DCF has BrowserClaw MCP tools;
3. a page-originated DCF task reaches the local AI without the user copying an MCP URL, tab ID, session ID or task packet during the run;
4. the local AI identifies the registered source surface rather than guessing from the active tab;
5. the local AI can inspect the source surface and operate a separate BrowserClaw agent tab within the same task;
6. the final result returns to the original ChatGPT conversation through the DCF semantic adapter;
7. page reload replaces ephemeral target identity without losing durable task/conversation identity;
8. browser-action evidence from BrowserClaw and task/delivery evidence from DCF can be correlated by one DCF task ID;
9. the browser or adapter may disappear temporarily without erasing the OpenCode task, permission history or pending delivery;
10. a second web provider can later register through the same surface contract without changing the OpenCode/BrowserClaw MCP contract.

## Consequences

- DCF can achieve its first self-observing web–local loop with much less browser infrastructure than a stock-Chrome-first design.
- The remote ChatGPT page remains a participant rather than a privileged local process; its bridge to local execution is the DCF adapter and task protocol.
- OpenCode gains direct access to the visible browser that contains the DCF page, allowing runtime investigation and repair from the same local task.
- BrowserClaw's agent-tab isolation is useful for parallel work, but DCF still needs an explicit persistent shared-surface concept for ongoing conversations.
- DCF must verify that its standalone OpenCode service loads the same MCP configuration as the interactive OpenCode client.
- BrowserClaw is a substrate dependency, not the architectural centre. DCF Core and provider adapters remain replaceable and host-neutral.

## Reconsideration conditions

Reconsider BrowserClaw as the lead substrate if it cannot run the real AI providers reliably, cannot load the DCF extension, cannot expose stable enough tab/page identity, does not make its MCP tools available to the exact OpenCode service used by DCF, or its agent-session lifecycle prevents persistent shared conversation surfaces. These conditions change the browser substrate, not the surface-registration and durable-core architecture.