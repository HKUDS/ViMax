WITH ranked_defaults AS (
	SELECT "id", row_number() OVER (
		PARTITION BY "tenant_id", "type"
		ORDER BY "updated_at" DESC, "id"
	) AS position
	FROM "models"
	WHERE "is_default" = 1
)
UPDATE "models"
SET "is_default" = 0
WHERE "id" IN (SELECT "id" FROM ranked_defaults WHERE position > 1);
--> statement-breakpoint
CREATE UNIQUE INDEX "models_one_default_per_tenant_type_idx"
	ON "models" USING btree ("tenant_id", "type")
	WHERE "is_default" = 1;
