create or replace function public.unlock_hint_with_coins(target_message_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare current_balance integer;
declare owns_message boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select exists(select 1 from public.messages where id = target_message_id and recipient_id = auth.uid()) into owns_message;
  if not owns_message then raise exception 'Message not found'; end if;
  perform public.ensure_coin_wallet(auth.uid());
  if exists(select 1 from public.anonymous_sender_reveals where user_id = auth.uid() and message_id = target_message_id) then
    select balance into current_balance from public.coins where user_id = auth.uid();
    return current_balance;
  end if;
  update public.coins set balance = balance - 5, updated_at = now()
  where user_id = auth.uid() and balance >= 5 returning balance into current_balance;
  if current_balance is null then raise exception 'You need 5 coins to unlock this hint.'; end if;
  insert into public.anonymous_sender_reveals (user_id, message_id) values (auth.uid(), target_message_id);
  insert into public.coin_transactions (user_id, transaction_type, amount, description, metadata)
  values (auth.uid(), 'spend', -5, 'Unlock Hint', jsonb_build_object('message_id', target_message_id));
  return current_balance;
end;
$$;

create or replace function public.reveal_sender_with_coins(target_message_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
begin
  return public.unlock_hint_with_coins(target_message_id);
end;
$$;
