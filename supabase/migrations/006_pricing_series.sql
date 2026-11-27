-- 006: 教室管理（フェーズ②）料金計算・定期レッスン・空き教室検索
-- Supabase の SQL Editor に貼って Run。既存の予約は消えません。何度実行しても同じ結果になります。
-- 料金は「予約を保存した時点の料金」を予約に記録する（料金設定を後から変えても過去の売上は変わらない）

-- ───────── 1. 料金設定（1行だけ） ─────────
create table if not exists price_settings (
  id             int  primary key default 1 check (id = 1),
  base_per_hour  int  not null default 1000 check (base_per_hour  >= 0),  -- 一般教室 基本料金（円/時・税抜）
  add_per_person int  not null default 100  check (add_per_person >= 0),  -- 2人目以降 1人あたり（円/時）
  hall_per_hour  int  not null default 1500 check (hall_per_hour  >= 0),  -- ホール 基本料金（円/時・税抜）
  tax_rate       int  not null default 10   check (tax_rate between 0 and 100),  -- 消費税率(%)
  public_charge  boolean not null default true,  -- 一般の予約画面からの予約を有料（未払い）にするか。false なら無料で入る
  updated_at     timestamptz not null default now()
);
insert into price_settings (id) values (1) on conflict do nothing;
alter table price_settings enable row level security;
revoke all on price_settings from anon, authenticated;
grant select on price_settings to authenticated;
grant update (base_per_hour, add_per_person, hall_per_hour, tax_rate, public_charge) on price_settings to authenticated;
drop policy if exists "admins read price settings"   on price_settings;
drop policy if exists "admins update price settings" on price_settings;
create policy "admins read price settings"   on price_settings for select to authenticated using (is_admin());
create policy "admins update price settings" on price_settings for update to authenticated using (is_admin()) with check (is_admin());

-- ───────── 2. ホールの追加楽器 ─────────
create table if not exists hall_extras (
  id         bigserial primary key,
  name       text not null unique check (char_length(name) between 1 and 40),
  price      int  not null default 0 check (price >= 0),           -- 円・税抜
  unit       text not null default 'hour' check (unit in ('hour', 'once')),  -- 1時間あたり／1回あたり
  sort_order int  not null default 0,
  active     boolean not null default true                          -- false なら新しい予約では選べない（過去の予約の名前は残る）
);
insert into hall_extras (name, price, unit, sort_order) values
  ('グランドピアノ', 0, 'hour', 1), ('マリンバ', 0, 'hour', 2), ('ドラムセット', 0, 'hour', 3), ('その他打楽器', 0, 'once', 4)
on conflict (name) do nothing;
alter table hall_extras enable row level security;
revoke all on hall_extras from anon, authenticated;
grant select, insert, update, delete on hall_extras to authenticated;
grant usage on sequence hall_extras_id_seq to authenticated;
drop policy if exists "admins manage hall extras" on hall_extras;
create policy "admins manage hall extras" on hall_extras for all to authenticated using (is_admin()) with check (is_admin());

-- ───────── 3. 料金を計算する関数（画面のプレビュー・保存時・検索で同じものを使う） ─────────
-- 一般貸出だけに料金がかかる。ホールは「ホール料金×時間＋追加楽器」、それ以外は「(基本＋2人目以降×人数)×時間」
-- 税抜 = 手動修正があればその額、なければ 基本＋追加−割引（0未満は0）。消費税は四捨五入
create or replace function public.quote_price(
  p_category text, p_room_id int, p_start_at timestamptz, p_end_at timestamptz,
  p_people int default 1, p_extras text[] default '{}', p_discount int default 0, p_override int default null
) returns table (base int, extras int, net int, tax int, total int)
language plpgsql stable security definer set search_path = public
as $$
declare
  s price_settings;
  h numeric := extract(epoch from (p_end_at - p_start_at)) / 3600.0;
  v_hall boolean;
  v_base numeric := 0;
  v_ex numeric := 0;
begin
  select * into s from price_settings where id = 1;
  if p_category = 'rental' then
    select is_hall into v_hall from rooms where id = p_room_id;
    if coalesce(v_hall, false) then
      v_base := s.hall_per_hour * h;
      select coalesce(sum(e.price * case when e.unit = 'hour' then h else 1 end), 0) into v_ex
        from hall_extras e where e.name = any (coalesce(p_extras, '{}'));
    else
      v_base := (s.base_per_hour + greatest(0, coalesce(p_people, 1) - 1) * s.add_per_person) * h;
    end if;
  end if;
  base   := round(v_base);
  extras := round(v_ex);
  net    := greatest(0, coalesce(p_override, base + extras - coalesce(p_discount, 0)));
  tax    := round(net * s.tax_rate / 100.0);
  total  := net + tax;
  return next;
end;
$$;
revoke all on function public.quote_price(text, int, timestamptz, timestamptz, int, text[], int, int) from public;
grant execute on function public.quote_price(text, int, timestamptz, timestamptz, int, text[], int, int) to authenticated;

-- ───────── 4. 予約に料金を記録する ─────────
alter table reservations add column if not exists price_base   int not null default 0;
alter table reservations add column if not exists price_extras int not null default 0;
alter table reservations add column if not exists price_net    int not null default 0;
alter table reservations add column if not exists price_tax    int not null default 0;
alter table reservations add column if not exists price_total  int not null default 0;
alter table reservations add column if not exists series_id    uuid;   -- 定期レッスンのまとまり
create index if not exists reservations_series_id_idx on reservations (series_id) where series_id is not null;

-- 既存の予約にも今の料金設定で料金を入れる（下のトリガーを作る前に行う）
drop trigger if exists reservations_price on reservations;
update reservations r set price_base = q.base, price_extras = q.extras, price_net = q.net, price_tax = q.tax, price_total = q.total
  from reservations x
  cross join lateral quote_price(x.category, x.room_id, x.start_at, x.end_at, x.people, x.extras, x.discount, x.price_override) q
 where r.id = x.id and r.price_total = 0 and x.category = 'rental' and x.price_override is null;

-- 保存のたびに料金を計算し直す（料金に関わる項目が変わったときだけ。画面から料金の列は書けない）
create or replace function public.set_price() returns trigger
language plpgsql security definer set search_path = public
as $$
declare q record;
begin
  if tg_op = 'UPDATE' and (new.category, new.room_id, new.start_at, new.end_at, new.people, new.extras, new.discount, new.price_override)
                       is not distinct from
                          (old.category, old.room_id, old.start_at, old.end_at, old.people, old.extras, old.discount, old.price_override) then
    new.price_base := old.price_base; new.price_extras := old.price_extras; new.price_net := old.price_net;
    new.price_tax := old.price_tax;   new.price_total := old.price_total;
    return new;
  end if;
  select * into q from quote_price(new.category, new.room_id, new.start_at, new.end_at, new.people, new.extras, new.discount, new.price_override);
  new.price_base := q.base; new.price_extras := q.extras; new.price_net := q.net; new.price_tax := q.tax; new.price_total := q.total;
  return new;
end;
$$;
drop trigger if exists reservations_price on reservations;
create trigger reservations_price before insert or update on reservations
  for each row execute function public.set_price();

grant insert (series_id) on reservations to authenticated;

-- ───────── 5. 一般の予約：料金設定「一般予約を有料にする」がオフなら無料で入れる ─────────
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
  v_charge boolean := true;
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

  select public_charge into v_charge from price_settings where id = 1;
  if coalesce(v_charge, true) then
    insert into reservations (room_id, start_at, end_at, name, school, source)
    values (p_room_id, p_start_at, p_end_at, p_name, p_school, p_source)
    returning id into v_id;
  else
    insert into reservations (room_id, start_at, end_at, name, school, source, payment, price_override)
    values (p_room_id, p_start_at, p_end_at, p_name, p_school, p_source, 'free', 0)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.create_reservation(int, timestamptz, timestamptz, text, text, text) from public;
grant execute on function public.create_reservation(int, timestamptz, timestamptz, text, text, text) to anon, authenticated;

-- ───────── 6. 定期レッスン：毎週・隔週で終了日まで一括登録 ─────────
-- 実行するユーザーの権限で動く（管理者でなければ RLS で登録できない）
-- 定休日・予約不可枠・ほかの予約と重なる日は登録せず、理由つきで返す。p_dry_run = true なら登録せずに結果だけ返す
create or replace function public.create_series(
  p_room_id int, p_first date, p_start_min int, p_end_min int, p_every_days int, p_until date,
  p_fields jsonb, p_dry_run boolean default true
) returns table (day date, ok boolean, reason text, id bigint)
language plpgsql security invoker set search_path = public
as $$
declare
  v_series uuid := gen_random_uuid();
  d date := p_first;
  s timestamptz; e timestamptz;
  v_closed boolean;
  v_reason text;
  v_n int := 0;
begin
  if not is_admin() then raise exception '管理者だけが使えます'; end if;
  if p_every_days not in (7, 14) then raise exception '繰り返しは毎週か隔週です'; end if;
  if p_until < p_first or p_until > p_first + 366 then raise exception '終了日は開始日から1年以内にしてください'; end if;
  if p_end_min <= p_start_min or p_start_min % 15 <> 0 or p_end_min % 15 <> 0 or p_end_min > 1440 then
    raise exception '開始と終了の時刻を確認してください';
  end if;

  while d <= p_until loop
    v_n := v_n + 1;
    s := (d + make_interval(mins => p_start_min)) at time zone 'Asia/Tokyo';
    e := (d + make_interval(mins => p_end_min))   at time zone 'Asia/Tokyo';
    v_reason := null; id := null;

    select is_closed into v_closed from business_hours where weekday = extract(dow from d)::int;
    if coalesce(v_closed, false) then v_reason := '定休日'; end if;
    if v_reason is null then
      select '予約不可（' || coalesce(c.reason, '休業') || '）' into v_reason from closures c
       where (c.room_id is null or c.room_id = p_room_id)
         and tstzrange(c.start_at, c.end_at, '[)') && tstzrange(s, e, '[)') limit 1;
    end if;
    if v_reason is null then
      select '重複：' || to_char(r.start_at at time zone 'Asia/Tokyo', 'FMHH24:MI') || '〜' || to_char(r.end_at at time zone 'Asia/Tokyo', 'FMHH24:MI') || ' ' || r.name
        into v_reason from reservations r
       where r.room_id = p_room_id and r.status <> 'cancelled' and r.deleted_at is null
         and tstzrange(r.start_at, r.end_at, '[)') && tstzrange(s, e, '[)') limit 1;
    end if;

    if v_reason is null and not p_dry_run then
      begin
        insert into reservations (room_id, start_at, end_at, source, series_id, name, school, status, category, teacher, course,
                                  people, contact, staff, note, payment, extras, discount, price_override)
        values (p_room_id, s, e, 'admin', v_series,
                btrim(p_fields->>'name'), nullif(btrim(p_fields->>'school'), ''),
                coalesce(p_fields->>'status', 'confirmed'), coalesce(p_fields->>'category', 'lesson'),
                nullif(btrim(p_fields->>'teacher'), ''), nullif(btrim(p_fields->>'course'), ''),
                coalesce((p_fields->>'people')::int, 1), nullif(btrim(p_fields->>'contact'), ''),
                nullif(btrim(p_fields->>'staff'), ''), nullif(btrim(p_fields->>'note'), ''),
                coalesce(p_fields->>'payment', 'free'),
                coalesce(array(select jsonb_array_elements_text(p_fields->'extras')), '{}'),
                coalesce((p_fields->>'discount')::int, 0), (p_fields->>'price_override')::int)
        returning reservations.id into id;
      exception when exclusion_violation then
        v_reason := '重複';
      end;
    end if;

    day := d; ok := v_reason is null; reason := v_reason;
    return next;
    d := d + p_every_days;
  end loop;
end;
$$;
revoke all on function public.create_series(int, date, int, int, int, date, jsonb, boolean) from public;
grant execute on function public.create_series(int, date, int, int, int, date, jsonb, boolean) to authenticated;

-- ───────── 7. 空き教室検索（管理者用。料金つき） ─────────
-- p_keyword：'ホール' ならホールだけ、それ以外は常設楽器に含まれる文字で絞る。空ならすべて
create or replace function public.search_free_rooms(
  p_date date, p_start_min int, p_minutes int, p_people int default 1, p_keyword text default ''
) returns table (room_id int, name text, instruments text, capacity int, is_hall boolean, is_public boolean, total int)
language plpgsql stable security invoker set search_path = public
as $$
declare
  s timestamptz := (p_date + make_interval(mins => p_start_min)) at time zone 'Asia/Tokyo';
  e timestamptz := (p_date + make_interval(mins => p_start_min + p_minutes)) at time zone 'Asia/Tokyo';
begin
  if not is_admin() then raise exception '管理者だけが使えます'; end if;
  if p_minutes <= 0 or p_start_min % 15 <> 0 or p_minutes % 15 <> 0 or p_start_min + p_minutes > 1440 then
    raise exception '開始と利用時間を確認してください';
  end if;
  return query
    select r.id, r.name, r.instruments, r.capacity, r.is_hall, r.is_public,
           (select q.total from quote_price('rental', r.id, s, e, greatest(1, p_people), '{}', 0, null) q)
      from rooms r
     where (r.capacity is null or r.capacity >= coalesce(p_people, 1))
       and (coalesce(p_keyword, '') = ''
            or (p_keyword = 'ホール' and r.is_hall)
            or (p_keyword <> 'ホール' and coalesce(r.instruments, '') like '%' || p_keyword || '%'))
       and not exists (select 1 from reservations x
                        where x.room_id = r.id and x.status <> 'cancelled' and x.deleted_at is null
                          and tstzrange(x.start_at, x.end_at, '[)') && tstzrange(s, e, '[)'))
       and not exists (select 1 from closures c
                        where (c.room_id is null or c.room_id = r.id)
                          and tstzrange(c.start_at, c.end_at, '[)') && tstzrange(s, e, '[)'))
     order by r.sort_order, r.id;
end;
$$;
revoke all on function public.search_free_rooms(date, int, int, int, text) from public;
grant execute on function public.search_free_rooms(date, int, int, int, text) to authenticated;
