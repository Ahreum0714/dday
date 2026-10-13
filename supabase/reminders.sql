-- =====================================================================
-- 디데이 알림 (schema.sql 다음에 실행)
-- 알림은 사람마다 따로 저장돼요. 시간대는 한국(Asia/Seoul) 기준이에요.
-- =====================================================================

-- 알림 설정: 디데이 × 사람 × 종류
create table if not exists public.reminders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dday_id      uuid not null references public.ddays(id) on delete cascade,
  kind         text not null check (kind in ('day0','day1','day7','custom')),
  remind_time  time,                -- 당일/하루 전/일주일 전에 울릴 시각
  custom_at    timestamptz,         -- 직접 입력한 날짜와 시각
  next_at      timestamptz,         -- 다음에 울릴 때 (자동 계산)
  last_fire_at timestamptz,
  created_at   timestamptz not null default now(),
  check ((kind = 'custom' and custom_at is not null) or (kind <> 'custom' and remind_time is not null))
);
create index if not exists reminders_due_idx on public.reminders(next_at) where next_at is not null;
create index if not exists reminders_owner_idx on public.reminders(user_id, dday_id);

-- 알림 받을 기기
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- ---------- 다음 알림 시각 계산 ----------
create or replace function public.reminder_next_at(
  r_kind text, r_time time, r_custom timestamptz,
  d_date date, d_mode text, d_repeat boolean, after_ts timestamptz)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  offs int; y int; m int; dd int; target date; cand timestamptz;
begin
  if r_kind = 'custom' then
    return case when r_custom > after_ts then r_custom else null end;
  end if;
  offs := case r_kind when 'day0' then 0 when 'day1' then 1 when 'day7' then 7 end;
  if d_mode = 'dday' and d_repeat then
    m := extract(month from d_date)::int; dd := extract(day from d_date)::int;
    y := extract(year from (after_ts at time zone 'Asia/Seoul'))::int - 1;
    for i in 0..3 loop
      if m = 2 and dd = 29 and not ((y+i) % 4 = 0 and ((y+i) % 100 <> 0 or (y+i) % 400 = 0)) then
        target := make_date(y+i, 2, 28);
      else
        target := make_date(y+i, m, dd);
      end if;
      if target >= d_date then
        cand := ((target - offs) + r_time) at time zone 'Asia/Seoul';
        if cand > after_ts then return cand; end if;
      end if;
    end loop;
    return null;
  end if;
  cand := ((d_date - offs) + r_time) at time zone 'Asia/Seoul';
  return case when cand > after_ts then cand else null end;
end $$;

-- 알림을 저장할 때 다음 시각을 채움
create or replace function public.reminders_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  if tg_op = 'INSERT' then new.user_id := coalesce(auth.uid(), new.user_id); end if;
  select x.date, x.mode, x.repeat into d from public.ddays x where x.id = new.dday_id;
  new.next_at := public.reminder_next_at(new.kind, new.remind_time, new.custom_at, d.date, d.mode, d.repeat, now());
  return new;
end $$;
drop trigger if exists reminders_before_write on public.reminders;
create trigger reminders_before_write before insert or update of kind, remind_time, custom_at, dday_id on public.reminders
  for each row execute function public.reminders_before_write();

-- 디데이 날짜가 바뀌면 그 디데이의 모든 사람 알림을 다시 계산
create or replace function public.ddays_after_update_reminders() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.reminders r
     set next_at = public.reminder_next_at(r.kind, r.remind_time, r.custom_at, new.date, new.mode, new.repeat, now())
   where r.dday_id = new.id;
  return null;
end $$;
drop trigger if exists ddays_after_update_reminders on public.ddays;
create trigger ddays_after_update_reminders after update of date, mode, repeat on public.ddays
  for each row execute function public.ddays_after_update_reminders();

-- 공유가 끝나면 그 사람의 알림도 지움
create or replace function public.shares_after_delete_reminders() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.reminders r where r.dday_id = old.dday_id and r.user_id = old.user_id;
  return null;
end $$;
drop trigger if exists shares_after_delete_reminders on public.dday_shares;
create trigger shares_after_delete_reminders after delete on public.dday_shares
  for each row execute function public.shares_after_delete_reminders();

-- 같은 기기에서 다른 계정으로 로그인해도 기기 등록이 넘어가게
create or replace function public.register_push(p_endpoint text, p_p256dh text, p_auth text) returns void
language sql security definer set search_path = '' as $$
  insert into public.push_subscriptions(endpoint, user_id, p256dh, auth)
  select p_endpoint, auth.uid(), p_p256dh, p_auth where auth.uid() is not null and public.is_member()
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
$$;

-- 보낼 차례가 된 알림을 가져가고 다음 시각으로 넘김 (서버 전용)
create or replace function public.claim_due_reminders()
returns table(reminder_id uuid, user_id uuid, kind text, title text, dday_date date, mode text, repeat boolean, fire_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select r.id from public.reminders r
    where r.next_at is not null and r.next_at <= now()
    for update skip locked
  ), upd as (
    update public.reminders r
       set last_fire_at = r.next_at,
           next_at = public.reminder_next_at(r.kind, r.remind_time, r.custom_at, d.date, d.mode, d.repeat, r.next_at)
      from due, public.ddays d
     where r.id = due.id and d.id = r.dday_id
    returning r.id, r.user_id, r.kind, d.title, d.date, d.mode, d.repeat, r.last_fire_at
  )
  select u.id, u.user_id, u.kind, u.title, u.date, u.mode, u.repeat, u.last_fire_at
  from upd u where u.last_fire_at > now() - interval '6 hours';  -- 너무 늦은 알림은 건너뜀
end $$;

-- ---------- 접근 규칙 ----------
alter table public.reminders enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists reminders_select on public.reminders;
drop policy if exists reminders_insert on public.reminders;
drop policy if exists reminders_update on public.reminders;
drop policy if exists reminders_delete on public.reminders;
create policy reminders_select on public.reminders for select to authenticated using (user_id = auth.uid());
create policy reminders_insert on public.reminders for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_dday(dday_id));
create policy reminders_update on public.reminders for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_see_dday(dday_id));
create policy reminders_delete on public.reminders for delete to authenticated using (user_id = auth.uid());

drop policy if exists push_select on public.push_subscriptions;
drop policy if exists push_delete on public.push_subscriptions;
create policy push_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

revoke execute on function public.claim_due_reminders() from public, anon, authenticated;
revoke execute on function public.register_push(text, text, text) from public, anon;
grant execute on function public.register_push(text, text, text) to authenticated;

-- 트리거 함수는 직접 부를 수 없게
revoke execute on function public.reminders_before_write(), public.ddays_after_update_reminders(),
  public.shares_after_delete_reminders(), public.ddays_before_write() from public, anon, authenticated;

-- 알림 발송 설정(키 보관, 매분 예약 작업)은 비밀키가 들어 있어 저장소에 올리지 않았어요.
-- Supabase의 Vault에 dday_vapid_public / dday_vapid_private 이름으로 보관돼 있어요.
