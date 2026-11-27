-- 008: 教室管理（フェーズ④）変更履歴・集計の時間帯の設定
-- Supabase の SQL Editor に貼って Run。既存のデータは変わりません。何度実行しても同じ結果になります。

-- ───────── 1. お店の設定（集計・予約表の時間帯） ─────────
create table if not exists shop_settings (
  id             int  primary key default 1 check (id = 1),
  analysis_open  time not null default '09:00',   -- 稼働率の分母・管理画面の予約表の開始
  analysis_close time not null default '21:00',   -- 同 終了
  check (analysis_close > analysis_open),
  check (extract(minute from analysis_open)::int = 0 and extract(minute from analysis_close)::int = 0)  -- 1時間単位
);
insert into shop_settings (id) values (1) on conflict do nothing;
alter table shop_settings enable row level security;
revoke all on shop_settings from anon, authenticated;
grant select on shop_settings to authenticated;
grant update (analysis_open, analysis_close) on shop_settings to authenticated;
drop policy if exists "admins read shop settings"   on shop_settings;
drop policy if exists "admins update shop settings" on shop_settings;
create policy "admins read shop settings"   on shop_settings for select to authenticated using (is_admin());
create policy "admins update shop settings" on shop_settings for update to authenticated using (is_admin()) with check (is_admin());

-- ───────── 2. 変更履歴 ─────────
-- 誰が（管理者のメール／一般の予約画面／SQL Editor）・いつ・どの表のどの行を・どう変えたか（変わった列の前後の値）
create table if not exists audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       uuid,                   -- ログインしていた人（auth.users.id）
  actor_email text,
  actor_kind  text not null check (actor_kind in ('admin', 'public', 'system')),
  table_name  text not null,
  row_id      text,
  action      text not null check (action in ('insert', 'update', 'delete')),
  before      jsonb,                  -- update は変わった列だけ
  after       jsonb
);
create index if not exists audit_log_at_idx on audit_log (at desc);
create index if not exists audit_log_row_idx on audit_log (table_name, row_id);
alter table audit_log enable row level security;
revoke all on audit_log from anon, authenticated;
grant select on audit_log to authenticated;            -- 書き込みはトリガーだけ。誰も書き換え・削除できない
drop policy if exists "admins read audit log" on audit_log;
create policy "admins read audit log" on audit_log for select to authenticated using (is_admin());

create or replace function public.write_audit() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  b jsonb; a jsonb;
  k text;
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_role text := coalesce(claims->>'role', '');
begin
  if tg_op = 'UPDATE' then
    b := '{}'; a := '{}';
    for k in select jsonb_object_keys(n) loop
      if k <> 'updated_at' and (o->k) is distinct from (n->k) then
        b := b || jsonb_build_object(k, o->k);
        a := a || jsonb_build_object(k, n->k);
      end if;
    end loop;
    if a = '{}' then return new; end if;   -- 何も変わっていない
  else
    b := o; a := n;
  end if;
  insert into audit_log (actor, actor_email, actor_kind, table_name, row_id, action, before, after)
  values (
    nullif(claims->>'sub', '')::uuid,
    claims->>'email',
    case when v_role = 'authenticated' then 'admin' when v_role = 'anon' then 'public' else 'system' end,
    tg_table_name,
    coalesce(n->>'id', o->>'id', n->>'weekday', o->>'weekday'),
    lower(tg_op), b, a);
  return coalesce(new, old);
end;
$$;
revoke execute on function public.write_audit() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['reservations', 'rooms', 'closures', 'business_hours', 'price_settings', 'hall_extras', 'shop_settings'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function public.write_audit()', t || '_audit', t);
  end loop;
end $$;
