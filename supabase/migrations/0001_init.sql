-- Memo 云端数据表。与 packages/core/src/model.ts、events.ts 以及 App 本地的 SQLite 表一一对应。
-- 在 Supabase 后台的 SQL Editor 里整段执行一次即可。
--
-- 约定：
--   * 主键是客户端生成的 UUIDv7（text），离线也能建数据。
--   * 业务时间是 Unix 毫秒（bigint），与客户端一致。
--   * 每行带 user_id，并用行级权限（RLS）保证只能读写自己的数据。
--   * review_logs、events 只增不改：没有 update / delete 策略。
--   * 删除都是软删除（deleted_at），这样删除也能同步到其他设备。
--
-- 同步（见 apps/mobile/src/sync）：
--   * 上传：客户端按行 upsert。可修改的表按 updated_at「后写的赢」，由触发器在服务器端把关。
--   * 拉取：每行有服务器时间 server_updated_at，客户端按它增量拉取。
--   * 实时：表加入 supabase_realtime，有变动时通知其他设备来拉取。
--   * 表之间不设外键：各设备上传顺序不定，外键会让同步卡住；引用关系由客户端维护。

create table public.folders (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id text,
  name text not null,
  sort_key text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table public.cards (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id text not null,
  version integer not null default 1,
  suspended boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table public.card_links (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id text not null,
  folder_id text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table public.blocks (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id text not null,
  type text not null check (type in ('text', 'math', 'code', 'image', 'ink', 'audio')),
  content text not null,
  sort_key text not null,
  updated_at bigint not null,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table public.memories (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id text not null,
  masks jsonb not null default '[]',
  phase text not null default 'new' check (phase in ('new', 'learning', 'review', 'relearning')),
  difficulty double precision not null default 0,
  stability double precision not null default 0,
  due bigint,
  last_review bigint,
  reps integer not null default 0,
  lapses integer not null default 0,
  learning_steps integer not null default 0,
  scheduled_days integer not null default 0,
  introduced_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table public.review_logs (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  memory_id text not null,
  card_id text not null,
  card_version integer not null,
  reviewed_at bigint not null,
  timezone text not null,
  device text not null,
  grade smallint not null check (grade between 1 and 4),
  slider_mode text not null,
  slider_value double precision not null,
  slider_trace jsonb not null default '[]',
  think_ms integer not null,
  rate_ms integer not null,
  state_before jsonb not null,
  state_after jsonb not null,
  retrievability_before double precision,
  elapsed_days double precision,
  scheduled_days integer not null,
  algorithm_version text not null,
  weights_version text not null,
  mode text not null,
  scope_folder_id text,
  pick_kind text not null,
  entry text not null,
  offline boolean not null,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table public.events (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null,
  at bigint not null,
  device text not null,
  payload jsonb not null default '{}',
  server_updated_at timestamptz not null default clock_timestamp()
);

create index on public.folders (user_id, server_updated_at);
create index on public.cards (user_id, server_updated_at);
create index on public.card_links (user_id, server_updated_at);
create index on public.blocks (user_id, server_updated_at);
create index on public.memories (user_id, server_updated_at);
create index on public.review_logs (user_id, server_updated_at);
create index on public.events (user_id, server_updated_at);
create index on public.review_logs (user_id, memory_id, reviewed_at);

-- 「后写的赢」：上传的版本比服务器上的旧，就保留服务器上的。
-- 触发器按名字顺序执行，a_ 在 b_ 之前：被拒绝的上传仍会刷新 server_updated_at，
-- 这样上传方下次拉取时会拿到服务器上更新的那个版本，两边重新一致。
create function public.keep_newer() returns trigger language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end $$;

create function public.stamp_server_time() returns trigger language plpgsql as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['folders', 'cards', 'card_links', 'blocks', 'memories'] loop
    execute format('create trigger a_keep_newer before update on public.%I for each row execute function public.keep_newer()', t);
  end loop;
  foreach t in array array['folders', 'cards', 'card_links', 'blocks', 'memories', 'review_logs', 'events'] loop
    execute format('create trigger b_stamp_server_time before insert or update on public.%I for each row execute function public.stamp_server_time()', t);
  end loop;
end $$;

-- 行级权限
alter table public.folders enable row level security;
alter table public.cards enable row level security;
alter table public.card_links enable row level security;
alter table public.blocks enable row level security;
alter table public.memories enable row level security;
alter table public.review_logs enable row level security;
alter table public.events enable row level security;

create policy "own folders" on public.folders for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own cards" on public.cards for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own card links" on public.card_links for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own blocks" on public.blocks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own memories" on public.memories for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 只增不改：只允许读取和插入。
create policy "read own review logs" on public.review_logs for select using (user_id = auth.uid());
create policy "append own review logs" on public.review_logs for insert with check (user_id = auth.uid());
create policy "read own events" on public.events for select using (user_id = auth.uid());
create policy "append own events" on public.events for insert with check (user_id = auth.uid());

-- 实时通知：有变动时告诉其他设备来拉取（按 RLS 只会收到自己的数据）。
alter publication supabase_realtime add table
  public.folders, public.cards, public.card_links, public.blocks,
  public.memories, public.review_logs, public.events;
