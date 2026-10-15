# Demo script

A three-minute live demo of Shelf2Kumo on `https://shelf2kumo.web.app`, run on a phone or a 360–400px browser window.

## What to claim (and not)

- **Real AI, every time.** Photo reading uses AMD-hosted MiniCPM-V; chat uses AMD-hosted models with automatic fallback. No canned responses in production.
- **Demo images are synthetic.** They are product scenes we rendered ourselves (`pnpm eval:images`). Do not claim accuracy on real shop photos: it has not been measured.
- **Timing is honest.** Reading a photo takes about 15–60 seconds on the shared hackathon endpoint (38 s in the last rehearsal); chat edits about 5–15 seconds.

## Preparation (10 minutes before)

1. `pnpm eval:images` and copy `evaluation/images/synthetic/s1-hojicha-pouch.jpg` (tea pouch with a price card) to the demo device.
2. Check health: open `https://shelf2kumo.web.app/s/demo` (labeled demo shop with three photos) and run the `opsAmdCheck` command in [DEPLOYMENT.md](DEPLOYMENT.md).
3. Sign up a fresh account in advance (or during the demo if time allows) and create the shop 「器と道具 こもれび」.
4. Accept the photo notice once beforehand so it does not interrupt the flow.

## The flow (rehearsed 2026-10-15: 71 seconds end to end)

| # | Do | Say | Expect |
|---|---|---|---|
| 1 | Chat: 「雑貨と器のお店です。営業時間は11時から18時、火曜定休です。」 | "Owners just talk to it in Japanese." | Card: 営業時間 （なし）→ 11:00〜18:00（火曜定休）, with 元に戻す |
| 2 | カタログ → 写真を追加 → tea pouch photo | "One photo, one product. The photo stays private; location data is removed." | 「商品情報を読み取っています…」, then 「ほうじ茶 864円（税込）」 created automatically, with uncertain fields flagged |
| 3 | Chat: 「ほうじ茶の説明を「京都・宇治の香ばしいほうじ茶です」にしてください」 | "Corrections are a sentence. Every change shows a diff and can be undone." | Card: 説明 京都・宇治 → 京都・宇治の香ばしいほうじ茶です |
| 4 | Optional: 「もっと温かい雰囲気のデザインに」 then プレビュー | "Themes are curated and always readable." | Warm palette in the preview |
| 5 | 公開する | "There is exactly one gate: a summary, then publish. No approval queues." | 「初めての公開です…」 → 公開する → 「公開しました」 with URL and QR |
| 6 | Scan the QR with another phone | "A real public page: plain HTML, no JavaScript, fast on mobile." | Shop page with the photo, price and hours |
| 7 | Optional: 共有 → 公開を停止 | "Owners stay in control." | Page returns 404 within about a minute |

## If something goes wrong

- **Photo reading is slow or fails:** say the shared AI endpoint is busy, show 「手動で追加」 (manual entry keeps the photo), and continue. Point to `/s/demo` as an already-published example.
- **Chat says 「AI に接続できませんでした」:** the fallback chain was exhausted; edit with the form (編集) and continue.
- **Publish blocked:** the dialog explains why (a product without a name, or a photo still being read); fix it and retry.

## Talking points for questions

- Safety: the AI only proposes; the server validates every change, deletions and bulk edits need a tap, and text inside photos is treated as data (tested with an injected instruction in a product name).
- Privacy: photos are private in Storage, sent to the AMD service for reading (disclosed before the first upload), and published only as stripped renditions referenced by the live page.
- Reliability: idempotent jobs, per-owner queues and quotas, revision checks, and an exact-content publish confirmation; 80+ emulator tests and a browser release test run in CI.
