-- Memo 初始数据表。与 packages/core/src/model.ts、events.ts 对应。
-- 约定：
--   * 主键是客户端生成的 UUIDv7（text），离线也能建数据；PowerSync 要求 id 列为 text。
--   * 时间是 Unix 毫秒（bigint），与客户端一致。
--   * 每行带 user_id，并用行级权限（RLS）保证只能读写自己的数据。
--   * review_logs、events 只增不改：没有 update / delete 策略。

create table public.folders (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id text references public.folders (id),
  name text not null,
  sort_key text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

create table public.cards (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id text not null references public.folders (id),
  version integer not null default 1,
  suspended boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

create table public.card_links (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id text not null references public.cards (id),
  folder_id text not null references public.folders (id),
  created_at bigint not null,
  unique (card_id, folder_id)
);

create table public.blocks (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id text not null references public.cards (id),
  type text not null check (type in ('text', 'math', 'code', 'image', 'ink', 'audio')),
  content text not null,
  sort_key text not null,
  updated_at bigint not null
);

create table public.memories (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id text not null references public.cards (id),
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
  created_at bigint not null
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
  offline boolean not null
);

create table public.events (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null,
  at bigint not null,
  device text not null,
  payload jsonb not null default '{}'
);

create index on public.folders (user_id, parent_id);
create index on public.cards (user_id, folder_id);
create index on public.blocks (card_id);
create index on public.memories (user_id, card_id);
create index on public.review_logs (user_id, memory_id, reviewed_at);
create index on public.events (user_id, at);

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

-- PowerSync 通过逻辑复制读取变更。
create publication powersync for table
  public.folders, public.cards, public.card_links, public.blocks,
  public.memories, public.review_logs, public.events;
