/*
 * Every task in the vault, kept current from the metadata cache. The cache
 * already knows which list items are tasks and where they are, so only notes
 * that contain tasks are ever read.
 */

import { App, CachedMetadata, Events, TFile } from 'obsidian';
import { parseTask, TaskLine } from './task';
import type { Settings } from './settings';

export interface Item extends TaskLine {
  path: string;
  /** Zero-based line in the note. */
  line: number;
  /** The whole line as it was read, to find it again before writing. */
  text: string;
  heading: string | null;
  key: string;
}

export class TaskIndex extends Events {
  private files = new Map<string, Item[]>();
  private timer: number | null = null;
  ready = false;

  constructor(private app: App, private settings: () => Settings) {
    super();
  }

  async rebuild(): Promise<void> {
    this.files.clear();
    const files = this.app.vault.getMarkdownFiles();
    let i = 0;
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.listItems?.some(l => l.task !== undefined)) continue;
      await this.readFile(file, cache);
      /* Stay responsive in a large vault. */
      if (++i % 200 === 0) await new Promise(r => window.setTimeout(r, 0));
    }
    this.ready = true;
    this.notify();
  }

  private async readFile(file: TFile, cache: CachedMetadata | null, data?: string): Promise<void> {
    if (this.ignored(file.path) || !cache?.listItems?.some(l => l.task !== undefined)) {
      if (this.files.delete(file.path)) this.notify();
      return;
    }
    let text = data;
    if (text === undefined) {
      try {
        text = await this.app.vault.cachedRead(file);
      } catch {
        /* Gone between the cache and the read; its delete event follows. */
        return;
      }
    }
    if (!this.app.vault.getAbstractFileByPath(file.path)) return;
    this.files.set(file.path, this.parse(file.path, text, cache));
    this.notify();
  }

  parse(path: string, text: string, cache: CachedMetadata): Item[] {
    const lines = text.split('\n');
    const headings = (cache.headings ?? []).map(h => ({ line: h.position.start.line, text: h.heading }));
    const filter = this.settings().filterTag.toLowerCase();
    const out: Item[] = [];
    for (const li of cache.listItems ?? []) {
      if (li.task === undefined) continue;
      const line = li.position.start.line;
      const raw = (lines[line] ?? '').replace(/\r$/, '');
      const task = parseTask(raw);
      if (!task) continue;
      if (filter && !task.tags.some(tag => tag.toLowerCase() === filter || tag.toLowerCase().startsWith(filter + '/'))) continue;
      let heading: string | null = null;
      for (const h of headings) if (h.line < line) heading = h.text;
      if (filter) task.description = task.description.replace(new RegExp(`(^|\\s)${escape(this.settings().filterTag)}(?=\\s|$)`, 'i'), '$1').replace(/\s{2,}/g, ' ').trim();
      out.push({ ...task, path, line, text: raw, heading, key: `${path}\u0000${line}\u0000${raw}` });
    }
    return out;
  }

  private ignored(path: string): boolean {
    return this.settings().ignore.some(f => path === f || path.startsWith(f + '/'));
  }

  onChanged(file: TFile, data: string, cache: CachedMetadata): void {
    void this.readFile(file, cache, data);
  }

  onDeleted(path: string): void {
    if (this.files.delete(path)) this.notify();
  }

  onRenamed(file: TFile, old: string): void {
    const items = this.files.get(old);
    if (!items) return;
    this.files.delete(old);
    void this.readFile(file, this.app.metadataCache.getFileCache(file));
  }

  all(): Item[] {
    const out: Item[] = [];
    this.files.forEach(items => out.push(...items));
    return out;
  }

  /** Coalesces bursts of changes into one redraw. */
  notify(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.trigger('update');
    }, 60);
  }
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
