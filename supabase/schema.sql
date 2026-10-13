-- =====================================================================
-- 디데이 앱 데이터베이스 설정
-- Supabase 대시보드 > SQL Editor > New query 에 전체를 붙여넣고 Run.
--
-- ★ 실행 전에 맨 아래 "관리자 등록" 줄의 이메일을
--   내가 로그인할 구글 계정 이메일로 바꿔 주세요.
-- =====================================================================

-- ---------- 테이블 ----------

-- 초대 목록: 여기 있는 이메일의 구글 계정만 앱을 쓸 수 있어요.
create table if not exists public.members (
  email      text primary key check (email = lower(email)),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- 로그인한 사람의 이름/이메일 (공유 대상 고를 때 표시용)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  name       text,
  updated_at timestamptz not null default now()
);

-- 디데이
create table if not exists public.ddays (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 30),
  date       date not null,
  mode       text not null default 'dday' check (mode in ('dday','count')),
  repeat     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- 디데이별 공유 대상 (만든 사람은 여기 없이 owner로 구분)
create table if not exists public.dday_shares (
  dday_id uuid not null references public.ddays(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (dday_id, user_id)
);
create index if not exists dday_shares_user_idx on public.dday_shares(user_id);

-- 사람마다 따로 저장하는 설정 (테마, 정렬, 고정, 그룹, 마지막 화면)
create table if not exists public.user_prefs (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- 권한 확인 함수 ----------

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.email = lower(coalesce(auth.jwt() ->> 'email', '')) and m.is_admin
  );
$$;

-- 앱이 로그인 직후 내 권한을 묻는 함수: 'admin' | 'member' | null
create or replace function public.my_access() returns text
language sql stable security definer set search_path = '' as $$
  select case when m.is_admin then 'admin' else 'member' end
  from public.members m
  where m.email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.can_see_dday(d uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_member() and (
    exists (select 1 from public.ddays x where x.id = d and x.owner = auth.uid())
    or exists (select 1 from public.dday_shares s where s.dday_id = d and s.user_id = auth.uid())
  );
$$;

create or replace function public.owns_dday(d uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_member() and exists (
    select 1 from public.ddays x where x.id = d and x.owner = auth.uid()
  );
$$;

-- 공유 대상이 초대된 사람인지 확인
create or replace function public.is_member_user(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join public.members m on m.email = lower(p.email)
    where p.id = u
  );
$$;

-- ---------- 디데이 수정 시 자동 처리 ----------
-- 공유받은 사람이 날짜를 고쳐도 만든 사람(owner)은 바뀌지 않게 고정
create or replace function public.ddays_before_write() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.owner      := old.owner;
    new.created_at := old.created_at;
  else
    new.owner      := auth.uid();
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists ddays_before_write on public.ddays;
create trigger ddays_before_write before insert or update on public.ddays
  for each row execute function public.ddays_before_write();

-- ---------- 접근 규칙 (RLS) ----------

alter table public.members     enable row level security;
alter table public.profiles    enable row level security;
alter table public.ddays       enable row level security;
alter table public.dday_shares enable row level security;
alter table public.user_prefs  enable row level security;

-- members: 초대된 사람은 목록 보기, 관리자만 초대/삭제
drop policy if exists members_select on public.members;
drop policy if exists members_insert on public.members;
drop policy if exists members_update on public.members;
drop policy if exists members_delete on public.members;
create policy members_select on public.members for select to authenticated using (public.is_member());
create policy members_insert on public.members for insert to authenticated with check (public.is_admin());
create policy members_update on public.members for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy members_delete on public.members for delete to authenticated using (public.is_admin());

-- profiles: 초대된 사람끼리 이름 보기, 내 것만 저장
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (public.is_member());
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid() and public.is_member());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ddays: 만든 사람 + 공유받은 사람만 보기/수정, 삭제는 만든 사람만
drop policy if exists ddays_select on public.ddays;
drop policy if exists ddays_insert on public.ddays;
drop policy if exists ddays_update on public.ddays;
drop policy if exists ddays_delete on public.ddays;
create policy ddays_select on public.ddays for select to authenticated
  using ((owner = auth.uid() and public.is_member()) or public.can_see_dday(id));
create policy ddays_insert on public.ddays for insert to authenticated with check (public.is_member());
create policy ddays_update on public.ddays for update to authenticated using (public.can_see_dday(id)) with check (public.can_see_dday(id));
create policy ddays_delete on public.ddays for delete to authenticated using (owner = auth.uid() and public.is_member());

-- dday_shares: 그 디데이를 볼 수 있는 사람만 공유 목록 보기
--              공유 추가/해제는 만든 사람만, 공유받은 사람은 '내 목록에서 빼기'만
drop policy if exists shares_select on public.dday_shares;
drop policy if exists shares_insert on public.dday_shares;
drop policy if exists shares_delete on public.dday_shares;
create policy shares_select on public.dday_shares for select to authenticated using (public.can_see_dday(dday_id));
create policy shares_insert on public.dday_shares for insert to authenticated
  with check (public.owns_dday(dday_id) and user_id <> auth.uid() and public.is_member_user(user_id));
create policy shares_delete on public.dday_shares for delete to authenticated
  using (public.owns_dday(dday_id) or user_id = auth.uid());

-- user_prefs: 내 설정은 나만
drop policy if exists prefs_all on public.user_prefs;
create policy prefs_all on public.user_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 실시간 반영 ----------
do $$
begin
  begin alter publication supabase_realtime add table public.ddays;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.dday_shares; exception when duplicate_object then null; end;
end $$;

-- ---------- 관리자 등록 (★ 이메일 바꾸기) ----------
insert into public.members (email, is_admin)
values (lower('내-구글-이메일@gmail.com'), true)
on conflict (email) do update set is_admin = true;
