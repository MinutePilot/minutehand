-- Reviews: collect customer testimonials gated by real usage.
-- All reviews default to approved = false; flip to true manually to publish.

create table reviews (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        references auth.users(id)    on delete set null,
  org_id       uuid        references organizations(id) on delete set null,
  rating       integer     not null check (rating between 1 and 5),
  review_text  text,
  display_name text,        -- how the reviewer wants to be identified publicly (optional)
  approved     boolean     not null default false,
  created_at   timestamptz not null default now()
);

alter table reviews enable row level security;

-- Authenticated users may insert one review at a time for themselves
create policy "Users can insert own reviews"
  on reviews for insert
  to authenticated
  with check (user_id = auth.uid());

-- Anyone (anon + authenticated) may read approved reviews
create policy "Public read of approved reviews"
  on reviews for select
  to anon, authenticated
  using (approved = true);

-- Index to make the homepage fetch fast
create index reviews_approved_created_at on reviews (approved, created_at desc)
  where approved = true;
