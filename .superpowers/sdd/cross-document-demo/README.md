# Cross-document demo

This directory is the export target for the generic DOCX flow. The source fixture is
`agent/test/fixtures/cross-document-air-rescue-report.docx`, which uses entities and
locations outside the Indo-Pak scenario pack.

Run the real service flow with credentials supplied through the process environment:

```powershell
powershell -ExecutionPolicy Bypass -File .\.superpowers\sdd\run-real-docx-flow.ps1 `
  -SourceDocxPath .\agent\test\fixtures\cross-document-air-rescue-report.docx `
  -OutputDirectory .\.superpowers\sdd\cross-document-demo `
  -GenericMode
```

The flow exports `event-plan.json`, `narration-plan.json`, `scene-blueprint.json`,
`resolved-scene-plan.json`, `choreography-plan.json`, `canonical-runtime-plan.json`,
`scene-project.json`, and `scene-id.txt`. Generic mode accepts grounded static markers
when no trustworthy route exists and rejects fabricated resolved interactions.
