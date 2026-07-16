# Asset seed contract and provenance

Date: 2026-07-15

## Stable IDs

| Kind | Stable asset ID | Current operator source name |
| --- | --- | --- |
| model | `model:j10` | `J-10.glb` |
| model | `model:jf17` | `JF-17.glb` |
| model | `model:mig29` | `MiG-29.glb` |
| model | `model:pl15e` | `pl-15e.glb` |
| model | `model:rafale` | `Refale.glb`; the source spelling is retained only as an alias |
| model | `model:su30mki` | `SU-30MKI.glb` |
| video | `video:ooda-chain` | `ooda作战链示例视频.mp4` |
| video | `video:runway-exit` | `冲出跑道.mp4` |
| video | `video:missile-impact` | `导弹击中飞机.mp4` |
| video | `video:cockpit-jamming` | `座舱被全频段干扰.mp4` |
| video | `video:damage-check` | `检查基本完好无损.mp4` |
| video | `video:bomb-explosion` | `炸弹爆炸的视频.mp4` |
| video | `video:radar-offline` | `红灯闪烁，offline.mp4` |
| video | `video:target-lock` | `锁定目标.mp4` |
| image | `image:ground-radar` | `地面雷达.png` |
| image | `image:cockpit-hud` | `座舱HUD.png` |
| image | `image:airport` | `机场.png` |
| image | `image:aew-illustration` | `预警机插图.png` |
| trajectory | `trajectory:ambala-rafale-1` | `AMBALA Rafale-1.json` |
| trajectory | `trajectory:ambala-rafale-2` | `AMBALA Rafale-2.json` |
| trajectory | `trajectory:ambala-rafale-3` | `AMBALA Rafale-3.json` |
| trajectory | `trajectory:ambala-rafale-4` | `AMBALA Rafale-4.json` |
| trajectory | `trajectory:adampur-vampire-1` | `ADAMPUR Vampire-1.json` |
| trajectory | `trajectory:adampur-vampire-2` | `ADAMPUR Vampire-2.json` |
| trajectory | `trajectory:adampur-vampire-3` | `ADAMPUR Vampire-3.json` |
| trajectory | `trajectory:adampur-vampire-4` | `ADAMPUR Vampire-4.json` |
| trajectory | `trajectory:ambala-su30mki-1` | `AMBALA Su-30MKI-1.json`; suffix curation is recorded in the source map |
| trajectory | `trajectory:ambala-su30mki-2` | `AMBALA Su-30MKI-2.json` |
| trajectory | `trajectory:minhas-j10ce-1` | `MINAS J-10CE-1.json`; the source spelling conflict is explicit |
| trajectory | `trajectory:minhas-j10ce-2` | `MINAS J-10CE-2.json` |
| trajectory | `trajectory:minhas-j10ce-3` | `MINAS J-10CE-3.json` |
| trajectory | `trajectory:minhas-j10ce-4` | `MINAS J-10CE-4.json` |
| trajectory | `trajectory:rafiki-j10ce-1` | `RAFIKI J-10CE-1.json` |
| trajectory | `trajectory:rafiki-j10ce-2` | `RAFIKI J-10CE-2.json` |
| trajectory | `trajectory:rafiki-j10ce-3` | `RAFIKI J-10CE-3.json` |
| trajectory | `trajectory:rafiki-j10ce-4` | `RAFIKI J-10CE-4.json` |
| trajectory | `trajectory:pakistan-missile-1` | `巴方导弹1.json` |
| trajectory | `trajectory:pakistan-strike-missile-2` | `巴方打击导弹2.json` |
| trajectory | `trajectory:india-missile-1` | `印方导弹1.json` |

The catalog contains all 21 operator trajectories. Every trajectory ID is `trajectory:<origin-or-side>-<platform>-<ordinal>` in lowercase kebab case. Source spelling never silently changes the stable ID; `nameMappings` records report, trajectory, model, and operator contexts explicitly, including the J-10/J-10CE and JF-17 naming cases.

The Su-30MKI-1 source has a single auditable curation record: policy `trajectory.shift-suffix/v1`, expected raw fingerprint `sha256:ba6e0167c0d31e1141a6890bf033e1e671f1f364e7109471f28c7ab000a95995`, `startIndex: 91`, and `deltaMs: 2000`. The same shared preparation helper applies this suffix shift during both manifest construction and seed upload.

## Manifest fields

- `sourceRelativePath` is a forward-slash path below the operator-provided asset root. It is seed input only and never appears in RuntimePlan or ResolvedAssetAccess.
- `objectName` is the MinIO object name selected by the API seed CLI. It is never returned to Web or Agent.
- `availability` is exactly `available`, `missing`, or `invalid`; `criticality` is independently exactly `required` or `optional`.
- `allowFallback` must be true before `fallbackAssetIds` may contain another registered asset; both fields remain seed policy and are absent from ResolvedAssetAccess.
- `fingerprint` and `size` describe the prepared bytes that are uploaded. For trajectories they describe canonical `ise-trajectory/v1` bytes, not the original timestamp/latitude/longitude/altitude JSON.
- Model `scale` is unitless, `rotationOffsetDeg` is `[x, y, z]` in degrees, and `altitudeOffsetM` is meters.
- Trajectory metadata is exactly `{ format: 'ise-trajectory/v1', timeUnit: 'ms', coordinateOrder: 'lng-lat-alt', startTimeMs, endTimeMs, monotonic: true }`.
- Video `durationMs` is milliseconds and `codec` is the probed codec name. Image `width` and `height` are pixels.

## Canonical trajectory bytes

Raw source arrays are parsed in source order. Timestamps are interpreted deterministically as UTC, distinct timestamp reversal is invalid, and equal timestamp groups use the frozen gap-allocation algorithm tested in `packages/runtime-contracts/test/trajectory.test.ts`. Canonical upload bytes are UTF-8 `JSON.stringify` output of `{ "schemaVersion": "ise-trajectory/v1", "points": [...] }` with no trailing newline.

## Upload handoff

Foundation validation is local and non-networking. The API seed CLI receives a validated `AssetManifestEntry`, reads `sourceRelativePath` below an operator-selected root, calls `prepareAssetForUpload(entry, sourceBytes)`, uploads the returned bytes to `objectName`, and only then records `availability: 'available'`. Required entries that are missing, invalid, or fingerprint-mismatched block publication.
