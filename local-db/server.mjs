// =====================================================================
// Dantesras internal test database
// - Embedded PostgreSQL (PGlite) saved in ./data – no install, no internet
// - Supabase/PostgREST-compatible API at http://localhost:54321/rest/v1
//   so the app works unchanged (just point environment.ts here)
// - Web console at http://localhost:54321 for browsing tables, CRUD and SQL
//
//   npm start          start (creates + fills the database on first run)
//   npm run reset      wipe and recreate with fresh dummy data
// =====================================================================
import { PGlite, types } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import http from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.LOCAL_DB_DATA ? path.resolve(process.env.LOCAL_DB_DATA) : path.join(here, 'data');
const MIGRATIONS = path.join(here, '..', 'supabase', 'migrations');
const PORT = Number(process.env.LOCAL_DB_PORT ?? 54321);
// Only this computer can connect. Set LOCAL_DB_HOST=0.0.0.0 to let a phone on the same Wi-Fi
// (the Android app) reach it – test data only.
const HOST = process.env.LOCAL_DB_HOST ?? '127.0.0.1';

if (process.argv.includes('--reset') && existsSync(DATA_DIR)) {
  rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('Database wiped.');
}
const fresh = !existsSync(path.join(DATA_DIR, 'PG_VERSION'));
mkdirSync(DATA_DIR, { recursive: true });

// Return values the way Supabase does: numbers as numbers, dates as strings.
const isoTs = (v) => {
  const s = v.replace(' ', 'T');
  return new Date(/[+-]\d\d$/.test(s) ? s + ':00' : s).toISOString();
};
const db = await PGlite.create({
  dataDir: DATA_DIR,
  extensions: { pgcrypto }, // bcrypt password hashing, as on Supabase
  parsers: {
    [types.NUMERIC]: (v) => parseFloat(v),
    [types.INT8]: (v) => Number(v),
    [types.DATE]: (v) => v,
    [types.TIMESTAMP]: (v) => v,
    [types.TIMESTAMPTZ]: isoTs,
  },
});

// ---------------------------------------------------------------------
// First run: same SQL as Supabase + dummy data
// ---------------------------------------------------------------------
async function runFile(file) {
  const sql = readFileSync(file, 'utf8').replace(/^﻿/, '').replace('create extension if not exists pgcrypto;', '');
  await db.exec(sql);
  console.log('  ✓', path.basename(file));
}
// Every supabase/migrations/*.sql file runs once, in name order. New files (004_…, 005_…)
// are applied automatically on the next start, so existing test data is kept.
const migrationFiles = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
if (fresh) console.log('Creating database…');
try {
  await db.exec(`do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  end $$;`);
  // like Supabase: the API roles may use everything in public unless a migration revokes it,
  // and row level security decides which rows they see
  await db.exec(`grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;`);
  if (!fresh && (await db.query(`select to_regclass('public._api_roles_v1') is null as missing`)).rows[0].missing) {
    console.error('\nThis test database was made before the role lock-down. Run:  npm run reset\n');
    process.exit(1);
  }
  await db.exec('create table if not exists _api_roles_v1 (done boolean)');
  await db.exec('create extension if not exists pgcrypto');
  const tracked = (await db.query(`select to_regclass('public._migrations') is not null as t`)).rows[0].t;
  await db.exec(`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`);
  // databases created before migrations were tracked already contain 001–003
  if (!fresh && !tracked) await db.exec(`insert into _migrations(name) values ('001_schema.sql'),('002_functions.sql'),('003_seed.sql') on conflict do nothing`);
  const done = new Set((await db.query(`select name from _migrations`)).rows.map((r) => r.name));
  for (const f of migrationFiles) {
    if (done.has(f)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(readFileSync(path.join(MIGRATIONS, f), 'utf8').replace(/^﻿/, '').replace('create extension if not exists pgcrypto;', ''));
      await tx.query(`insert into _migrations(name) values ($1)`, [f]);
    });
    console.log('  ✓', f);
  }
  if (fresh && process.env.LOCAL_DB_NO_DUMMY !== '1') await runFile(path.join(here, 'dummy-data.sql'));
  // test logins for each role (only fills staff that have no account yet) – see README
  if (process.env.LOCAL_DB_NO_DUMMY !== '1') await runFile(path.join(here, 'dev-accounts.sql'));
} catch (e) {
  console.error(`\nSetup failed: ${e.message}${e.where ? '\n  at ' + e.where.split('\n')[0] : ''}`);
  await db.close();
  if (fresh) rmSync(DATA_DIR, { recursive: true, force: true }); // so the next start tries again from scratch
  process.exit(1);
}

// ---------------------------------------------------------------------
// Schema metadata (tables, columns, keys) for the API
// ---------------------------------------------------------------------
let meta = { columns: {}, pks: {}, fks: [], relations: [] };
async function loadMeta() {
  const cols = await db.query(`
    select c.table_name t, c.column_name c from information_schema.columns c
    where c.table_schema='public' order by c.table_name, c.ordinal_position`);
  const cons = await db.query(`
    select con.conname as name, con.contype as type, t.relname as tbl, ft.relname as ftbl,
      (select string_agg(a.attname, ',' order by k.ord) from unnest(con.conkey) with ordinality k(n, ord)
         join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n) as cols,
      (select string_agg(a.attname, ',' order by k.ord) from unnest(con.confkey) with ordinality k(n, ord)
         join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n) as fcols
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace ns on ns.oid = t.relnamespace
    left join pg_class ft on ft.oid = con.confrelid
    where ns.nspname = 'public' and con.contype in ('p','f')`);
  const rels = await db.query(`
    select table_name n, table_type k from information_schema.tables where table_schema='public' order by table_name`);
  const m = { columns: {}, pks: {}, fks: [], relations: rels.rows.map((r) => ({ name: r.n, kind: r.k === 'VIEW' ? 'view' : 'table' })) };
  for (const r of cols.rows) (m.columns[r.t] ??= []).push(r.c);
  for (const r of cons.rows) {
    if (r.type === 'p') m.pks[r.tbl] = r.cols.split(',');
    else m.fks.push({ name: r.name, table: r.tbl, cols: r.cols.split(','), ftable: r.ftbl, fcols: r.fcols.split(',') });
  }
  meta = m;
}
await loadMeta();

// ---------------------------------------------------------------------
// PostgREST-style query building
// ---------------------------------------------------------------------
class ApiError extends Error {
  constructor(status, message, code = 'PGRST100') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const IDENT = /^[a-z_][a-z0-9_]*$/;
const q = (name) => {
  if (!IDENT.test(name)) throw new ApiError(400, `Invalid name: ${name}`);
  return `"${name}"`;
};
const relation = (name) => {
  if (!meta.columns[name]) throw new ApiError(404, `Table or view "${name}" not found`, 'PGRST205');
  return q(name);
};

/** Split on commas that are not inside parentheses. */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** "a, b, alias:rel!hint(x, y)" → tree */
function parseSelect(s) {
  return splitTop(s || '*').map((item) => {
    const e = item.match(/^(?:(\w+):)?(\w+)(?:!(\w+))?\(([\s\S]*)\)$/);
    if (e) return { embed: true, alias: e[1] || e[2], rel: e[2], hint: e[3], children: parseSelect(e[4]) };
    const c = item.match(/^(?:(\w+):)?(\*|\w+)$/);
    if (!c) throw new ApiError(400, `Cannot parse select item: ${item}`);
    return { embed: false, alias: c[1], col: c[2] };
  });
}

/** Find how `rel` joins to `table` (many-to-one → object, one-to-many → array). */
function resolveRel(table, rel, hint) {
  relation(rel);
  const named = hint && hint !== 'inner' ? meta.fks.find((f) => f.name === hint) : null;
  const m2o = meta.fks.filter((f) => f.table === table && f.ftable === rel && (!named || f === named));
  if (m2o.length) return { fk: m2o[0], many: false };
  const o2m = meta.fks.filter((f) => f.table === rel && f.ftable === table && (!named || f === named));
  if (o2m.length) return { fk: o2m[0], many: true };
  throw new ApiError(400, `No relationship between "${table}" and "${rel}"`, 'PGRST200');
}

function selectList(table, alias, items, depth) {
  const parts = [];
  for (const it of items) {
    if (!it.embed) {
      if (it.col === '*') parts.push(`${alias}.*`);
      else parts.push(`${alias}.${q(it.col)} as ${q(it.alias || it.col)}`);
      continue;
    }
    const child = `t${depth + 1}`;
    const { fk, many } = resolveRel(table, it.rel, it.hint);
    const inner = selectList(it.rel, child, it.children, depth + 1);
    const on = many
      ? fk.cols.map((c, i) => `${child}.${q(c)} = ${alias}.${q(fk.fcols[i])}`).join(' and ')
      : fk.fcols.map((c, i) => `${child}.${q(c)} = ${alias}.${q(fk.cols[i])}`).join(' and ');
    parts.push(
      many
        ? `(select coalesce(json_agg(row_to_json(x)), '[]'::json) from (select ${inner} from ${q(it.rel)} ${child} where ${on}) x) as ${q(it.alias)}`
        : `(select row_to_json(x) from (select ${inner} from ${q(it.rel)} ${child} where ${on} limit 1) x) as ${q(it.alias)}`,
    );
  }
  return parts.join(', ');
}

/** One filter like ("status", "in.(a,b)") → SQL */
function condition(alias, col, expr, params) {
  let neg = false;
  if (expr.startsWith('not.')) {
    neg = true;
    expr = expr.slice(4);
  }
  const dot = expr.indexOf('.');
  if (dot < 0) throw new ApiError(400, `Bad filter: ${col}=${expr}`);
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  const c = `${alias}.${q(col)}`;
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  let s;
  switch (op) {
    case 'eq': s = `${c} = ${p(val)}`; break;
    case 'neq': s = `${c} <> ${p(val)}`; break;
    case 'gt': s = `${c} > ${p(val)}`; break;
    case 'gte': s = `${c} >= ${p(val)}`; break;
    case 'lt': s = `${c} < ${p(val)}`; break;
    case 'lte': s = `${c} <= ${p(val)}`; break;
    case 'like': s = `${c}::text like ${p(val.replace(/\*/g, '%'))}`; break;
    case 'ilike': s = `${c}::text ilike ${p(val.replace(/\*/g, '%'))}`; break;
    case 'is': s = val === 'null' ? `${c} is null` : `${c} is ${val === 'true' ? 'true' : 'false'}`; break;
    case 'in': {
      const list = splitTop(val.replace(/^\(|\)$/g, '')).map((v) => v.replace(/^"|"$/g, ''));
      s = `${c}::text = any(${p(list)}::text[])`;
      break;
    }
    default: throw new ApiError(400, `Unsupported filter operator: ${op}`);
  }
  return neg ? `not (${s})` : s;
}

/** or=(a.eq.1,and(b.gte.2,b.lt.3)) */
function logic(alias, kind, inner, params) {
  const parts = splitTop(inner).map((item) => {
    const nested = item.match(/^(not\.)?(and|or)\(([\s\S]*)\)$/);
    if (nested) {
      const sql = logic(alias, nested[2], nested[3], params);
      return nested[1] ? `not ${sql}` : sql;
    }
    const dot = item.indexOf('.');
    return condition(alias, item.slice(0, dot), item.slice(dot + 1), params);
  });
  return `(${parts.join(kind === 'or' ? ' or ' : ' and ')})`;
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
function whereClause(alias, sp, params) {
  const conds = [];
  for (const [key, value] of sp.entries()) {
    if (RESERVED.has(key)) continue;
    if (key === 'or' || key === 'and') conds.push(logic(alias, key, value.replace(/^\(|\)$/g, ''), params));
    else if (key.includes('.')) continue; // filters on embedded resources are not used by the app
    else conds.push(condition(alias, key, value, params));
  }
  return conds.length ? ` where ${conds.join(' and ')}` : '';
}

function orderClause(alias, order) {
  if (!order) return '';
  return ' order by ' + order.split(',').map((o) => {
    const [col, ...mods] = o.split('.');
    const dir = mods.includes('desc') ? 'desc' : 'asc';
    const nulls = mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : '';
    return `${alias}.${q(col)} ${dir}${nulls}`;
  }).join(', ');
}

function bodyColumns(table, rows) {
  const valid = new Set(meta.columns[table]);
  return [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => valid.has(c));
}
const jsonParam = (v) => JSON.stringify(v);

// ---------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------
async function handleRest(req, url, body) {
  // like PostgREST: every request runs as the "anon" role, in one transaction, with the request
  // headers visible to the database (current_setting('request.headers')) – so row level security applies
  let out;
  await db.transaction(async (tx) => {
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(',') : v]));
    await tx.query(`select set_config('request.headers', $1, true), set_config('role', 'anon', true)`, [JSON.stringify(headers)]);
    out = await handleRestAs(tx, req, url, body);
  });
  return out;
}
async function handleRestAs(db, req, url, body) {
  const parts = url.pathname.replace(/^\/rest\/v1\/?/, '').split('/').filter(Boolean);
  const sp = url.searchParams;
  const prefer = req.headers['prefer'] ?? '';
  const wantsObject = (req.headers['accept'] ?? '').includes('vnd.pgrst.object');
  const returnRows = prefer.includes('return=representation');
  // like PostgREST: return only what was asked for (and nothing without return=representation),
  // so hidden columns (e.g. staff.password_hash) are never touched
  const plainSelect = (sp.get('select') ?? '*').split(',').map((c) => c.trim()).filter(Boolean);
  const returningAs = (alias) => !returnRows ? ' returning 1'
    : plainSelect.includes('*') || plainSelect.some((c) => /[()!:]/.test(c)) ? ` returning ${alias ? alias + '.' : ''}*`
    : ' returning ' + plainSelect.map((c) => (alias ? alias + '.' : '') + q(c)).join(', ');
  const returning = returningAs('');

  // ----- RPC -----
  if (parts[0] === 'rpc') {
    const fn = parts[1];
    const args = body && typeof body === 'object' ? body : {};
    const keys = Object.keys(args);
    const params = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? jsonParam(args[k]) : args[k]));
    const sql = `select ${q(fn)}(${keys.map((k, i) => `${q(k)} => $${i + 1}`).join(', ')}) as r`;
    const res = await db.query(sql, params);
    const r = res.rows[0]?.r;
    return { status: 200, json: r === undefined || r === '' ? null : r };
  }

  const table = parts[0];
  relation(table);

  if (req.method === 'GET') {
    const params = [];
    const sql =
      `select ${selectList(table, 't0', parseSelect(sp.get('select')), 0)} from ${q(table)} t0` +
      whereClause('t0', sp, params) +
      orderClause('t0', sp.get('order')) +
      (sp.get('limit') ? ` limit ${Number(sp.get('limit'))}` : '') +
      (sp.get('offset') ? ` offset ${Number(sp.get('offset'))}` : '');
    const res = await db.query(sql, params);
    return single(res.rows, wantsObject);
  }

  if (req.method === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const cols = bodyColumns(table, rows);
    const list = cols.map(q).join(', ');
    let sql = `insert into ${q(table)} (${list}) select ${list} from json_populate_recordset(null::${q(table)}, $1::json)`;
    if (prefer.includes('resolution=merge-duplicates') || prefer.includes('resolution=ignore-duplicates')) {
      const pk = (sp.get('on_conflict')?.split(',') ?? meta.pks[table] ?? []);
      const upd = cols.filter((c) => !pk.includes(c));
      sql += ` on conflict (${pk.map(q).join(', ')}) ` +
        (prefer.includes('ignore') || !upd.length ? 'do nothing' : `do update set ${upd.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}`);
    }
    sql += returning;
    const res = await db.query(sql, [jsonParam(rows)]);
    await maybeReloadMeta(table);
    return returnRows ? single(res.rows, wantsObject, 201) : { status: 201, json: null };
  }

  if (req.method === 'PATCH') {
    const cols = bodyColumns(table, [body]);
    if (!cols.length) throw new ApiError(400, 'Nothing to update');
    const params = [];
    const where = whereClause('t0', sp, params);
    if (!where) throw new ApiError(400, 'UPDATE without a filter is not allowed');
    params.push(jsonParam(body));
    const sql = `update ${q(table)} t0 set ${cols.map((c) => `${q(c)} = r.${q(c)}`).join(', ')} ` +
      `from json_populate_record(null::${q(table)}, $${params.length}::json) r${where.replace(' where ', ' where ')}${returningAs('t0')}`;
    const res = await db.query(sql, params);
    return returnRows ? single(res.rows, wantsObject) : { status: 204, json: null };
  }

  if (req.method === 'DELETE') {
    const params = [];
    const where = whereClause('t0', sp, params);
    if (!where) throw new ApiError(400, 'DELETE without a filter is not allowed');
    const res = await db.query(`delete from ${q(table)} t0${where}${returningAs('t0')}`, params);
    return returnRows ? single(res.rows, wantsObject) : { status: 204, json: null };
  }
  throw new ApiError(405, `Method ${req.method} not supported`);
}

function single(rows, wantsObject, status = 200) {
  if (!wantsObject) return { status, json: rows };
  if (rows.length !== 1) throw new ApiError(406, `JSON object requested, multiple (or no) rows returned (${rows.length})`, 'PGRST116');
  return { status, json: rows[0] };
}
async function maybeReloadMeta() {
  /* schema only changes through the console */
}

// ----- console API -----
async function handleConsole(url, body) {
  if (url.pathname === '/console/meta') return { status: 200, json: meta };
  if (url.pathname === '/console/sql') {
    const sql = String(body?.sql ?? '');
    const results = await db.exec(sql);
    if (/\b(create|alter|drop)\b/i.test(sql)) await loadMeta();
    const last = results[results.length - 1] ?? { rows: [], fields: [] };
    return { status: 200, json: { fields: last.fields?.map((f) => f.name) ?? [], rows: last.rows ?? [], affected: last.affectedRows ?? 0, statements: results.length } };
  }
  throw new ApiError(404, 'Not found');
}

// ---------------------------------------------------------------------
// Edge Functions (simulated). Same URLs and answers as supabase/functions/*, but nothing
// leaves this computer: no Safaricom, no SMS. The app shows the "phone" on screen instead.
// ---------------------------------------------------------------------
const rand = (n, chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789') =>
  Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
const one = async (sql, params) => (await db.query(sql, params)).rows[0]?.r;

async function handleFunctions(url, body) {
  const fn = url.pathname.replace(/^\/functions\/v1\/?/, '');
  const b = body ?? {};
  if (fn === 'mpesa-stk') {
    // 1. same checks as live, 2. pretend Daraja accepted the push
    const r = await one(
      `select stk_create($1, $2, $3, $4, $5, $6, true) as r`,
      [b.purpose, b.phone, b.amount, b.booking_id ?? null, b.sale_id ?? null, b.student_id ?? null],
    );
    const checkout = `ws_CO_SIM_${Date.now()}${rand(4, '0123456789')}`;
    await db.query(`select stk_accepted($1, $2, $3)`, [r.id, `SIM-${rand(8, '0123456789')}`, checkout]);
    return {
      status: 200,
      json: { id: r.id, checkout_request_id: checkout, phone: r.phone, amount: r.amount, simulated: true,
        customer_message: 'Success. Request accepted for processing' },
    };
  }
  if (fn === 'mpesa-simulate') {
    // stands in for Safaricom calling our callback after the client answers the prompt
    const outcomes = {
      pay: [0, 'The service request is processed successfully.'],
      cancel: [1032, 'Request cancelled by user'],
      insufficient: [1, 'The balance is insufficient for the transaction'],
      timeout: [1037, 'DS timeout user cannot be reached'],
      wrong_pin: [2001, 'The initiator information is invalid'],
    };
    const [code, desc] = outcomes[b.outcome] ?? outcomes.pay;
    const receipt = code === 0 ? `T${String.fromCharCode(65 + new Date().getMonth())}${rand(8)}` : null;
    const r = await one(`select stk_complete($1, $2, $3, $4, null, null) as r`, [b.checkout_request_id, code, desc, receipt]);
    return { status: 200, json: { ResultCode: code, ResultDesc: desc, status: r.status } };
  }
  if (fn === 'portal-otp') {
    // live: the code goes out by SMS / WhatsApp / email. Here it is returned so the app can show it.
    const r = await one(`select portal_issue_code($1, $2) as r`, [b.channel, b.address]);
    console.log(`  ✉ code for ${r.address} (${b.channel}): ${r.code}`);
    return { status: 200, json: { sent: true, channel: b.channel, to: r.address, simulated: true, dev_code: r.code } };
  }
  throw new ApiError(404, `Function ${fn} not found`);
}

// ---------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Range',
};
const consoleHtml = () => readFileSync(path.join(here, 'console.html'), 'utf8');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/console')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(consoleHtml());
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    const body = raw ? JSON.parse(raw) : null;
    const out = url.pathname.startsWith('/rest/v1')
      ? await handleRest(req, url, body)
      : url.pathname.startsWith('/functions/v1')
        ? await handleFunctions(url, body)
        : await handleConsole(url, body);
    res.writeHead(out.status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(out.json === null && out.status === 204 ? '' : JSON.stringify(out.json));
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 400;
    const payload = { message: e.message, code: e.code ?? 'P0001', details: e.detail ?? null, hint: e.hint ?? null };
    if (!(e instanceof ApiError)) console.log(`  ! ${req.method} ${url.pathname}: ${e.message}`);
    res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\nDantesras internal database is running`);
  console.log(`  Console : http://localhost:${PORT}`);
  console.log(`  App API : http://localhost:${PORT}/rest/v1   (anon key: any text, e.g. "local-dev")`);
  console.log(`  Data    : ${DATA_DIR}`);
  console.log(`Press Ctrl+C to stop.\n`);
});

const stop = async () => {
  server.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
