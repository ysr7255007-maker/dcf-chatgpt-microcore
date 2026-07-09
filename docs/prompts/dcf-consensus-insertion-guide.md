# DCF Consensus Insertion Guide

Date: 2026-07-09
Status: draft

## Purpose

This guide defines a reusable prompt and usage method for building shared understanding about DCF before a new AI session modifies the project.

The goal is not to make the model recite project history. The goal is to establish the correct conceptual frame so that future changes do not drift toward "just fix the userscript" or "add a webpage button".

DCF should be understood as:

> a low-friction language ammunition firing system inside the user's personal cognitive infrastructure.

It has two core layers:

1. **Language ammunition**: persistent, versioned, evolvable, precisely launchable cognitive tools such as expressions, frameworks, role protocols, workflow prompts, and handoff texts.
2. **Low-friction control architecture**: a small stable kernel, replaceable plugins, failure isolation, reliable publishing, and text-driven evolution that helps the user stay in flow.

## When to insert the consensus prompt

Insert the prompt when:

- opening a new AI window for DCF work;
- asking another model to modify the repo;
- starting a feature discussion about ammo, plugins, release, or maintenance;
- recovering from a session where the model treated DCF as a simple userscript;
- asking for architecture, roadmap, or implementation planning;
- handing off from one AI tool to another.

The prompt should come before detailed implementation requests.

## How to use it

Paste the consensus block first, then ask the model to do one of three things:

```text
1. Restate the project understanding in its own words.
2. Classify the next task by layer: ammo, plugin, runtime, supply chain, documentation, or ADR.
3. Proceed with the requested action only after the layer and boundary are clear.
```

The point is to build operational agreement, not to force a verbose essay.

## Canonical insertion prompt

```text
<<<DCF_CONSENSUS
You are entering the DCF ChatGPT Microcore project.

Do not treat DCF as an ordinary ChatGPT enhancement script or a simple webpage button. DCF is part of a personal cognitive infrastructure.

Its first layer is a language ammunition system. It turns high-quality expressions, judgment frameworks, role protocols, workflow prompts, handoff texts, ADR prompts, and multi-step collaboration flows into persistent, versioned, evolvable, searchable, and precisely launchable language ammunition.

Its second layer is a low-friction control architecture. It should reduce the user's operational friction through a small stable kernel, replaceable plugins, failure isolation, reliable publishing, and text-driven evolution. The goal is to let the user extend and use the system while staying in flow.

The current Tampermonkey userscript is the launcher shell and runtime carrier. It is not the whole product.

Keep these boundaries:
- source and internal organization may be modular;
- the published Tampermonkey artifact should be a complete .user.js;
- GitHub is a version, publishing, documentation, and ammunition supply source;
- the browser runtime should not download remote JavaScript and execute it with Function(source) or eval;
- localStorage may store state, configuration, indexes, and user data, but should not be treated as an executable code release channel;
- pluginization should happen through source structure, data definitions, build outputs, and clear interfaces, not by fragile runtime eval.

When working on DCF, first classify the task by layer:
- product intent;
- ammo model;
- plugin/control architecture;
- runtime userscript;
- supply chain;
- documentation and ADR.

Then preserve the core direction:
Language ammunition becomes a first-class object.
System use and evolution should have as little friction as possible.

Before implementing, briefly state your working interpretation, the layer you are changing, and the boundary you will preserve.
DCF_CONSENSUS>>>
```

## Compact version

Use this when context is tight:

```text
<<<DCF_CONSENSUS_COMPACT
DCF is not just a userscript. It is a low-friction language ammunition firing system for personal cognitive infrastructure.

Layer 1: persist, version, evolve, retrieve, combine, and precisely fire high-quality prompts, expressions, judgment frameworks, role protocols, handoffs, and multi-step collaboration flows.

Layer 2: reduce user friction through a small stable kernel, replaceable plugins, failure isolation, reliable publishing, and text-driven evolution.

Published runtime should remain a complete Tampermonkey .user.js. Do not reintroduce remote JS eval, Function(source), runtime chunk loading, or localStorage-as-code. GitHub is a publishing/version/ammo source, not a browser runtime code execution source.

Before changing anything, classify the task: product intent, ammo model, plugin architecture, runtime userscript, supply chain, documentation, or ADR.
DCF_CONSENSUS_COMPACT>>>
```

## Expected response from the receiving AI

A good response should not jump straight into code. It should first establish:

```text
I understand DCF as a low-friction language ammunition system, not just a userscript.
The current task affects: <layer>.
The boundary I will preserve is: <boundary>.
The next action is: <action>.
```

This keeps the model aligned without turning the prompt into a long rulebook.

## What the prompt is not for

Do not use this prompt to make every ordinary message heavy. Use it at session starts, handoffs, major design turns, or before letting another AI change the project.

Do not treat the prompt as a replacement for ADR. Consensus establishes shared understanding; ADR records durable decisions.

Do not treat the prompt as a replacement for verification. After repository changes, files still need to be read back and checked.

## Relationship to ammunition

This guide is itself a language ammunition item. It should eventually be represented in the ammunition system as a reusable consensus-building ammo entry.

Suggested ammo identity:

```text
ammo_id: dcf.consensus.project-frame.v1
kind: consensus_prompt
purpose: align a new AI session with DCF's two-layer product and architecture model before project changes
```
