-- 004: 管理者ページ（ステップ5）
-- Supabase の SQL Editor に貼って Run。既存データは消えません。何度実行しても同じ結果になります。
-- 管理者の判定はすべて RLS（is_admin()）で行う。service_role key は使わない。

-- ───────── 管理者 ─────────
create table if not exists admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table admins enable row level security;
revoke all on admins from anon, authenticated;
grant select on admins to authenticated;
drop policy if exists "read own admin row" on admins;
create policy "read own admin row" on admins for select to authenticated using (user_id = auth.uid());
-- 管理者の追加・削除は SQL Editor からのみ（API からはできない）

-- ログイン中のユーザーが管理者か。RLS の中から呼ぶ
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from admins where user_id = auth.uid()); $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ───────── 予約：管理者だけが全件を読み、キャンセル／取り消し・代理予約ができる ─────────
drop policy if exists "admins read reservations"   on reservations;
drop policy if exists "admins update reservations" on reservations;
drop policy if exists "admins insert reservations" on reservations;
create policy "admins read reservations"   on reservations for select to authenticated using (is_admin());
create policy "admins update reservations" on reservations for update to authenticated using (is_admin()) with check (is_admin());
create policy "admins insert reservations" on reservations for insert to authenticated with check (is_admin());
-- anon には引き続き何も付与しない
grant select on reservations to authenticated;
grant update (status) on reservations to authenticated;                                    -- 変更できるのは状態だけ
grant insert (room_id, start_at, end_at, name, school, source) on reservations to authenticated;
grant usage on sequence reservations_id_seq to authenticated;

-- キャンセル日時は DB が自動で記録（画面からは書き換えられない）
create or replace function public.set_cancelled_at() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.cancelled_at := case when new.status = 'cancelled' then now() else null end;
  end if;
  return new;
end;
$$;
drop trigger if exists reservations_cancelled_at on reservations;
create trigger reservations_cancelled_at before update on reservations
  for each row execute function public.set_cancelled_at();
-- ※ キャンセルの取り消しで時間が重なる場合は、排他制約(23P01)で DB が拒否する

-- ───────── 部屋：管理者は非公開の部屋も含めて追加・編集・削除 ─────────
drop policy if exists "admins manage rooms" on rooms;
create policy "admins manage rooms" on rooms for all to authenticated using (is_admin()) with check (is_admin());
grant select, insert, update, delete on rooms to authenticated;
grant usage on sequence rooms_id_seq to authenticated;
-- 予約が残っている部屋は外部キーで削除できない（23503）→ 画面では「非公開にする」を案内

-- ───────── 営業時間（曜日ごと。0=日〜6=土） ─────────
create table if not exists business_hours (
  weekday    smallint primary key check (weekday between 0 and 6),
  open_time  time    not null default '10:00',
  close_time time    not null default '21:00',
  is_closed  boolean not null default false,
  check (close_time > open_time),
  check (extract(minute from open_time)::int % 15 = 0 and extract(minute from close_time)::int % 15 = 0)
);
insert into business_hours (weekday) select g from generate_series(0, 6) g on conflict do nothing;
alter table business_hours enable row level security;
revoke all on business_hours from anon, authenticated;
grant select on business_hours to anon, authenticated;
grant update (open_time, close_time, is_closed) on business_hours to authenticated;
drop policy if exists "anyone can read hours" on business_hours;
drop policy if exists "admins update hours"   on business_hours;
create policy "anyone can read hours" on business_hours for select to anon, authenticated using (true);
create policy "admins update hours"   on business_hours for update to authenticated using (is_admin()) with check (is_admin());

-- ───────── 予約不可枠（定休日・店の都合・メンテナンス） ─────────
-- room_id が null なら全部屋。理由は利用者の画面にも表示される（個人情報は書かない）
create table if not exists closures (
  id         bigserial primary key,
  room_id    int references rooms(id) on delete cascade,
  start_at   timestamptz not null,
  end_at     timestamptz not null,
  reason     text check (char_length(reason) <= 40),
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index if not exists closures_start_at_idx on closures (start_at);
alter table closures enable row level security;
revoke all on closures from anon, authenticated;
grant select on closures to anon, authenticated;
grant insert (room_id, start_at, end_at, reason) on closures to authenticated;
grant delete on closures to authenticated;
grant usage on sequence closures_id_seq to authenticated;
drop policy if exists "anyone can read closures" on closures;
drop policy if exists "admins manage closures"   on closures;
create policy "anyone can read closures" on closures for select to anon, authenticated using (true);
create policy "admins manage closures"   on closures for all to authenticated using (is_admin()) with check (is_admin());

-- ───────── 予約関数：営業時間と予約不可枠もチェック ─────────
create or replace function public.create_reservation(
  p_room_id  int,
  p_start_at timestamptz,
  p_end_at   timestamptz,
  p_name     text,
  p_school   text default null,
  p_source   text default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  s timestamp := p_start_at at time zone 'Asia/Tokyo';
  e timestamp := p_end_at   at time zone 'Asia/Tokyo';
  v_open  time := '10:00';
  v_close time := '21:00';
  v_closed boolean := false;
begin
  p_name   := btrim(coalesce(p_name, ''));
  p_school := nullif(btrim(coalesce(p_school, '')), '');
  p_source := nullif(btrim(coalesce(p_source, '')), '');

  if not exists (select 1 from rooms where id = p_room_id and is_public) then
    raise exception 'この部屋は予約できません';
  end if;
  if p_name = '' then
    raise exception '名前を入力してください';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception '開始と終了の時刻を確認してください';
  end if;
  if extract(second from s) <> 0 or extract(minute from s)::int % 15 <> 0
     or extract(second from e) <> 0 or extract(minute from e)::int % 15 <> 0 then
    raise exception '時刻は15分単位で指定してください';
  end if;
  if p_end_at - p_start_at < interval '30 minutes' then
    raise exception '予約は30分以上でお願いします';
  end if;
  if p_end_at - p_start_at > interval '3 hours' then
    raise exception '1回の予約は3時間までです';
  end if;

  select open_time, close_time, is_closed into v_open, v_close, v_closed
    from business_hours where weekday = extract(dow from s)::int;
  if v_closed then
    raise exception 'この日は定休日です';
  end if;
  if s < s::date + coalesce(v_open, '10:00') or e > s::date + coalesce(v_close, '21:00') then
    raise exception '予約できる時間は %〜% です', to_char(coalesce(v_open, '10:00'), 'FMHH24:MI'), to_char(coalesce(v_close, '21:00'), 'FMHH24:MI');
  end if;
  if exists (select 1 from closures c
              where (c.room_id is null or c.room_id = p_room_id)
                and tstzrange(c.start_at, c.end_at, '[)') && tstzrange(p_start_at, p_end_at, '[)')) then
    raise exception 'その時間は予約を受け付けていません';
  end if;
  if p_start_at <= now() then
    raise exception '過ぎた時間は予約できません';
  end if;

  insert into reservations (room_id, start_at, end_at, name, school, source)
  values (p_room_id, p_start_at, p_end_at, p_name, p_school, p_source)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_reservation(int, timestamptz, timestamptz, text, text, text) from public;
grant execute on function public.create_reservation(int, timestamptz, timestamptz, text, text, text) to anon, authenticated;
