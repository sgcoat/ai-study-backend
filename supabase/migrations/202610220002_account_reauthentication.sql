-- Keep account deletion codes separate from login's shared magic-link/recovery token.
begin;
alter table study.deletion_challenges add column baseline_hash text;
alter table study.deletion_challenges add column nonce_hash text;
alter table study.deletion_challenges add column requested_at timestamptz not null default now();

-- Preserve the initial implementation privately and block its superseded deletion operations.
alter function public.ai_study_rpc(text,uuid,jsonb) set schema study;
alter function study.ai_study_rpc(text,uuid,jsonb) rename to core_rpc;
revoke all on function study.core_rpc(text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.ai_study_rpc(op text,owner_id uuid default null,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$ begin
  if op='health' then return jsonb_build_object('schemaVersion',2); end if;
  if left(op,7)='delete_' then perform study.fail(400,'INVALID_OPERATION','삭제 인증 전용 API를 이용해 주세요.'); end if;
  return study.core_rpc(op,owner_id,args);
end $$;

create function public.ai_study_account_rpc(op text,owner_id uuid,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare d study.deletion_challenges; nonce text; sent_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
  if owner_id is null or not exists(select 1 from study.profiles p where p.id=owner_id) then
    perform study.fail(401,'SESSION_EXPIRED','로그인이 만료되었습니다. 다시 로그인해 주세요.');
  end if;
  if op='reserve' then
    select * into d from study.deletion_challenges t where t.user_id=owner_id;
    if found and d.resend_at>now() then perform study.fail(429,'CODE_COOLDOWN','인증 코드는 60초 후 다시 요청할 수 있습니다.'); end if;
    perform study.rate('email-day:'||(args->>'emailHash')||':'||to_char(now() at time zone 'UTC','YYYY-MM-DD'),10,86400);
    perform study.rate('email-hour:'||to_char(now() at time zone 'UTC','YYYY-MM-DD-HH24'),100,3600);
    perform study.rate('email-day:'||to_char(now() at time zone 'UTC','YYYY-MM-DD'),500,86400);
    select reauthentication_token into nonce from auth.users where id=owner_id;
    insert into study.deletion_challenges(user_id,id,expires_at,resend_at,attempts,baseline_hash,nonce_hash,requested_at)
      values(owner_id,(args->>'challengeId')::uuid,now()+interval '5 minutes',now()+interval '60 seconds',0,nonce,null,now())
      on conflict(user_id) do update set id=excluded.id,expires_at=excluded.expires_at,resend_at=excluded.resend_at,
        attempts=0,baseline_hash=excluded.baseline_hash,nonce_hash=null,requested_at=excluded.requested_at;
    return '{}';
  end if;
  select * into d from study.deletion_challenges t where t.user_id=owner_id;
  if op='release' then
    delete from study.deletion_challenges t where t.user_id=owner_id and id=(args->>'challengeId')::uuid; return '{}';
  end if;
  if op='bind' then
    if d.id is null or d.id<>(args->>'challengeId')::uuid or d.expires_at<now() then
      perform study.fail(409,'DELETION_CHALLENGE_CHANGED','새 계정 삭제 인증 코드를 요청해 주세요.');
    end if;
    select reauthentication_token,reauthentication_sent_at into nonce,sent_at from auth.users where id=owner_id;
    if nonce is null or nonce='' or nonce is not distinct from d.baseline_hash or sent_at is null
      or sent_at<d.requested_at-interval '5 seconds' then
      perform study.fail(503,'DELETION_EMAIL_FAILED','삭제 인증 코드를 준비하지 못했습니다. 잠시 후 다시 요청해 주세요.');
    end if;
    update study.deletion_challenges t set nonce_hash=nonce where t.user_id=owner_id;
    return '{}';
  end if;
  if op='consume' then
    if d.id is null or d.nonce_hash is null or d.expires_at<=now() or d.attempts>=5 then return '{"allowed":false}'; end if;
    -- An invalid attempt must commit, so return false instead of raising an exception.
    update study.deletion_challenges t set attempts=attempts+1 where t.user_id=owner_id;
    if args->>'nonceHash' is null or args->>'nonceHash' !~ '^[0-9a-f]{56}$' or d.nonce_hash<>args->>'nonceHash' then
      return '{"allowed":false}';
    end if;
    delete from study.deletion_challenges t where t.user_id=owner_id;
    return '{"allowed":true}';
  end if;
  perform study.fail(400,'INVALID_OPERATION','지원하지 않는 인증 작업입니다.'); return 'null';
end $$;
revoke all on function public.ai_study_rpc(text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.ai_study_account_rpc(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ai_study_rpc(text,uuid,jsonb) to service_role;
grant execute on function public.ai_study_account_rpc(text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
