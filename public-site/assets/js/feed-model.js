(function (root) {
  "use strict";
  // Estado independente do DOM: offset conta linhas do servidor, não cartões.
  class Feed {
    constructor() { this.seen = new Set(); this.featured = new Set(); this.offset = 0; this.total = 0; this.batches = 0; this.done = false; this.count = 0; }
    keys(item) { return [item.id && "id:" + item.id, item.slug && "slug:" + item.slug].filter(Boolean); }
    has(item) { return this.keys(item).some(key => this.seen.has(key)); }
    remember(item) { this.keys(item).forEach(key => this.seen.add(key)); this.count++; }
    accept(items, total, limit) {
      const fresh = [], onlyOld = items.length > 0 && items.every(item => this.has(item) && !this.keys(item).some(key => this.featured.has(key)));
      for (const item of items) if (item.slug && !this.has(item)) { this.remember(item); fresh.push(item); }
      this.offset += items.length; this.total = total; this.batches++;
      this.done = this.offset >= total || items.length < limit || onlyOld;
      return fresh;
    }
    get highlightsDue() { return this.batches > 0 && this.batches % 3 === 0; }
    highlights(items, { now = Date.now(), random = Math.random } = {}) {
      const candidates = [], chosen = new Set();
      for (const item of items) {
        const stamp = new Date(item.publicado_em).valueOf();
        if (!item.slug || this.has(item) || this.keys(item).some(key => chosen.has(key)) || !Number.isFinite(stamp) || stamp > now || stamp < now - 30 * 86400000) continue;
        this.keys(item).forEach(key => chosen.add(key)); candidates.push(item);
      }
      if (candidates.length < 3) return [];
      for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
      const selected = candidates.slice(0, 3);
      selected.forEach(item => { this.remember(item); this.keys(item).forEach(key => this.featured.add(key)); });
      return selected;
    }
  }
  root.TNNFeedModel = Feed;
})(typeof window !== "undefined" ? window : globalThis);
