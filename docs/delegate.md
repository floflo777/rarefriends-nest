# Steward delegate (specified, not deployed)

Nest's Steward prepares transactions and the holder signs each one. A fully autonomous mode ("the pet feeds itself while you sleep") would need a delegate that can act without the holder online. This is the specification; it is deliberately not part of the submission because an unaudited contract that spends holders' RF is the one risk the rules ask entrants to flag.

## Contract: `NestDelegate`

- One instance per holder, deployed by the holder; `owner` immutable.
- `allow(bytes4 selector, bool)` for `claim`, `claimBatch`, `hardwire`, `promote`, `upgrade`, `activate` on ActivationManager only. No arbitrary calls.
- `setCap(uint256 rfPerDay, uint64 expiry)`: rolling 24 h RF spend cap and an expiry after which nothing executes.
- `setSteward(address)`: the hot key that may call `execute(bytes calldata)`; it can be a server, a phone, or an agent.
- `execute` checks selector allow-list, target == ActivationManager, tokenId ∈ owner's Friends (via `ownerOf`), cap and expiry, then `transferFrom(owner → this)` exactly the quoted cost, approves ActivationManager for that amount and calls it. Any leftover RF is returned to the owner in the same transaction.
- `revoke()` by owner at any time; `sweep()` returns anything held.

## Why not now

A cap-and-allow-list delegate is small, but "small" is not "audited", and the difference between the two is the whole trust model. Nest ships the plan and the dry-run; the delegate ships when it has been reviewed.
