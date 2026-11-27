-- 005: 教室管理（フェーズ①）予約の区分・項目、仮予約／利用済み、削除（論理削除）、8教室の初期データ
-- Supabase の SQL Editor に貼って Run。既存の予約は消えません（新しい列には既定値が入ります）。
-- 何度実行しても同じ結果になります。公開中の画面はこの migration の前後どちらでも動きます。

-- ───────── 1. 予約の項目 ─────────
-- 既存の予約は「一般貸出・1人・未払い」になる
alter table reservations add column if not exists category text not null default 'rental'
  check (category in ('lesson', 'rental', 'pass', 'trial', 'event', 'internal', 'maint'));
alter table reservations add column if not exists teacher text check (char_length(teacher) <= 40);
alter table reservations add column if not exists course  text check (char_length(course)  <= 40);
alter table reservations add column if not exists people  int  not null default 1 check (people between 1 and 200);
alter table reservations add column if not exists contact text check (char_length(contact) <= 60);   -- 連絡先（管理者だけが入力・閲覧）
alter table reservations add column if not exists staff   text check (char_length(staff)   <= 40);   -- 受付担当
alter table reservations add column if not exists note    text check (char_length(note)    <= 500);
alter table reservations add column if not exists payment text not null default 'unpaid'
  check (payment in ('unpaid', 'paid', 'free'));
alter table reservations add column if not exists extras  text[] not null default '{}'
  check (cardinality(extras) <= 20);                                                                 -- ホールの追加楽器
alter table reservations add column if not exists discount       int not null default 0 check (discount >= 0);   -- 割引（円・税抜）
alter table reservations add column if not exists price_override int check (price_override >= 0);               -- 料金の手動修正（税抜）
alter table reservations add column if not exists deleted_at     timestamptz;                                    -- 削除（画面・集計から外す。行は残す）

-- 予約状況：仮予約・確定・利用済み・キャンセル
alter table reservations drop constraint if exists reservations_status_check;
alter table reservations add constraint reservations_status_check
  check (status in ('tentative', 'confirmed', 'used', 'cancelled'));

-- ───────── 2. 重複防止：区分に関係なく、キャンセル・削除以外はすべて重ならない ─────────
-- 新しい制約を先に作ってから古い制約を外す（その間も重複を防ぐ）
do $$ begin
  alter table reservations add constraint reservations_no_overlap_active
    exclude using gist (room_id with =, tstzrange(start_at, end_at, '[)') with &&)
    where (status <> 'cancelled' and deleted_at is null);
exception when duplicate_object or duplicate_table then null; end $$;
alter table reservations drop constraint if exists reservations_no_overlap;

-- キャンセル日時・削除日時は DB が記録する（画面から好きな日時は入れられない）
create or replace function public.set_cancelled_at() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.cancelled_at := case when new.status = 'cancelled' then now() else null end;
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_at := now();
  elsif new.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;
  return new;
end;
$$;

-- ───────── 3. 管理者が書き換えられる列（一般の人の権限は変えない） ─────────
-- 流入元（source）と作成日時は書き換え不可
grant update (status, room_id, start_at, end_at, name, school, category, teacher, course, people,
              contact, staff, note, payment, extras, discount, price_override, deleted_at) on reservations to authenticated;
grant insert (room_id, start_at, end_at, name, school, source, status, category, teacher, course, people,
              contact, staff, note, payment, extras, discount, price_override) on reservations to authenticated;

-- ───────── 4. 空き状況ビュー：中身は出さず、メンテナンスかどうかだけ足す ─────────
create or replace view booked_slots as
  select room_id, start_at, end_at, (category = 'maint') as is_maint
    from reservations
   where status <> 'cancelled' and deleted_at is null;
revoke all on booked_slots from anon, authenticated;
grant select on booked_slots to anon, authenticated;

-- ───────── 5. 教室マスタの項目 ─────────
alter table rooms add column if not exists instruments  text    check (char_length(instruments) <= 200);  -- 常設楽器
alter table rooms add column if not exists is_hall      boolean not null default false;
alter table rooms add column if not exists target_rate  int     not null default 40 check (target_rate between 0 and 100);  -- 目標稼働率(%)
alter table rooms add column if not exists sales_target int     not null default 0  check (sales_target >= 0);             -- 月の貸出売上目標(円)
-- 一般の人には目標の数字を見せない（列単位で読める列を指定）
revoke select on rooms from anon;
grant select (id, name, color, capacity, description, sort_order, is_public, instruments, is_hall) on rooms to anon;

-- ───────── 6. 8教室の初期データ（最初は非公開。同じ名前があれば入れない） ─────────
insert into rooms (name, color, capacity, sort_order, is_public, instruments, is_hall, target_rate, sales_target)
select v.name, v.color, v.capacity, v.sort_order, false, v.instruments, v.is_hall, 40, 20000
  from (values
    ('L-1',  '#4f7a87',  4, 11, 'アップライトピアノ',                         false),
    ('M-3',  '#8a6474',  4, 12, 'グランドピアノ、ステージア ELS-01C',           false),
    ('L-2',  '#7a7a52',  4, 13, 'アップライトピアノ、ステージア ELS-02C、ELS-03X', false),
    ('S-5',  '#5b6f8f',  4, 14, 'グランドピアノ',                             false),
    ('M-2',  '#8a7056',  4, 15, 'グランドピアノ',                             false),
    ('M-1',  '#5f7d63',  4, 16, 'アップライトピアノ、ステージア ELS-02C',       false),
    ('S-6',  '#7d6a8f',  4, 17, 'グランドピアノ、アップライトピアノ',           false),
    ('ホール', '#6b6b6b', 30, 18, 'グランドピアノ',                             true)
  ) as v(name, color, capacity, sort_order, instruments, is_hall)
 where not exists (select 1 from rooms r where r.name = v.name);
