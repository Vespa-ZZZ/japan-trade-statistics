# Japan Trade Statistics — Exports & Imports by Country and Commodity (Customs)

Official **Japan Customs trade statistics** (財務省 貿易統計「輸出入額の推移」) as clean JSON rows — ready for spreadsheets, BI tools, data pipelines and AI agents. No API key, no browser.

- **By partner country:** monthly (since 1979) or yearly exports, imports and trade balance for the world, regions (Asia, North America, EU, ASEAN, Middle East …) and every partner country in them.
- **By commodity group:** monthly or yearly exports / imports for about 55 commodity groups (概況品: food, mineral fuels, chemicals, semiconductors, cars …) with quantities where published, for the world or a major partner (USA, EU, Asia, China, Korea, ASEAN, Middle East, Russia), since 1988.

## Use cases

- **Trading companies, logistics & manufacturers:** track monthly exports/imports with a partner or a commodity group, spot trend changes early
- **Market research & consulting:** build country × commodity time series without hand-cleaning Shift_JIS spreadsheets
- **Finance & macro analysis:** feed Japan's trade balance into models and dashboards
- **AI agents:** a reliable tool for "how much did Japan import from China last month?"

## Input examples

Exports, imports and balance with every North American partner, calendar year 2025:

```json
{ "mode": "countries", "areas": ["北米"], "frequency": "yearly", "from": "2025", "to": "2025" }
```

Monthly world totals since 2020:

```json
{ "mode": "countries", "areas": ["世界"], "from": "2020-01" }
```

Imports from China by commodity group for one month:

```json
{ "mode": "commodities", "partners": ["中国"], "flows": ["import"], "from": "2026-09", "to": "2026-09" }
```

## Output examples

Countries mode:

```json
{
  "area": "北米", "frequency": "yearly", "period": "2025",
  "partnerCode": "302", "partnerName": "CANADA",
  "exportThousandJPY": 1645010166, "importThousandJPY": 1841781446,
  "exportJPY": 1645010166000, "importJPY": 1841781446000, "balanceJPY": -196771280000,
  "sourceUrl": "https://www.customs.go.jp/toukei/suii/html/data/d42ca003.csv",
  "source": "Japan Customs, Ministry of Finance — 輸出入額の推移 (Trade Statistics of Japan)"
}
```

Commodities mode:

```json
{
  "partner": "中国", "flow": "import", "frequency": "monthly", "period": "2026-09",
  "group": "電気機器", "commodityCode": "70311", "commodityName": "半導体等電子部品",
  "valueThousandJPY": 71660762, "valueJPY": 71660762000,
  "quantity": 215140321, "quantityUnit": "NO",
  "sourceUrl": "https://www.customs.go.jp/toukei/suii/html/data/d62ma004.csv",
  "source": "Japan Customs, Ministry of Finance — 輸出入額の推移 (Trade Statistics of Japan)"
}
```

- `period` is `YYYY-MM` (monthly) or `YYYY` (yearly). The source publishes values in thousand yen; `…JPY` fields are converted to yen.
- `partnerCode` is the Japan Customs country code (`Total` for the area total row). `commodityCode` is the 概況品 code (`0-9` = total, `0+1` = food group, …). **Commodity codes are specific to the flow**: the export and import tables use different code lists (e.g. semiconductors etc. are `70323` in exports and `70311` in imports). Always combine `flow` + `commodityCode` when joining, and use `exportCommodityCodes` / `importCommodityCodes` or `commodityNameContains` to filter both flows.
- Months not yet published (placeholder rows at the end of the source file) are omitted. Inside the published range, blanks (`-`) are `null` and a published `0` stays `0`.
- Figures are as published in the current files: recent months are preliminary and are revised by Customs later — re-run to pick up revisions.

## How it works

The Actor downloads the official CSV files listed on the Customs [time-series page](https://www.customs.go.jp/toukei/suii/html/time.htm) (one file per area / partner and flow), decodes Shift_JIS, validates the table layout and converts it into rows. Requests are sequential with a delay (default 2 s). If the source layout changes, the run fails with a clear message instead of returning wrong numbers.

## Data source & terms

Source: Japan Customs, Ministry of Finance — Trade Statistics of Japan (財務省貿易統計). Content is available under the Public Data License 1.0 ([Customs copyright notice](https://www.customs.go.jp/copyright_e.htm)). When you publish the data, credit the source and state that it was processed and by whom, for example:

> 出典：財務省貿易統計「輸出入額の推移」（https://www.customs.go.jp/toukei/suii/html/time.htm）をもとに〇〇が加工して作成（Japan Trade Statistics Actor で取得・整形）
 This Actor is not affiliated with or endorsed by Japan Customs or the Ministry of Finance.

---

## 日本語の概要

財務省貿易統計「輸出入額の推移」の公開 CSV から、国・地域別の輸出入額と貿易収支（月別 1979 年〜／年別）、概況品別の輸出入額・数量（1988 年〜、世界・米国・EU・アジア・中国・韓国・ASEAN・中東・ロシア）を JSON で取得します。Shift_JIS の表を自動で整形し、未公表月は除外、千円単位の値は円にも換算します。出典の明記など公共データ利用規約（第1.0版）に従ってご利用ください。
