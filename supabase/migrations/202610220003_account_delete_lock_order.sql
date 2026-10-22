-- Take a profile FK-compatible lock BEFORE a user's advisory lock.
-- Auth admin deletion uses FK cascades; waiting for an advisory lock inside a
-- profile DELETE trigger can deadlock with a concurrent study write.
begin;
drop trigger profile_delete on study.profiles;
drop function study.lock_deleted_profile();

create or replace function public.ai_study_rpc(op text,owner_id uuid default null,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
begin
  if op='health' then return jsonb_build_object('schemaVersion',2); end if;
  if left(op,7)='delete_' then perform study.fail(400,'INVALID_OPERATION','삭제 인증 전용 API를 이용해 주세요.'); end if;
  if owner_id is not null then
    perform 1 from study.profiles p where p.id=owner_id for key share;
  end if;
  return study.core_rpc(op,owner_id,args);
end $$;

alter function public.ai_study_account_rpc(text,uuid,jsonb) set schema study;
alter function study.ai_study_account_rpc(text,uuid,jsonb) rename to core_account_rpc;
revoke all on function study.core_account_rpc(text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.ai_study_account_rpc(op text,owner_id uuid,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
begin
  perform 1 from study.profiles p where p.id=owner_id for key share;
  return study.core_account_rpc(op,owner_id,args);
end $$;
revoke all on function public.ai_study_rpc(text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.ai_study_account_rpc(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ai_study_rpc(text,uuid,jsonb) to service_role;
grant execute on function public.ai_study_account_rpc(text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
