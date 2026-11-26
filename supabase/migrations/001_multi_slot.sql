-- 001: 連続した複数枠の予約（フェーズ1）
-- Supabase の SQL Editor に貼って Run。既存の予約データは消えません。
-- 何度実行しても同じ結果になるように書いてあります。

-- ───────── 予約のまとまり（15:00〜17:00 なら 2行が同じ group_id） ─────────
alter table reservations add column if not exists group_id uuid;
update reservations set group_id = gen_random_uuid() where group_id is null;  -- 既存の予約は1枠ずつ
alter table reservations alter column group_id set default gen_random_uuid();
alter table reservations alter column group_id set not null;
create index if not exists reservations_group_id_idx on reservations (group_id);

-- ───────── 予約はこの関数経由だけにする ─────────
-- ・複数枠を1回でまとめて入れる（1枠でも埋まっていれば全体が失敗＝中途半端に入らない）
-- ・時間帯・過去・長さのチェックをDB側で行う
-- security definer: 関数の作成者(postgres)の権限で動くので、anon にテーブルへの直接権限は不要
create or replace function public.create_reservation(
  p_room_id    int,
  p_date       date,
  p_start_hour int,
  p_end_hour   int,      -- 終了時刻（15:00〜17:00 なら 17）
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

  -- 同じ部屋・同じ日・同じ時間がすでにあれば unique 制約で 23505 エラー → 全体が取り消される
  insert into reservations (room_id, date, start_hour, name, school, source, group_id)
  select p_room_id, p_date, h, p_name, p_school, p_source, v_group
  from generate_series(p_start_hour, p_end_hour - 1) as h;

  return v_group;
end;
$$;

revoke all on function public.create_reservation(int, date, int, int, text, text, text) from public;
grant execute on function public.create_reservation(int, date, int, int, text, text, text) to anon, authenticated;

-- テーブルへの直接 insert は取り上げる（関数経由だけにする）
drop policy if exists "anyone can reserve" on reservations;   -- ポリシーの削除のみ。データは消えません
revoke insert on reservations from anon, authenticated;

-- ───────── 空き状況ビューに group_id を追加（つながった枠を1つのブロックで表示するため） ─────────
-- group_id はランダムな値で、個人情報は含まない
create or replace view booked_slots as
  select room_id, date, start_hour, group_id from reservations;
revoke all on booked_slots from anon, authenticated;
grant select on booked_slots to anon, authenticated;
