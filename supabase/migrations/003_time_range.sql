-- 003: 予約を「開始時刻〜終了時刻（15分単位）」で持つ（ステップ3）
-- Supabase の SQL Editor に貼って Run。何度実行しても同じ結果になります。
-- ※ 実行後、新しい画面を push するまでは、公開中の古い画面からは予約できません（空き状況の表示も止まります）

-- ───────── 0. テスト予約の削除（承認済み） ─────────
delete from reservations where name = '__TEST__' or date >= '2099-01-01';

-- ───────── 1. 念のためのバックアップ（API から見えない別スキーマに保存） ─────────
create schema if not exists backup;
revoke all on schema backup from anon, authenticated;
create table if not exists backup.reservations_003 as select * from public.reservations;
revoke all on backup.reservations_003 from anon, authenticated;

-- ───────── 2. 新しい列 ─────────
alter table reservations add column if not exists start_at     timestamptz;
alter table reservations add column if not exists end_at       timestamptz;
alter table reservations add column if not exists status       text not null default 'confirmed';
alter table reservations add column if not exists cancelled_at timestamptz;

-- ───────── 3. 既存データの移行 ─────────
-- 同じ group_id の行（例：15時・16時の2行）を、いちばん小さい id の1行（15:00〜17:00）にまとめる
with g as (
  select group_id,
         min(id) as keep_id,
         min((date + make_time(start_hour, 0, 0)) at time zone 'Asia/Tokyo')                       as s,
         max((date + make_time(start_hour, 0, 0)) at time zone 'Asia/Tokyo') + interval '1 hour'    as e
    from reservations
   where start_at is null
   group by group_id
)
update reservations r set start_at = g.s, end_at = g.e
  from g where r.id = g.keep_id;
-- まとめ先にならなかった残りの行（同じ内容が上の1行に入っている）を削除
delete from reservations where start_at is null;

-- ───────── 4. 制約 ─────────
alter table reservations alter column start_at set not null;
alter table reservations alter column end_at   set not null;
-- 旧形式の列は残すが、今後は使わない
alter table reservations alter column date       drop not null;
alter table reservations alter column start_hour drop not null;
-- 1時間単位の重複防止は、下の排他制約に置き換える
alter table reservations drop constraint if exists reservations_room_id_date_start_hour_key;

do $$ begin
  alter table reservations add constraint reservations_status_check check (status in ('confirmed', 'cancelled'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table reservations add constraint reservations_time_order check (end_at > start_at);
exception when duplicate_object then null; end $$;
do $$ begin
  -- 15分単位（:00 / :15 / :30 / :45、秒は0）
  alter table reservations add constraint reservations_quarter_hour check (
    extract(second from start_at) = 0 and extract(minute from start_at)::int % 15 = 0 and
    extract(second from end_at)   = 0 and extract(minute from end_at)::int   % 15 = 0);
exception when duplicate_object then null; end $$;

-- 重複予約の防止：同じ部屋で時間帯が重なる「確定」予約は DB が拒否する（キャンセル済みは対象外）
-- '[)' なので 16:45 終了と 16:45 開始は重ならない
create extension if not exists btree_gist with schema extensions;
do $$ begin
  alter table reservations add constraint reservations_no_overlap
    exclude using gist (room_id with =, tstzrange(start_at, end_at, '[)') with &&)
    where (status = 'confirmed');
exception when duplicate_object or duplicate_table then null; end $$;

create index if not exists reservations_start_at_idx on reservations (start_at);

-- ───────── 5. 予約関数を新しい形式に ─────────
drop function if exists public.create_reservation(int, date, int, int, text, text, text);  -- 関数の削除のみ

create or replace function public.create_reservation(
  p_room_id  int,
  p_start_at timestamptz,   -- 例 '2026-11-28T15:15:00+09:00'
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
  s timestamp := p_start_at at time zone 'Asia/Tokyo';   -- 日本時間の「時計の時刻」
  e timestamp := p_end_at   at time zone 'Asia/Tokyo';
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
  if s < s::date + time '10:00' or e > s::date + time '21:00' then
    raise exception '予約できる時間は 10:00〜21:00 です';
  end if;
  if p_start_at <= now() then
    raise exception '過ぎた時間は予約できません';
  end if;

  -- 時間帯が重なる確定予約があれば、排他制約で 23P01 エラーになる
  insert into reservations (room_id, start_at, end_at, name, school, source)
  values (p_room_id, p_start_at, p_end_at, p_name, p_school, p_source)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_reservation(int, timestamptz, timestamptz, text, text, text) from public;
grant execute on function public.create_reservation(int, timestamptz, timestamptz, text, text, text) to anon, authenticated;

-- ───────── 6. 空き状況ビュー（個人情報なし・確定予約のみ） ─────────
drop view if exists booked_slots;   -- 列が変わるため作り直し（ビューはデータを持たない）
create view booked_slots as
  select room_id, start_at, end_at from reservations where status = 'confirmed';
revoke all on booked_slots from anon, authenticated;
grant select on booked_slots to anon, authenticated;

-- ───────── 7. 部屋の色を落ち着いた色に ─────────
alter table rooms alter column color set default '#4f7a87';
update rooms set color = '#4f7a87' where color = '#0c8599';
update rooms set color = '#8a6474' where color = '#d6336c';
