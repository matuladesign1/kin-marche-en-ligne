-- Le créateur d'un fil le relit immédiatement (INSERT … RETURNING) : la fonction
-- can_view_ticket ne voit pas encore la ligne qui vient d'être insérée.
create policy "tickets : lecture créateur" on public.support_tickets for select to authenticated
  using (customer_id = (select auth.uid()));
