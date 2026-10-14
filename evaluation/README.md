# Evaluation data

Inputs for the vision compatibility gate (spec P0-5) and, later, the standalone model evaluation (Workstream E).

| File | Purpose |
|---|---|
| `manifest.json` | Dataset version, image list, task mode (`single` / `shelf`), source and license |
| `ground-truth.json` | Expected product count, items (name, `priceJpy`, `taxTreatment`) and visible text per image |
| `images/` | Image files; **gitignored** (regenerate or obtain locally) |
| `results/` | Evaluation output; **gitignored** |

## Synthetic set (`synthetic-v1`)

`pnpm eval:images` renders five Japanese product scenes with local headless Chrome into `images/synthetic/`:

| ID | Tests |
|---|---|
| `s1-hojicha-pouch` | Product label plus price card, tax-included |
| `s2-bowl-no-price` | No price visible: price must stay `null` |
| `s3-spoon-tax-excluded` | `¥` notation, tax-excluded |
| `s4-shelf-three-jars` | Three products: MVP single mode must ask which one |
| `s5-pop-card-linen` | Handwritten-style POP card |

These are project-generated, so there is no license or consent issue. They check pipeline compatibility and basic Japanese reading only. They are **not** evidence of real-photo recognition quality. Add consented real shop photos (with ground truth) before making any quality claim.

Send one image through the hypothesized vision payload (one paid request):

```bash
pnpm smoke:amd --image evaluation/images/synthetic/s1-hojicha-pouch.jpg --consented
```
