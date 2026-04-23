-- Drop old trigger referencing fault_ref
DROP TRIGGER IF EXISTS before_fault_insert ON faults;
DROP FUNCTION IF EXISTS set_fault_ref();

-- Recreate trigger using client_ref
CREATE OR REPLACE FUNCTION set_client_ref() RETURNS TRIGGER AS $$
DECLARE seq INT;
BEGIN
  IF NEW.client_ref IS NULL OR NEW.client_ref = '' THEN
    SELECT COALESCE(MAX(CAST(SPLIT_PART(client_ref, '-', 3) AS INT)), 0) + 1
    INTO seq FROM faults WHERE fault_date = NEW.fault_date;
    NEW.client_ref := 'INF-' || TO_CHAR(NEW.fault_date, 'YYYYMMDD') || '-' || LPAD(seq::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER before_fault_insert BEFORE INSERT ON faults
FOR EACH ROW EXECUTE FUNCTION set_client_ref();
