ALTER TABLE "AssessmentBlueprint"
  ADD COLUMN "onDemandEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "onDemandCapacity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "requiresSupervision" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requiresEquipment" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "on_demand_delivery_policy" CHECK (
    "onDemandCapacity" BETWEEN 1 AND 100 AND
    (NOT "onDemandEnabled" OR (NOT "requiresSupervision" AND NOT "requiresEquipment"))
  );
ALTER TABLE "AssessmentAvailability" ADD COLUMN "onDemand" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "private_on_demand_window" CHECK (NOT "onDemand" OR NOT active);
ALTER TABLE "AssessmentBooking" ADD COLUMN "onDemand" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "on_demand_capacity" ON "AssessmentBooking" ("blueprintId", status) WHERE "onDemand";
CREATE FUNCTION enforce_on_demand_booking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE demand boolean;
BEGIN
 SELECT a."onDemand" INTO demand FROM "AssessmentSlot" s JOIN "AssessmentAvailability" a ON a.id=s."availabilityId" WHERE s.id=NEW."slotId";
 IF NEW."onDemand" IS DISTINCT FROM demand THEN RAISE EXCEPTION 'Booking delivery must match its availability' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW."onDemand" <> OLD."onDemand" THEN RAISE EXCEPTION 'Booking delivery is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "on_demand_booking_integrity" BEFORE INSERT OR UPDATE ON "AssessmentBooking" FOR EACH ROW EXECUTE FUNCTION enforce_on_demand_booking();
