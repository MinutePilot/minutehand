// A small in-memory stand-in for the Supabase client and for the model, for handler tests.
// Only the parts the handler uses: from().select/insert/update().eq/neq().maybeSingle(), rpc, auth.getUser.

export function fakeDb(tables, { tokens = {}, rpcs = {} } = {}) {
  const db = { t: tables, writes: [], fail: {}, tokens, rpcs };

  class Query {
    constructor(table) { this.table = table; this.op = 'select'; this.filters = []; this.values = null; this.ret = false; this.mode = 'many'; }
    select() { this.ret = true; return this; }
    insert(v) { this.op = 'insert'; this.values = v; return this; }
    update(v) { this.op = 'update'; this.values = v; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
    order() { return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    single() { this.mode = 'single'; return this; }
    then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
    run() {
      const rows = (db.t[this.table] ??= []);
      const key = `${this.table}:${this.op}`;
      if (db.fail[key]) return { data: null, error: { message: `injected failure on ${key}` } };
      const shape = (list) => {
        if (this.mode === 'many') return { data: list, error: null };
        return { data: list[0] ?? null, error: null };
      };
      if (this.op === 'select') return shape(rows.filter((r) => this.filters.every((f) => f(r))).map((r) => ({ ...r })));
      if (this.op === 'insert') {
        const list = (Array.isArray(this.values) ? this.values : [this.values]).map((v) => ({ id: `${this.table}-${rows.length + 1}`, ...v }));
        rows.push(...list);
        db.writes.push({ table: this.table, op: 'insert', values: list });
        return this.ret ? shape(list) : { data: null, error: null };
      }
      const hit = rows.filter((r) => this.filters.every((f) => f(r)));
      hit.forEach((r) => Object.assign(r, this.values));
      db.writes.push({ table: this.table, op: 'update', values: this.values, count: hit.length });
      return this.ret ? shape(hit.map((r) => ({ ...r }))) : { data: null, error: null };
    }
  }

  db.from = (table) => new Query(table);
  db.rpc = async (name, args) => (db.rpcs[name] ? db.rpcs[name](args) : { data: null, error: { message: `no such function ${name}` } });
  db.auth = { getUser: async (token) => (db.tokens[token] ? { data: { user: db.tokens[token] }, error: null } : { data: { user: null }, error: { message: 'bad token' } }) };
  return db;
}

// The model: hands back queued drafts (or throws queued errors) and remembers what it was asked.
export function fakeModel(queue) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (args) => {
        calls.push(args);
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return { content: [{ type: 'tool_use', name: 'write_minutes', input: next }] };
      },
    },
  };
}
