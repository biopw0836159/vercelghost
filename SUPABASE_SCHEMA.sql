-- 在「新的」Supabase 專案 SQL editor 跑一次，建立自有登入用的帳號表。
-- service role key 走後端（route handler）、繞過 RLS；此表不開放前端 anon 直連。

create table if not exists admin_users (
  username      text primary key,
  password_hash text not null,
  must_change   boolean not null default true,
  last_login_at timestamptz,
  last_login_ip text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 開啟 RLS 且不加任何 policy → anon/authenticated 一律讀不到（只有 service role 能存取）。
alter table admin_users enable row level security;
