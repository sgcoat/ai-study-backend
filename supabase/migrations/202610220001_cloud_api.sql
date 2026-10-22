-- AI Study: service-only database. The mobile app never calls this RPC directly.
-- Apply to the NEW ai-study-backend project only. No local SQLite data is changed.
begin;

create schema if not exists study;
revoke all on schema study from public, anon, authenticated;

create table study.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique, created_at timestamptz not null
);
create table study.sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references study.profiles(id) on delete cascade,
  expires_at timestamptz not null
);
create index on study.sessions(user_id);
create table study.materials (
  id uuid primary key, owner_id uuid not null references study.profiles(id) on delete cascade,
  subject text not null, title text not null, content text not null, is_public boolean not null default false,
  revision integer not null default 1 check (revision > 0), created_at timestamptz not null default now()
);
create index on study.materials(owner_id, created_at desc, id);
create table study.images (
  id uuid primary key, material_id uuid not null references study.materials(id) on delete cascade,
  owner_id uuid not null references study.profiles(id) on delete cascade,
  object_path text not null unique, mime text not null, bytes integer not null,
  ordinal integer not null
);
create index on study.images(material_id, ordinal, id);
create table study.summaries (
  id uuid primary key, material_id uuid not null unique references study.materials(id) on delete cascade,
  owner_id uuid not null references study.profiles(id) on delete cascade, payload jsonb not null
);
create table study.question_sets (
  id uuid primary key, material_id uuid not null references study.materials(id) on delete cascade,
  owner_id uuid not null references study.profiles(id) on delete cascade,
  fingerprint text not null unique, payload jsonb not null, created_at timestamptz not null default now()
);
create table study.questions (
  id uuid primary key, set_id uuid not null references study.question_sets(id) on delete cascade,
  material_id uuid not null references study.materials(id) on delete cascade,
  owner_id uuid not null references study.profiles(id) on delete cascade,
  payload jsonb not null
);
create index on study.questions(material_id);
create table study.jobs (
  id uuid primary key, user_id uuid not null references study.profiles(id) on delete cascade,
  material_id uuid not null references study.materials(id) on delete cascade,
  kind text not null check (kind in ('SUMMARY','QUESTIONS')), fingerprint text not null,
  config jsonb not null, status text not null check (status in ('QUEUED','PROCESSING','COMPLETED','FAILED')),
  result jsonb, error jsonb, lease uuid, deadline timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index on study.jobs(fingerprint) where status in ('QUEUED','PROCESSING');
create unique index on study.jobs(fingerprint) where status = 'COMPLETED';
create index on study.jobs(user_id, created_at desc);
create table study.idempotency (
  user_id uuid not null references study.profiles(id) on delete cascade, operation text not null,
  request_key text not null, fingerprint text not null, resource_id uuid not null,
  primary key(user_id, operation, request_key)
);
create table study.attempts (
  id uuid primary key, user_id uuid not null references study.profiles(id) on delete cascade,
  question_id uuid not null references study.questions(id) on delete cascade,
  request_key text not null, fingerprint text not null,
  status text not null check (status in ('PROCESSING','COMPLETED','FAILED')),
  lease uuid, deadline timestamptz, result jsonb, solved_time timestamptz,
  unique(user_id, request_key)
);
create index on study.attempts(user_id, solved_time desc);
create table study.rate_counters (
  bucket text primary key, total integer not null, expires_at timestamptz not null
);
create table study.login_challenges (
  email_hash text primary key, expires_at timestamptz not null,
  resend_at timestamptz not null, attempts integer not null default 0
);
create table study.deletion_challenges (
  user_id uuid primary key references study.profiles(id) on delete cascade,
  id uuid not null, expires_at timestamptz not null, resend_at timestamptz not null,
  attempts integer not null default 0
);
-- Reservations are created BEFORE upload. An interrupted upload remains eligible for cleanup.
create table study.upload_reservations (
  id uuid primary key, owner_id uuid not null references study.profiles(id) on delete cascade,
  object_path text not null unique, mime text not null, bytes integer not null,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
-- No FK to a user: cleanup survives account/material deletion.
create table study.file_deletions (
  object_path text primary key, not_before timestamptz not null default now()
);

create function study.fail(status integer, code text, message text) returns void
language plpgsql set search_path = '' as $$ begin
  raise exception using errcode = 'P0001', message = jsonb_build_object('status',status,'code',code,'message',message)::text;
end $$;

create function study.rate(p_bucket text, maximum integer, seconds integer) returns void
language plpgsql set search_path = '' as $$
declare n integer;
begin
  insert into study.rate_counters as c values (p_bucket, 1, now() + make_interval(secs => seconds))
  on conflict (bucket) do update set total = case when c.expires_at <= now() then 1 else c.total+1 end,
    expires_at = case when c.expires_at <= now() then excluded.expires_at else c.expires_at end
  returning total into n;
  if n > maximum then perform study.fail(429,'RATE_LIMIT','요청이 많습니다. 잠시 후 다시 시도해 주세요.'); end if;
end $$;

create function study.raw_material(m study.materials) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',m.id,'authorId',m.owner_id,'subject',m.subject,'title',m.title,
    'content',m.content,'isPublic',m.is_public,'revision',m.revision,
    '_images',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'path',i.object_path,'mime',i.mime,'bytes',i.bytes)
      order by i.ordinal,i.id) from study.images i where i.material_id=m.id),'[]'::jsonb))
$$;
create function study.job_view(j study.jobs) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('jobId',j.id,'status',j.status,'pollAfterMs',3000,
    'createdAt',j.created_at,'updatedAt',j.updated_at,'result',j.result,'error',j.error))
$$;
create function study.accepted(j study.jobs) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('jobId',j.id,'status',case when j.status='PROCESSING' then 'PROCESSING' else 'QUEUED' end,'pollAfterMs',3000)
$$;
create function study.expire_work(owner uuid) returns void
language plpgsql set search_path = '' as $$ begin
  update study.jobs set status='FAILED',lease=null,
    error='{"code":"AI_INTERRUPTED","message":"서버 작업이 중단되었습니다. 저장된 결과를 확인한 뒤 다시 생성해 주세요."}',updated_at=now()
    where user_id=owner and status='PROCESSING' and deadline<now();
  update study.attempts set status='FAILED',lease=null where user_id=owner and status='PROCESSING' and deadline<now();
end $$;
create function study.assert_idle(material uuid) returns void
language plpgsql set search_path = '' as $$ begin
  if exists(select 1 from study.jobs where material_id=material and status in ('QUEUED','PROCESSING'))
    or exists(select 1 from study.attempts a join study.questions q on q.id=a.question_id
      where q.material_id=material and a.status='PROCESSING') then
    perform study.fail(409,'MATERIAL_BUSY','요약·문제 생성 또는 채점 중입니다. 완료 후 다시 시도해 주세요.');
  end if;
end $$;
create function study.reset_learning(material uuid) returns void
language plpgsql set search_path = '' as $$ begin
  delete from study.idempotency where operation in ('SUMMARY','QUESTIONS')
    and resource_id in (select id from study.jobs where material_id=material);
  delete from study.jobs where material_id=material;
  delete from study.question_sets where material_id=material;
  delete from study.summaries where material_id=material;
end $$;
create function study.queue_deleted_file() returns trigger
language plpgsql set search_path = '' as $$ begin
  insert into study.file_deletions values(old.object_path,now())
    on conflict(object_path) do update set not_before=least(study.file_deletions.not_before,excluded.not_before);
  return old;
end $$;
create trigger image_delete before delete on study.images for each row execute function study.queue_deleted_file();
create trigger reservation_delete before delete on study.upload_reservations for each row execute function study.queue_deleted_file();
create function study.lock_deleted_profile() returns trigger
language plpgsql set search_path = '' as $$ begin
  perform pg_advisory_xact_lock(hashtextextended(old.id::text,0)); return old;
end $$;
create trigger profile_delete before delete on study.profiles for each row execute function study.lock_deleted_profile();

-- A closed list of operations, accessible only with the server's injected service key.
-- No dynamic SQL and no client-controlled table/schema names.
create function public.ai_study_rpc(op text, owner_id uuid default null, args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
  m study.materials; j study.jobs; a study.attempts; idem study.idempotency;
  u study.profiles; c study.login_challenges; d study.deletion_challenges;
  q study.questions; r study.upload_reservations; v jsonb; x jsonb;
  mid uuid; rid uuid; key text; fp text; page integer; size integer; total integer;
  changed boolean; keep uuid[]; answer text; model text;
begin
  if op='health' then return jsonb_build_object('schemaVersion',1); end if;
  if op='rate' then
    perform study.rate(args->>'bucket',(args->>'maximum')::integer,(args->>'seconds')::integer); return '{}';
  end if;
  if op='login_reserve' then
    perform pg_advisory_xact_lock(hashtextextended(args->>'emailHash',0));
    select * into c from study.login_challenges where email_hash=args->>'emailHash';
    if found and c.resend_at>now() then perform study.fail(429,'CODE_COOLDOWN','인증 코드는 60초 후 다시 요청할 수 있습니다.'); end if;
    perform study.rate('email-day:'||(args->>'emailHash')||':'||to_char(now() at time zone 'UTC','YYYY-MM-DD'),10,86400);
    perform study.rate('email-hour:'||to_char(now() at time zone 'UTC','YYYY-MM-DD-HH24'),100,3600);
    perform study.rate('email-day:'||to_char(now() at time zone 'UTC','YYYY-MM-DD'),500,86400);
    insert into study.login_challenges values(args->>'emailHash',now()+interval '5 minutes',now()+interval '60 seconds',0)
      on conflict(email_hash) do update set expires_at=excluded.expires_at,resend_at=excluded.resend_at,attempts=0;
    return '{}';
  end if;
  if op='login_release' then delete from study.login_challenges where email_hash=args->>'emailHash'; return '{}'; end if;
  if op='login_check' then
    update study.login_challenges set attempts=attempts+1
      where email_hash=args->>'emailHash' and expires_at>now() and attempts<5 returning * into c;
    return jsonb_build_object('allowed',found);
  end if;
  if op='session_create' then
    insert into study.profiles select id,email,created_at from auth.users
      where id=owner_id and email_confirmed_at is not null
      on conflict(id) do update set email=excluded.email returning * into u;
    if not found then perform study.fail(401,'UNAUTHENTICATED','이메일 인증을 완료해 주세요.'); end if;
    insert into study.sessions values(args->>'tokenHash',owner_id,now()+interval '7 days');
    delete from study.login_challenges where email_hash=args->>'emailHash';
    return jsonb_build_object('id',u.id,'email',u.email,'createdAt',u.created_at);
  end if;
  if op='session_get' then
    select p.* into u from study.profiles p join study.sessions s on s.user_id=p.id
      where s.token_hash=args->>'tokenHash' and s.expires_at>now();
    if not found then perform study.fail(401,'SESSION_EXPIRED','로그인이 만료되었습니다. 다시 로그인해 주세요.'); end if;
    return jsonb_build_object('id',u.id,'email',u.email,'createdAt',u.created_at);
  end if;
  if op='session_delete' then delete from study.sessions where token_hash=args->>'tokenHash'; return '{}'; end if;
  if op='gc_list' then
    -- Never remove reservations that can still be committed.
    delete from study.upload_reservations where expires_at<now();
    delete from study.sessions where expires_at<now();
    delete from study.rate_counters where expires_at<now();
    delete from study.login_challenges where expires_at<now();
    return coalesce((select jsonb_agg(object_path) from
      (select object_path from study.file_deletions where not_before<=now() order by not_before limit 30) s),'[]');
  end if;
  if op='gc_ack' then
    delete from study.file_deletions where object_path in (select jsonb_array_elements_text(args->'paths')) and not_before<=now();
    return '{}';
  end if;

  if owner_id is null or not exists(select 1 from study.profiles p where p.id=owner_id) then
    perform study.fail(401,'SESSION_EXPIRED','로그인이 만료되었습니다. 다시 로그인해 주세요.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
  perform study.expire_work(owner_id);

  if op='delete_reserve' then
    select * into d from study.deletion_challenges dc where dc.user_id=owner_id;
    if found and d.resend_at>now() then perform study.fail(429,'CODE_COOLDOWN','인증 코드는 60초 후 다시 요청할 수 있습니다.'); end if;
    perform study.rate('delete-day:'||owner_id::text||':'||to_char(now() at time zone 'UTC','YYYY-MM-DD'),10,86400);
    insert into study.deletion_challenges values(owner_id,gen_random_uuid(),now()+interval '5 minutes',now()+interval '60 seconds',0)
      on conflict(user_id) do update set id=excluded.id,expires_at=excluded.expires_at,resend_at=excluded.resend_at,attempts=0;
    return '{}';
  end if;
  if op='delete_release' then delete from study.deletion_challenges dc where dc.user_id=owner_id; return '{}'; end if;
  if op='delete_check' then
    update study.deletion_challenges dc set attempts=attempts+1 where dc.user_id=owner_id and expires_at>now() and attempts<5 returning * into d;
    return jsonb_build_object('allowed',found,'challengeId',d.id);
  end if;
  if op='delete_authorize' then
    select * into d from study.deletion_challenges dc where dc.user_id=owner_id and id=(args->>'challengeId')::uuid and expires_at>now();
    if not found then perform study.fail(422,'INVALID_DELETION_CODE','계정 삭제 인증 코드가 올바르지 않거나 만료되었습니다.'); end if;
    delete from study.deletion_challenges dc where dc.user_id=owner_id; return '{}';
  end if;

  if op='upload_reserve' then
    for x in select * from jsonb_array_elements(args->'images') loop
      insert into study.upload_reservations(id,owner_id,object_path,mime,bytes)
        values((x->>'id')::uuid,owner_id,x->>'path',x->>'mime',(x->>'bytes')::integer);
      insert into study.file_deletions values(x->>'path',now()+interval '10 minutes');
    end loop;
    return '{}';
  end if;
  if op='upload_abandon' then
    delete from study.upload_reservations ur where ur.owner_id=owner_id and id in (select jsonb_array_elements_text(args->'ids')::uuid);
    return '{}';
  end if;

  if op='materials_list' then
    page=(args->>'page')::integer; size=(args->>'pageSize')::integer;
    select count(*) into total from study.materials t where t.owner_id=owner_id
      and (coalesce(args->>'subject','')='' or t.subject=args->>'subject')
      and (coalesce(args->>'query','')='' or position(lower(args->>'query') in lower(t.title||' '||t.subject||' '||t.content))>0);
    return jsonb_build_object('items',coalesce((select jsonb_agg(study.raw_material(s::study.materials) order by s.created_at desc,s.id)
      from (select t.* from study.materials t where t.owner_id=owner_id
        and (coalesce(args->>'subject','')='' or t.subject=args->>'subject')
        and (coalesce(args->>'query','')='' or position(lower(args->>'query') in lower(t.title||' '||t.subject||' '||t.content))>0)
        order by t.created_at desc,t.id limit size offset (page-1)*size) s),'[]'),
      'pageInfo',jsonb_build_object('page',page,'pageSize',size,'totalItems',total,'totalPages',ceil(total::numeric/size)),
      'subjects',coalesce((select jsonb_agg(subject order by subject) from (select distinct t.subject from study.materials t where t.owner_id=owner_id) s),'[]'));
  end if;
  if op in ('material_registration','material_replay','material_create') then
    key=args->>'key'; fp=args->>'fingerprint';
    if key is not null then
      select * into idem from study.idempotency i where i.user_id=owner_id and operation='MATERIAL_CREATE' and request_key=key;
      if found then
        if op<>'material_registration' and idem.fingerprint<>fp then perform study.fail(409,'IDEMPOTENCY_CONFLICT','같은 요청 키로 다른 자료를 저장할 수 없습니다.'); end if;
        select * into m from study.materials t where t.id=idem.resource_id and t.owner_id=owner_id;
        if not found then perform study.fail(410,'MATERIAL_ALREADY_DELETED','이미 삭제된 자료입니다. 새 자료로 다시 작성해 주세요.'); end if;
        return study.raw_material(m);
      end if;
    end if;
    if op='material_registration' then perform study.fail(404,'MATERIAL_REGISTRATION_NOT_FOUND','아직 등록된 자료를 확인하지 못했습니다.'); end if;
    if op='material_replay' then return 'null'; end if;
    mid=(args->>'id')::uuid;
    insert into study.materials(id,owner_id,subject,title,content,is_public)
      values(mid,owner_id,args->>'subject',args->>'title',args->>'content',(args->>'isPublic')::boolean) returning * into m;
    if key is not null then insert into study.idempotency values(owner_id,'MATERIAL_CREATE',key,fp,mid); end if;
    keep='{}';
  elsif op in ('material_get','material_update','material_delete','summary_snapshot','questions_snapshot','job_start') then
    mid=(args->>'materialId')::uuid;
    select * into m from study.materials t where t.id=mid and t.owner_id=owner_id;
    if not found then perform study.fail(404,'MATERIAL_NOT_FOUND','자료를 찾을 수 없습니다.'); end if;
  end if;
  if op='material_get' then return study.raw_material(m); end if;
  if op in ('material_update','material_delete') then
    if m.revision<>(args->>'expectedRevision')::integer then perform study.fail(409,'MATERIAL_CONFLICT','다른 화면에서 자료가 변경되었습니다. 최신 자료를 불러와 주세요.'); end if;
    perform study.assert_idle(mid);
    if op='material_delete' then delete from study.materials where id=mid; return '{}'; end if;
    select coalesce(array_agg(value::uuid),'{}') into keep from jsonb_array_elements_text(args->'retainedImageIds');
    if exists(select 1 from unnest(keep) as retained(id) where not exists(select 1 from study.images i where i.id=retained.id and i.material_id=mid)) then
      perform study.fail(422,'INVALID_IMAGE_REFERENCE','유지할 사진 목록을 확인해 주세요.');
    end if;
    changed=m.title<>args->>'title' or m.subject<>args->>'subject' or m.content<>args->>'content'
      or (select count(*) from study.images where material_id=mid)<>cardinality(keep) or jsonb_array_length(args->'images')>0;
    if changed and not coalesce((args->>'resetStudyData')::boolean,false) then
      perform study.fail(409,'STUDY_DATA_RESET_REQUIRED','자료를 수정하려면 기존 요약·문제·학습 기록 초기화에 동의해 주세요.');
    end if;
    if changed then perform study.reset_learning(mid); end if;
    delete from study.images where material_id=mid and not(id=any(keep));
    update study.materials set title=args->>'title',subject=args->>'subject',content=args->>'content',
      is_public=(args->>'isPublic')::boolean,revision=revision+1 where id=mid returning * into m;
  end if;
  if op in ('material_create','material_update') then
    for x in select * from jsonb_array_elements(args->'images') loop
      select * into r from study.upload_reservations ur where ur.id=(x->>'id')::uuid and ur.owner_id=owner_id and expires_at>now();
      if not found then perform study.fail(409,'UPLOAD_EXPIRED','사진 업로드 시간이 초과되었습니다. 다시 저장해 주세요.'); end if;
      insert into study.images values(r.id,mid,owner_id,r.object_path,r.mime,r.bytes,
        coalesce((select max(ordinal)+1 from study.images where material_id=mid),0));
      -- The DELETE trigger queues the file; remove that reservation entry only AFTER attachment.
      delete from study.upload_reservations where id=r.id;
      delete from study.file_deletions where object_path=r.object_path;
    end loop;
    return study.raw_material(m);
  end if;
  if op='summary_snapshot' then
    select * into j from study.jobs where user_id=owner_id and material_id=mid and kind='SUMMARY' and status in ('QUEUED','PROCESSING') order by created_at limit 1;
    return jsonb_build_object('items',coalesce((select jsonb_agg(payload) from study.summaries where material_id=mid),'[]'),
      'activeJob',case when j.id is null then null else study.accepted(j) end);
  end if;
  if op='questions_snapshot' then
    return jsonb_build_object('items',coalesce((select jsonb_agg(payload order by created_at,id) from study.question_sets where material_id=mid),'[]'),
      'activeJobs',coalesce((select jsonb_agg(study.accepted(t)||jsonb_build_object('config',t.config) order by t.created_at)
        from study.jobs t where t.user_id=owner_id and t.material_id=mid and kind='QUESTIONS' and status in ('QUEUED','PROCESSING')),'[]'));
  end if;
  if op='job_start' then
    key=args->>'key'; fp=args->>'fingerprint';
    select * into idem from study.idempotency i where i.user_id=owner_id and i.operation=args->>'kind' and i.request_key=key;
    if found then
      if idem.fingerprint<>fp then perform study.fail(409,'IDEMPOTENCY_CONFLICT','같은 요청 키로 다른 작업을 요청할 수 없습니다.'); end if;
      select * into j from study.jobs where id=idem.resource_id; return study.accepted(j);
    end if;
    if args->>'kind'='QUESTIONS' and not exists(select 1 from study.summaries where material_id=mid and id=(args->'config'->>'summaryId')::uuid) then
      perform study.fail(422,'SUMMARY_REQUIRED','저장된 요약을 먼저 선택해 주세요.');
    end if;
    select * into j from study.jobs where fingerprint=fp and status in ('QUEUED','PROCESSING','COMPLETED') order by created_at desc limit 1;
    if not found then
      if (select count(*) from study.jobs where user_id=owner_id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=30 then
        perform study.fail(429,'DAILY_GENERATION_LIMIT','오늘의 생성 한도에 도달했습니다. 내일 다시 이용해 주세요.');
      end if;
      if (select count(*) from study.jobs where user_id=owner_id and status in ('QUEUED','PROCESSING'))>=3 then
        perform study.fail(429,'TOO_MANY_JOBS','진행 중인 작업이 많습니다. 완료 후 다시 요청해 주세요.');
      end if;
      insert into study.jobs(id,user_id,material_id,kind,fingerprint,config,status)
        values(gen_random_uuid(),owner_id,mid,args->>'kind',fp,args->'config','QUEUED') returning * into j;
    end if;
    insert into study.idempotency values(owner_id,args->>'kind',key,fp,j.id);
    return study.accepted(j);
  end if;
  if op in ('job_get','job_claim','job_finish','job_fail') then
    select * into j from study.jobs t where t.id=(args->>'jobId')::uuid and t.user_id=owner_id;
    if not found then
      if op='job_get' then perform study.fail(404,'JOB_NOT_FOUND','작업을 찾을 수 없습니다.'); end if;
      return 'null';
    end if;
    if op='job_get' then return study.job_view(j); end if;
    if op='job_claim' then
      if j.status<>'QUEUED' then return 'null'; end if;
      update study.jobs set status='PROCESSING',lease=gen_random_uuid(),deadline=now()+interval '135 seconds',updated_at=now() where id=j.id returning * into j;
      select * into m from study.materials where id=j.material_id;
      return jsonb_build_object('job',to_jsonb(j),'material',study.raw_material(m),'summary',(select payload from study.summaries where material_id=j.material_id));
    end if;
    if j.status<>'PROCESSING' or j.lease<>(args->>'lease')::uuid or j.deadline<now() then return 'null'; end if;
    if op='job_fail' then
      update study.jobs set status='FAILED',error=args->'error',lease=null,updated_at=now() where id=j.id; return '{}';
    end if;
    v=args->'result'; rid=(v->>'id')::uuid;
    if j.kind='SUMMARY' then
      insert into study.summaries values(rid,j.material_id,owner_id,v);
    else
      insert into study.question_sets values(rid,j.material_id,owner_id,j.fingerprint,v,now());
      for x in select * from jsonb_array_elements(args->'questions') loop
        insert into study.questions values((x->>'id')::uuid,rid,j.material_id,owner_id,x);
      end loop;
    end if;
    update study.jobs set status='COMPLETED',result=v,error=null,lease=null,updated_at=now() where id=j.id; return '{}';
  end if;
  if op='attempt_claim' then
    key=args->>'key'; fp=args->>'fingerprint';
    select * into a from study.attempts t where t.user_id=owner_id and t.request_key=key;
    if found then
      if a.fingerprint<>fp then perform study.fail(409,'IDEMPOTENCY_CONFLICT','같은 요청 키로 다른 답안을 제출할 수 없습니다.'); end if;
      if a.status='COMPLETED' then return jsonb_build_object('result',a.result); end if;
      if a.status='PROCESSING' then perform study.fail(409,'ATTEMPT_PROCESSING','답안을 채점 중입니다. 잠시 후 결과를 다시 확인해 주세요.'); end if;
    end if;
    select * into q from study.questions t where t.id=(args->>'questionId')::uuid and t.owner_id=owner_id;
    if not found then perform study.fail(404,'QUESTION_NOT_FOUND','문제를 찾을 수 없습니다.'); end if;
    answer=args->>'submittedAnswer';
    if q.payload->>'type'='OX' and answer not in ('O','X') then perform study.fail(422,'INVALID_ANSWER','O 또는 X를 선택해 주세요.'); end if;
    if q.payload->>'type'='MULTIPLE_CHOICE' and not exists(select 1 from jsonb_array_elements(q.payload->'choices') ch where ch->>'id'=answer) then
      perform study.fail(422,'INVALID_ANSWER','보기 중 하나를 선택해 주세요.');
    end if;
    if (select count(*) from study.attempts where user_id=owner_id and solved_time>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=500 then
      perform study.fail(429,'DAILY_ATTEMPT_LIMIT','오늘의 풀이 한도에 도달했습니다. 내일 다시 이용해 주세요.');
    end if;
    if a.id is null then
      insert into study.attempts(id,user_id,question_id,request_key,fingerprint,status,lease,deadline)
        values(gen_random_uuid(),owner_id,q.id,key,fp,'PROCESSING',gen_random_uuid(),now()+interval '35 seconds') returning * into a;
    else
      update study.attempts set status='PROCESSING',lease=gen_random_uuid(),deadline=now()+interval '35 seconds' where id=a.id returning * into a;
    end if;
    select payload->>'modelInfo' into model from study.question_sets where id=q.set_id;
    return jsonb_build_object('attemptId',a.id,'lease',a.lease,'question',q.payload,'modelInfo',model);
  end if;
  if op in ('attempt_finish','attempt_fail') then
    select * into a from study.attempts t where t.id=(args->>'attemptId')::uuid and t.user_id=owner_id;
    if not found or a.status<>'PROCESSING' or a.lease<>(args->>'lease')::uuid or a.deadline<now() then
      perform study.fail(409,'ATTEMPT_INTERRUPTED','채점이 중단되었거나 자료가 변경되었습니다. 다시 제출해 주세요.');
    end if;
    if op='attempt_fail' then update study.attempts set status='FAILED',lease=null where id=a.id; return '{}'; end if;
    select * into q from study.questions where id=a.question_id;
    v=jsonb_build_object('record',jsonb_build_object('id',a.id,'userId',owner_id,'questionId',q.id,
      'submittedAnswer',args->>'submittedAnswer','isCorrect',(args->>'isCorrect')::boolean,'solvedTime',now()),
      'correctAnswer',q.payload->>'answer','explanation',args->>'explanation');
    update study.attempts set status='COMPLETED',result=v,solved_time=now(),lease=null where id=a.id; return v;
  end if;
  if op='records_list' then
    page=(args->>'page')::integer; size=(args->>'pageSize')::integer;
    select count(*) into total from study.attempts where user_id=owner_id and status='COMPLETED';
    return jsonb_build_object('items',coalesce((select jsonb_agg(s.result->'record' order by s.solved_time desc,s.id)
      from (select * from study.attempts where user_id=owner_id and status='COMPLETED'
        order by solved_time desc,id limit size offset (page-1)*size) s),'[]'),
      'pageInfo',jsonb_build_object('page',page,'pageSize',size,'totalItems',total,'totalPages',ceil(total::numeric/size)));
  end if;
  perform study.fail(400,'INVALID_OPERATION','지원하지 않는 서버 작업입니다.'); return 'null';
end $$;

-- Defense in depth: no direct app/database access, even with a valid Supabase Auth JWT.
alter table study.profiles enable row level security;
alter table study.sessions enable row level security;
alter table study.materials enable row level security;
alter table study.images enable row level security;
alter table study.summaries enable row level security;
alter table study.question_sets enable row level security;
alter table study.questions enable row level security;
alter table study.jobs enable row level security;
alter table study.idempotency enable row level security;
alter table study.attempts enable row level security;
alter table study.rate_counters enable row level security;
alter table study.login_challenges enable row level security;
alter table study.deletion_challenges enable row level security;
alter table study.upload_reservations enable row level security;
alter table study.file_deletions enable row level security;
revoke all on all tables in schema study from public, anon, authenticated;
revoke all on all functions in schema study from public, anon, authenticated;
revoke all on function public.ai_study_rpc(text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.ai_study_rpc(text,uuid,jsonb) to service_role;
alter default privileges in schema study revoke all on tables from public, anon, authenticated;
alter default privileges in schema study revoke all on functions from public, anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('ai-study-materials','ai-study-materials',false,5242880,array['image/jpeg','image/png','image/webp']);
-- Deliberately no anon/authenticated Storage policies. Only the Edge service key can upload/sign.

commit;
