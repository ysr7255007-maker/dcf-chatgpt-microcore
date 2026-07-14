# ADR: Canonical module supersession and workbench consolidation

Date: 2026-07-14  
Status: accepted

## Context

Migration deliberately kept legacy modules discoverable, but no exit condition existed after a complete replacement became active. The temporary compatibility rule therefore produced permanent duplicate entries in Functions, Maintenance role management and Package Management. Title-based deduplication would be unsafe because similar names do not prove equivalent commands or ownership.

## Decision

- An active module may declare exact predecessor IDs in `supersedes`.
- Projection validates self-replacement, conflicting replacements and cycles.
- A predecessor is omitted from normal Runtime modules only while a valid replacement is active.
- Registry publishes the resolved relation as `dcf.runtime.module-supersession.v1`.
- A package whose only runtime capability consists of superseded modules moves to a folded historical package section; it is not automatically deleted.
- `dcf.standard.ammo@1.3.0` becomes the canonical `语言弹药工作台`, absorbs direct create/edit/search in addition to the existing value loop, and supersedes `dcf.ammo_workbench`, `dcf.ammo_workspace.unified` and `dcf.language_ammo`.

## Boundaries

- Similar titles never create a replacement relation.
- Distinct helpers such as extraction or formatting remain unless explicitly audited and superseded.
- User ammo and other user content are not package-owned and are never deleted by module consolidation.
- Removing the canonical replacement restores legacy reachability from the still-installed historical package.
