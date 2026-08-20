# cognition/

The computational cognition boundary of Ascend OS. Full specification: [`docs/COGNITION-CONTRACT.md`](../docs/COGNITION-CONTRACT.md).

**"Neural Core" is the product name, not this layer.** `app/page.tsx` and `components/graph/NeuralCore.tsx` own that name and remain the renderer. Cognition must never depend on either.

## The question this layer answers

> **What tends to occur together in this business, and with what evidence?**

Everything else it will eventually do — predict, hypothesise, propose — is downstream of that one question. If a change to this layer does not make its answer better or more honest, it does not belong here.

## What it is not

It is not a source of truth. The Vault stays authoritative for current business state, the Event Spine for history, the graph for structure. Cognition produces derived state that is always rebuildable and always deletable.

It cannot decide what is true. The `Epistemics` ladder in `contract.ts` names every tier a claim can occupy, and this layer can author only `learned`, `predicted`, and `hypothesis`. It has no type capable of expressing a `fact` or a `witnessed` event — enforced by F22.13, not by good intentions.

## The founding principle

> **Anything a human answered is a fact. Anything a machine derived is a cache.**

The failure mode this layer is built against is not a bad learning rule. It is a chain of individually reasonable derivations — association, then pattern, then prediction, then hypothesis — arriving at a claim of truth nobody authorised. The only legal ascent runs:

```
machine inference → hypothesis → human confirmation → business fact → core writer → event
```

No layer may silently promote one epistemic tier into another.

## Status

**N0 — anatomy and walls only.** This directory contains vocabulary and bounds. There is no learning logic, no activation engine, no co-occurrence, no persistence, no UI, and no AI. Nothing imports it yet.

Its walls are enforced by **F22** in `tests/architecture/fitness.test.ts`, and F12 and F19 were widened to cover it in the same commit that created it — a new top-level directory is invisible to every fitness rule until it is named in one.

## Constraints

Pure, in the same sense the engines are: no filesystem, no network, no `process.env`, no `server-only`, no module-level mutable state, no writes, no events emitted. `now` is always injected — there is no clock read in this layer, and F22.6 enforces that here even though no equivalent rule exists for `engines/` yet.

Cognition may import `import type` from `@/domain` and nothing else. In particular it may not import `@/graph-view`: `graph-view/projection.ts` carries its own retirement notice, and building cognition on a layer the architecture reserves the right to delete would invert the dependency that makes the projection disposable.

Activations arrive through `ActivationSource`. Cognition never consumes `EventEnvelope` directly, and events with `actor === "system"` are excluded at the adapter — otherwise the strongest association the system learns is that the reconciler ran.

## Retirement condition

`graph-view/projection.ts` ships with a retirement notice in its header; this layer gets one too.

**Retire `cognition/` if it cannot be shown to improve the operator's answers.** `lib/compileContext.ts` and the `compile*Brief` modules already assemble context without it. If cognition never measurably improves that pack — or if the event corpus never grows enough for co-occurrence to mean anything — then this is an ornament with twenty-two fitness rules around it, and deleting it should cost nothing. That deletability is a feature, and every rule in F22 exists partly to preserve it.
