-- 002: 複数の部屋（フェーズ2）
-- Supabase の SQL Editor に貼って Run。既存の予約データは消えません。何度実行しても同じ結果になります。

-- ───────── 部屋ごとの設定 ─────────
alter table rooms add column if not exists color       text    not null default '#0c8599';
alter table rooms add column if not exists capacity    int;
alter table rooms add column if not exists description text;
alter table rooms add column if not exists sort_order  int     not null default 0;
alter table rooms add column if not exists is_public   boolean not null default true;

do $$ begin
  alter table rooms add constraint rooms_color_hex check (color ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table rooms add constraint rooms_capacity_positive check (capacity is null or capacity between 1 and 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table rooms add constraint rooms_text_length check (char_length(name) between 1 and 40 and char_length(coalesce(description, '')) <= 200);
exception when duplicate_object then null; end $$;

-- 既存の部屋(id=1)を「2階 練習室A」に。既存の予約は A のまま
update rooms set name = '2階 練習室A', color = '#0c8599', sort_order = 1
 where id = 1 and name = '2階 練習室';
insert into rooms (name, color, sort_order)
select '2階 練習室B', '#d6336c', 2
 where not exists (select 1 from rooms where name = '2階 練習室B');

-- ───────── 一般の利用者には「公開」の部屋だけ見せる ─────────
drop policy if exists "anyone can read rooms" on rooms;         -- ポリシーの付け替えのみ。データは消えません
drop policy if exists "anyone can read public rooms" on rooms;
create policy "anyone can read public rooms" on rooms
  for select to anon, authenticated using (is_public);

-- ───────── 予約関数：非公開・存在しない部屋は予約不可に ─────────
-- （ダブルブッキング防止は従来どおり unique(room_id, date, start_hour) で DB が保証）
create or replace function public.create_reservation(
  p_room_id    int,
  p_date       date,
  p_start_hour int,
  p_end_hour   int,
  p_name       text,
  p_school     text default null,
  p_source     text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid := gen_random_uuid();
  v_now   timestamp := now() at time zone 'Asia/Tokyo';
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
  if p_start_hour is null or p_end_hour is null
     or p_start_hour < 10 or p_end_hour > 21 or p_end_hour <= p_start_hour then
    raise exception '予約できる時間は 10:00〜21:00 です';
  end if;
  if p_end_hour - p_start_hour > 3 then
    raise exception '1回の予約は3時間までです';
  end if;
  if p_date + make_time(p_start_hour, 0, 0) <= v_now then
    raise exception '過ぎた時間は予約できません';
  end if;

  insert into reservations (room_id, date, start_hour, name, school, source, group_id)
  select p_room_id, p_date, h, p_name, p_school, p_source, v_group
  from generate_series(p_start_hour, p_end_hour - 1) as h;

  return v_group;
end;
$$;

revoke all on function public.create_reservation(int, date, int, int, text, text, text) from public;
grant execute on function public.create_reservation(int, date, int, int, text, text, text) to anon, authenticated;
