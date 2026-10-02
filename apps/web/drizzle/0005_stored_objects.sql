CREATE TABLE "stored_objects" (
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" bytea NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_objects_bucket_key_pk" PRIMARY KEY("bucket","key"),
	CONSTRAINT "stored_objects_bucket_check" CHECK ("stored_objects"."bucket" in ('private', 'public'))
);
