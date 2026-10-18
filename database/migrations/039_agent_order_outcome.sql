-- A signed-in reader with WPG can start Neron from search without using the free daily order.
ALTER TABLE article_order_assessments
  DROP CONSTRAINT article_order_assessments_outcome_check;

ALTER TABLE article_order_assessments
  ADD CONSTRAINT article_order_assessments_outcome_check
  CHECK (outcome IN ('queued', 'rejected_not_clean', 'rejected_daily_limit', 'agent'));
