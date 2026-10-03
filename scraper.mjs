#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 JSONLDEventsRadar/1.0';

async function fetchPage(url) {
  let response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(25000) });
    if (response.ok) return await response.text();
    console.warn(`HTTP ${response.status} from ${url}; retrying with curl.`);
  } catch (error) {
    console.warn(`Node fetch failed for ${url}: ${error.message}; retrying with curl.`);
  }
  const { stdout } = await execFileAsync('curl', ['-fsSL', '--max-time', '35', '-A', USER_AGENT, url], { maxBuffer: 12 * 1024 * 1024 });
  return stdout;
}

function parseJsonLd(html, source) {
  const blocks = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = re.exec(html))) {
    const clean = match[1].replace(/[\u0000-\u001f\u007f]/g, '');
    try { blocks.push(JSON.parse(clean)); }
    catch (error) { console.warn(`Could not parse JSON-LD on ${source}: ${error.message}`); }
  }
  return blocks;
}

const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
function addressOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(addressOf).filter(Boolean).join(', ');
  return ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'].map(k => text(value[k]?.name ?? value[k])).filter(Boolean).join(', ');
}
function locationOf(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(locationOf).filter(Boolean).join('; ');
  if (typeof value === 'string') return value;
  const name = text(value.name);
  const address = addressOf(value.address);
  return [name, address].filter((v, i, a) => v && (i === 0 || v !== a[0])).join(' — ');
}
function peopleOf(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map(item => typeof item === 'string' ? item : text(item?.name)).filter(Boolean).join(', ');
}
function priceOf(offers) {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  return list.map(o => {
    if (typeof o !== 'object') return text(o);
    const price = text(o.price ?? o.lowPrice);
    const currency = text(o.priceCurrency);
    return price ? `${currency ? `${currency} ` : ''}${price}` : '';
  }).filter(Boolean).join(', ');
}
function gatherEvents(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) { for (const item of node) gatherEvents(item, out); return out; }
  if (typeof node !== 'object') return out;
  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  if (types.some(type => typeof type === 'string' && type.split('/').pop().toLowerCase() === 'event')) out.push(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === '@graph' || key === 'itemListElement' || key === 'item') gatherEvents(value, out);
  }
  return out;
}

function normalize(event, source) {
  const startDate = text(event.startDate);
  if (!startDate) return null;
  const endDate = text(event.endDate) || startDate;
  const endTime = Date.parse(endDate);
  if (Number.isFinite(endTime) && endTime < Date.now()) return null;
  const name = text(event.name);
  if (!name) return null;
  const location = locationOf(event.location);
  const url = text(event.url ?? event['@id']) || source;
  return { name, url, startDate, endDate, location, performer: peopleOf(event.performer), organizer: peopleOf(event.organizer), ticketPrice: priceOf(event.offers), source };
}

function markdown(events) {
  const esc = s => String(s ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = ['# Upcoming Events', '', `Collected ${new Date().toISOString()} by [JSON-LD Events Radar](https://github.com/nursatechstudio/jsonld-events-radar).`, '', '| Start date | Event | Location | Ticket price |', '| --- | --- | --- | --- |'];
  for (const e of events) lines.push(`| ${esc(e.startDate)} | [${esc(e.name)}](${e.url}) | ${esc(e.location || 'Not listed')} | ${esc(e.ticketPrice || 'Not listed')} |`);
  if (!events.length) lines.push('| | No upcoming events found. | | |');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const configPath = process.argv[2] || new URL('./targets.json', import.meta.url);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const targets = Array.isArray(config) ? config : config.targets;
  if (!Array.isArray(targets)) throw new Error('targets.json must contain a targets array.');
  const events = [];
  for (const target of targets) {
    const url = typeof target === 'string' ? target : target.url;
    if (!url) { console.warn('Skipping target without a URL.'); continue; }
    try {
      const html = await fetchPage(url);
      const found = parseJsonLd(html, url).flatMap(block => gatherEvents(block)).map(event => normalize(event, url)).filter(Boolean);
      events.push(...found);
      console.log(`Collected ${found.length} upcoming event(s) from ${url}.`);
    } catch (error) { console.warn(`Unable to collect ${url}: ${error.message}`); }
  }
  const deduped = new Map();
  const seenUrls = new Set();
  const seenNames = new Set();
  for (const event of events) {
    const urlKey = event.url.toLowerCase();
    const nameKey = event.name.toLowerCase().replace(/\s+/g, ' ');
    if (seenUrls.has(urlKey) || seenNames.has(nameKey)) continue;
    seenUrls.add(urlKey);
    seenNames.add(nameKey);
    deduped.set(urlKey, event);
  }
  const result = [...deduped.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
  await writeFile(new URL('./events.json', import.meta.url), `${JSON.stringify({ generatedAt: new Date().toISOString(), events: result }, null, 2)}\n`);
  await writeFile(new URL('./events.md', import.meta.url), markdown(result));
  console.log(`Wrote ${result.length} unique upcoming event(s) to events.json and events.md.`);
}

main().catch(error => { console.error(`Collection failed: ${error.message}`); process.exitCode = 1; });
