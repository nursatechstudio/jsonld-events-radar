# JSON-LD Events Radar

A free, zero-dependency Node.js CLI that collects upcoming public events from Schema.org Event JSON-LD embedded in conference, news, and community pages. It needs no API key and does not use a browser.

## How it works

The tool fetches each URL in `targets.json` with a browser-like User-Agent. If Node.js fetch fails or returns an HTTP error, it retries with `curl` to work around sites that block Node's TLS fingerprint. It parses JSON-LD blocks, including Events nested in `@graph` and `ItemList`, filters events whose end date has passed, deduplicates by URL (or name), and sorts by start date. The generated `events.json` and `events.md` are ready to publish or use in another project.

## Run locally

Requirements: Node.js 18 or newer and `curl` available on `PATH` for sites requiring the fallback.

```sh
node scraper.mjs
```

To use another targets file:

```sh
node scraper.mjs ./my-targets.json
```

Edit `targets.json` to add or remove public page URLs. Collection is best-effort: inaccessible pages and malformed JSON-LD are reported, while other targets continue to be processed. If no events are found, the tool still writes valid empty output files and exits successfully.

## Use in your repo

Copy `scraper.mjs` and `targets.json` into your repository, customize the target URLs, and run `node scraper.mjs`. The included GitHub Actions workflow collects daily and commits changed `events.json` and `events.md` files. To reuse it, copy `.github/workflows/collect.yml` as well and allow Actions to write repository contents.

## Monetization

The core tool is free and open source. A future Pro tier may offer convenience features via a Stripe Payment Link; no paid account or service is required to run this project.

## Project

[https://github.com/nursatechstudio/jsonld-events-radar](https://github.com/nursatechstudio/jsonld-events-radar)

Built by nursatechstudio.

## License

MIT. See [LICENSE](LICENSE).
