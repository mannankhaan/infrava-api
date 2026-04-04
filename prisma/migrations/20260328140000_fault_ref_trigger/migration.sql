-- Fault reference ID trigger: INF-YYYYMMDD-NNNN
CREATE OR REPLACE FUNCTION set_fault_ref() RETURNS TRIGGER AS $$
DECLARE seq INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(fault_ref, '-', 3) AS INT)), 0) + 1
  INTO seq FROM faults WHERE fault_date = NEW.fault_date;
  NEW.fault_ref := 'INF-' || TO_CHAR(NEW.fault_date, 'YYYYMMDD') || '-' || LPAD(seq::TEXT, 4, '0');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER before_fault_insert BEFORE INSERT ON faults
FOR EACH ROW EXECUTE FUNCTION set_fault_ref();
