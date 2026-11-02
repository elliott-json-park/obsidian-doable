/*
 * ```doable and ```tasks blocks: the query runs over the index and draws the
 * same rows as the agenda, kept live as notes change.
 */

import { MarkdownRenderChild } from 'obsidian';
import { today } from './dates';
import { plural, t } from './i18n';
import type DoablePlugin from './main';
import { groupTasks, parseQuery, runQuery } from './query';
import { renderRow } from './rows';
import { dayLabel } from './words';
import { isDay } from './dates';

export class QueryBlock extends MarkdownRenderChild {
  constructor(el: HTMLElement, private source: string, private plugin: DoablePlugin, private sourcePath: string) {
    super(el);
  }

  onload(): void {
    this.containerEl.addClass('dbl-block');
    this.registerEvent(this.plugin.index.on('update', () => this.render()));
    this.render();
  }

  private render(): void {
    const el = this.containerEl;
    el.empty();
    const q = parseQuery(this.source, { today: today(), weekStart: this.plugin.weekStart() });
    const items = runQuery(q, this.plugin.index.all());
    const groups = groupTasks(items, q.groups);
    if (items.length === 0) el.createDiv({ cls: 'dbl-block-none', text: t('query.none') });
    for (const g of groups) {
      if (g.names.length) {
        g.names.forEach((n, depth) => {
          el.createDiv({ cls: `dbl-block-group is-depth-${Math.min(depth, 2)}`, text: isDay(n) ? dayLabel(n, today(), true) : n });
        });
      }
      const rows = el.createDiv({ cls: 'dbl-rows' });
      for (const item of g.tasks) renderRow(rows, item, this.plugin.rowHost(null), { showDay: true, showNote: item.path !== this.sourcePath });
    }
    const foot = el.createDiv({ cls: 'dbl-block-foot' });
    foot.createSpan({ text: plural('query.count', items.length) });
    if (q.skipped.length) foot.createSpan({ cls: 'dbl-block-skipped', text: t('query.skipped', { lines: q.skipped.join(' · ') }) });
  }
}
