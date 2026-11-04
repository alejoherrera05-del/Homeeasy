# HomeEasy Pentagrama Agent — Design QA

- Source visual truth: `infra/pentagrama-agent/design-qa/source-premium-agent.png`
- Implementation screenshot: `infra/pentagrama-agent/design-qa/implementation-native-ui.png`
- Combined comparison: `infra/pentagrama-agent/design-qa/comparison.png`
- Source pixels: 1504 × 1046; implementation pixels/CSS size: 920 × 650; Windows DPI-aware native capture at device scale 1.
- State: source depicts healthy; implementation intentionally depicts the live `recovering / AGENT_JOB_NOT_FOUND` runtime state. Layout and components are compared independently of that truthful semantic-state difference.

## Full-view comparison evidence

The native WPF implementation preserves the selected direction: burgundy/gold branded title bar, elevated primary status panel, three compact capability indicators, secure Pentagrama connection card, and paired diagnostic/HomeEasy actions. The hierarchy, width ratios, vertical rhythm, radii, elevation and CTA emphasis follow the reference while adapting copy to live Agent state.

## Focused-region comparison evidence

- Title bar: real logo asset, crisp Segoe UI typography, gold divider and native minimize/close controls.
- Status: large semantic icon, centered title/detail, raised capability capsules and dynamic colors.
- Connection: protected-credentials copy and `Configurar acceso` open the HomeEasy-managed secure configuration; no password field or plaintext secret exists locally.
- Footer: secondary diagnostic action and high-emphasis HomeEasy CTA remain fully visible at 920 × 650.

## Required fidelity surfaces

- Fonts and typography: Segoe UI/Segoe MDL2 Assets render with ClearType and per-monitor DPI awareness; hierarchy and wrapping are stable.
- Spacing and layout rhythm: cards, gaps, alignment, radii and shadows match the selected premium composition with no clipping or overflow.
- Colors and tokens: HomeEasy burgundy, gold, warm canvas, semantic green/amber/red and neutral text tokens are consistent.
- Image quality and assets: the supplied HomeEasy logo and generated ICO are used directly; standard interface symbols use the Windows Segoe MDL2 icon library.
- Copy and content: Spanish labels are correctly encoded and no mojibake remains.

## Interaction verification

- Native window launched without a terminal host.
- `Configurar acceso`, `Ver diagnóstico`, `Abrir HomeEasy`, minimize, hide-on-close and tray actions are wired.
- Runtime health, browser extension and update-status sources are polled every five seconds.
- Automatic update notifications retain downloading/installing/failure states.

## Comparison history

- P1 fixed: PowerShell/WinForms caused a visible terminal, blurry scaling and corrupt UTF-8 text. Replaced by a DPI-aware native WinExe.
- P2 fixed: first native pass used a large marketing header and horizontal status layout. Revised to the selected compact branded title bar and centered premium status composition.
- P2 fixed: stale runtime `code` values could override an otherwise healthy status. The UI now treats only active `recovering`/`error` states as warnings.

No actionable P0/P1/P2 visual findings remain. The live warning state correctly differs from the healthy mock and must not be cosmetically hidden.

final result: passed
